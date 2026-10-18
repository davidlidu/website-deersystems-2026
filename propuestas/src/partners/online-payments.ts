import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PARTNERS_URL } from '../config.ts';
import { db as sqlite } from '../db.ts';
import { HttpError, json, readBody, readJson } from '../http.ts';
import { decrypt, encrypt, mask } from '../secrets.ts';
import type { Viewer } from './auth.ts';
import * as billing from './billing.ts';
import { requireOwner, str } from './common.ts';
import * as db from './db.ts';
import { notify } from './notify.ts';

/**
 * Pago en línea OPCIONAL con Wompi (links de pago: PSE, Nequi, botón Bancolombia, tarjetas).
 * Todo cobra comisión, así que está apagado por defecto y se activa por cuenta de cobro, solo si el cliente lo pide.
 * Lo normal sigue siendo la transferencia o el QR a tu cuenta, que no cobra nada.
 *
 * Flujo: activar en una cuenta de cobro → se crea un link de pago de un solo uso por el saldo, en COP.
 * Wompi avisa por webhook (firmado con el secreto de eventos); el pago aprobado se registra como abono aplicado
 * a esa cuenta de cobro y va al Gestor financiero como cualquier abono.
 */

interface Config {
  enabled: boolean;
  env: 'sandbox' | 'production';
  publicKey: string;
  privateKey: string | null;
  eventsSecret: string | null;
}

function config(): Config {
  const s = db.getSetting<{ enabled?: boolean; env?: string; publicKey?: string; privateKey?: string; eventsSecret?: string }>('online_payments') ?? {};
  return {
    enabled: !!s.enabled,
    env: s.env === 'production' ? 'production' : 'sandbox',
    publicKey: s.publicKey ?? '',
    privateKey: decrypt(s.privateKey),
    eventsSecret: decrypt(s.eventsSecret),
  };
}

const apiBase = (c: Config) => (c.env === 'production' ? 'https://production.wompi.co/v1' : 'https://sandbox.wompi.co/v1');
export const onlinePaymentsReady = () => {
  const c = config();
  return c.enabled && !!c.privateKey && !!c.eventsSecret;
};

if (!(sqlite.prepare('PRAGMA table_info(invoices)').all() as { name: string }[]).some((c) => c.name === 'online_link_id')) {
  sqlite.exec(`
    ALTER TABLE invoices ADD COLUMN online_link_id TEXT;
    ALTER TABLE invoices ADD COLUMN online_link_url TEXT;
  `);
}

export function onlineLink(invoiceId: number): string | null {
  const row = sqlite.prepare('SELECT online_link_url FROM invoices WHERE id = ?').get(invoiceId) as { online_link_url: string | null } | undefined;
  return row?.online_link_url && onlinePaymentsReady() ? row.online_link_url : null;
}

