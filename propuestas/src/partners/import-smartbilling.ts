import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { DATA_DIR } from '../config.ts';
import { db as sqlite } from '../db.ts';
import { HttpError, json, readBody, readJson } from '../http.ts';
import type { Viewer } from './auth.ts';
import * as billing from './billing.ts';
import { requireOwner, str } from './common.ts';
import * as db from './db.ts';

/**
 * Migración única desde SmartBilling: clientes, cuentas de cobro con sus ítems, abonos y perfil del remitente.
 *
 * 1. Vista previa: se leen los datos (de su API o de un JSON exportado), se guardan en una instantánea y se proponen
 *    las coincidencias con los clientes que ya existen aquí (por documento o por nombre).
 * 2. Importar: con las coincidencias que confirmes. Es idempotente (sb_id): repetirla no duplica nada.
 *
 * Para que todo quede igual en reportes y en el Gestor financiero:
 * - El total en COP de cada cuenta de cobro es el que guardó SmartBilling.
 * - Los abonos conservan su referencia en el Gestor (el UUID del pago), su categoría (el nombre del cliente en
 *   SmartBilling) y la descripción que el Gestor les puso; no se vuelven a enviar porque ya están allá.
 * - Los abonos siguen ligados al cliente, sin aplicarse a una cuenta de cobro (SmartBilling no tenía esa relación).
 */

interface SbClient {
  id: string;
  nitOrCc: string;
  name: string;
  city: string;
  phone: string;
  address: string;
}
interface SbItem {
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
}
interface SbInvoice {
  id: string;
  invoiceNumber: string;
  date: string;
  clientId: string;
  notes: string;
  currency: 'COP' | 'USD';
  exchangeRate: number | null;
  totalAmount: number;
  lineItems: SbItem[];
}
interface SbPayment {
  id: string;
  clientId: string;
  amount: number;
  date: string;
  method: string;
  notes: string;
  proofUrl: string | null;
}
interface SbProfile {
  name: string;
  nit: string;
  type: string;
  logoUrl: string | null;
  address: string;
  phone: string;
  email: string;
  bankAccountInfo: string;
  signatureName: string;
  signatureCC: string;
  signatureImageUrl: string | null;
}
interface Snapshot {
  id: string;
  fetchedAt: string;
  source: string;
  clients: SbClient[];
  invoices: SbInvoice[];
  payments: SbPayment[];
  profile: SbProfile | null;
}

const DIR = join(DATA_DIR, 'imports');
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trim();
const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
};
// MySQL devuelve las fechas como "2025-12-03T00:00:00.000Z": SmartBilling muestra la parte de la fecha, igual aquí.
const day = (v: unknown) => s(v).slice(0, 10);

/** Normaliza lo que llegue (API de SmartBilling o JSON exportado) a una instantánea. */
function normalize(raw: { clients?: unknown; invoices?: unknown; payments?: unknown; profile?: unknown }, source: string): Snapshot {
  const arr = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
  const clients = arr(raw.clients).map((c) => ({
    id: s(c.id),
    nitOrCc: s(c.nitOrCc),
    name: s(c.name),
    city: s(c.city),
    phone: s(c.phone),
    address: s(c.address),
  }));
  const invoices = arr(raw.invoices).map((i) => ({
    id: s(i.id),
    invoiceNumber: s(i.invoiceNumber),
    date: day(i.date),
    clientId: s(i.clientId),
    notes: s(i.notes),
    currency: (s(i.currency).toUpperCase() === 'USD' ? 'USD' : 'COP') as 'COP' | 'USD',
    exchangeRate: i.exchangeRate === null || i.exchangeRate === undefined ? null : num(i.exchangeRate),
    totalAmount: num(i.totalAmount),
    lineItems: arr(i.lineItems).map((li) => ({ description: s(li.description), quantity: num(li.quantity), unit: s(li.unit), unitPrice: num(li.unitPrice) })),
  }));
  const payments = arr(raw.payments).map((p) => ({
    id: s(p.id),
    clientId: s(p.clientId),
    amount: num(p.amount),
    date: day(p.date),
    method: s(p.method),
    notes: s(p.notes),
    proofUrl: s(p.proofUrl) || null,
  }));
  const pr = raw.profile && typeof raw.profile === 'object' ? (raw.profile as Record<string, unknown>) : null;
  const profile = pr
    ? {
        name: s(pr.name),
        nit: s(pr.nit),
        type: s(pr.type),
        logoUrl: s(pr.logoUrl) || null,
        address: s(pr.address),
        phone: s(pr.phone),
        email: s(pr.email),
        bankAccountInfo: s(pr.bankAccountInfo),
        signatureName: s(pr.signatureName),
        signatureCC: s(pr.signatureCC),
        signatureImageUrl: s(pr.signatureImageUrl) || null,
      }
    : null;
  if (!clients.length && !invoices.length && !payments.length) throw new HttpError(400, 'No llegaron clientes, cuentas de cobro ni pagos.');
  return { id: randomUUID(), fetchedAt: new Date().toISOString(), source, clients, invoices, payments, profile };
}

