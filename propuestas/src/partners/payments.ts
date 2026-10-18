import type { IncomingMessage, ServerResponse } from 'node:http';
import { AiError, completeJson } from '../ai.ts';
import { db as sqlite } from '../db.ts';
import { HttpError, json, readJson } from '../http.ts';
import type { Viewer } from './auth.ts';
import * as billing from './billing.ts';
import { optDate, requireOwner, str, visibleProject } from './common.ts';
import * as db from './db.ts';
import { financeConfigured, todayBogota, trmFor } from './finance.ts';

/**
 * Pagos del proyecto según la propuesta (anticipo, cuotas, contra entrega). Solo tú los editas;
 * el cliente los ve; el equipo nunca (son valores).
 *
 * Al marcar una cuota como pagada se crea su abono (billing.ts), que es el que va al Gestor financiero con la
 * referencia de siempre (deersystems-pago-{id}). El Gestor lleva todo en COP: los pagos en USD se registran con
 * el valor recibido en pesos (por defecto, monto × TRM del día). Cada cuota puede generar su cuenta de cobro.
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
  /** Histórico: el estado de sincronización ahora vive en el abono de la cuota. */
  sync_status: SyncStatus;
  sync_error: string | null;
  synced_at: string | null;
  created_at: string;
  updated_at: string;
  invoice_id: number | null;
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
if (!(sqlite.prepare('PRAGMA table_info(payments)').all() as { name: string }[]).some((c) => c.name === 'invoice_id')) {
  // La cuenta de cobro que generó la cuota (si la tiene).
  sqlite.exec('ALTER TABLE payments ADD COLUMN invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL');
}

const now = () => new Date().toISOString();
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

function syncOf(r: Row) {
  const receipt = billing.receiptForPayment(r.id);
  return { receiptId: receipt?.id ?? null, sync: receipt?.sync_status ?? null, syncError: receipt?.sync_error ?? null, syncedAt: receipt?.synced_at ?? null };
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
    invoiceId: r.invoice_id,
    invoiceNumber: r.invoice_id ? (billing.getInvoice(r.invoice_id)?.number ?? null) : null,
    // Lo del Gestor (pesos recibidos, TRM, sincronización) es solo para ti. La sincronización es la del abono.
    ...(owner ? { amountCop: r.amount_cop, trm: r.trm, ...syncOf(r) } : {}),
  };
}

function visiblePayment(id: number, v: Viewer): Row {
  const r = get(id);
  if (!r) throw new HttpError(404, 'El pago no existe.');
  if (v.kind === 'team') throw new HttpError(403, 'No tienes acceso a los pagos.');
  visibleProject(r.project_id, v);
  return r;
}

// ───────── Abono de la cuota ─────────

/**
 * La cuota pagada es un abono del cliente (billing.ts): ahí vive el ingreso del Gestor.
 * Pagada → crea o actualiza su abono y lo sincroniza. Desmarcar o borrar la cuota quita el abono (ver rutas).
 */
async function syncPaid(r: Row): Promise<Row> {
  if (!r.paid) return r;
  const project = db.getProject(r.project_id)!;
  const current = billing.receiptForPayment(r.id);
  const saved = billing.saveReceipt(
    {
      clientId: project.client_id,
      projectId: r.project_id,
      invoiceId: r.invoice_id ?? current?.invoice_id ?? null,
      paymentId: r.id,
      amountCop: r.amount_cop ?? r.amount,
      currency: r.currency,
      amount: r.amount,
      trm: r.trm,
      date: r.paid_at ?? todayBogota(),
      method: current?.method || 'Transferencia',
      notes: current?.notes ?? '',
    },
    current ? { id: current.id } : { financeRef: `deersystems-pago-${r.id}` },
  );
  await billing.syncReceipt(saved);
  return get(r.id)!;
}

// Antes de los abonos, el estado de sincronización vivía en la cuota: se pasa a su abono, con la misma referencia.
for (const r of sqlite.prepare('SELECT * FROM payments WHERE paid = 1').all() as unknown as Row[]) {
  if (billing.receiptForPayment(r.id)) continue;
  const project = db.getProject(r.project_id);
  if (!project) continue;
  const saved = billing.saveReceipt(
    {
      clientId: project.client_id,
      projectId: r.project_id,
      invoiceId: null,
      paymentId: r.id,
      amountCop: r.amount_cop ?? r.amount,
      currency: r.currency,
      amount: r.amount,
      trm: r.trm,
      date: r.paid_at ?? r.updated_at.slice(0, 10),
      method: 'Transferencia',
      notes: '',
    },
    { financeRef: `deersystems-pago-${r.id}`, synced: r.sync_status === 'ok' },
  );
  if (r.sync_status === 'error') sqlite.prepare("UPDATE receipts SET sync_status = 'error', sync_error = ? WHERE id = ?").run(r.sync_error, saved.id);
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

export async function handlePayments(route: string, id: number, req: IncomingMessage, res: ServerResponse, v: Viewer): Promise<boolean> {
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
        updated = await syncPaid(get(r.id)!);
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
        // Primero se quita el abono (y su ingreso del Gestor); si el Gestor falla, la cuota sigue pagada.
        const receipt = billing.receiptForPayment(r.id);
        if (receipt) await billing.deleteReceipt(receipt);
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
      json(res, 200, view(await syncPaid(get(r.id)!), v));
      return true;
    }

    case 'POST payments/:id/sync': {
      requireOwner(v);
      json(res, 200, view(await syncPaid(visiblePayment(id, v)), v));
      return true;
    }

    case 'DELETE payments/:id': {
      requireOwner(v);
      const r = visiblePayment(id, v);
      // Primero se quita su abono (y el ingreso del Gestor); si falla, la cuota se queda para no dejar un ingreso huérfano.
      const receipt = billing.receiptForPayment(r.id);
      if (receipt) await billing.deleteReceipt(receipt);
      sqlite.prepare('DELETE FROM payments WHERE id = ?').run(r.id);
      json(res, 200, { ok: true });
      return true;
    }

  }
  return false;
}
