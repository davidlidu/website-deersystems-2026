import type { IncomingMessage, ServerResponse } from 'node:http';
import { AiError, completeJson } from '../ai.ts';
import { db as sqlite } from '../db.ts';
import { HttpError, json, readJson } from '../http.ts';
import { decrypt, encrypt, mask } from '../secrets.ts';
import type { Viewer } from './auth.ts';
import { optDate, requireOwner, str, visibleProject } from './common.ts';
import * as db from './db.ts';

/**
 * Pagos del proyecto según la propuesta (anticipo, cuotas, contra entrega). Solo tú los editas;
 * el cliente los ve; el equipo nunca (son valores).
 *
 * Al marcar uno como pagado se registra como ingreso en el Gestor financiero
 * (POST /integrations/billing-payment, idempotente por referencia). El Gestor lleva todo en COP:
 * los pagos en USD se registran con el valor recibido en pesos (por defecto, monto × TRM del día).
 */
export type Currency = 'USD' | 'COP';
type SyncStatus = 'ok' | 'error' | null;

interface Row {
  id: number;
  project_id: number;
  label: string;
  percent: number | null;
  amount: number;
  currency: Currency;
  due_date: string | null;
  position: number;
  paid: number;
  paid_at: string | null;
  amount_cop: number | null;
  trm: number | null;
  sync_status: SyncStatus;
  sync_error: string | null;
  synced_at: string | null;
  created_at: string;
  updated_at: string;
}

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    percent REAL,
    amount REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'COP',
    due_date TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    paid INTEGER NOT NULL DEFAULT 0,
    paid_at TEXT,
    amount_cop REAL,
    trm REAL,
    sync_status TEXT,
    sync_error TEXT,
    synced_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS payments_project ON payments(project_id, position);