/** Lee todo desde la API de SmartBilling (con token si ya está protegida). */
async function fetchFromApi(base: string, token: string): Promise<Snapshot> {
  const root = base.replace(/\/+$/, '');
  const get = async (path: string) => {
    let r: Response;
    try {
      r = await fetch(`${root}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(20_000) });
    } catch (err) {
      throw new HttpError(502, `No se pudo conectar con SmartBilling (${path}): ${(err as Error).message}`);
    }
    if (r.status === 401 || r.status === 403) throw new HttpError(502, 'SmartBilling rechazó el acceso: revisa el token.');
    if (!r.ok) throw new HttpError(502, `SmartBilling respondió ${r.status} en ${path}.`);
    return r.json() as Promise<unknown>;
  };
  const [clients, list, payments] = await Promise.all([get('/clients'), get('/invoices'), get('/payments')]);
  const profile = await get('/settings/profile').catch(() => null);
  // La lista no trae los ítems: se pide cada cuenta de cobro (de a 5).
  const ids = (Array.isArray(list) ? list : []).map((i: Record<string, unknown>) => s(i.id)).filter(Boolean);
  const invoices: unknown[] = [];
  for (let i = 0; i < ids.length; i += 5) {
    invoices.push(...(await Promise.all(ids.slice(i, i + 5).map((id) => get(`/invoices/${encodeURIComponent(id)}`)))));
  }
  return normalize({ clients, invoices, payments, profile }, root);
}

function saveSnapshot(snap: Snapshot) {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(join(DIR, `smartbilling-${snap.id}.json`), JSON.stringify(snap));
}

function loadSnapshot(id: string): Snapshot {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(400, 'Vista previa no válida.');
  try {
    return JSON.parse(readFileSync(join(DIR, `smartbilling-${id}.json`), 'utf8')) as Snapshot;
  } catch {
    throw new HttpError(404, 'La vista previa expiró: vuelve a leer los datos.');
  }
}

// ───────── Coincidencias ─────────

const digits = (v: string) => v.replace(/\D+/g, '');
/** NIT sin dígito de verificación ("900123456-7" → "900123456"), para comparar documentos. */
const docKey = (v: string) => {
  const m = v.match(/^\s*([\d.\s]+)\s*-\s*\d\s*$/);
  return digits(m ? m[1] : v);
};
const LEGAL = /\b(s\.?\s?a\.?\s?s\.?|s\.?\s?a\.?|ltda\.?|e\.?\s?u\.?|s\.?\s?en\s?c\.?|y\s+cia\.?|inc\.?|llc)\b/g;
export const normName = (v: string) =>
  v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(LEGAL, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function similarity(a: string, b: string) {
  const ta = new Set(normName(a).split(' ').filter((w) => w.length > 2));
  const tb = new Set(normName(b).split(' ').filter((w) => w.length > 2));
  if (!ta.size || !tb.size) return 0;
  const inter = [...ta].filter((w) => tb.has(w)).length;
  return inter / Math.min(ta.size, tb.size);
}

type How = 'importado' | 'documento' | 'nombre' | 'parecido';

function suggest(c: SbClient, portal: db.Client[]): { clientId: number; how: How } | null {
  const already = portal.find((p) => p.sb_id === c.id);
  if (already) return { clientId: already.id, how: 'importado' };
  const doc = docKey(c.nitOrCc);
  if (doc.length >= 5) {
    const byDoc = portal.find((p) => p.doc_number && docKey(p.doc_number) === doc);
    if (byDoc) return { clientId: byDoc.id, how: 'documento' };
  }
  const byName = portal.find((p) => normName(p.name) === normName(c.name));
  if (byName) return { clientId: byName.id, how: 'nombre' };
  let best: { clientId: number; score: number } | null = null;
  for (const p of portal) {
    const score = similarity(c.name, p.name);
    if (score >= 0.6 && (!best || score > best.score)) best = { clientId: p.id, score };
  }
  return best ? { clientId: best.clientId, how: 'parecido' } : null;
}

function preview(snap: Snapshot) {
  const portal = sqlite.prepare('SELECT * FROM clients ORDER BY name').all() as unknown as db.Client[];
  const imported = {
    invoices: new Set((sqlite.prepare('SELECT sb_id FROM invoices WHERE sb_id IS NOT NULL').all() as { sb_id: string }[]).map((r) => r.sb_id)),
    receipts: new Set((sqlite.prepare('SELECT sb_id FROM receipts WHERE sb_id IS NOT NULL').all() as { sb_id: string }[]).map((r) => r.sb_id)),
  };
  // Números de cuenta de cobro que ya existen aquí y no vienen de SmartBilling: chocarían.
  const localNumbers = new Set((sqlite.prepare('SELECT number FROM invoices WHERE sb_id IS NULL').all() as { number: string }[]).map((r) => r.number));
  const known = new Set(snap.clients.map((c) => c.id));
  return {
    id: snap.id,
    source: snap.source,
    fetchedAt: snap.fetchedAt,
    totals: {
      clients: snap.clients.length,
      invoices: snap.invoices.length,
      items: snap.invoices.reduce((n, i) => n + i.lineItems.length, 0),
      payments: snap.payments.length,
      invoiced: snap.invoices.reduce((n, i) => n + i.totalAmount, 0),
      paid: snap.payments.reduce((n, p) => n + p.amount, 0),
      alreadyImported: { invoices: snap.invoices.filter((i) => imported.invoices.has(i.id)).length, payments: snap.payments.filter((p) => imported.receipts.has(p.id)).length },
    },
    clients: snap.clients.map((c) => {
      const inv = snap.invoices.filter((i) => i.clientId === c.id);
      const pays = snap.payments.filter((p) => p.clientId === c.id);
      return {
        sbId: c.id,
        name: c.name,
        docNumber: c.nitOrCc,
        city: c.city,
        invoices: inv.length,
        invoiced: inv.reduce((n, i) => n + i.totalAmount, 0),
        payments: pays.length,
        paid: pays.reduce((n, p) => n + p.amount, 0),
        suggestion: suggest(c, portal),
      };
    }),
    portalClients: portal.map((p) => ({ id: p.id, name: p.name, docNumber: p.doc_number, email: p.email })),
    problems: [
      ...snap.invoices.filter((i) => localNumbers.has(i.invoiceNumber)).map((i) => `La cuenta de cobro ${i.invoiceNumber} ya existe aquí (creada en el portal): no se importará.`),
      ...snap.invoices.filter((i) => !known.has(i.clientId)).map((i) => `La cuenta de cobro ${i.invoiceNumber} es de un cliente que no vino en la exportación.`),
      ...snap.payments.filter((p) => !known.has(p.clientId)).map((p) => `Un pago de ${p.date} es de un cliente que no vino en la exportación.`),
      ...snap.invoices.filter((i) => !i.lineItems.length).map((i) => `La cuenta de cobro ${i.invoiceNumber} no trae ítems: se importa con un ítem por el total.`),
    ],
    profile: snap.profile ? { name: snap.profile.name, nit: snap.profile.nit, current: !!billing.billingProfile().name } : null,
  };
}

/** Logo y firma: SmartBilling los guarda como data URL o como enlace. Los enlaces se descargan (máx. 1,5 MB). */
async function asDataUrl(v: string | null): Promise<string | null> {
  if (!v) return null;
  if (/^data:image\/(png|jpeg|webp|gif);base64,/i.test(v)) return v.length <= 2_000_000 ? v : null;
  if (!/^https?:\/\//i.test(v)) return null;
  try {
    const r = await fetch(v, { signal: AbortSignal.timeout(10_000) });
    const type = r.headers.get('content-type') ?? '';
    if (!r.ok || !/^image\/(png|jpeg|webp|gif)/.test(type)) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.length <= 1_500_000 ? `data:${type.split(';')[0]};base64,${buf.toString('base64')}` : null;
  } catch {
    return null;
  }
}

async function apply(snap: Snapshot, matches: Record<string, unknown>, withProfile: boolean) {
  const logo = withProfile ? await asDataUrl(snap.profile?.logoUrl ?? null) : null;
  const signature = withProfile ? await asDataUrl(snap.profile?.signatureImageUrl ?? null) : null;
  const created = { clients: 0, linked: 0, invoices: 0, receipts: 0, skipped: 0 };
  const clientMap = new Map<string, number>();

  db.transaction(() => {
    for (const c of snap.clients) {
      const choice = matches[c.id];
      const existing = sqlite.prepare('SELECT * FROM clients WHERE sb_id = ?').get(c.id) as db.Client | undefined;
      const docType = /^\s*[\d.\s]+-\s*\d\s*$/.test(c.nitOrCc) ? 'NIT' : c.nitOrCc ? 'CC' : '';
      let id: number;
      if (existing) id = existing.id;
      else if (Number(choice)) {
        const target = db.getClient(Number(choice));
        if (!target) throw new HttpError(400, `El cliente elegido para «${c.name}» no existe.`);
        if (target.sb_id && target.sb_id !== c.id) throw new HttpError(400, `«${target.name}» ya está unido a otro cliente de SmartBilling.`);
        // Se completan los datos de facturación que falten; lo que ya tenía el portal se respeta.
        db.updateClient(target.id, {
          sb_id: c.id,
          doc_number: target.doc_number || c.nitOrCc,
          doc_type: target.doc_type || docType,
          city: target.city || c.city,
          address: target.address || c.address,
          phone: target.phone || c.phone,
        });
        id = target.id;
        created.linked++;
      } else {
        id = db.createClient({ name: c.name || 'Cliente sin nombre', contactName: '', email: null, phone: c.phone, docType, docNumber: c.nitOrCc, city: c.city, address: c.address, sbId: c.id }).id;
        created.clients++;
      }
      clientMap.set(c.id, id);
    }

    const sbName = new Map(snap.clients.map((c) => [c.id, c.name]));
    for (const i of snap.invoices) {
      const clientId = clientMap.get(i.clientId);
      const taken = sqlite.prepare('SELECT sb_id FROM invoices WHERE number = ?').get(i.invoiceNumber) as { sb_id: string | null } | undefined;
      if (!clientId || sqlite.prepare('SELECT 1 FROM invoices WHERE sb_id = ?').get(i.id) || (taken && taken.sb_id !== i.id)) {
        created.skipped++;
        continue;
      }
      const items = i.lineItems.length
        ? i.lineItems.map((li) => ({ description: billing.sanitizeHtml(li.description) || 'Ítem', quantity: li.quantity || 1, unit: li.unit, unitPrice: li.unitPrice }))
        : [{ description: 'Servicios', quantity: 1, unit: '', unitPrice: i.currency === 'USD' && i.exchangeRate ? i.totalAmount / i.exchangeRate : i.totalAmount }];
      billing.saveInvoice(
        {
          clientId,
          projectId: null,
          number: i.invoiceNumber || billing.nextNumber(),
          date: i.date,
          dueDate: null,
          currency: i.currency,
          exchangeRate: i.currency === 'USD' ? i.exchangeRate : null,
          notes: i.notes,
          items,
        },
        { sbId: i.id, totalCop: i.totalAmount },
      );
      created.invoices++;
    }

    for (const p of snap.payments) {
      const clientId = clientMap.get(p.clientId);
      if (!clientId || !(p.amount > 0) || sqlite.prepare('SELECT 1 FROM receipts WHERE sb_id = ?').get(p.id)) {
        created.skipped++;
        continue;
      }
      const name = sbName.get(p.clientId) ?? '';
      billing.saveReceipt(
        { clientId, projectId: null, invoiceId: null, amountCop: p.amount, currency: 'COP', amount: p.amount, trm: null, date: p.date, method: p.method, notes: p.notes },
        {
          sbId: p.id,
          financeRef: p.id,
          financeCategory: name || null,
          // SmartBilling no enviaba descripción: el Gestor les puso «Abono factura - Cliente».
          financeDescription: `Abono factura${name ? ` - ${name}` : ''}`,
          synced: true,
          proofUrl: p.proofUrl && p.proofUrl.length <= 3_000_000 ? p.proofUrl : null,
        },
      );
      created.receipts++;
    }

    if (withProfile && snap.profile) {
      const pr = snap.profile;
      const current = billing.billingProfile();
      billing.saveBillingProfile({
        name: pr.name,
        docType: /-\s*\d\s*$/.test(pr.nit) ? 'NIT' : 'CC',
        docNumber: pr.nit,
        personType: pr.type || current.personType,
        address: pr.address,
        phone: pr.phone,
        email: pr.email,
        bankInfo: pr.bankAccountInfo,
        signatureName: pr.signatureName,
        signatureDoc: pr.signatureCC,
        logo: logo ?? current.logo,
        signature: signature ?? current.signature,
      });
    }
  });

  // Cuadre: por cliente, lo de SmartBilling contra lo importado aquí.
  const reconciliation = snap.clients.map((c) => {
    const sbInvoiced = snap.invoices.filter((i) => i.clientId === c.id).reduce((n, i) => n + i.totalAmount, 0);
    const sbPaid = snap.payments.filter((p) => p.clientId === c.id).reduce((n, p) => n + p.amount, 0);
    const ids = snap.invoices.filter((i) => i.clientId === c.id).map((i) => i.id);
    const pids = snap.payments.filter((p) => p.clientId === c.id).map((p) => p.id);
    const sum = (table: string, col: string, list: string[]) =>
      list.length
        ? (sqlite.prepare(`SELECT COALESCE(SUM(${col}), 0) AS n FROM ${table} WHERE sb_id IN (${list.map(() => '?').join(',')})`).get(...list) as { n: number }).n
        : 0;
    const invoiced = sum('invoices', 'total_cop', ids);
    const paid = sum('receipts', 'amount_cop', pids);
    return {
      sbId: c.id,
      name: c.name,
      clientId: clientMap.get(c.id) ?? null,
      sb: { invoiced: sbInvoiced, paid: sbPaid, balance: sbInvoiced - sbPaid },
      portal: { invoiced, paid, balance: invoiced - paid },
      ok: Math.abs(sbInvoiced - invoiced) < 0.5 && Math.abs(sbPaid - paid) < 0.5,
    };
  });
  return { created, reconciliation, ok: reconciliation.every((r) => r.ok), nextNumber: billing.nextNumber() };
}

export async function handleImport(route: string, _id: number, req: IncomingMessage, res: ServerResponse, v: Viewer): Promise<boolean> {
  switch (route) {
    case 'POST import/smartbilling/preview': {
      requireOwner(v);
      const body = await readJson(req);
      const url = str(body.url, 300);
      if (!/^https?:\/\/[^\s]+$/.test(url)) throw new HttpError(400, 'Escribe la URL de la API de SmartBilling (termina en /api).');
      const snap = await fetchFromApi(url, str(body.token, 2000));
      saveSnapshot(snap);
      json(res, 200, preview(snap));
      return true;
    }

    case 'POST import/smartbilling/upload': {
      // Un JSON exportado: { clients, invoices (con lineItems), payments, profile }.
      requireOwner(v);
      let raw: Record<string, unknown>;
      try {
        raw = JSON.parse((await readBody(req, 60 * 1024 * 1024)).toString());
      } catch (err) {
        if (err instanceof HttpError) throw err;
        throw new HttpError(400, 'El archivo no es un JSON válido.');
      }
      const snap = normalize(raw, 'archivo');
      saveSnapshot(snap);
      json(res, 200, preview(snap));
      return true;
    }

    case 'POST import/smartbilling/apply': {
      requireOwner(v);
      const body = await readJson(req, 1024 * 1024);
      const snap = loadSnapshot(str(body.id, 40));
      const matches = body.matches && typeof body.matches === 'object' ? (body.matches as Record<string, unknown>) : {};
      json(res, 200, await apply(snap, matches, body.profile === true));
      return true;
    }
  }
  return false;
}
