import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { db as sqlite } from '../db.ts';
import * as google from '../google.ts';
import { HttpError, json, readJson } from '../http.ts';
import { invoiceForClient } from '../mail.ts';
import type { Viewer } from './auth.ts';
import { EMAIL_RE, optDate, requireOwner, str } from './common.ts';
import * as db from './db.ts';
import { deleteIncome, FinanceError, paymentMethodFor, todayBogota, trmFor, upsertIncome } from './finance.ts';

/**
 * Facturación (lo que antes vivía en SmartBilling):
 * - Cuentas de cobro con sus ítems (COP, o USD con TRM; el total en COP siempre queda guardado).
 * - Abonos (receipts): lo que entra. Van ligados al cliente, como en SmartBilling; opcionalmente a un proyecto,
 *   a una cuenta de cobro o a una cuota del plan de pagos. Cada abono es un ingreso en el Gestor financiero.
 * - Estado de cuenta del cliente: facturado − abonado (las anuladas no cuentan).
 *
 * Todo es solo del administrador, salvo que el cliente ve sus cuentas de cobro (no anuladas), sus abonos y su saldo.
 */

export type Currency = 'USD' | 'COP';

export interface InvoiceRow {
  id: number;
  client_id: number;
  project_id: number | null;
  number: string;
  kind: 'cuenta_cobro';
  date: string;
  due_date: string | null;
  currency: Currency;
  exchange_rate: number | null;
  total: number;
  total_cop: number;
  notes: string;
  status: 'emitida' | 'anulada';
  sent_at: string | null;
  sb_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ItemRow {
  id: number;
  invoice_id: number;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  position: number;
}

export interface ReceiptRow {
  id: number;
  client_id: number;
  project_id: number | null;
  invoice_id: number | null;
  payment_id: number | null;
  amount_cop: number;
  currency: Currency;
  amount: number;
  trm: number | null;
  date: string;
  method: string;
  notes: string;
  proof_url: string | null;
  finance_ref: string;
  finance_category: string | null;
  finance_description: string | null;
  sync_status: 'ok' | 'error' | null;
  sync_error: string | null;
  synced_at: string | null;
  sb_id: string | null;
  created_at: string;
  updated_at: string;
}

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    number TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL DEFAULT 'cuenta_cobro',
    date TEXT NOT NULL,
    due_date TEXT,
    currency TEXT NOT NULL DEFAULT 'COP',
    exchange_rate REAL,
    total REAL NOT NULL DEFAULT 0,
    total_cop REAL NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'emitida' CHECK (status IN ('emitida', 'anulada')),
    sent_at TEXT,
    sb_id TEXT UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS invoices_client ON invoices(client_id, date);
  CREATE TABLE IF NOT EXISTS invoice_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    quantity REAL NOT NULL,
    unit TEXT NOT NULL DEFAULT '',
    unit_price REAL NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS invoice_items_invoice ON invoice_items(invoice_id, position);
  CREATE TABLE IF NOT EXISTS receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
    payment_id INTEGER UNIQUE REFERENCES payments(id) ON DELETE SET NULL,
    amount_cop REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'COP',
    amount REAL NOT NULL,
    trm REAL,
    date TEXT NOT NULL,
    method TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    proof_url TEXT,
    finance_ref TEXT NOT NULL UNIQUE,
    finance_category TEXT,
    finance_description TEXT,
    sync_status TEXT,
    sync_error TEXT,
    synced_at TEXT,
    sb_id TEXT UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS receipts_client ON receipts(client_id, date);
`);

const now = () => new Date().toISOString();
const round2 = (n: number) => Math.round(n * 100) / 100;

export const getInvoice = (id: number) => sqlite.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as InvoiceRow | undefined;
export const getReceipt = (id: number) => sqlite.prepare('SELECT * FROM receipts WHERE id = ?').get(id) as ReceiptRow | undefined;
export const receiptForPayment = (paymentId: number) =>
  sqlite.prepare('SELECT * FROM receipts WHERE payment_id = ?').get(paymentId) as ReceiptRow | undefined;
const itemsOf = (invoiceId: number) =>
  sqlite.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY position, id').all(invoiceId) as unknown as ItemRow[];

// ───────── HTML de los ítems ─────────

const ALLOWED = new Set(['b', 'strong', 'i', 'em', 'u', 'br', 'p', 'div', 'ul', 'ol', 'li', 'span']);

/**
 * Las descripciones de los ítems vienen con formato (negrita, listas) del editor de SmartBilling.
 * Se guardan con una lista blanca de etiquetas y sin atributos: el HTML nunca puede ejecutar nada.
 */
export function sanitizeHtml(html: string): string {
  return html
    .replace(/<(script|style|iframe|object|embed|svg|math|template)[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?([a-z0-9]+)\b[^>]*>/gi, (tag, name: string) => {
      const n = name.toLowerCase();
      if (!ALLOWED.has(n)) return '';
      return tag.startsWith('</') ? `</${n}>` : n === 'br' ? '<br>' : `<${n}>`;
    })
    .replace(/<(?![a-z/])/gi, '&lt;')
    .slice(0, 20_000)
    .trim();
}

/** Texto plano (para correos, búsquedas y la bitácora). */
export const htmlText = (html: string) =>
  html
    .replace(/<br\s*\/?>|<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

// ───────── Cuentas de cobro ─────────

/** Siguiente consecutivo: el mayor número usado + 1 (mismo criterio que SmartBilling, que solo mira los dígitos). */
export function nextNumber(): string {
  const rows = sqlite.prepare('SELECT number FROM invoices').all() as { number: string }[];
  let max = 0;
  for (const r of rows) {
    const n = Number(r.number.replace(/\D+/g, ''));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return String(max + 1);
}

interface ItemInput {
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
}

interface InvoiceInput {
  clientId: number;
  projectId: number | null;
  number: string;
  date: string;
  dueDate: string | null;
  currency: Currency;
  exchangeRate: number | null;
  notes: string;
  items: ItemInput[];
}

function readItems(raw: unknown): ItemInput[] {
  const items = (Array.isArray(raw) ? raw : [])
    .slice(0, 100)
    .map((it: Record<string, unknown>) => ({
      description: sanitizeHtml(typeof it?.description === 'string' ? it.description : ''),
      quantity: round2(Number(it?.quantity)),
      unit: str(it?.unit, 40),
      unitPrice: round2(Number(it?.unitPrice)),
    }))
    .filter((it) => htmlText(it.description) || it.unitPrice);
  if (!items.length) throw new HttpError(400, 'La cuenta de cobro necesita al menos un ítem.');
  if (items.some((it) => !htmlText(it.description))) throw new HttpError(400, 'Cada ítem necesita una descripción.');
  if (items.some((it) => !Number.isFinite(it.quantity) || it.quantity <= 0)) throw new HttpError(400, 'La cantidad de cada ítem debe ser mayor a cero.');
  if (items.some((it) => !Number.isFinite(it.unitPrice) || it.unitPrice < 0)) throw new HttpError(400, 'El valor unitario no es válido.');
  return items;
}

function readInvoice(body: Record<string, unknown>, current?: InvoiceRow): InvoiceInput {
  const clientId = Number(body.clientId ?? current?.client_id);
  if (!db.getClient(clientId)) throw new HttpError(400, 'Elige el cliente.');
  const projectId = body.projectId === undefined ? (current?.project_id ?? null) : Number(body.projectId) || null;
  if (projectId && db.getProject(projectId)?.client_id !== clientId) throw new HttpError(400, 'El proyecto no es de ese cliente.');
  const number = str(body.number ?? current?.number, 40) || nextNumber();
  const date = optDate(body.date ?? current?.date) ?? todayBogota();
  const dueDate = body.dueDate === undefined ? (current?.due_date ?? null) : (optDate(body.dueDate) ?? null);
  if (dueDate && dueDate < date) throw new HttpError(400, 'El vencimiento no puede ser antes de la fecha.');
  const currency: Currency = String(body.currency ?? current?.currency).toUpperCase() === 'USD' ? 'USD' : 'COP';
  const exchangeRate = currency === 'USD' ? Number(body.exchangeRate ?? current?.exchange_rate) : null;
  if (currency === 'USD' && !(exchangeRate! > 0)) throw new HttpError(400, 'Las cuentas de cobro en USD necesitan la TRM.');
  return {
    clientId,
    projectId,
    number,
    date,
    dueDate,
    currency,
    exchangeRate: exchangeRate ? round2(exchangeRate) : null,
    notes: typeof body.notes === 'string' ? body.notes.trim().slice(0, 5000) : (current?.notes ?? ''),
    items: body.items === undefined && current ? itemsOf(current.id).map((i) => ({ description: i.description, quantity: i.quantity, unit: i.unit, unitPrice: i.unit_price })) : readItems(body.items),
  };
}

/** Total en la moneda de la cuenta y en COP (SmartBilling redondea el equivalente a pesos enteros). */
export function totalsOf(items: ItemInput[], currency: Currency, exchangeRate: number | null) {
  const total = round2(items.reduce((n, it) => n + it.quantity * it.unitPrice, 0));
  return { total, totalCop: currency === 'USD' ? Math.round(total * (exchangeRate ?? 0)) : total };
}

function numberTaken(number: string, exceptId?: number) {
  const row = sqlite.prepare('SELECT id FROM invoices WHERE number = ?').get(number) as { id: number } | undefined;
  return !!row && row.id !== exceptId;
}

export function saveInvoice(input: InvoiceInput, opts: { id?: number; sbId?: string | null; totalCop?: number } = {}): InvoiceRow {
  if (numberTaken(input.number, opts.id)) throw new HttpError(409, `Ya existe una cuenta de cobro con el número ${input.number}.`);
  const t = totalsOf(input.items, input.currency, input.exchangeRate);
  // Al importar se respeta el total en COP que guardó SmartBilling, para que los reportes cuadren al peso.
  const totalCop = opts.totalCop ?? t.totalCop;
  const ts = now();
  let id = opts.id;
  sqlite.exec('SAVEPOINT save_invoice');
  try {
    if (id) {
      sqlite
        .prepare(
          `UPDATE invoices SET client_id = ?, project_id = ?, number = ?, date = ?, due_date = ?, currency = ?, exchange_rate = ?,
             total = ?, total_cop = ?, notes = ?, updated_at = ? WHERE id = ?`,
        )
        .run(input.clientId, input.projectId, input.number, input.date, input.dueDate, input.currency, input.exchangeRate, t.total, totalCop, input.notes, ts, id);
      sqlite.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(id);
    } else {
      const r = sqlite
        .prepare(
          `INSERT INTO invoices (client_id, project_id, number, date, due_date, currency, exchange_rate, total, total_cop, notes, sb_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(input.clientId, input.projectId, input.number, input.date, input.dueDate, input.currency, input.exchangeRate, t.total, totalCop, input.notes, opts.sbId ?? null, ts, ts);
      id = Number(r.lastInsertRowid);
    }
    const ins = sqlite.prepare('INSERT INTO invoice_items (invoice_id, description, quantity, unit, unit_price, position) VALUES (?, ?, ?, ?, ?, ?)');
    input.items.forEach((it, i) => ins.run(id!, it.description, it.quantity, it.unit, it.unitPrice, i));
    sqlite.exec('RELEASE save_invoice');
  } catch (err) {
    sqlite.exec('ROLLBACK TO save_invoice');
    sqlite.exec('RELEASE save_invoice');
    throw err;
  }
  return getInvoice(id!)!;
}

