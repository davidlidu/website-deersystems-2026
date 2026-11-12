import type { IncomingMessage, ServerResponse } from 'node:http';
import { db as sqlite } from '../db.ts';
import * as google from '../google.ts';
import { HttpError, json } from '../http.ts';
import type { Viewer } from './auth.ts';
import { requireOwner } from './common.ts';
import { notify } from './notify.ts';

/**
 * Correos programados: la propuesta después de la llamada, el resumen de una reunión y la cuenta de cobro pueden
 * salir más tarde. El correo se arma completo al programarlo (con sus adjuntos) y se guarda; cada minuto se envían
 * los que ya llegaron a su hora. Después de enviarlo, cada tipo marca lo suyo (p. ej. la cuenta de cobro queda «enviada»).
 */

export type ScheduledKind = 'proposal' | 'summary' | 'invoice';

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS scheduled_mails (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    ref_id INTEGER NOT NULL,
    send_at TEXT NOT NULL,
    mail TEXT NOT NULL,
    meta TEXT NOT NULL DEFAULT '{}',
    label TEXT NOT NULL DEFAULT '',
    path TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pendiente',
    error TEXT,
    created_at TEXT NOT NULL,
    sent_at TEXT
  );
  CREATE INDEX IF NOT EXISTS scheduled_mails_due ON scheduled_mails (status, send_at);
  CREATE INDEX IF NOT EXISTS scheduled_mails_ref ON scheduled_mails (kind, ref_id);