async function wompi(c: Config, method: string, path: string, body?: unknown) {
  let r: Response;
  try {
    r = await fetch(`${apiBase(c)}${path}`, {
      method,
      headers: { Authorization: `Bearer ${c.privateKey}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new HttpError(502, `No se pudo conectar con Wompi: ${(err as Error).message}`);
  }
  const data = (await r.json().catch(() => ({}))) as { data?: Record<string, unknown>; error?: { reason?: string; messages?: unknown } };
  if (!r.ok) throw new HttpError(502, `Wompi respondió ${r.status}: ${data.error?.reason ?? JSON.stringify(data.error?.messages ?? '')}`);
  return data.data ?? {};
}

/** Firma de los eventos: SHA256(valores de signature.properties + timestamp + secreto de eventos). */
export function validEvent(event: Record<string, unknown>, secret: string): boolean {
  const sig = event.signature as { properties?: string[]; checksum?: string } | undefined;
  if (!sig?.properties?.length || !sig.checksum) return false;
  const data = event.data as Record<string, unknown>;
  const pick = (path: string) => path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), data);
  const raw = sig.properties.map((p) => String(pick(p) ?? '')).join('') + String(event.timestamp ?? '') + secret;
  const mine = Buffer.from(createHash('sha256').update(raw).digest('hex').toUpperCase());
  const theirs = Buffer.from(String(sig.checksum).toUpperCase());
  return mine.length === theirs.length && timingSafeEqual(mine, theirs);
}

/** Webhook de Wompi (sin sesión: lo autentica la firma). Siempre responde 200 si la firma es válida. */
export async function handleWompiWebhook(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const c = config();
  let event: Record<string, unknown>;
  try {
    event = JSON.parse((await readBody(req, 256 * 1024)).toString());
  } catch {
    throw new HttpError(400, 'Evento no válido.');
  }
  if (!c.eventsSecret || !validEvent(event, c.eventsSecret)) throw new HttpError(401, 'Firma no válida.');
  const tx = ((event.data as Record<string, unknown>)?.transaction ?? {}) as Record<string, unknown>;
  if (event.event !== 'transaction.updated' || tx.status !== 'APPROVED' || !tx.payment_link_id) return json(res, 200, { ok: true });

  const invoice = sqlite.prepare('SELECT id FROM invoices WHERE online_link_id = ?').get(String(tx.payment_link_id)) as { id: number } | undefined;
  const inv = invoice ? billing.getInvoice(invoice.id) : undefined;
  const ref = `deersystems-wompi-${String(tx.id)}`;
  if (!inv || sqlite.prepare('SELECT 1 FROM receipts WHERE finance_ref = ?').get(ref)) return json(res, 200, { ok: true });

  const amount = Math.round(Number(tx.amount_in_cents)) / 100;
  const receipt = billing.saveReceipt(
    {
      clientId: inv.client_id,
      projectId: inv.project_id,
      invoiceId: inv.id,
      amountCop: amount,
      currency: 'COP',
      amount,
      trm: null,
      date: billing.todayBogota(),
      method: `Wompi · ${String(tx.payment_method_type ?? 'en línea')}`,
      notes: `Pago en línea ${String(tx.id)}`,
    },
    { financeRef: ref },
  );
  await billing.syncReceipt(receipt);
  // El link era de un solo uso: queda cerrado.
  sqlite.prepare('UPDATE invoices SET online_link_id = NULL, online_link_url = NULL WHERE id = ?').run(inv.id);
  notify('online_payment', {
    actor: null,
    projectId: inv.project_id,
    title: `Pago en línea recibido: cuenta de cobro ${inv.number}`,
    body: `${db.getClient(inv.client_id)?.name ?? ''} · $ ${amount.toLocaleString('es-CO')}`,
    path: `/cuentas-de-cobro/${inv.id}`,
  });
  json(res, 200, { ok: true });
}

export async function handleOnlinePayments(route: string, id: number, req: IncomingMessage, res: ServerResponse, v: Viewer): Promise<boolean> {
  switch (route) {
    case 'GET settings/online-payments': {
      requireOwner(v);
      const c = config();
      json(res, 200, {
        enabled: c.enabled,
        env: c.env,
        publicKey: c.publicKey,
        hasPrivateKey: !!c.privateKey,
        privateKeyHint: mask(c.privateKey),
        hasEventsSecret: !!c.eventsSecret,
        webhookUrl: `${PARTNERS_URL}/api/webhooks/wompi`,
      });
      return true;
    }

    case 'PUT settings/online-payments': {
      requireOwner(v);
      const body = await readJson(req);
      const cur = db.getSetting<Record<string, unknown>>('online_payments') ?? {};
      const secret = (k: string) => (typeof body[k] === 'string' ? ((body[k] as string).trim() ? encrypt((body[k] as string).trim()) : undefined) : cur[k]);
      db.setSetting('online_payments', {
        enabled: typeof body.enabled === 'boolean' ? body.enabled : !!cur.enabled,
        env: body.env === 'production' ? 'production' : body.env === 'sandbox' ? 'sandbox' : (cur.env ?? 'sandbox'),
        publicKey: typeof body.publicKey === 'string' ? str(body.publicKey, 200) : cur.publicKey,
        privateKey: secret('privateKey'),
        eventsSecret: secret('eventsSecret'),
      });
      json(res, 200, { ok: true, ready: onlinePaymentsReady() });
      return true;
    }

    case 'POST invoices/:id/online': {
      // Activar (crea el link por el saldo) o desactivar el pago en línea de una cuenta de cobro.
      requireOwner(v);
      const inv = billing.getInvoice(id);
      if (!inv) throw new HttpError(404, 'La cuenta de cobro no existe.');
      const body = await readJson(req);
      const c = config();
      const current = sqlite.prepare('SELECT online_link_id FROM invoices WHERE id = ?').get(id) as { online_link_id: string | null };
      if (body.enabled === false) {
        if (current.online_link_id && c.privateKey) await wompi(c, 'PATCH', `/payment_links/${current.online_link_id}`, { active: false }).catch(() => {});
        sqlite.prepare('UPDATE invoices SET online_link_id = NULL, online_link_url = NULL WHERE id = ?').run(id);
        json(res, 200, { link: null });
        return true;
      }
      if (!onlinePaymentsReady()) throw new HttpError(409, 'Activa y configura el pago en línea en Configuración → Finanzas.');
      if (inv.status === 'anulada') throw new HttpError(409, 'La cuenta de cobro está anulada.');
      const detail = billing.invoiceDetail(inv);
      const due = Math.round(inv.total_cop - detail.applied);
      if (due <= 0) throw new HttpError(409, 'La cuenta de cobro ya está pagada.');
      const client = db.getClient(inv.client_id)!;
      const link = await wompi(c, 'POST', '/payment_links', {
        name: `Cuenta de cobro ${inv.number}`.slice(0, 60),
        description: `${client.name}${inv.project_id ? ` · ${db.getProject(inv.project_id)?.name ?? ''}` : ''}`.slice(0, 255),
        single_use: true,
        collect_shipping: false,
        currency: 'COP',
        amount_in_cents: due * 100,
        sku: `cc-${inv.id}`,
        redirect_url: `${PARTNERS_URL}/cuentas-de-cobro/${inv.id}`,
      });
      const linkId = String(link.id ?? '');
      if (!linkId) throw new HttpError(502, 'Wompi no devolvió el link.');
      const url = `https://checkout.wompi.co/l/${linkId}`;
      sqlite.prepare('UPDATE invoices SET online_link_id = ?, online_link_url = ? WHERE id = ?').run(linkId, url, id);
      json(res, 200, { link: url, amount: due });
      return true;
    }
  }
  return false;
}