/** Lo abonado a una cuenta de cobro (solo los abonos aplicados a ella). */
const appliedTo = (invoiceId: number) =>
  (sqlite.prepare('SELECT COALESCE(SUM(amount_cop), 0) AS n FROM receipts WHERE invoice_id = ?').get(invoiceId) as { n: number }).n;

function invoiceSummary(r: InvoiceRow) {
  const client = db.getClient(r.client_id);
  const applied = appliedTo(r.id);
  return {
    id: r.id,
    number: r.number,
    date: r.date,
    dueDate: r.due_date,
    clientId: r.client_id,
    clientName: client?.name ?? '',
    projectId: r.project_id,
    projectName: r.project_id ? (db.getProject(r.project_id)?.name ?? null) : null,
    currency: r.currency,
    exchangeRate: r.exchange_rate,
    total: r.total,
    totalCop: r.total_cop,
    status: r.status,
    applied,
    // Pagada solo si los abonos aplicados a ella la cubren. Lo importado de SmartBilling no traía esa relación.
    paid: r.status !== 'anulada' && applied >= r.total_cop - 0.5 && applied > 0,
    sentAt: r.sent_at,
    imported: !!r.sb_id,
  };
}

/** Link de pago en línea (Wompi) si está activo para esta cuenta de cobro y el pago en línea está encendido. */
export function payUrl(r: InvoiceRow): string | null {
  const row = r as InvoiceRow & { online_link_url?: string | null };
  return row.online_link_url && db.getSetting<{ enabled?: boolean }>('online_payments')?.enabled && r.status !== 'anulada' ? row.online_link_url : null;
}