`);

const now = () => new Date().toISOString();
const todayBogota = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
const get = (id: number) => sqlite.prepare('SELECT * FROM payments WHERE id = ?').get(id) as Row | undefined;
const listFor = (projectId: number) =>
  sqlite.prepare('SELECT * FROM payments WHERE project_id = ? ORDER BY position, id').all(projectId) as unknown as Row[];

export interface PaymentInput {
  label: string;
  percent: number | null;
  amount: number;
  currency: Currency;
  dueDate: string | null;
}

/** Valida lo que llega del panel o de la IA. Devuelve null si no sirve (sin concepto o sin monto). */
export function normalizePayment(raw: Record<string, unknown>): PaymentInput | null {
  const amount = Math.round(Number(raw?.amount) * 100) / 100;
  const label = str(raw?.label, 160);
  if (!label || !Number.isFinite(amount) || amount <= 0) return null;
  const percent = Number(raw?.percent);
  return {
    label,
    percent: Number.isFinite(percent) && percent > 0 && percent <= 100 ? Math.round(percent * 100) / 100 : null,
    amount,
    currency: String(raw?.currency).toUpperCase() === 'USD' ? 'USD' : 'COP',
    dueDate: optDate(raw?.dueDate) ?? null,
  };
}

export function createPayments(projectId: number, items: PaymentInput[]): void {
  const start = (sqlite.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM payments WHERE project_id = ?').get(projectId) as { n: number }).n;
  const ins = sqlite.prepare(
    'INSERT INTO payments (project_id, label, percent, amount, currency, due_date, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const ts = now();
  items.forEach((p, i) => ins.run(projectId, p.label, p.percent, p.amount, p.currency, p.dueDate, start + i, ts, ts));
}

function view(r: Row, v: Viewer) {
  const owner = v.kind === 'owner';
  return {
    id: r.id,
    label: r.label,
    percent: r.percent,
    amount: r.amount,
    currency: r.currency,
    dueDate: r.due_date,
    paid: !!r.paid,
    paidAt: r.paid_at,
    // Lo del Gestor (pesos recibidos, TRM, sincronización) es solo para ti.
    ...(owner ? { amountCop: r.amount_cop, trm: r.trm, sync: r.sync_status, syncError: r.sync_error, syncedAt: r.synced_at } : {}),
  };
}

function visiblePayment(id: number, v: Viewer): Row {
  const r = get(id);
  if (!r) throw new HttpError(404, 'El pago no existe.');
  if (v.kind === 'team') throw new HttpError(403, 'No tienes acceso a los pagos.');
  visibleProject(r.project_id, v);
  return r;
}

// ───────── Gestor financiero ─────────

const DEFAULT_URL = 'https://api.finanzas.lidutech.net/api';

interface FinanceConfig {
  url: string;
  apiKey: string | null;
}

function financeConfig(): FinanceConfig {
  const s = db.getSetting<{ url?: string; apiKey?: string }>('finanzas');
  return { url: (s?.url || DEFAULT_URL).replace(/\/+$/, ''), apiKey: decrypt(s?.apiKey) };
}

export function financeConfigured(): boolean {
  return !!financeConfig().apiKey;
}

class FinanceError extends Error {}

async function financeCall(method: 'PUT' | 'DELETE', path: string, body?: unknown): Promise<void> {
  const cfg = financeConfig();
  if (!cfg.apiKey) throw new FinanceError('El Gestor financiero no está conectado (Configuración → Finanzas).');
  let r: Response;
  try {
    r = await fetch(`${cfg.url}${path}`, {
      method,
      headers: { 'x-api-key': cfg.apiKey, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new FinanceError(`No se pudo conectar con el Gestor: ${(err as Error).message}`);
  }
  if (r.ok) return;
  const text = await r.text().catch(() => '');
  let msg = text.slice(0, 300);
  try {
    msg = (JSON.parse(text) as { error?: string }).error ?? msg;
  } catch {
    /* no es JSON */
  }
  if (r.status === 401) msg = 'La clave del Gestor no es válida.';
  throw new FinanceError(`Gestor financiero (${r.status}): ${msg || r.statusText}`);
}

const reference = (r: Row) => `deersystems-pago-${r.id}`;

const money = (n: number, currency: Currency) =>
  `${currency} ${n.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/** Ingreso en el Gestor: categoría = empresa; descripción = proyecto, tipo de abono y porcentaje. */
function financePayload(r: Row) {
  const project = db.getProject(r.project_id)!;
  const client = db.getClient(project.client_id);
  const parts = [`${project.name} — ${r.label}`];
  if (r.percent) parts.push(`${r.percent}%`);
  if (r.currency === 'USD') parts.push(`${money(r.amount, 'USD')}${r.trm ? ` a TRM ${r.trm.toLocaleString('es-CO')}` : ''}`);
  return {
    amount: r.currency === 'USD' ? r.amount_cop : r.amount,
    date: r.paid_at,
    clientName: client?.name ?? 'Cliente',
    description: parts.join(' · '),
    paymentMethod: 'transfer',
  };
}

/** Lleva el estado del pago al Gestor: pagado → crea o actualiza el ingreso; no pagado → lo borra. */
async function sync(r: Row): Promise<Row> {
  const set = (status: SyncStatus, error: string | null) =>
    sqlite
      .prepare('UPDATE payments SET sync_status = ?, sync_error = ?, synced_at = ? WHERE id = ?')
      .run(status, error, status === 'ok' ? now() : r.synced_at, r.id);
  try {
    if (r.paid) await financeCall('PUT', `/integrations/billing-payment/${reference(r)}`, financePayload(r));
    else if (r.sync_status) await financeCall('DELETE', `/integrations/billing-payment/${reference(r)}`);
    else return r; // nunca se sincronizó: no hay nada que borrar
    set(r.paid ? 'ok' : null, null);
  } catch (err) {
    if (!(err instanceof FinanceError)) throw err;
    set('error', err.message);
  }
  return get(r.id)!;
}

// ───────── TRM (Superintendencia Financiera, datos abiertos) ─────────

const trmCache = new Map<string, number>();

/** TRM vigente para una fecha (la del día hábil anterior si cae en fin de semana o festivo). */
export async function trmFor(date: string): Promise<number | null> {
  if (trmCache.has(date)) return trmCache.get(date)!;
  const q = new URLSearchParams({ $where: `vigenciadesde <= '${date}T00:00:00.000'`, $order: 'vigenciadesde DESC', $limit: '1' });
  try {
    const r = await fetch(`https://www.datos.gov.co/resource/32sa-8pi3.json?${q}`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const value = Number(((await r.json()) as { valor?: string }[])[0]?.valor);
    if (!Number.isFinite(value) || value <= 0) return null;
    trmCache.set(date, value);
    return value;
  } catch {
    return null;
  }
}

// ───────── IA: pagos a partir de la propuesta ─────────

export const PAYMENTS_PROMPT = `"payments": el plan de pagos que pactó el cliente según los valores y la forma de pago de la propuesta (anticipo, cuotas, pago contra entrega, mensualidades). Cada uno:
  { "label": "tipo de abono, p. ej. Anticipo, Segundo pago, Pago contra entrega", "percent": porcentaje del total o null, "amount": monto numérico sin separadores, "currency": "USD" o "COP", "dueDate": "YYYY-MM-DD" }
  Fechas coherentes con el cronograma (el anticipo al inicio, el pago final en la entrega). Si la propuesta no trae valores, [].`;

async function suggestPayments(project: db.Project) {
  if (!project.pricing.trim()) throw new HttpError(400, 'El proyecto no tiene valores ni forma de pago guardados (pestaña Propuesta y valores).');
  const { data } = await completeJson<{ payments?: unknown }>({
    profile: 'propuestas',
    purpose: 'pagos',
    system: 'Eres el asistente financiero de DeerSystems. Responde SOLO con un objeto JSON válido, en español.',
    prompt: `Proyecto "${project.name}". Inicio: ${project.start_date ?? 'sin fecha'}. Entrega estimada: ${project.end_date ?? 'sin fecha'}. Hoy: ${todayBogota()}.
Opción aprobada: ${project.approved_option || '(única)'}. Ajustes al aprobar: ${project.approval_notes || '(ninguno)'}.

VALORES Y FORMA DE PAGO:
"""
${project.pricing.slice(0, 15_000)}
"""

Devuelve { ${PAYMENTS_PROMPT} }
Usa solo los valores de la opción aprobada.`,
  });
  return (Array.isArray(data.payments) ? data.payments : [])
    .map((p) => normalizePayment(p as Record<string, unknown>))
    .filter((p): p is PaymentInput => !!p)
    .slice(0, 24);
}

// ───────── Rutas ─────────

export async function handlePayments(route: string, id: number, req: IncomingMessage, res: ServerResponse, v: Viewer, url: URL): Promise<boolean> {
  switch (route) {
    case 'GET projects/:id/payments': {
      if (v.kind === 'team') throw new HttpError(403, 'No tienes acceso a los pagos.');
      visibleProject(id, v);
      json(res, 200, { payments: listFor(id).map((r) => view(r, v)), ...(v.kind === 'owner' ? { finance: financeConfigured() } : {}) });
      return true;
    }

    case 'POST projects/:id/payments': {
      requireOwner(v);
      visibleProject(id, v);
      const body = await readJson(req);
      const items = (Array.isArray(body.payments) ? body.payments : [body]).map((p) => normalizePayment(p as Record<string, unknown>));
      if (!items.length || items.some((p) => !p)) throw new HttpError(400, 'Cada pago necesita un concepto y un monto mayor a cero.');
      createPayments(id, items as PaymentInput[]);
      json(res, 201, { payments: listFor(id).map((r) => view(r, v)) });
      return true;
    }

    case 'POST projects/:id/payments/suggest': {
      requireOwner(v);
      const project = visibleProject(id, v);
      try {
        json(res, 200, { payments: await suggestPayments(project) });
      } catch (err) {
        if (err instanceof AiError) throw new HttpError(502, err.message);
        throw err;
      }
      return true;
    }

    case 'PATCH payments/:id': {
      requireOwner(v);
      const r = visiblePayment(id, v);
      const body = await readJson(req);
      const next = normalizePayment({
        label: body.label ?? r.label,
        percent: body.percent === undefined ? r.percent : body.percent,
        amount: body.amount ?? r.amount,
        currency: body.currency ?? r.currency,
        dueDate: body.dueDate === undefined ? r.due_date : body.dueDate,
      });
      if (!next) throw new HttpError(400, 'El pago necesita un concepto y un monto mayor a cero.');
      sqlite
        .prepare('UPDATE payments SET label = ?, percent = ?, amount = ?, currency = ?, due_date = ?, updated_at = ? WHERE id = ?')
        .run(next.label, next.percent, next.amount, next.currency, next.dueDate, now(), r.id);
      let updated = get(r.id)!;
      // Si ya estaba pagado en COP, el ingreso del Gestor sigue el nuevo monto. En USD manda el valor recibido en pesos.
      if (updated.paid) {
        if (updated.currency === 'COP') sqlite.prepare('UPDATE payments SET amount_cop = amount WHERE id = ?').run(r.id);
        updated = await sync(get(r.id)!);
      }
      json(res, 200, view(updated, v));
      return true;
    }

    case 'POST payments/:id/paid': {
      // Marcar o desmarcar como pagado. Al marcar: fecha del pago y, si es en USD, pesos recibidos y TRM.
      requireOwner(v);
      const r = visiblePayment(id, v);
      const body = await readJson(req);
      if (body.paid === false) {
        sqlite.prepare('UPDATE payments SET paid = 0, paid_at = NULL, amount_cop = NULL, trm = NULL, updated_at = ? WHERE id = ?').run(now(), r.id);
      } else {
        const paidAt = optDate(body.paidAt) ?? todayBogota();
        let amountCop = r.amount;
        let trm: number | null = null;
        if (r.currency === 'USD') {
          trm = Number(body.trm) > 0 ? Number(body.trm) : await trmFor(paidAt);
          const given = Number(body.amountCop);
          amountCop = given > 0 ? Math.round(given * 100) / 100 : trm ? Math.round(r.amount * trm) : 0;
          if (!amountCop) throw new HttpError(400, 'No se pudo obtener la TRM. Escribe cuántos pesos recibiste.');
        }
        sqlite
          .prepare('UPDATE payments SET paid = 1, paid_at = ?, amount_cop = ?, trm = ?, updated_at = ? WHERE id = ?')
          .run(paidAt, amountCop, trm, now(), r.id);
      }
      json(res, 200, view(await sync(get(r.id)!), v));
      return true;
    }

    case 'POST payments/:id/sync': {
      requireOwner(v);
      json(res, 200, view(await sync(visiblePayment(id, v)), v));
      return true;
    }

    case 'DELETE payments/:id': {
      requireOwner(v);
      const r = visiblePayment(id, v);
      if (r.sync_status) {
        // Primero se quita el ingreso del Gestor; si falla, el pago se queda para no dejar un ingreso huérfano.
        try {
          await financeCall('DELETE', `/integrations/billing-payment/${reference(r)}`);
        } catch (err) {
          if (err instanceof FinanceError) throw new HttpError(502, `${err.message} El pago no se borró.`);
          throw err;
        }
      }
      sqlite.prepare('DELETE FROM payments WHERE id = ?').run(r.id);
      json(res, 200, { ok: true });
      return true;
    }

    case 'GET trm': {
      requireOwner(v);
      const date = optDate(url.searchParams.get('date')) ?? todayBogota();
      json(res, 200, { date, trm: await trmFor(date) });
      return true;
    }

    // ── Configuración: Gestor financiero
    case 'GET settings/finanzas': {
      requireOwner(v);
      const cfg = financeConfig();
      json(res, 200, { url: cfg.url, defaultUrl: DEFAULT_URL, hasKey: !!cfg.apiKey, keyHint: mask(cfg.apiKey) });
      return true;
    }

    case 'PUT settings/finanzas': {
      requireOwner(v);
      const body = await readJson(req);
      const current = db.getSetting<{ url?: string; apiKey?: string }>('finanzas') ?? {};
      const urlIn = str(body.url, 300);
      if (urlIn && !/^https?:\/\/[^\s]+$/.test(urlIn)) throw new HttpError(400, 'La URL del Gestor no es válida.');
      const key = typeof body.apiKey === 'string' ? body.apiKey.trim() : undefined;
      db.setSetting('finanzas', {
        url: urlIn || current.url || DEFAULT_URL,
        apiKey: key === undefined ? current.apiKey : key ? encrypt(key) : undefined,
      });
      const cfg = financeConfig();
      json(res, 200, { url: cfg.url, defaultUrl: DEFAULT_URL, hasKey: !!cfg.apiKey, keyHint: mask(cfg.apiKey) });
      return true;
    }

    case 'POST settings/finanzas/test': {
      // Borrar una referencia que no existe es inofensivo e idempotente: sirve para probar URL y clave.
      requireOwner(v);
      try {
        await financeCall('DELETE', '/integrations/billing-payment/deersystems-prueba-conexion');
      } catch (err) {
        if (err instanceof FinanceError) throw new HttpError(502, err.message);
        throw err;
      }
      json(res, 200, { ok: true });
      return true;
    }
  }
  return false;
}