`);
// Si el servidor se cayó mientras enviaba, no se sabe si salió: queda en error para que lo revises (no se reenvía solo).
sqlite
  .prepare(
    "UPDATE scheduled_mails SET status = 'error', error = 'Se interrumpió el envío: revisa en Gmail si salió antes de reintentar.' WHERE status = 'enviando'",
  )
  .run();

interface Row {
  id: number;
  kind: ScheduledKind;
  ref_id: number;
  send_at: string;
  mail: string;
  meta: string;
  label: string;
  path: string;
  status: 'pendiente' | 'enviando' | 'enviado' | 'error' | 'cancelado';
  error: string | null;
  created_at: string;
  sent_at: string | null;
}

interface StoredMail extends Omit<google.Mail, 'attachments'> {
  attachments?: { name: string; mime: string; data: string; cid?: string }[];
}

const now = () => new Date().toISOString();
const get = (id: number) => sqlite.prepare('SELECT * FROM scheduled_mails WHERE id = ?').get(id) as Row | undefined;

interface Hooks<M> {
  /** Justo antes de enviar: si devuelve un texto, no se envía y queda en error con ese motivo. */
  check?: (refId: number, meta: M) => string | null;
  /** Después de enviarlo: marcar lo enviado (fecha, destinatarios). */
  sent?: (refId: number, meta: M, to: string) => void;
}
const hooks = new Map<ScheduledKind, Hooks<never>>();
export function onScheduled<M>(kind: ScheduledKind, h: Hooks<M>): void {
  hooks.set(kind, h as Hooks<never>);
}

/** Lee y valida la fecha de envío que llega del formulario: null si es para enviar ya. */
export function readSendAt(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const t = Date.parse(String(value));
  if (!Number.isFinite(t)) throw new HttpError(400, 'La fecha de envío no es válida.');
  if (t < Date.now() + 60_000) throw new HttpError(400, 'Elige una hora de envío al menos un minuto en el futuro.');
  if (t > Date.now() + 366 * 86_400_000) throw new HttpError(400, 'Programa el envío para dentro de un año como máximo.');
  return new Date(t).toISOString();
}

export function scheduleMail(p: {
  kind: ScheduledKind;
  refId: number;
  sendAt: string;
  mail: google.Mail;
  meta?: unknown;
  label: string;
  path: string;
}): ScheduledView {
  const stored: StoredMail = { ...p.mail, attachments: p.mail.attachments?.map((a) => ({ ...a, data: a.data.toString('base64') })) };
  const r = sqlite
    .prepare('INSERT INTO scheduled_mails (kind, ref_id, send_at, mail, meta, label, path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(p.kind, p.refId, p.sendAt, JSON.stringify(stored), JSON.stringify(p.meta ?? {}), p.label.slice(0, 200), p.path, now());
  return scheduledView(get(Number(r.lastInsertRowid))!);
}

export interface ScheduledView {
  id: number;
  sendAt: string;
  to: string;
  subject: string;
  status: Row['status'];
  error: string | null;
  sentAt: string | null;
}

function scheduledView(r: Row): ScheduledView {
  const m = JSON.parse(r.mail) as StoredMail;
  return { id: r.id, sendAt: r.send_at, to: m.to, subject: m.subject, status: r.status, error: r.error, sentAt: r.sent_at };
}

/** Los programados de algo (pendientes, con error y los enviados en los últimos 7 días, para confirmar que salieron). */
export function scheduledFor(kind: ScheduledKind, refId: number): ScheduledView[] {
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  return (
    sqlite
      .prepare(
        "SELECT * FROM scheduled_mails WHERE kind = ? AND ref_id = ? AND (status IN ('pendiente', 'enviando', 'error') OR (status = 'enviado' AND sent_at > ?)) ORDER BY send_at, id",
      )
      .all(kind, refId, since) as unknown as Row[]
  ).map(scheduledView);
}

async function deliver(r: Row): Promise<void> {
  // Se toma la fila solo si sigue pendiente: dos ciclos (o «Enviar ahora» y el ciclo) no la envían dos veces.
  const taken = sqlite.prepare("UPDATE scheduled_mails SET status = 'enviando' WHERE id = ? AND status = 'pendiente'").run(r.id);
  if (!taken.changes) return;
  const h = hooks.get(r.kind);
  const meta = JSON.parse(r.meta) as never;
  const stored = JSON.parse(r.mail) as StoredMail;
  const fail = (error: string) => {
    sqlite.prepare("UPDATE scheduled_mails SET status = 'error', error = ? WHERE id = ?").run(error, r.id);
    notify('scheduled_mail', { actor: null, projectId: null, title: `No salió el correo programado: ${r.label}`, body: error, path: r.path });
  };
  const blocked = h?.check?.(r.ref_id, meta);
  if (blocked) return fail(blocked);
  if (!google.connectionStatus().connected) return fail('Google no está conectado: conéctalo en Configuración y reintenta.');
  try {
    await google.sendMail({ ...stored, attachments: stored.attachments?.map((a) => ({ ...a, data: Buffer.from(a.data, 'base64') })) });
  } catch (err) {
    return fail((err as Error).message);
  }
  // Los adjuntos ya no hacen falta: se libera el espacio.
  sqlite
    .prepare("UPDATE scheduled_mails SET status = 'enviado', sent_at = ?, error = NULL, mail = json_remove(mail, '$.attachments', '$.html') WHERE id = ?")
    .run(now(), r.id);
  try {
    h?.sent?.(r.ref_id, meta, stored.to);
  } catch (err) {
    console.error('Correo programado enviado, pero no se pudo marcar:', err);
  }
  notify('scheduled_mail', { actor: null, projectId: null, title: `Salió el correo programado: ${r.label}`, body: `Para ${stored.to}`, path: r.path });
}

let ticking = false;
async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const due = sqlite
      .prepare("SELECT * FROM scheduled_mails WHERE status = 'pendiente' AND send_at <= ? ORDER BY send_at, id LIMIT 20")
      .all(now()) as unknown as Row[];
    for (const r of due) await deliver(r);
  } catch (err) {
    console.error('Correos programados:', err);
  } finally {
    ticking = false;
  }
}

export function startScheduledMails(): void {
  setInterval(() => void tick(), 60_000).unref();
  setTimeout(() => void tick(), 5_000).unref();
}

export async function handleScheduled(route: string, id: number, _req: IncomingMessage, res: ServerResponse, v: Viewer, url: URL): Promise<boolean> {
  switch (route) {
    case 'GET scheduled-mails': {
      requireOwner(v);
      const kind = url.searchParams.get('kind') as ScheduledKind;
      if (!['proposal', 'summary', 'invoice'].includes(kind)) throw new HttpError(400, 'Tipo no válido.');
      json(res, 200, scheduledFor(kind, Number(url.searchParams.get('ref')) || 0));
      return true;
    }

    // Enviar ya uno programado (o reintentar uno que falló).
    case 'POST scheduled-mails/:id/send-now': {
      requireOwner(v);
      const r = get(id);
      if (!r) throw new HttpError(404, 'El envío programado no existe.');
      if (r.status !== 'pendiente' && r.status !== 'error')
        throw new HttpError(409, r.status === 'enviado' ? 'Ese correo ya salió.' : 'Ese envío ya no está pendiente.');
      sqlite.prepare("UPDATE scheduled_mails SET status = 'pendiente', error = NULL WHERE id = ?").run(id);
      await deliver(get(id)!);
      const after = get(id)!;
      if (after.status === 'error') throw new HttpError(502, after.error ?? 'No se pudo enviar.');
      json(res, 200, scheduledView(after));
      return true;
    }

    case 'POST scheduled-mails/:id/cancel': {
      requireOwner(v);
      const r = get(id);
      if (!r) throw new HttpError(404, 'El envío programado no existe.');
      const done = sqlite.prepare("UPDATE scheduled_mails SET status = 'cancelado' WHERE id = ? AND status IN ('pendiente', 'error')").run(id);
      if (!done.changes)
        throw new HttpError(
          409,
          r.status === 'enviado' || r.status === 'enviando' ? 'Ese correo ya salió (o está saliendo).' : 'Ese envío ya no está pendiente.',
        );
      json(res, 200, { ok: true });
      return true;
    }
  }
  return false;
}