export function invoiceDetail(r: InvoiceRow) {
  const client = db.getClient(r.client_id)!;
  return {
    ...invoiceSummary(r),
    notes: r.notes,
    payUrl: payUrl(r),
    items: itemsOf(r.id).map((i) => ({ id: i.id, description: i.description, quantity: i.quantity, unit: i.unit, unitPrice: i.unit_price })),
    client: {
      id: client.id,
      name: client.name,
      contactName: client.contact_name,
      docType: client.doc_type,
      docNumber: client.doc_number,
      city: client.city,
      address: client.address,
      phone: client.phone,
      email: client.email,
    },
    receipts: (sqlite.prepare('SELECT * FROM receipts WHERE invoice_id = ? ORDER BY date').all(r.id) as unknown as ReceiptRow[]).map(receiptView),
  };
}

// ───────── Abonos ─────────

function receiptView(r: ReceiptRow) {
  return {
    id: r.id,
    clientId: r.client_id,
    clientName: db.getClient(r.client_id)?.name ?? '',
    projectId: r.project_id,
    invoiceId: r.invoice_id,
    invoiceNumber: r.invoice_id ? (getInvoice(r.invoice_id)?.number ?? null) : null,
    paymentId: r.payment_id,
    amountCop: r.amount_cop,
    currency: r.currency,
    amount: r.amount,
    trm: r.trm,
    date: r.date,
    method: r.method,
    notes: r.notes,
    proofUrl: r.proof_url,
    sync: r.sync_status,
    syncError: r.sync_error,
    syncedAt: r.synced_at,
    imported: !!r.sb_id,
  };
}

/** Lo que ve el cliente de un abono: sin datos del Gestor. */
const receiptForClient = (r: ReceiptRow) => ({ id: r.id, date: r.date, amountCop: r.amount_cop, currency: r.currency, amount: r.amount, invoiceId: r.invoice_id, method: r.method });

const money = (n: number, currency: Currency) => `${currency} ${n.toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/** Descripción del ingreso en el Gestor. Los importados conservan la que ya tenían allá. */
function incomeDescription(r: ReceiptRow): string {
  if (r.finance_description) return r.finance_description;
  const payment = r.payment_id
    ? (sqlite.prepare('SELECT label, percent FROM payments WHERE id = ?').get(r.payment_id) as { label: string; percent: number | null } | undefined)
    : undefined;
  const project = r.project_id ? db.getProject(r.project_id) : undefined;
  const invoice = r.invoice_id ? getInvoice(r.invoice_id) : undefined;
  const parts: string[] = [];
  if (payment) parts.push(`${project?.name ?? 'Proyecto'} — ${payment.label}`, ...(payment.percent ? [`${payment.percent}%`] : []));
  else parts.push(project ? `${project.name} — Abono` : 'Abono');
  if (invoice) parts.push(`cuenta de cobro ${invoice.number}`);
  if (r.currency === 'USD') parts.push(`${money(r.amount, 'USD')}${r.trm ? ` a TRM ${r.trm.toLocaleString('es-CO')}` : ''}`);
  if (!payment && r.notes) parts.push(r.notes.slice(0, 120));
  return parts.join(' · ');
}

/** Lleva el abono al Gestor (crea o actualiza el ingreso). Nunca lanza: deja el estado en el abono. */
export async function syncReceipt(r: ReceiptRow): Promise<ReceiptRow> {
  try {
    await upsertIncome(r.finance_ref, {
      amount: r.amount_cop,
      date: r.date,
      clientName: r.finance_category || db.getClient(r.client_id)?.name || 'Cliente',
      description: incomeDescription(r),
      paymentMethod: paymentMethodFor(r.method),
    });
    sqlite.prepare("UPDATE receipts SET sync_status = 'ok', sync_error = NULL, synced_at = ? WHERE id = ?").run(now(), r.id);
  } catch (err) {
    if (!(err instanceof FinanceError)) throw err;
    sqlite.prepare("UPDATE receipts SET sync_status = 'error', sync_error = ? WHERE id = ?").run(err.message, r.id);
  }
  return getReceipt(r.id)!;
}

/** Borra el abono: primero el ingreso del Gestor; si falla, el abono se queda para no dejar un ingreso huérfano. */
export async function deleteReceipt(r: ReceiptRow): Promise<void> {
  if (r.sync_status) {
    try {
      await deleteIncome(r.finance_ref);
    } catch (err) {
      if (err instanceof FinanceError) throw new HttpError(502, `${err.message} El abono no se borró.`);
      throw err;
    }
  }
  sqlite.prepare('DELETE FROM receipts WHERE id = ?').run(r.id);
}

export interface ReceiptInput {
  clientId: number;
  projectId: number | null;
  invoiceId: number | null;
  paymentId?: number | null;
  amountCop: number;
  currency: Currency;
  amount: number;
  trm: number | null;
  date: string;
  method: string;
  notes: string;
}

/** Crea o actualiza un abono (sin sincronizar). */
export function saveReceipt(
  input: ReceiptInput,
  opts: { id?: number; financeRef?: string; sbId?: string | null; financeCategory?: string | null; financeDescription?: string | null; synced?: boolean; proofUrl?: string | null } = {},
): ReceiptRow {
  const ts = now();
  if (opts.id) {
    sqlite
      .prepare(
        `UPDATE receipts SET client_id = ?, project_id = ?, invoice_id = ?, amount_cop = ?, currency = ?, amount = ?, trm = ?, date = ?,
           method = ?, notes = ?, updated_at = ? WHERE id = ?`,
      )
      .run(input.clientId, input.projectId, input.invoiceId, input.amountCop, input.currency, input.amount, input.trm, input.date, input.method, input.notes, ts, opts.id);
    return getReceipt(opts.id)!;
  }
  const r = sqlite
    .prepare(
      `INSERT INTO receipts (client_id, project_id, invoice_id, payment_id, amount_cop, currency, amount, trm, date, method, notes, proof_url,
         finance_ref, finance_category, finance_description, sync_status, synced_at, sb_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.clientId,
      input.projectId,
      input.invoiceId,
      input.paymentId ?? null,
      input.amountCop,
      input.currency,
      input.amount,
      input.trm,
      input.date,
      input.method,
      input.notes,
      opts.proofUrl ?? null,
      opts.financeRef ?? `deersystems-abono-${randomUUID()}`,
      opts.financeCategory ?? null,
      opts.financeDescription ?? null,
      opts.synced ? 'ok' : null,
      opts.synced ? ts : null,
      opts.sbId ?? null,
      ts,
      ts,
    );
  return getReceipt(Number(r.lastInsertRowid))!;
}

/** En USD sin TRM ni pesos: se usa la TRM oficial de la fecha del abono. */
async function withTrm(body: Record<string, unknown>, current?: ReceiptRow): Promise<Record<string, unknown>> {
  const usd = String(body.currency ?? current?.currency ?? 'COP').toUpperCase() === 'USD';
  if (!usd || Number(body.trm) > 0 || Number(body.amountCop) > 0 || (current?.trm && body.amount === undefined)) return body;
  const date = optDate(body.date ?? current?.date) ?? todayBogota();
  return { ...body, trm: await trmFor(date) };
}

function readReceipt(body: Record<string, unknown>, current?: ReceiptRow): ReceiptInput {
  const clientId = Number(body.clientId ?? current?.client_id);
  if (!db.getClient(clientId)) throw new HttpError(400, 'Elige el cliente.');
  const projectId = body.projectId === undefined ? (current?.project_id ?? null) : Number(body.projectId) || null;
  if (projectId && db.getProject(projectId)?.client_id !== clientId) throw new HttpError(400, 'El proyecto no es de ese cliente.');
  const invoiceId = body.invoiceId === undefined ? (current?.invoice_id ?? null) : Number(body.invoiceId) || null;
  if (invoiceId && getInvoice(invoiceId)?.client_id !== clientId) throw new HttpError(400, 'La cuenta de cobro no es de ese cliente.');
  const currency: Currency = String(body.currency ?? current?.currency ?? 'COP').toUpperCase() === 'USD' ? 'USD' : 'COP';
  const amount = round2(Number(body.amount ?? current?.amount));
  if (!(amount > 0)) throw new HttpError(400, 'El monto debe ser mayor a cero.');
  const trm = currency === 'USD' ? Number(body.trm ?? current?.trm) || null : null;
  const amountCop = currency === 'USD' ? round2(Number(body.amountCop) || (trm ? Math.round(amount * trm) : 0)) : amount;
  if (!(amountCop > 0)) throw new HttpError(400, 'Escribe cuántos pesos se recibieron (o la TRM).');
  return {
    clientId,
    projectId,
    invoiceId,
    amountCop,
    currency,
    amount,
    trm,
    date: optDate(body.date ?? current?.date) ?? todayBogota(),
    method: str(body.method ?? current?.method ?? 'Transferencia', 60),
    notes: typeof body.notes === 'string' ? body.notes.trim().slice(0, 1000) : (current?.notes ?? ''),
  };
}

// ───────── Estado de cuenta ─────────

export function statement(clientId: number) {
  const invoices = sqlite.prepare("SELECT * FROM invoices WHERE client_id = ? ORDER BY date DESC, id DESC").all(clientId) as unknown as InvoiceRow[];
  const receipts = sqlite.prepare('SELECT * FROM receipts WHERE client_id = ? ORDER BY date DESC, id DESC').all(clientId) as unknown as ReceiptRow[];
  const invoiced = invoices.filter((i) => i.status !== 'anulada').reduce((n, i) => n + i.total_cop, 0);
  const paid = receipts.reduce((n, r) => n + r.amount_cop, 0);
  return { invoices, receipts, totals: { invoiced, paid, balance: round2(invoiced - paid) } };
}

// ───────── Perfil del emisor (lo que va en la cuenta de cobro) ─────────

export interface BillingProfile {
  name: string;
  docType: string;
  docNumber: string;
  personType: string;
  address: string;
  city: string;
  phone: string;
  email: string;
  bankInfo: string;
  signatureName: string;
  signatureDoc: string;
  defaultNotes: string;
  defaultDueDays: number;
  logo: string | null;
  signature: string | null;
  qr: string | null;
}

const EMPTY_PROFILE: BillingProfile = {
  name: '',
  docType: 'CC',
  docNumber: '',
  personType: 'Persona natural · No responsable de IVA',
  address: '',
  city: '',
  phone: '',
  email: '',
  bankInfo: '',
  signatureName: '',
  signatureDoc: '',
  defaultNotes: '',
  defaultDueDays: 0,
  logo: null,
  signature: null,
  qr: null,
};

export const billingProfile = (): BillingProfile => ({ ...EMPTY_PROFILE, ...(db.getSetting<Partial<BillingProfile>>('billing_profile') ?? {}) });

/** Imágenes (logo, firma, QR de pago) como data URL; máx. ~1,5 MB cada una. */
function readImage(v: unknown, current: string | null): string | null {
  if (v === undefined) return current;
  if (v === null || v === '') return null;
  if (typeof v !== 'string' || !/^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(v)) throw new HttpError(400, 'La imagen debe ser PNG, JPG, WEBP o GIF.');
  if (v.length > 2_000_000) throw new HttpError(400, 'La imagen pesa demasiado (máx. 1,5 MB).');
  return v;
}

export function saveBillingProfile(body: Record<string, unknown>): BillingProfile {
  const c = billingProfile();
  const text = (k: keyof BillingProfile, max = 200) => (typeof body[k] === 'string' ? (body[k] as string).trim().slice(0, max) : (c[k] as string));
  const next: BillingProfile = {
    name: text('name'),
    docType: text('docType', 20),
    docNumber: text('docNumber', 40),
    personType: text('personType', 120),
    address: text('address'),
    city: text('city', 100),
    phone: text('phone', 60),
    email: text('email'),
    bankInfo: text('bankInfo', 2000),
    signatureName: text('signatureName'),
    signatureDoc: text('signatureDoc', 60),
    defaultNotes: text('defaultNotes', 5000),
    defaultDueDays: Number.isFinite(Number(body.defaultDueDays)) ? Math.max(0, Math.min(120, Math.round(Number(body.defaultDueDays)))) : c.defaultDueDays,
    logo: readImage(body.logo, c.logo),
    signature: readImage(body.signature, c.signature),
    qr: readImage(body.qr, c.qr),
  };
  db.setSetting('billing_profile', next);
  return next;
}

/** Lo que el cliente necesita para pagar: datos bancarios y QR. */
export const paymentInstructions = () => {
  const p = billingProfile();
  return { name: p.name, docType: p.docType, docNumber: p.docNumber, bankInfo: p.bankInfo, qr: p.qr };
};

// ───────── Rutas ─────────

function visibleInvoice(id: number, v: Viewer): InvoiceRow {
  const r = getInvoice(id);
  // El cliente solo ve las suyas y nunca las anuladas; el equipo, ninguna.
  if (!r || v.kind === 'team' || (v.kind === 'client' && (r.client_id !== v.clientId || r.status === 'anulada'))) {
    throw new HttpError(404, 'La cuenta de cobro no existe.');
  }
  return r;
}

function filterBy(url: URL) {
  const where: string[] = [];
  const args: (string | number)[] = [];
  const clientId = Number(url.searchParams.get('clientId'));
  const projectId = Number(url.searchParams.get('projectId'));
  if (clientId) {
    where.push('client_id = ?');
    args.push(clientId);
  }
  if (projectId) {
    where.push('project_id = ?');
    args.push(projectId);
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', args };
}

export async function handleBilling(route: string, id: number, req: IncomingMessage, res: ServerResponse, v: Viewer, url: URL): Promise<boolean> {
  switch (route) {
    // ── Cuentas de cobro
    case 'GET invoices': {
      if (v.kind === 'team') throw new HttpError(403, 'No tienes acceso a la facturación.');
      const f = filterBy(url);
      if (v.kind === 'client') {
        f.sql = f.sql ? `${f.sql} AND client_id = ? AND status != 'anulada'` : "WHERE client_id = ? AND status != 'anulada'";
        f.args.push(v.clientId);
      }
      const rows = sqlite.prepare(`SELECT * FROM invoices ${f.sql} ORDER BY date DESC, id DESC`).all(...f.args) as unknown as InvoiceRow[];
      json(res, 200, rows.map(invoiceSummary));
      return true;
    }

    case 'GET invoices/next-number':
      requireOwner(v);
      json(res, 200, { number: nextNumber() });
      return true;

    case 'POST invoices': {
      requireOwner(v);
      const body = await readJson(req);
      const invoice = saveInvoice(readInvoice(body));
      // Desde una cuota del plan de pagos: la cuota queda ligada a su cuenta de cobro.
      const paymentId = Number(body.paymentId) || null;
      if (paymentId) {
        const p = sqlite.prepare('SELECT project_id FROM payments WHERE id = ?').get(paymentId) as { project_id: number } | undefined;
        if (p && db.getProject(p.project_id)?.client_id === invoice.client_id) {
          sqlite.prepare('UPDATE payments SET invoice_id = ? WHERE id = ?').run(invoice.id, paymentId);
          sqlite.prepare('UPDATE receipts SET invoice_id = ? WHERE payment_id = ? AND invoice_id IS NULL').run(invoice.id, paymentId);
        }
      }
      json(res, 201, invoiceDetail(invoice));
      return true;
    }

    case 'GET invoices/:id': {
      const r = visibleInvoice(id, v);
      const detail = invoiceDetail(r);
      json(res, 200, {
        ...detail,
        receipts: v.kind === 'owner' ? detail.receipts : (sqlite.prepare('SELECT * FROM receipts WHERE invoice_id = ?').all(r.id) as unknown as ReceiptRow[]).map(receiptForClient),
        profile: billingProfile(),
      });
      return true;
    }

    case 'PUT invoices/:id': {
      requireOwner(v);
      const current = visibleInvoice(id, v);
      if (current.status === 'anulada') throw new HttpError(409, 'La cuenta de cobro está anulada.');
      const updated = saveInvoice(readInvoice(await readJson(req), current), { id: current.id });
      json(res, 200, invoiceDetail(updated));
      return true;
    }

    case 'PATCH invoices/:id': {
      // Anular o reactivar. Anular no borra: el número queda usado y deja de contar en el saldo.
      requireOwner(v);
      const current = visibleInvoice(id, v);
      const body = await readJson(req);
      if (body.status === 'anulada' || body.status === 'emitida') {
        sqlite.prepare('UPDATE invoices SET status = ?, updated_at = ? WHERE id = ?').run(body.status, now(), current.id);
      }
      if (body.sent === true) sqlite.prepare('UPDATE invoices SET sent_at = ? WHERE id = ?').run(now(), current.id);
      json(res, 200, invoiceDetail(getInvoice(current.id)!));
      return true;
    }

    case 'POST invoices/:id/send': {
      // El PDF lo genera el navegador (igual que lo descargas) y llega aquí para adjuntarlo al correo.
      requireOwner(v);
      const current = visibleInvoice(id, v);
      if (current.status === 'anulada') throw new HttpError(409, 'La cuenta de cobro está anulada.');
      const body = await readJson(req, 20 * 1024 * 1024);
      const client = db.getClient(current.client_id)!;
      const account = db.getClientAccount(client.id);
      const to = str(body.to, 200).toLowerCase() || account?.email || client.email || '';
      if (!EMAIL_RE.test(to)) throw new HttpError(400, 'El cliente no tiene correo: escríbelo para enviarle la cuenta de cobro.');
      const pdf = typeof body.pdf === 'string' ? Buffer.from(body.pdf.replace(/^data:application\/pdf;base64,/, ''), 'base64') : null;
      if (!pdf || pdf.subarray(0, 4).toString() !== '%PDF') throw new HttpError(400, 'Falta el PDF de la cuenta de cobro.');
      if (!google.connectionStatus().connected) throw new HttpError(409, 'Conecta Google en Configuración para enviar correos.');
      const longDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
      const cop = (n: number) => `$ ${n.toLocaleString('es-CO', { maximumFractionDigits: 0 })}`;
      const mail = invoiceForClient({
        to,
        name: client.contact_name || client.name,
        number: current.number,
        date: longDate(current.date),
        total: current.currency === 'USD' ? money(current.total, 'USD') : cop(current.total_cop),
        totalCop: current.currency === 'USD' ? cop(current.total_cop) : null,
        dueDate: current.due_date ? longDate(current.due_date) : null,
        projectName: current.project_id ? (db.getProject(current.project_id)?.name ?? null) : null,
        bankInfo: billingProfile().bankInfo,
        portal: !!account?.active,
        payUrl: payUrl(current),
      });
      const safe = (t: string) => t.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);
      try {
        await google.sendMail({ ...mail, attachments: [{ name: `Cuenta de Cobro-${safe(current.number)} ${safe(client.name)}.pdf`, mime: 'application/pdf', data: pdf }] });
      } catch (err) {
        if (err instanceof google.GoogleError) throw new HttpError(502, err.message);
        throw err;
      }
      sqlite.prepare('UPDATE invoices SET sent_at = ? WHERE id = ?').run(now(), current.id);
      json(res, 200, { ...invoiceDetail(getInvoice(current.id)!), sentTo: to });
      return true;
    }

    case 'DELETE invoices/:id': {
      requireOwner(v);
      const current = visibleInvoice(id, v);
      if (appliedTo(current.id) > 0) throw new HttpError(409, 'Tiene abonos aplicados: anúlala en lugar de borrarla.');
      sqlite.prepare('UPDATE payments SET invoice_id = NULL WHERE invoice_id = ?').run(current.id);
      sqlite.prepare('DELETE FROM invoices WHERE id = ?').run(current.id);
      json(res, 200, { ok: true });
      return true;
    }

    // ── Abonos
    case 'GET receipts': {
      requireOwner(v);
      const f = filterBy(url);
      const rows = sqlite.prepare(`SELECT * FROM receipts ${f.sql} ORDER BY date DESC, id DESC`).all(...f.args) as unknown as ReceiptRow[];
      json(res, 200, rows.map(receiptView));
      return true;
    }

    case 'POST receipts': {
      requireOwner(v);
      const r = saveReceipt(readReceipt(await withTrm(await readJson(req))));
      json(res, 201, receiptView(await syncReceipt(r)));
      return true;
    }

    case 'PATCH receipts/:id': {
      requireOwner(v);
      const current = getReceipt(id);
      if (!current) throw new HttpError(404, 'El abono no existe.');
      if (current.payment_id) throw new HttpError(409, 'Este abono viene de una cuota del plan de pagos: edítalo desde la pestaña Pagos del proyecto.');
      const r = saveReceipt(readReceipt(await withTrm(await readJson(req), current), current), { id: current.id });
      json(res, 200, receiptView(await syncReceipt(r)));
      return true;
    }

    case 'POST receipts/:id/sync': {
      requireOwner(v);
      const current = getReceipt(id);
      if (!current) throw new HttpError(404, 'El abono no existe.');
      json(res, 200, receiptView(await syncReceipt(current)));
      return true;
    }

    case 'DELETE receipts/:id': {
      requireOwner(v);
      const current = getReceipt(id);
      if (!current) throw new HttpError(404, 'El abono no existe.');
      if (current.payment_id) throw new HttpError(409, 'Este abono viene de una cuota del plan de pagos: desmárcala como pagada en la pestaña Pagos del proyecto.');
      await deleteReceipt(current);
      json(res, 200, { ok: true });
      return true;
    }

    // ── Estado de cuenta, reportes y perfil
    case 'GET clients/:id/statement': {
      if (v.kind === 'team' || (v.kind === 'client' && v.clientId !== id)) throw new HttpError(403, 'No tienes acceso a la facturación.');
      if (!db.getClient(id)) throw new HttpError(404, 'El cliente no existe.');
      const s = statement(id);
      const owner = v.kind === 'owner';
      json(res, 200, {
        totals: s.totals,
        invoices: s.invoices.filter((i) => owner || i.status !== 'anulada').map(invoiceSummary),
        receipts: owner ? s.receipts.map(receiptView) : s.receipts.map(receiptForClient),
        ...(owner ? {} : { howToPay: paymentInstructions() }),
      });
      return true;
    }

    case 'GET billing/report': {
      // Lo mismo que usaban los reportes de SmartBilling: cuentas de cobro (total en COP), abonos y clientes.
      requireOwner(v);
      const invoices = (sqlite.prepare("SELECT * FROM invoices WHERE status != 'anulada' ORDER BY date").all() as unknown as InvoiceRow[]).map(invoiceSummary);
      const receipts = (sqlite.prepare('SELECT * FROM receipts ORDER BY date').all() as unknown as ReceiptRow[]).map((r) => ({
        id: r.id,
        clientId: r.client_id,
        date: r.date,
        amountCop: r.amount_cop,
      }));
      const clients = db.listClients().map((c) => ({ id: c.id, name: c.name, docNumber: c.doc_number, city: c.city, phone: c.phone }));
      json(res, 200, { invoices, receipts, clients });
      return true;
    }

    case 'GET billing/profile':
      requireOwner(v);
      json(res, 200, billingProfile());
      return true;

    case 'PUT billing/profile':
      requireOwner(v);
      // Lleva hasta tres imágenes (logo, firma y QR de pago).
      json(res, 200, saveBillingProfile(await readJson(req, 8 * 1024 * 1024)));
      return true;
  }
  return false;
}

export { receiptView, invoiceSummary, todayBogota };
