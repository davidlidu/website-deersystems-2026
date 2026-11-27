import type { IncomingMessage, ServerResponse } from 'node:http';
import { AiError, complete, completeJson } from '../ai.ts';
import { PARTNERS_URL, SUPERADMIN_EMAIL } from '../config.ts';
import { db as sqlite } from '../db.ts';
import * as google from '../google.ts';
import { HttpError, json, readJson } from '../http.ts';
import { getProposal } from '../db.ts';
import { meetingSummary, proposalAfterCall } from '../mail.ts';
import { publicUrl } from '../proposals.ts';
import type { Viewer } from './auth.ts';
import { actor, clientSees, isDelivery, limitedToOwnTasks, optDate, requireOwner, str, visibleProject } from './common.ts';
import { assertFree, bogota, checkSlots, freeForClient } from './availability.ts';
import * as db from './db.ts';
import { notify } from './notify.ts';
import { requestChanges } from './reviews.ts';
import { onScheduled, readSendAt, scheduleMail } from './scheduled.ts';

/**
 * Reuniones con clientes: se leen de Google Calendar (eventos donde participa el correo de un cliente),
 * se busca la transcripción de Meet al terminar, la IA propone resumen, acuerdos y tareas, y tú lo
 * apruebas antes de que llegue al cliente.
 *
 * Estados: programada → esperando (terminó, falta transcripción) → borrador (IA lista) → aprobada.
 * También: sin_transcripcion, error (la IA falló, se puede reintentar) y descartada.
 */
export type MeetingKind = 'proyecto' | 'discovery' | 'proposal' | 'cliente';
export type MeetingStatus = 'programada' | 'esperando' | 'borrador' | 'aprobada' | 'sin_transcripcion' | 'error' | 'descartada';

export interface Attendee {
  email: string;
  name: string;
  /** deersystems = tú o alguien del equipo; cliente = la cuenta o el correo del cliente; otro = el resto. */
  side: 'deersystems' | 'cliente' | 'otro';
}

export interface ProposedTask {
  title: string;
  description: string;
  side: db.Side;
  dueDate: string | null;
}

/** Ajustes que el cliente pidió en la reunión sobre una entrega que ya existe (en revisión o completada). */
export interface ProposedChange {
  taskId: number;
  request: string;
}

interface Row {
  id: number;
  event_id: string | null;
  client_id: number | null;
  project_id: number | null;
  title: string;
  start_at: string;
  end_at: string;
  meet_code: string | null;
  meet_url: string | null;
  calendar_url: string | null;
  attendees: string;
  status: MeetingStatus;
  transcript: string | null;
  transcript_source: 'meet' | 'manual' | 'drive' | null;
  transcript_url: string | null;
  summary: string;
  agreements: string;
  proposed_tasks: string;
  /** Ajustes sobre entregas existentes que detectó la IA (JSON: ProposedChange[]). */
  proposed_changes: string;
  task_ids: string;
  /** Fase del proyecto a la que pertenece la reunión (null = fuera de las fases). */
  phase_id: number | null;
  /** La tarea tipo reunión que la muestra en el cronograma (se crea al asignarle una fase). */
  plan_task_id: number | null;
  /**
   * proyecto = seguimiento de un proyecto; discovery / proposal = llamadas comerciales (antes de haber proyecto);
   * cliente = reunión con un cliente fuera de un proyecto (p. ej. para hablar de uno futuro): resumen y correo igual.
   */
  kind: MeetingKind;
  /** Prospecto de la llamada comercial: { company, contact, email } (JSON). */
  prospect: string | null;
  proposal_id: number | null;
  proposal_sent_at: string | null;
  proposal_sent_to: string | null;
  ai: string | null;
  error: string | null;
  approved_at: string | null;
  approved_by: string | null;
  sent_to: string;
  /** Reservada en tu Calendar pero sin invitar al cliente: se confirma con él y luego se envía la invitación. */
  tentative: number;
  /** Correos del cliente que se invitarán al confirmarla (JSON). */
  pending_attendees: string | null;
  /** Otro horario que propuso el cliente para la reserva (JSON: ClientProposal). Se borra al confirmar o al moverla. */
  client_proposal: string | null;
  created_at: string;
  updated_at: string;
}

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS meetings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT UNIQUE,
    client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    meet_code TEXT,
    meet_url TEXT,
    calendar_url TEXT,
    attendees TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'programada',
    transcript TEXT,
    transcript_source TEXT,
    transcript_url TEXT,
    summary TEXT NOT NULL DEFAULT '',
    agreements TEXT NOT NULL DEFAULT '[]',
    proposed_tasks TEXT NOT NULL DEFAULT '[]',
    task_ids TEXT NOT NULL DEFAULT '[]',
    ai TEXT,
    error TEXT,
    approved_at TEXT,
    approved_by TEXT,
    sent_to TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS meetings_project ON meetings(project_id, start_at);
  CREATE INDEX IF NOT EXISTS meetings_status ON meetings(status, end_at);
`);
if (!(sqlite.prepare('PRAGMA table_info(meetings)').all() as { name: string }[]).some((c) => c.name === 'phase_id')) {
  sqlite.exec('ALTER TABLE meetings ADD COLUMN phase_id INTEGER REFERENCES phases(id) ON DELETE SET NULL');
}
{
  const cols = (sqlite.prepare('PRAGMA table_info(meetings)').all() as { name: string }[]).map((c) => c.name);
  const add = (name: string, def: string) => !cols.includes(name) && sqlite.exec(`ALTER TABLE meetings ADD COLUMN ${name} ${def}`);
  add('kind', "TEXT NOT NULL DEFAULT 'proyecto'");
  add('prospect', 'TEXT');
  add('proposal_id', 'INTEGER');
  add('proposal_sent_at', 'TEXT');
  add('proposal_sent_to', 'TEXT');
  add('plan_task_id', 'INTEGER');
  add('tentative', 'INTEGER NOT NULL DEFAULT 0');
  add('pending_attendees', 'TEXT');
  add('proposed_changes', "TEXT NOT NULL DEFAULT '[]'");
  add('client_proposal', 'TEXT');
}

/** El cliente no puede ir a la hora reservada y propone otra (misma duración). */
export interface ClientProposal {
  startAt: string;
  endAt: string;
  note: string;
  by: string;
  at: string;
}

// Reuniones a las que la sincronización les copió «Por confirmar · » en el nombre: se limpian al arrancar.
sqlite.prepare("UPDATE meetings SET title = TRIM(SUBSTR(title, 17)) WHERE title LIKE 'Por confirmar · %'").run();

/** En Calendar, la reserva se distingue por el título hasta que el cliente confirma. */
const TENTATIVE_PREFIX = 'Por confirmar · ';
/** El título sin el «Por confirmar · » de Calendar (la sincronización lo trae del evento y no debe quedar en el nombre). */
const withoutPrefix = (title: string) => title.replace(/^(\s*por confirmar\s*·\s*)+/i, '').trim();
const calendarSummary = (m: Pick<Row, 'tentative'>, title: string) => (m.tentative ? `${TENTATIVE_PREFIX}${withoutPrefix(title)}` : withoutPrefix(title));

interface Prospect {
  company: string;
  contact: string;
  email: string;
}
const prospectOf = (m: Row): Prospect | null => parse<Prospect | null>(m.prospect, null);
export const KIND_LABEL: Record<MeetingKind, string> = { proyecto: 'Seguimiento', discovery: 'Discovery Call', proposal: 'Proposal Call', cliente: 'Reunión' };

const now = () => new Date().toISOString();
const get = (id: number) => sqlite.prepare('SELECT * FROM meetings WHERE id = ?').get(id) as unknown as Row | undefined;

/**
 * Columnas para los listados: todo menos la transcripción completa (cada una puede pesar cientos de KB y el listado
 * solo necesita saber si existe). En su lugar va '1' o NULL, así `!!m.transcript` sigue funcionando.
 */
let listCols: string | null = null;
const LIST = () =>
  (listCols ??= [
    ...(sqlite.prepare('PRAGMA table_info(meetings)').all() as { name: string }[]).map((c) => c.name).filter((c) => c !== 'transcript'),
    "CASE WHEN transcript IS NULL OR transcript = '' THEN NULL ELSE '1' END AS transcript",
  ].join(', '));
const byEvent = (eventId: string) => sqlite.prepare('SELECT * FROM meetings WHERE event_id = ?').get(eventId) as unknown as Row | undefined;
const parse = <T>(s: string | null, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};

function update(id: number, fields: Partial<Omit<Row, 'id' | 'created_at' | 'plan_task_id'>>): void {
  for (const [col, value] of Object.entries(fields)) {
    sqlite.prepare(`UPDATE meetings SET ${col} = ?, updated_at = ? WHERE id = ?`).run(value as string | number | null, now(), id);
  }
  if (['title', 'start_at', 'phase_id', 'project_id', 'status'].some((k) => k in fields)) syncPlanTask(id, 'phase_id' in fields);
}

// Propuesta programada: a la hora de enviar el enlace debe seguir activo; al salir, la reunión queda con «enviada».
onScheduled<{ proposalId: number; to: string[] }>('proposal', {
  check: (_meetingId, meta) => {
    const p = getProposal(meta.proposalId);
    if (!p) return 'La propuesta ya no existe.';
    return p.active ? null : 'El enlace de la propuesta está pausado: actívalo en Propuestas y reintenta.';
  },
  sent: (meetingId, meta) => {
    if (get(meetingId)) update(meetingId, { proposal_id: meta.proposalId, proposal_sent_at: now(), proposal_sent_to: JSON.stringify(meta.to) });
  },
});

/**
 * La reunión en el cronograma: una tarea tipo reunión en su fase y con su fecha. Se crea al asignarle una fase y
 * después sigue a la reunión (título, fecha, fase); queda completada cuando ya ocurrió y se quita si se descarta
 * o pasa a otro proyecto. Si la borraste del cronograma, no vuelve hasta que le asignes una fase de nuevo.
 */
function syncPlanTask(id: number, phaseChanged: boolean): void {
  const m = get(id);
  if (!m) return;
  const setTask = (taskId: number | null) => sqlite.prepare('UPDATE meetings SET plan_task_id = ? WHERE id = ?').run(taskId, m.id);
  let task = m.plan_task_id ? db.getTask(m.plan_task_id) : undefined;
  if (!m.project_id || m.kind !== 'proyecto' || m.status === 'descartada' || (task && task.project_id !== m.project_id)) {
    if (task) db.deleteTask(task.id);
    if (m.plan_task_id) setTask(null);
    return;
  }
  const date = new Date(m.start_at).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  const description = m.meet_url ? `Enlace de Meet: ${m.meet_url}` : '';
  if (task) {
    // En Calendar el título lleva delante a quién es («Carlos Herrán · …»); la tarea del plan conserva su nombre.
    const title = m.title === task.title || m.title.endsWith(` · ${task.title}`) ? task.title : m.title;
    db.updateTask(task.id, { title, phase_id: m.phase_id, start_date: date, due_date: date });
  } else {
    if (!phaseChanged || !m.phase_id) return;
    task = db.createTask({
      projectId: m.project_id,
      phaseId: m.phase_id,
      title: m.title,
      description,
      side: 'deersystems',
      assigneeId: null,
      startDate: date,
      dueDate: date,
      position: db.nextTaskPosition(m.project_id),
      source: 'manual',
      kind: 'reunion',
    });
    setTask(task.id);
  }
  const happened = m.status !== 'programada';
  if (happened !== (task.status === 'completada')) db.setTaskStatus(task.id, happened ? 'completada' : 'pendiente');
}

/**
 * Reuniones agendadas que no quedaron ligadas a su tarea del plan (p. ej. las agendadas al aprobar la propuesta antes
 * de este arreglo): se reconocen por el título («Cliente · <título de la tarea>») en el mismo proyecto y se ligan, con
 * la fase de la tarea, para que la tarea muestre la hora y el Meet y siga los cambios de fecha.
 */
export function linkOrphanMeetings(projectId?: number): number {
  const meetings = sqlite
    .prepare(
      `SELECT ${LIST()} FROM meetings WHERE plan_task_id IS NULL AND project_id IS NOT NULL AND status != 'descartada' AND COALESCE(kind, 'proyecto') = 'proyecto'${projectId ? ' AND project_id = ?' : ''} ORDER BY start_at`,
    )
    .all(...(projectId ? [projectId] : [])) as unknown as Row[];
  let linked = 0;
  for (const m of meetings) {
    const day = new Date(m.start_at).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
    const candidates = db
      .listTasks(m.project_id!)
      .filter((t) => t.kind === 'reunion' && (m.title === t.title || m.title.endsWith(` · ${t.title}`)))
      .filter((t) => !sqlite.prepare('SELECT 1 FROM meetings WHERE plan_task_id = ?').get(t.id));
    // Con títulos repetidos, la de la misma fecha.
    const task = candidates.find((t) => t.due_date === day) ?? (candidates.length === 1 ? candidates[0] : undefined);
    if (!task) continue;
    sqlite.prepare('UPDATE meetings SET plan_task_id = ? WHERE id = ?').run(task.id, m.id);
    if (task.phase_id && !m.phase_id) update(m.id, { phase_id: task.phase_id });
    else syncPlanTask(m.id, false);
    linked++;
  }
  return linked;
}

/** La reunión agendada (con evento en Calendar) que representa una tarea del cronograma, si la hay. */
export function meetingOfTask(taskId: number): { id: number; title: string; startAt: string; endAt: string; scheduled: boolean } | null {
  const m = sqlite.prepare('SELECT * FROM meetings WHERE plan_task_id = ?').get(taskId) as unknown as Row | undefined;
  if (!m) return null;
  return { id: m.id, title: m.title, startAt: m.start_at, endAt: m.end_at, scheduled: m.status === 'programada' && !!m.event_id };
}

/**
 * Mueve una reunión agendada a otra fecha y hora (misma duración e invitados): actualiza el evento de Calendar,
 * avisa a los invitados y la tarea del cronograma la sigue. Lo usa el ajuste del plan con IA.
 */
export async function moveMeeting(meetingId: number, date: string, time: string, title: string | null, v: Viewer, quiet = false): Promise<void> {
  const m = get(meetingId);
  if (!m) throw new HttpError(404, 'La reunión no existe.');
  if (m.status !== 'programada') throw new HttpError(409, 'Solo se pueden mover reuniones que aún no ocurren.');
  const start = new Date(`${date}T${time}:00-05:00`);
  if (Number.isNaN(start.getTime())) throw new HttpError(400, 'Fecha u hora no válida.');
  if (start.getTime() < Date.now() - 5 * 60_000) throw new HttpError(400, 'La fecha ya pasó.');
  const end = new Date(start.getTime() + (new Date(m.end_at).getTime() - new Date(m.start_at).getTime()));
  await assertFree(start, end, m.id);
  const newTitle = title?.trim().slice(0, 200) || m.title;
  let event: google.CalendarEvent | null = null;
  if (m.event_id) {
    if (!google.connectionStatus().connected) throw new HttpError(503, 'Conecta Google en Configuración para mover reuniones.');
    try {
      event = await google.updateCalendarEvent(
        m.event_id,
        { summary: calendarSummary(m, newTitle), startIso: start.toISOString(), endIso: end.toISOString(), attendees: parse<Attendee[]>(m.attendees, []).map((a) => a.email) },
        true,
      );
    } catch (err) {
      throw err instanceof google.GoogleError ? new HttpError(502, err.message) : err;
    }
  }
  update(m.id, {
    title: newTitle,
    start_at: start.toISOString(),
    end_at: end.toISOString(),
    ...(event?.htmlLink ? { calendar_url: event.htmlLink } : {}),
    ...(m.tentative ? { client_proposal: null } : {}),
  });
  if (m.tentative && !quiet) askClientToConfirm(get(m.id)!, v, true);
  if (m.project_id) {
    const a = actor(v);
    const when = start.toLocaleString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota' });
    db.logActivity({ projectId: m.project_id, actorKind: a.kind, actorName: a.name, type: 'meeting_updated', data: { title: newTitle, when } });
  }
}

/** Quita la reunión y su tarea del cronograma. */
function remove(m: Row): void {
  if (m.plan_task_id) db.deleteTask(m.plan_task_id);
  sqlite.prepare('DELETE FROM meetings WHERE id = ?').run(m.id);
}

function insert(r: Partial<Row> & Pick<Row, 'title' | 'start_at' | 'end_at'>): Row {
  const t = now();
  const { lastInsertRowid } = sqlite
    .prepare(
      `INSERT INTO meetings (event_id, client_id, project_id, title, start_at, end_at, meet_code, meet_url, calendar_url, attendees, status, transcript, transcript_source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      r.event_id ?? null,
      r.client_id ?? null,
      r.project_id ?? null,
      r.title,
      r.start_at,
      r.end_at,
      r.meet_code ?? null,
      r.meet_url ?? null,
      r.calendar_url ?? null,
      r.attendees ?? '[]',
      r.status ?? 'programada',
      r.transcript ?? null,
      r.transcript_source ?? null,
      t,
      t,
    );
  return get(Number(lastInsertRowid))!;
}

// ───────── Vistas según quién mira ─────────

function view(m: Row, v: Viewer) {
  const owner = v.kind === 'owner';
  const project = m.project_id ? db.getProject(m.project_id) : undefined;
  const client = m.client_id ? db.getClient(m.client_id) : undefined;
  const approved = m.status === 'aprobada';
  return {
    id: m.id,
    projectId: m.project_id,
    projectName: project?.name ?? null,
    phaseId: m.phase_id ?? null,
    clientId: m.client_id,
    clientName: client?.name ?? prospectOf(m)?.company ?? null,
    kind: m.kind ?? 'proyecto',
    prospect: prospectOf(m),
    title: m.title,
    startAt: m.start_at,
    endAt: m.end_at,
    meetUrl: m.meet_url,
    status: m.status,
    tentative: !!m.tentative,
    // La reserva la ven tú y el cliente que la debe confirmar (con el horario que haya propuesto).
    ...(m.tentative && (owner || clientResponds(m, v)) ? { clientProposal: parse<ClientProposal | null>(m.client_proposal, null), canRespond: !owner } : {}),
    attendees: parse<Attendee[]>(m.attendees, []),
    // Lo aprobado lo ven todos; el borrador y la transcripción, solo tú.
    ...(approved || owner
      ? {
          summary: m.summary,
          agreements: parse<string[]>(m.agreements, []),
          taskIds: parse<number[]>(m.task_ids, []),
          approvedAt: m.approved_at,
        }
      : {}),
    ...(owner
      ? {
          calendarUrl: m.calendar_url,
          pendingAttendees: parse<string[]>(m.pending_attendees, []),
          proposedTasks: parse<ProposedTask[]>(m.proposed_tasks, []),
          proposedChanges: parse<ProposedChange[]>(m.proposed_changes, []).flatMap((c) => {
            const t = db.getTask(c.taskId);
            return t && t.project_id === m.project_id ? [{ ...c, title: t.title, status: t.status, round: t.revision_round ?? 0 }] : [];
          }),
          hasTranscript: !!m.transcript,
          transcriptSource: m.transcript_source,
          transcriptUrl: m.transcript_url,
          ai: parse<Record<string, unknown> | null>(m.ai, null),
          error: m.error,
          sentTo: parse<string[]>(m.sent_to, []),
          clientContacts: [
            ...(prospectOf(m)?.email ? [{ email: prospectOf(m)!.email, name: prospectOf(m)!.contact, label: 'Contacto del prospecto' }] : []),
            ...clientContacts(project?.client_id ?? m.client_id, project?.id ?? null),
          ].filter((c, i, list) => list.findIndex((x) => x.email === c.email) === i),
          proposal: proposalInfo(m.proposal_id),
          proposalSentAt: m.proposal_sent_at,
          proposalSentTo: parse<string[]>(m.proposal_sent_to, []),
        }
      : {}),
  };
}

function proposalInfo(id: number | null) {
  const p = id ? getProposal(id) : undefined;
  return p ? { id: p.id, title: p.title || p.slug, slug: p.slug, url: publicUrl(p.slug), version: p.version, active: !!p.active, views: p.views } : null;
}

/** Correos principales del cliente para el resumen: la cuenta del portal y el correo de contacto, si son distintos. */
function clientContacts(clientId: number | null, projectId: number | null = null): { email: string; name: string; label: string }[] {
  if (!clientId) return [];
  const client = db.getClient(clientId);
  const out: { email: string; name: string; label: string }[] = [];
  const add = (email: string | null | undefined, name: string, label: string) => {
    const e = email?.trim().toLowerCase();
    if (e && !out.some((x) => x.email === e)) out.push({ email: e, name, label });
  };
  add(db.getClientAccount(clientId)?.email, client?.contact_name || client?.name || '', 'Cuenta principal');
  // Las demás personas del cliente que ven el proyecto (p. ej. el ejecutivo que lo lleva).
  for (const a of projectId ? db.projectClientAccounts(projectId) : []) add(a.email, a.name, 'Acceso al portal');
  add(client?.email, client?.contact_name || client?.name || '', 'Correo de contacto');
  for (const e of db.extraEmails(client)) add(e.email, '', e.label || 'Otro correo');
  return out;
}

function visible(id: number, v: Viewer): Row {
  const m = get(id);
  if (!m) throw new HttpError(404, 'La reunión no existe.');
  if (v.kind === 'owner') return m;
  if (!m.project_id) throw new HttpError(404, 'La reunión no existe.');
  visibleProject(m.project_id, v);
  if (!['programada', 'aprobada'].includes(m.status)) throw new HttpError(404, 'La reunión no existe.');
  return m;
}

/**
 * ¿Esta persona del cliente confirma la reserva (o propone otro horario)? Las que ven todo el proyecto, y las que
 * solo ven sus tareas si están entre los invitados de la reunión.
 */
function clientResponds(m: Row, v: Viewer): boolean {
  if (v.kind !== 'client' || !m.tentative || m.status !== 'programada' || !m.project_id || (m.kind ?? 'proyecto') !== 'proyecto') return false;
  const p = db.getProject(m.project_id);
  if (!p || !clientSees(v, p)) return false;
  return !limitedToOwnTasks(v) || parse<string[]>(m.pending_attendees, []).includes(v.email.toLowerCase());
}

/** Lo que ve cada uno de una reunión en las listas: tú todo; los demás lo programado y lo enviado, y el cliente sus reservas por confirmar. */
const shownTo = (m: Row, v: Viewer) =>
  v.kind === 'owner' || (['programada', 'aprobada'].includes(m.status) && (!m.tentative || clientResponds(m, v)));

const whenLabel = (iso: string) =>
  new Date(iso).toLocaleString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota' });

/** Al cliente: hay una reserva que debe confirmar (al reservarla o cuando le cambias la hora). */
function askClientToConfirm(m: Row, v: Viewer, moved = false): void {
  if (!m.project_id || !m.tentative) return;
  notify('meeting_to_confirm', {
    actor: v,
    projectId: m.project_id,
    title: moved ? `Nuevo horario por confirmar: «${m.title}»` : `Confirma la reunión «${m.title}»`,
    body: `${whenLabel(m.start_at)}. Confírmala o propón otro día y hora.`,
    path: `/reuniones-por-confirmar?reunion=${m.id}`,
  });
}

/**
 * La reserva pasa a reunión: se invita al cliente (Google le envía la invitación) con la fecha y hora que tenga.
 * La confirmas tú o el propio cliente desde el portal.
 */
/**
 * El nombre con que queda la reunión al confirmarla: sin «Por confirmar» y con el nombre de la empresa del cliente
 * adelante («Click Lab · Reunión de arranque»), si no lo tiene ya.
 */
function confirmedTitle(m: Row): string {
  const base = withoutPrefix(m.title) || 'Reunión';
  const client = m.client_id ? db.getClient(m.client_id) : undefined;
  const company = client?.name?.trim();
  if (!company || base.toLowerCase().includes(company.toLowerCase())) return base.slice(0, 200);
  return `${company} · ${base}`.slice(0, 200);
}

async function confirmTentative(m: Row, v: Viewer): Promise<Row> {
  if (m.status !== 'programada') throw new HttpError(409, 'Solo se pueden confirmar reuniones que aún no ocurren.');
  if (!m.tentative) throw new HttpError(409, 'Esta reunión ya está confirmada.');
  if (new Date(m.start_at).getTime() < Date.now()) throw new HttpError(409, 'La hora de esta reunión ya pasó: propón otro horario.');
  const current = parse<Attendee[]>(m.attendees, []);
  const extra = parse<string[]>(m.pending_attendees, []).filter((e) => !current.some((a) => a.email === e));
  const emails = [...current.map((a) => a.email), ...extra];
  const title = confirmedTitle(m);
  let event: google.CalendarEvent | null = null;
  if (m.event_id) {
    if (!google.connectionStatus().connected) {
      throw new HttpError(503, v.kind === 'owner' ? 'Conecta Google en Configuración para confirmar reuniones.' : 'No pudimos confirmar la reunión en este momento. Inténtalo más tarde.');
    }
    try {
      // La invitación sale con el nombre definitivo (empresa · reunión) y sin la nota de «Reservada: por confirmar».
      event = await google.updateCalendarEvent(
        m.event_id,
        {
          summary: title,
          startIso: m.start_at,
          endIso: m.end_at,
          attendees: emails,
          description: (d) =>
            d
              .split(/\n{2,}/)
              .filter((p) => !/^Reservada: por confirmar/i.test(p.trim()))
              .join('\n\n'),
        },
        true,
      );
    } catch (err) {
      throw err instanceof google.GoogleError ? new HttpError(502, err.message) : err;
    }
  }
  const staff = staffEmails();
  const clients = clientByEmail();
  update(m.id, {
    title,
    tentative: 0,
    pending_attendees: null,
    client_proposal: null,
    ...(event?.htmlLink ? { calendar_url: event.htmlLink } : {}),
    attendees: JSON.stringify([
      ...current,
      ...extra.map((email) => ({ email, name: '', side: staff.has(email) ? 'deersystems' : clients.has(email) ? 'cliente' : 'otro' })),
    ]),
  });
  if (m.project_id) {
    const a = actor(v);
    const when = whenLabel(m.start_at);
    db.logActivity({ projectId: m.project_id, actorKind: a.kind, actorName: a.name, type: v.kind === 'client' ? 'meeting_confirmed' : 'meeting_scheduled', data: { title, when } });
    notify('meeting_scheduled', { actor: v, projectId: m.project_id, title: `Reunión agendada: «${title}»`, body: when, path: `/proyectos/${m.project_id}?tab=reuniones` });
    if (v.kind === 'client') {
      notify('meeting_reply', { actor: v, projectId: m.project_id, title: `${v.name || v.email} confirmó «${title}»`, body: when, path: `/reuniones/${m.id}` });
    }
  }
  return get(m.id)!;
}

// ───────── Quién es quién ─────────

function staffEmails(): Set<string> {
  return new Set([SUPERADMIN_EMAIL, ...db.listTeam().map((a) => a.email)]);
}

/** Correo → cliente, con el correo del cliente y el de su cuenta de acceso. */
function clientByEmail(): Map<string, number> {
  const map = new Map<string, number>();
  for (const c of db.listClients()) {
    if (c.email) map.set(c.email.toLowerCase(), c.id);
    for (const a of db.listClientAccounts(c.id)) map.set(a.email.toLowerCase(), c.id);
  }
  return map;
}

/** Proyecto al que va una reunión: el activo más reciente del cliente (o el último, si no hay activos). */
function projectFor(clientId: number): number | null {
  const list = db.listProjects(clientId);
  return (list.find((p) => p.status === 'activo') ?? list[0])?.id ?? null;
}

const meetCodeOf = (e: google.CalendarEvent) =>
  e.conferenceData?.conferenceId ?? /meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})/.exec(e.hangoutLink ?? '')?.[1] ?? null;

// ───────── IA: resumen, acuerdos y tareas ─────────

const SYSTEM = `Eres el asistente de operaciones de DeerSystems, una empresa colombiana de software, automatización e IA.
Lees la transcripción de una reunión con un cliente y preparas el resumen que DeerSystems revisará antes de enviárselo al cliente.
Escribe en español, claro y profesional, en segunda persona del plural cuando hables al cliente. Responde SOLO con JSON válido.`;

async function generate(m: Row): Promise<void> {
  if (!m.transcript) throw new AiError('La reunión no tiene transcripción.');
  const project = m.project_id ? db.getProject(m.project_id) : undefined;
  const open = project ? db.listTasks(project.id).filter((t) => t.status !== 'completada') : [];
  // Entregas que el cliente pudo revisar en la reunión: sobre estas la IA detecta ajustes pedidos.
  const deliveries = project
    ? db.listTasks(project.id).filter((t) => isDelivery(t) && (t.status === 'en_revision' || t.status === 'completada'))
    : [];
  const attendees = parse<Attendee[]>(m.attendees, []);
  const date = new Date(m.start_at).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

  const { data, completion } = await completeJson<{ summary?: unknown; agreements?: unknown; tasks?: unknown; changes?: unknown }>({
    profile: 'reuniones',
    purpose: 'reunion',
    system: SYSTEM,
    maxOutputTokens: 8192,
    prompt: `Proyecto: ${project?.name ?? (m.kind === 'cliente' ? 'ninguno todavía: es una conversación con el cliente fuera de un proyecto (p. ej. sobre un proyecto futuro)' : 'sin proyecto asociado')}
Alcance aprobado (extracto): ${(project?.scope ?? '').slice(0, 3000) || '—'}

Tareas abiertas del proyecto (no las repitas):
${open.map((t) => `- ${t.title} [${t.side}]`).join('\n') || '- ninguna'}

Entregas al cliente que ya puede revisar (id, título, estado). Las tareas operativas internas no están aquí y no llevan ajustes:
${deliveries.map((t) => `- ${t.id}: ${t.title} [${t.status === 'completada' ? 'aprobada/completada' : 'en revisión'}${t.revision_round ? `, ${t.revision_round} rondas de ajustes` : ''}]`).join('\n') || '- ninguna'}

Reunión: «${m.title}» del ${date}.
Asistentes: ${attendees.map((a) => `${a.name || a.email} (${a.side === 'deersystems' ? 'DeerSystems' : a.side === 'cliente' ? 'cliente' : 'invitado'})`).join(', ') || 'sin datos'}

Devuelve:
{
  "summary": "Markdown: un párrafo de contexto y luego viñetas con los temas tratados y las decisiones. Máximo 250 palabras.",
  "agreements": ["acuerdo concreto y verificable", "..."],
  "tasks": [
    { "title": "tarea accionable que empiece con verbo", "description": "qué hay que hacer y para qué, 1-2 frases", "side": "deersystems | cliente", "dueDate": "YYYY-MM-DD o null" }
  ],
  "changes": [
    { "taskId": 12, "request": "los ajustes que el cliente pidió sobre esa entrega, concretos y en viñetas si son varios" }
  ]
}

Reglas:
- Solo tareas con un compromiso claro en la conversación. Nada inventado ni genérico.
- "side" es "cliente" si el compromiso lo asumió el cliente (enviar información, aprobar, dar accesos, pagar…); si no, "deersystems".
- Si se habló de una tarea que ya está abierta, no la crees de nuevo.
- "changes": solo cuando el cliente pidió cambios, correcciones o ajustes sobre una de las ENTREGAS listadas arriba (usa su id). Un ajuste a una entrega existente va en "changes", no como tarea nueva. Si el cliente la aprobó o no pidió cambios, no la incluyas. Si no hay, [].
- Convierte las fechas relativas ("el viernes", "en dos semanas") a YYYY-MM-DD tomando como referencia el ${date}. Si no se dijo fecha, null.
- No incluyas comentarios internos ni opiniones sobre el cliente: este texto lo leerá el cliente.

TRANSCRIPCIÓN:
"""
${m.transcript.slice(0, 400_000)}
"""`,
  });

  const tasks: ProposedTask[] = (Array.isArray(data.tasks) ? data.tasks : [])
    .slice(0, 40)
    .map((t: Record<string, unknown>) => ({
      title: str(t?.title, 200),
      description: str(t?.description, 2000),
      side: (t?.side === 'cliente' ? 'cliente' : 'deersystems') as db.Side,
      dueDate: optDate(t?.dueDate) ?? null,
    }))
    .filter((t) => t.title);
  const deliveryIds = new Set(deliveries.map((t) => t.id));
  const changes: ProposedChange[] = (Array.isArray(data.changes) ? data.changes : [])
    .map((c: Record<string, unknown>) => ({ taskId: Number(c?.taskId), request: str(c?.request, 4000) }))
    .filter((c, i, list) => deliveryIds.has(c.taskId) && c.request.length >= 5 && list.findIndex((x) => x.taskId === c.taskId) === i)
    .slice(0, 20);
  update(m.id, {
    proposed_changes: JSON.stringify(changes),
    summary: str(data.summary, 20_000),
    agreements: JSON.stringify((Array.isArray(data.agreements) ? data.agreements : []).map((a) => str(a, 500)).filter(Boolean).slice(0, 30)),
    proposed_tasks: JSON.stringify(tasks),
    ai: JSON.stringify({ provider: completion.provider, model: completion.model, costUsd: completion.costUsd, latencyMs: completion.latencyMs, fallbackReason: completion.fallbackReason ?? null }),
    status: 'borrador',
    error: null,
  });
  notify('meeting_draft', {
    actor: null,
    projectId: m.project_id,
    title: `Resumen listo para revisar: «${m.title}»`,
    body: `${tasks.length} tareas propuestas${changes.length ? ` · ${changes.length} ${changes.length === 1 ? 'entrega con ajustes' : 'entregas con ajustes'}` : ''}`,
    path: `/reuniones/${m.id}`,
  });
}

async function tryGenerate(m: Row): Promise<void> {
  try {
    await generate(m);
  } catch (err) {
    update(m.id, { status: 'error', error: (err as Error).message.slice(0, 500) });
  }
}

// ───────── Sincronización con Calendar y Meet ─────────

interface SyncState {
  lastRun: string | null;
  lastError: string | null;
  found: number;
  processed: number;
}

/** Por defecto solo se siguen las reuniones agendadas desde la plataforma (con su proyecto). */
interface MeetingSettings {
  importExternal: boolean;
}
const meetingSettings = (): MeetingSettings => ({ importExternal: false, ...(db.getSetting<Partial<MeetingSettings>>('meetings') ?? {}) });

const syncState = (): SyncState => db.getSetting<SyncState>('meetings_sync') ?? { lastRun: null, lastError: null, found: 0, processed: 0 };
let running: Promise<SyncState> | null = null;

/** Lee el calendario, actualiza las reuniones y procesa las que ya terminaron. Nunca corre dos veces a la vez. */
export function sync(): Promise<SyncState> {
  running ??= doSync().finally(() => (running = null));
  return running;
}

async function doSync(): Promise<SyncState> {
  const state: SyncState = { lastRun: now(), lastError: null, found: 0, processed: 0 };
  try {
    const status = google.connectionStatus();
    if (!status.connected) throw new Error('Google no está conectado.');
    if (!google.hasAnyScope('calendar.events', 'calendar.readonly') || !google.hasAnyScope('meetings.space.readonly')) {
      throw new Error('Faltan permisos de Google para Calendar y Meet: vuelve a conectar la cuenta en Configuración.');
    }
    const { importExternal } = meetingSettings();

    const staff = staffEmails();
    const clients = clientByEmail();
    const events = await google.calendarEvents(new Date(Date.now() - 14 * 86_400_000).toISOString(), new Date(Date.now() + 60 * 86_400_000).toISOString());

    for (const e of events) {
      const existing = byEvent(e.id);
      if (e.status === 'cancelled') {
        if (existing && ['programada', 'esperando'].includes(existing.status)) remove(existing);
        continue;
      }
      if (!e.start?.dateTime || !e.end?.dateTime) continue; // eventos de día completo
      const attendees: Attendee[] = (e.attendees ?? [])
        .filter((a) => a.email)
        .map((a) => {
          const email = a.email!.toLowerCase();
          return { email, name: a.displayName ?? '', side: staff.has(email) ? 'deersystems' : clients.has(email) ? 'cliente' : 'otro' };
        });
      const own = e.extendedProperties?.private?.dsPartners === '1';
      // Reuniones con clientes agendadas por fuera (otros temas): se ignoran, salvo que actives importarlas.
      if (!own && !existing && !importExternal) continue;
      const lockedProject = own ? Number(e.extendedProperties?.private?.dsProject) || null : null;
      const clientId =
        (lockedProject ? db.getProject(lockedProject)?.client_id : null) ??
        attendees.map((a) => clients.get(a.email)).find(Boolean) ??
        existing?.client_id ??
        null;
      // Reunión sin clientes: no es de la plataforma, salvo las llamadas comerciales con un prospecto (aún sin cuenta).
      const sales = !!existing && existing.kind !== 'proyecto';
      if (!clientId && !sales) continue;
      state.found++;
      const start = new Date(e.start.dateTime).toISOString();
      const end = new Date(e.end.dateTime).toISOString();
      const fields = {
        title: withoutPrefix(e.summary?.trim() || '') || 'Reunión',
        start_at: start,
        end_at: end,
        meet_code: meetCodeOf(e),
        meet_url: e.hangoutLink ?? null,
        calendar_url: e.htmlLink ?? null,
        attendees: JSON.stringify(attendees),
      };
      if (!existing) {
        insert({ event_id: e.id, client_id: clientId, project_id: lockedProject ?? projectFor(clientId!), status: end < now() ? 'esperando' : 'programada', ...fields });
      } else {
        // El proyecto lo puedes cambiar a mano: la sincronización no lo pisa.
        update(existing.id, {
          ...fields,
          client_id: clientId ?? existing.client_id,
          // Las llamadas comerciales no tienen proyecto todavía.
          ...(existing.project_id || sales || !clientId ? {} : { project_id: projectFor(clientId) }),
        });
        if (existing.status === 'programada' && end < now()) update(existing.id, { status: 'esperando' });
        if (existing.status === 'esperando' && end > now()) update(existing.id, { status: 'programada' });
      }
    }

    // Reuniones terminadas: buscar la transcripción (hasta 6 por vuelta) y generar el resumen.
    const pending = sqlite
      .prepare("SELECT * FROM meetings WHERE status = 'esperando' AND end_at < ? ORDER BY end_at DESC LIMIT 6")
      .all(new Date(Date.now() - 5 * 60_000).toISOString()) as unknown as Row[];
    for (const m of pending) {
      if (!m.meet_code) {
        update(m.id, { status: 'sin_transcripcion', error: 'La reunión no tiene enlace de Meet.' });
        continue;
      }
      try {
        if ((await lookupTranscript(m)) === 'ready') state.processed++;
      } catch (err) {
        state.lastError = (err as Error).message;
      }
    }
  } catch (err) {
    state.lastError = (err as Error).message;
  }
  db.setSetting('meetings_sync', state);
  return state;
}

/**
 * Busca la transcripción de una reunión terminada en Meet. Si está, genera el resumen.
 * Sin transcripción tres horas después de terminar (o al buscar a mano), queda «sin transcripción» con la causa.
 */
async function lookupTranscript(m: Row, manual = false): Promise<'ready' | 'pending' | 'none'> {
  if (!m.meet_code) {
    update(m.id, { status: 'sin_transcripcion', error: 'La reunión no tiene enlace de Meet.' });
    return 'none';
  }
  const t = await google.meetTranscript(m.meet_code, m.start_at);
  if (t.state === 'ready') {
    update(m.id, { transcript: t.text, transcript_source: 'meet', transcript_url: t.docUrl, status: 'esperando', error: null });
    await tryGenerate(get(m.id)!);
    return 'ready';
  }
  if (t.state === 'none' && (manual || Date.now() - new Date(m.end_at).getTime() > 3 * 3600_000)) {
    update(m.id, { status: 'sin_transcripcion', error: t.reason ?? 'Meet no generó transcripción para esta reunión.' });
  } else if (t.state === 'pending' && manual) {
    update(m.id, { status: 'esperando', error: null });
  }
  return t.state;
}

/** Cada 10 minutos, si Google está conectado. */
export function startScheduler(): void {
  const tick = () => {
    if (google.connectionStatus().connected) sync().catch((err) => console.error('Sincronización de reuniones:', err));
  };
  setTimeout(tick, 30_000).unref();
  setInterval(tick, 10 * 60_000).unref();
}

// ───────── Correo del resumen ─────────

/** El mismo correo sirve para enviarlo y para la vista previa: lo que ves es lo que recibe el cliente. */
function summaryMail(
  m: Row,
  project: db.Project | undefined,
  to: string,
  content: { summary: string; agreements: string[]; tasks: { title: string; side: db.Side; dueDate: string | null }[]; changes?: ProposedChange[] },
) {
  const date = new Date(m.start_at).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Bogota' });
  const day = (iso: string) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Bogota' });
  const bullets = (side: db.Side) =>
    content.tasks.filter((t) => t.side === side).map((t) => (t.dueDate ? `${t.title} · para el ${day(t.dueDate)}` : t.title));
  // Sin proyecto (reunión con cliente): el nombre del cliente y, si tiene cuenta, el enlace al portal.
  const clientId = project?.client_id ?? m.client_id;
  const hasPortal = !!clientId && !!db.getClientAccount(clientId);
  return meetingSummary({
    to,
    projectName: project?.name ?? (clientId ? db.getClient(clientId)?.name : null) ?? prospectOf(m)?.company ?? 'DeerSystems',
    meetingTitle: m.title,
    date,
    summary: content.summary,
    // Los ajustes pedidos sobre entregas van con los acuerdos: el cliente ve que quedaron registrados.
    agreements: [
      ...content.agreements,
      ...(content.changes ?? []).flatMap((c) => {
        const t = db.getTask(c.taskId);
        return t ? [`Ajustes en «${t.title}»: ${c.request.replace(/\s*\n\s*[-*•]?\s*/g, '; ').replace(/^[-*•]\s*/, '')}`] : [];
      }),
    ],
    ourTasks: bullets('deersystems'),
    clientTasks: bullets('cliente'),
    url: project ? `${PARTNERS_URL}/proyectos/${project.id}?tab=reuniones` : hasPortal ? PARTNERS_URL : null,
  });
}

/** Lee resumen, acuerdos y tareas tal como llegan del panel (para aprobar o para la vista previa). */
function readContent(body: Record<string, unknown>) {
  const team = new Set(db.listTeam().map((a) => a.id));
  return {
    summary: typeof body.summary === 'string' ? body.summary.trim().slice(0, 20_000) : '',
    agreements: (Array.isArray(body.agreements) ? body.agreements : []).map((a) => str(a, 500)).filter(Boolean).slice(0, 30),
    tasks: (Array.isArray(body.tasks) ? (body.tasks as Record<string, unknown>[]) : [])
      .map((t) => ({
        title: str(t.title, 200),
        description: str(t.description, 2000),
        side: (t.side === 'cliente' ? 'cliente' : 'deersystems') as db.Side,
        assigneeId: t.side !== 'cliente' && team.has(Number(t.assigneeId)) ? Number(t.assigneeId) : null,
        dueDate: optDate(t.dueDate) ?? null,
      }))
      .filter((t) => t.title)
      .slice(0, 40),
    changes: (Array.isArray(body.changes) ? (body.changes as Record<string, unknown>[]) : [])
      .map((c) => ({ taskId: Number(c.taskId), request: str(c.request, 4000) }))
      .filter((c, i, list) => c.taskId > 0 && c.request.length >= 5 && list.findIndex((x) => x.taskId === c.taskId) === i)
      .slice(0, 20),
  };
}

// ───────── Agendar ─────────

export type SalesKind = 'discovery' | 'proposal' | 'cliente';

export interface SalesCallInput {
  kind: SalesKind;
  clientId: number | null;
  company: string;
  contact: string;
  email: string;
  proposalId: number | null;
  title: string;
  date: string | null;
  time: string | null;
  durationMinutes: number;
  agenda: string;
  teamIds: number[];
  guests: string[];
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** «Discovery Call - Empresa (Contacto)», «Proposal Call - Empresa (Contacto)» o «Reunión - Empresa (Contacto)». */
export const salesTitle = (kind: SalesKind, company: string, contact: string) =>
  `${KIND_LABEL[kind]} - ${company || 'Cliente'}${contact ? ` (${contact})` : ''}`;

/**
 * Llamada comercial (Discovery o Proposal Call) con un cliente existente o un prospecto nuevo: Meet en tu Calendar,
 * invitaciones de Google y, en la Proposal Call, la propuesta ya subida que se enviará al terminar.
 */
export async function scheduleSalesCall(input: SalesCallInput): Promise<Row> {
  if (!google.connectionStatus().connected) throw new HttpError(503, 'Conecta Google en Configuración para agendar reuniones.');
  if (!google.hasAnyScope('calendar.events')) throw new HttpError(403, 'Falta el permiso para crear eventos: vuelve a conectar Google en Configuración.');
  const time = input.time && /^\d{2}:\d{2}$/.test(input.time) ? input.time : null;
  if (!input.date || !time) throw new HttpError(400, 'Elige la fecha y la hora.');
  const start = new Date(`${input.date}T${time}:00-05:00`);
  if (start.getTime() < Date.now() - 5 * 60_000) throw new HttpError(400, 'La fecha ya pasó.');
  const end = new Date(start.getTime() + Math.min(480, Math.max(15, input.durationMinutes || 45)) * 60_000);
  const client = input.clientId ? db.getClient(input.clientId) : undefined;
  if (input.clientId && !client) throw new HttpError(400, 'El cliente no existe.');
  const company = (input.company || client?.name || '').trim().slice(0, 120);
  const contact = (input.contact || client?.contact_name || '').trim().slice(0, 120);
  const email = (input.email || (client ? (db.getClientAccount(client.id)?.email ?? client.email) : '') || '').trim().toLowerCase();
  if (!company) throw new HttpError(400, 'Escribe la empresa o el nombre del cliente.');
  if (!EMAIL.test(email)) throw new HttpError(400, 'Escribe el correo del contacto.');
  const proposal = input.proposalId ? getProposal(input.proposalId) : undefined;
  if (input.proposalId && !proposal) throw new HttpError(400, 'La propuesta no existe.');
  await assertFree(start, end);

  const emails = new Set<string>([email]);
  const teamIds = new Set(input.teamIds);
  for (const a of db.listTeam()) if (a.active && teamIds.has(a.id)) emails.add(a.email.toLowerCase());
  for (const g of input.guests) {
    const e = g.trim().toLowerCase();
    if (EMAIL.test(e)) emails.add(e);
  }
  emails.delete(SUPERADMIN_EMAIL);
  const title = input.title.trim().slice(0, 200) || salesTitle(input.kind, company, contact);
  const agenda = input.agenda.trim().slice(0, 4000);

  let event: google.CalendarEvent;
  try {
    event = await google.createCalendarEvent({
      summary: title,
      description:
        agenda ||
        (input.kind === 'discovery'
          ? 'Conversación inicial para entender tu negocio, tus retos y cómo podemos ayudarte.'
          : input.kind === 'cliente'
            ? 'Conversación con DeerSystems sobre tus ideas y los siguientes pasos.'
            : 'Presentación de la propuesta de DeerSystems.'),
      startIso: start.toISOString(),
      endIso: end.toISOString(),
      attendees: [...emails],
      privateProps: { dsPartners: '1', dsKind: input.kind },
    });
  } catch (err) {
    throw err instanceof google.GoogleError ? new HttpError(502, err.message) : err;
  }
  const staff = staffEmails();
  const clients = clientByEmail();
  try {
    const m = insert({
      event_id: event.id,
      client_id: client?.id ?? null,
      project_id: null,
      title,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      meet_code: meetCodeOf(event),
      meet_url: event.hangoutLink ?? null,
      calendar_url: event.htmlLink ?? null,
      attendees: JSON.stringify(
        [...emails].map((e) => ({ email: e, name: e === email ? contact : '', side: staff.has(e) ? 'deersystems' : clients.has(e) || e === email ? 'cliente' : 'otro' })),
      ),
      status: 'programada',
    });
    update(m.id, { kind: input.kind, prospect: JSON.stringify({ company, contact, email }), proposal_id: proposal?.id ?? null });
    return get(m.id)!;
  } catch (err) {
    // Si no se pudo registrar aquí, se cancela en Calendar para no dejar invitaciones huérfanas.
    await google.cancelCalendarEvent(event.id).catch(() => {});
    throw err;
  }
}

/** Copy por defecto del correo tras la Proposal Call: agradece, conecta con lo hablado y muestra experiencia. */
export function defaultProposalMessage(contact: string, company: string): string {
  const first = contact.split(' ')[0];
  return `Hola${first ? ` ${first}` : ''},

Gracias por el espacio de hoy para presentarte la propuesta${company ? ` para ${company}` : ''}. Fue muy valioso escuchar de primera mano cómo trabajan y qué quieren lograr.

En DeerSystems diseñamos software, automatizaciones e inteligencia artificial para empresas que necesitan resultados medibles: menos tareas manuales, procesos que no dependen de una sola persona y datos claros para decidir. Esa experiencia es la que pusimos en esta propuesta, pensada para tu caso y no como una plantilla.

Aquí la tienes para revisarla con calma y compartirla con tu equipo: incluye el alcance, las etapas, los tiempos y la inversión.

Si quieres ajustar algo o resolver dudas, respóndeme este correo o agendamos 15 minutos. Con tu visto bueno, arrancamos con la primera etapa.

Un abrazo,
David Lidueñas · DeerSystems`;
}

/** Nombre del contacto y empresa de la reunión: del prospecto o del cliente. */
function whoOf(m: Row) {
  const p = prospectOf(m);
  const client = m.client_id ? db.getClient(m.client_id) : undefined;
  return { contact: p?.contact || client?.contact_name || '', company: p?.company || client?.name || '' };
}

export interface ScheduleInput {
  title: string;
  date: string | null;
  time: string | null;
  durationMinutes: number;
  agenda: string;
  includeClient: boolean;
  teamIds: number[];
  guests: string[];
  /** Fase del proyecto: la reunión queda en ella y aparece en el cronograma. */
  phaseId?: number | null;
  /** Solo reservar el horario: el cliente no recibe la invitación hasta que confirmes la reunión. */
  tentative?: boolean;
  /** La reunión del plan (tarea tipo reunión) que se está agendando: queda vinculada a ella en vez de crear otra. */
  taskId?: number | null;
}

/**
 * Crea la reunión con Meet en tu Calendar (Google envía las invitaciones) y la deja asignada al proyecto.
 * La usan el formulario de agendar y la aprobación de propuestas (reuniones de avance).
 */
/**
 * El título de la reunión empieza por a quién es, para reconocerla de un vistazo en Calendar: el cliente
 * («Las Negras · Reunión de avance 2») o, si el cliente tiene varios proyectos (p. ej. una agencia), el proyecto.
 */
export function meetingTitle(project: db.Project, client: db.Client, raw: string): string {
  const many = db.listProjects(client.id).length > 1;
  const who = ((many ? project.name : client.name || project.name) || project.name).trim();
  const title = raw.trim() || 'Reunión';
  if (!who || title.toLowerCase().includes(who.toLowerCase())) return title.slice(0, 200);
  return `${who} · ${title}`.slice(0, 200);
}

export async function scheduleMeeting(project: db.Project, input: ScheduleInput, v: Viewer): Promise<Row> {
  if (!google.connectionStatus().connected) throw new HttpError(503, 'Conecta Google en Configuración para agendar reuniones.');
  if (!google.hasAnyScope('calendar.events')) throw new HttpError(403, 'Falta el permiso para crear eventos: vuelve a conectar Google en Configuración.');
  const time = input.time && /^\d{2}:\d{2}$/.test(input.time) ? input.time : null;
  if (!input.date || !time) throw new HttpError(400, 'Elige la fecha y la hora.');
  const minutes = Math.min(480, Math.max(15, input.durationMinutes || 45));
  // Colombia no cambia de horario: -05:00 todo el año.
  const start = new Date(`${input.date}T${time}:00-05:00`);
  if (start.getTime() < Date.now() - 5 * 60_000) throw new HttpError(400, 'La fecha ya pasó.');
  const end = new Date(start.getTime() + minutes * 60_000);
  const client = db.getClient(project.client_id)!;
  const emails = new Set<string>();
  // El cliente: todas las personas que ven el proyecto (la cuenta principal y su ejecutivo), o su correo de contacto.
  const people = db.projectClientAccounts(project.id).map((a) => a.email);
  if (input.includeClient) for (const e of people.length ? people : client.email ? [client.email] : []) emails.add(e.toLowerCase());
  const teamIds = new Set(input.teamIds);
  for (const a of db.listTeam()) if (a.active && teamIds.has(a.id)) emails.add(a.email.toLowerCase());
  for (const g of input.guests) {
    const e = g.trim().toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) emails.add(e);
  }
  emails.delete(SUPERADMIN_EMAIL); // tú eres el organizador
  if (!emails.size) throw new HttpError(400, 'Invita al menos a una persona.');
  if (input.phaseId && db.getPhase(input.phaseId)?.project_id !== project.id) throw new HttpError(400, 'La fase no es de este proyecto.');
  const planTask = input.taskId ? db.getTask(input.taskId) : undefined;
  if (input.taskId && (!planTask || planTask.project_id !== project.id)) throw new HttpError(400, 'La tarea no es de este proyecto.');
  if (planTask && meetingOfTask(planTask.id)) throw new HttpError(409, 'Esta reunión del plan ya está agendada: cámbiale la fecha u hora.');
  await assertFree(start, end);
  const title = meetingTitle(project, client, input.title);
  const agenda = input.agenda.trim().slice(0, 4000);
  // Reserva: en Calendar solo queda tu equipo; el cliente se invita al confirmar.
  const clientEmails = new Set(clientByEmail().keys());
  const pending = input.tentative ? [...emails].filter((e) => clientEmails.has(e) || !staffEmails().has(e)) : [];
  const invited = [...emails].filter((e) => !pending.includes(e));

  let event: google.CalendarEvent;
  try {
    event = await google.createCalendarEvent({
      summary: calendarSummary({ tentative: input.tentative ? 1 : 0 }, title),
      description: [
        input.tentative ? `Reservada: por confirmar con ${pending.join(', ')}. Confírmala en Partners para enviarle la invitación.` : '',
        agenda,
        `Proyecto: ${project.name}`,
        `Sigue el proyecto en ${PARTNERS_URL}`,
      ]
        .filter(Boolean)
        .join('\n\n'),
      startIso: start.toISOString(),
      endIso: end.toISOString(),
      attendees: invited,
      privateProps: { dsPartners: '1', dsProject: String(project.id) },
    });
  } catch (err) {
    throw err instanceof google.GoogleError ? new HttpError(502, err.message) : err;
  }
  const staff = staffEmails();
  const clients = clientByEmail();
  let m: Row;
  try {
    m = insert({
    event_id: event.id,
    client_id: client.id,
    project_id: project.id,
    title,
    start_at: start.toISOString(),
    end_at: end.toISOString(),
    meet_code: meetCodeOf(event),
    meet_url: event.hangoutLink ?? null,
    calendar_url: event.htmlLink ?? null,
    attendees: JSON.stringify(
      invited.map((email) => ({ email, name: '', side: staff.has(email) ? 'deersystems' : clients.has(email) ? 'cliente' : 'otro' })),
    ),
    status: 'programada',
    });
  } catch (err) {
    // Si no se pudo registrar aquí, se cancela en Calendar para no dejar invitaciones huérfanas.
    await google.cancelCalendarEvent(event.id).catch(() => {});
    throw err;
  }
  // Desde una reunión del plan: la tarea queda vinculada (no se crea otra) y sigue la fecha de la reunión.
  if (planTask) {
    sqlite.prepare('UPDATE meetings SET plan_task_id = ? WHERE id = ?').run(planTask.id, m.id);
    if (planTask.kind !== 'reunion') db.updateTask(planTask.id, { kind: 'reunion' });
  }
  const phaseId = input.phaseId ?? planTask?.phase_id ?? null;
  if (phaseId) update(m.id, { phase_id: phaseId });
  else if (planTask) syncPlanTask(m.id, false);
  if (input.tentative) update(m.id, { tentative: 1, pending_attendees: JSON.stringify(pending) });
  const a = actor(v);
  const when = start.toLocaleString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota' });
  if (input.tentative) {
    db.logActivity({ projectId: project.id, actorKind: a.kind, actorName: a.name, type: 'meeting_reserved', data: { title, when } });
    askClientToConfirm(get(m.id)!, v);
    return get(m.id)!;
  }
  db.logActivity({ projectId: project.id, actorKind: a.kind, actorName: a.name, type: 'meeting_scheduled', data: { title, when } });
  notify('meeting_scheduled', { actor: v, projectId: project.id, title: `Reunión agendada: «${title}»`, body: when, path: `/proyectos/${project.id}?tab=reuniones` });
  return get(m.id)!;
}

// ───────── API ─────────

export async function handleMeetings(route: string, id: number, req: IncomingMessage, res: ServerResponse, v: Viewer, url: URL): Promise<boolean> {
  switch (route) {
    case 'GET meetings': {
      requireOwner(v);
      const rows = sqlite.prepare(`SELECT ${LIST()} FROM meetings ORDER BY start_at DESC LIMIT 300`).all() as unknown as Row[];
      json(res, 200, { items: rows.map((m) => view(m, v)), sync: syncState(), settings: meetingSettings() });
      return true;
    }

    case 'POST meetings/sync': {
      requireOwner(v);
      json(res, 200, await sync());
      return true;
    }

    case 'PUT meetings/settings': {
      requireOwner(v);
      const body = await readJson(req);
      const next = { ...meetingSettings(), ...(typeof body.importExternal === 'boolean' ? { importExternal: body.importExternal } : {}) };
      db.setSetting('meetings', next);
      json(res, 200, next);
      return true;
    }

    // Datos para el formulario de agendar: el contacto del cliente y el equipo.
    case 'GET projects/:id/contacts': {
      requireOwner(v);
      const project = visibleProject(id, v);
      const client = db.getClient(project.client_id)!;
      const people = db.projectClientAccounts(project.id).map((a) => a.email);
      json(res, 200, {
        client: { name: client.contact_name || client.name, company: client.name, email: people.length ? people.join(', ') : client.email },
        team: db.listTeam().filter((a) => a.active).map((a) => ({ id: a.id, name: a.name, email: a.email })),
        phases: db.listPhases(project.id).map((p) => ({ id: p.id, name: p.name })),
        canSchedule: google.connectionStatus().connected && google.hasAnyScope('calendar.events'),
      });
      return true;
    }

    // Agendar desde la plataforma: crea el evento con Meet en tu Calendar, invita y lo deja en el proyecto.
    // Qué está ocupado y si los horarios pedidos chocan (formularios de agendar, editar y el plan de la propuesta).
    case 'POST calendar/check': {
      requireOwner(v);
      const body = await readJson(req);
      const slots = (Array.isArray(body.slots) ? body.slots : []).slice(0, 30).map((s: Record<string, unknown>) => ({
        date: str(s?.date, 10),
        time: str(s?.time, 5),
        durationMinutes: Math.min(480, Math.max(15, Number(s?.durationMinutes) || 45)),
      }));
      json(res, 200, await checkSlots(slots, Number(body.excludeMeetingId) || null));
      return true;
    }

    case 'POST meetings/sales': {
      requireOwner(v);
      const body = await readJson(req);
      const m = await scheduleSalesCall({
        kind: body.kind === 'proposal' || body.kind === 'cliente' ? body.kind : 'discovery',
        clientId: Number(body.clientId) || null,
        company: str(body.company, 120),
        contact: str(body.contact, 120),
        email: str(body.email, 200),
        proposalId: Number(body.proposalId) || null,
        title: str(body.title, 200),
        date: optDate(body.date) ?? null,
        time: typeof body.time === 'string' ? body.time : null,
        durationMinutes: Number(body.durationMinutes) || 45,
        agenda: typeof body.agenda === 'string' ? body.agenda : '',
        teamIds: (Array.isArray(body.team) ? body.team : []).map(Number),
        guests: (Array.isArray(body.guests) ? body.guests : []).map((g) => str(g, 200)),
      });
      json(res, 201, view(m, v));
      return true;
    }

    // Correo con la propuesta después de la Proposal Call: vista previa y envío.
    case 'POST meetings/:id/proposal/preview':
    case 'POST meetings/:id/proposal/send': {
      requireOwner(v);
      const m = visible(id, v);
      const body = await readJson(req);
      const proposal = getProposal(Number(body.proposalId) || m.proposal_id || 0);
      if (!proposal) throw new HttpError(400, 'Elige la propuesta que vas a enviar.');
      const { contact, company } = whoOf(m);
      const to = [...new Set((Array.isArray(body.to) ? body.to : []).map((e) => str(e, 200).toLowerCase()))].filter((e) => EMAIL.test(e));
      const message = str(body.message, 8000) || defaultProposalMessage(contact, company);
      const first = contact.split(' ')[0];
      const mail = proposalAfterCall({
        to: to.join(', '),
        subject: str(body.subject, 200) || `Propuesta DeerSystems${company ? ` para ${company}` : ''}`,
        title: `${first ? `${first}, gracias` : 'Gracias'} por el espacio: aquí está tu propuesta`,
        message,
        proposalUrl: publicUrl(proposal.slug),
        proposalTitle: proposal.title,
      });
      if (route.endsWith('preview')) {
        json(res, 200, { subject: mail.subject, to: mail.to, html: mail.html });
        return true;
      }
      if (!proposal.active) throw new HttpError(409, 'El enlace de esa propuesta está pausado: actívalo en Propuestas antes de enviarla.');
      if (!to.length) throw new HttpError(400, 'Elige al menos un destinatario.');
      if (to.length > 10) throw new HttpError(400, 'Máximo 10 destinatarios.');
      const sendAt = readSendAt(body.sendAt);
      if (sendAt) {
        // Programado: se guarda el correo tal cual y sale a esa hora (si el enlace sigue activo).
        update(m.id, { proposal_id: proposal.id });
        scheduleMail({
          kind: 'proposal',
          refId: m.id,
          sendAt,
          mail,
          meta: { proposalId: proposal.id, to },
          label: `propuesta «${proposal.title || proposal.slug}»`,
          path: `/reuniones/${m.id}`,
        });
        json(res, 200, view(get(m.id)!, v));
        return true;
      }
      if (!google.connectionStatus().connected) throw new HttpError(409, 'Conecta Google en Configuración para enviar correos.');
      try {
        await google.sendMail(mail);
      } catch (err) {
        throw err instanceof google.GoogleError ? new HttpError(502, err.message) : err;
      }
      update(m.id, { proposal_id: proposal.id, proposal_sent_at: now(), proposal_sent_to: JSON.stringify(to) });
      json(res, 200, view(get(m.id)!, v));
      return true;
    }

    // El copy por defecto, o ajustado por la IA con lo que se habló en la llamada (transcripción o resumen).
    case 'POST meetings/:id/proposal/message': {
      requireOwner(v);
      const m = visible(id, v);
      const { contact, company } = whoOf(m);
      const body = await readJson(req);
      if (body.ai !== true) {
        json(res, 200, { message: defaultProposalMessage(contact, company) });
        return true;
      }
      const context = (m.transcript || m.summary || '').slice(0, 60_000);
      if (!context.trim()) throw new HttpError(400, 'La reunión aún no tiene transcripción ni resumen: impórtala primero para personalizar el mensaje.');
      let text: string;
      try {
        const completion = await complete({
          profile: 'reuniones', // conversación con el cliente: solo proveedores privados
          purpose: 'propuesta-correo',
          system:
            'Eres David Lidueñas, fundador de DeerSystems (software, automatización e IA, Colombia). Escribes en español, cálido, directo y profesional, tuteando. Responde SOLO con el cuerpo del correo, sin asunto.',
          maxOutputTokens: 8192,
          prompt: `Escribe el correo que acompaña la propuesta después de la llamada en la que se la presentaste a ${contact || 'el cliente'}${company ? ` de ${company}` : ''}.

Debe:
- Agradecer el espacio para presentar la propuesta.
- Retomar 2 o 3 puntos concretos de la conversación (sus retos, lo que valoraron, dudas que surgieron) y cómo la propuesta los resuelve.
- Mostrar experiencia sin presumir: cómo DeerSystems resuelve problemas parecidos con software, automatización e IA, con resultados medibles.
- Si en la llamada se pidieron cambios, decir que ya están incluidos en esta versión.
- Cerrar con un siguiente paso claro (visto bueno, dudas o una llamada corta).
- Máximo 190 palabras, párrafos cortos, sin emojis, sin inventar cifras, clientes ni datos que no estén en la conversación. Firma: David Lidueñas · DeerSystems.

LO QUE SE HABLÓ:
---
${context}
---`,
        });
        text = completion.text.trim().replace(/^```\w*\s*/, '').replace(/```$/, '').trim();
      } catch (err) {
        throw new HttpError(502, `La IA no respondió: ${(err as Error).message}`);
      }
      json(res, 200, { message: text.slice(0, 8000) });
      return true;
    }

    case 'POST projects/:id/meetings/schedule': {
      requireOwner(v);
      const project = visibleProject(id, v);
      const body = await readJson(req);
      const m = await scheduleMeeting(project, {
        title: str(body.title, 200),
        date: optDate(body.date) ?? null,
        time: typeof body.time === 'string' ? body.time : null,
        durationMinutes: Number(body.durationMinutes) || 45,
        agenda: typeof body.agenda === 'string' ? body.agenda : '',
        includeClient: body.includeClient !== false,
        teamIds: (Array.isArray(body.team) ? body.team : []).map(Number),
        guests: (Array.isArray(body.guests) ? body.guests : []).map((g) => str(g, 200)),
        phaseId: Number(body.phaseId) || null,
        tentative: body.tentative === true,
        taskId: Number(body.taskId) || null,
      }, v);
      json(res, 201, view(m, v));
      return true;
    }

    // La reunión agendada de una tarea del plan (para ver y cambiar su hora desde el detalle de la tarea).
    case 'GET tasks/:id/meeting': {
      const task = db.getTask(id);
      if (!task) throw new HttpError(404, 'La tarea no existe.');
      visibleProject(task.project_id, v);
      linkOrphanMeetings(task.project_id);
      const m = sqlite.prepare('SELECT * FROM meetings WHERE plan_task_id = ?').get(task.id) as unknown as Row | undefined;
      const shown = m && shownTo(m, v);
      json(res, 200, { meeting: shown ? view(m, v) : null, canSchedule: v.kind === 'owner' && google.connectionStatus().connected && google.hasAnyScope('calendar.events') });
      return true;
    }

    // Cambiar fecha, hora, duración, título o invitados. Con `notify`, Google avisa a los invitados del cambio.
    case 'POST meetings/:id/update': {
      requireOwner(v);
      const m = visible(id, v);
      if (m.status !== 'programada') throw new HttpError(409, 'Solo se pueden editar reuniones que aún no ocurren.');
      const body = await readJson(req);
      const date = optDate(body.date) ?? null;
      const time = typeof body.time === 'string' && /^\d{2}:\d{2}$/.test(body.time) ? body.time : null;
      if (!date || !time) throw new HttpError(400, 'Elige la fecha y la hora.');
      const minutes = Math.min(480, Math.max(15, Number(body.durationMinutes) || 45));
      // Colombia no cambia de horario: -05:00 todo el año.
      const start = new Date(`${date}T${time}:00-05:00`);
      if (start.getTime() < Date.now() - 5 * 60_000) throw new HttpError(400, 'La fecha ya pasó.');
      const end = new Date(start.getTime() + minutes * 60_000);
      const title = str(body.title, 200) || m.title;
      const emails = new Set(
        (Array.isArray(body.attendees) ? body.attendees : [])
          .map((e) => str(e, 200).trim().toLowerCase())
          .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)),
      );
      emails.delete(SUPERADMIN_EMAIL); // tú eres el organizador
      if (!emails.size) throw new HttpError(400, 'Deja al menos a una persona invitada.');
      await assertFree(start, end, m.id);
      const notifyGuests = body.notify !== false;

      let event: google.CalendarEvent | null = null;
      if (m.event_id) {
        if (!google.connectionStatus().connected) throw new HttpError(503, 'Conecta Google en Configuración para editar reuniones.');
        try {
          event = await google.updateCalendarEvent(
            m.event_id,
            { summary: calendarSummary(m, title), startIso: start.toISOString(), endIso: end.toISOString(), attendees: [...emails] },
            notifyGuests,
          );
        } catch (err) {
          throw err instanceof google.GoogleError ? new HttpError(502, err.message) : err;
        }
      }
      const staff = staffEmails();
      const clients = clientByEmail();
      const before = new Map(parse<Attendee[]>(m.attendees, []).map((a) => [a.email, a]));
      const moved = start.toISOString() !== m.start_at || end.toISOString() !== m.end_at;
      update(m.id, {
        ...(m.tentative && moved ? { client_proposal: null } : {}),
        title,
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        ...(event?.htmlLink ? { calendar_url: event.htmlLink } : {}),
        attendees: JSON.stringify(
          [...emails].map((email) => ({
            email,
            name: before.get(email)?.name ?? '',
            side: staff.has(email) ? 'deersystems' : clients.has(email) ? 'cliente' : 'otro',
          })),
        ),
      });
      if (m.project_id) {
        const a = actor(v);
        const when = start.toLocaleString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota' });
        db.logActivity({ projectId: m.project_id, actorKind: a.kind, actorName: a.name, type: 'meeting_updated', data: { title, when } });
      }
      // Reserva con otra hora: el cliente la vuelve a ver por confirmar, con el horario nuevo.
      if (m.tentative && moved) askClientToConfirm(get(m.id)!, v, true);
      json(res, 200, view(get(m.id)!, v));
      return true;
    }

    // La reserva pasa a reunión: se invita al cliente (Google le envía la invitación) con la fecha y hora de ese momento.
    case 'POST meetings/:id/confirm': {
      requireOwner(v);
      json(res, 200, view(await confirmTentative(visible(id, v), v), v));
      return true;
    }

    // Reuniones por confirmar: al cliente, las reservas que le tocan; a ti, las que el cliente respondió con otro horario.
    case 'GET meetings/pending': {
      if (v.kind === 'team') {
        json(res, 200, { items: [] });
        return true;
      }
      const rows = sqlite
        .prepare(`SELECT ${LIST()} FROM meetings WHERE tentative = 1 AND status = 'programada' AND project_id IS NOT NULL ORDER BY start_at`)
        .all() as unknown as Row[];
      const items = v.kind === 'owner' ? rows.filter((m) => !!m.client_proposal) : rows.filter((m) => clientResponds(m, v));
      json(res, 200, { items: items.map((m) => view(m, v)) });
      return true;
    }

    // El cliente responde la reserva: confirma el día y la hora, o propone otros (con una nota).
    case 'POST meetings/:id/respond': {
      const m = visible(id, v);
      if (!clientResponds(m, v)) throw new HttpError(403, 'Esta reunión no está pendiente de tu confirmación.');
      const body = await readJson(req);
      if (body.action === 'confirm') {
        json(res, 200, view(await confirmTentative(m, v), v));
        return true;
      }
      if (body.action !== 'propose') throw new HttpError(400, 'Acción no válida.');
      const date = optDate(body.date) ?? null;
      const time = typeof body.time === 'string' && /^\d{2}:\d{2}$/.test(body.time) ? body.time : null;
      if (!date || !time) throw new HttpError(400, 'Elige la fecha y la hora que te sirven.');
      // Colombia no cambia de horario: -05:00 todo el año.
      const start = new Date(`${date}T${time}:00-05:00`);
      if (Number.isNaN(start.getTime())) throw new HttpError(400, 'Fecha u hora no válida.');
      if (start.getTime() < Date.now() + 30 * 60_000) throw new HttpError(400, 'Elige un horario con al menos 30 minutos de anticipación.');
      if (start.getTime() > Date.now() + 120 * 86_400_000) throw new HttpError(400, 'Elige una fecha dentro de los próximos cuatro meses.');
      const end = new Date(start.getTime() + (new Date(m.end_at).getTime() - new Date(m.start_at).getTime()));
      if (start.toISOString() === m.start_at) throw new HttpError(400, 'Ese es el mismo horario reservado: usa «Confirmar».');
      const check = await freeForClient(start, end, m.id);
      if (!check.free) {
        // "a. m." ya termina en punto.
        throw new HttpError(409, `Ese horario ya está ocupado en la agenda de DeerSystems.${check.next ? ` El siguiente horario libre es el ${check.next}.` : ' Elige otro.'}`.replace(/\.\.$/, '.'));
      }
      const proposal: ClientProposal = { startAt: start.toISOString(), endAt: end.toISOString(), note: str(body.note, 1000), by: v.name || v.email, at: now() };
      update(m.id, { client_proposal: JSON.stringify(proposal) });
      const when = whenLabel(proposal.startAt);
      const a = actor(v);
      db.logActivity({ projectId: m.project_id!, actorKind: a.kind, actorName: a.name, type: 'meeting_proposed', data: { title: m.title, when } });
      notify('meeting_reply', {
        actor: v,
        projectId: m.project_id,
        title: `${proposal.by} propone otro horario para «${m.title}»`,
        body: `${when}${proposal.note ? ` · ${proposal.note}` : ''}`,
        path: `/reuniones/${m.id}`,
      });
      json(res, 200, view(get(m.id)!, v));
      return true;
    }

    // Aceptas el horario que propuso el cliente: la reunión se mueve ahí y se le envía la invitación.
    case 'POST meetings/:id/accept-proposal': {
      requireOwner(v);
      const m = visible(id, v);
      const p = parse<ClientProposal | null>(m.client_proposal, null);
      if (!m.tentative || !p) throw new HttpError(409, 'Esta reunión no tiene un horario propuesto por el cliente.');
      const { date, time } = bogota(Date.parse(p.startAt));
      await moveMeeting(m.id, date, time, null, v, true);
      json(res, 200, view(await confirmTentative(get(m.id)!, v), v));
      return true;
    }

    case 'POST meetings/:id/cancel': {
      requireOwner(v);
      const m = visible(id, v);
      if (m.status !== 'programada') throw new HttpError(409, 'Solo se pueden cancelar reuniones que aún no ocurren.');
      if (m.event_id) {
        try {
          await google.cancelCalendarEvent(m.event_id);
        } catch (err) {
          throw err instanceof google.GoogleError ? new HttpError(502, err.message) : err;
        }
      }
      remove(m);
      if (m.project_id) {
        const a = actor(v);
        db.logActivity({ projectId: m.project_id, actorKind: a.kind, actorName: a.name, type: 'meeting_cancelled', data: { title: m.title } });
      }
      json(res, 200, { ok: true });
      return true;
    }

    case 'GET projects/:id/meetings': {
      const project = visibleProject(id, v);
      linkOrphanMeetings(project.id);
      const rows = sqlite.prepare(`SELECT ${LIST()} FROM meetings WHERE project_id = ? ORDER BY start_at DESC`).all(project.id) as unknown as Row[];
      json(res, 200, rows.filter((m) => shownTo(m, v)).map((m) => view(m, v)));
      return true;
    }

    // Reunión fuera del calendario (teléfono, Zoom, presencial): pegas la transcripción o tus notas.
    case 'POST projects/:id/meetings': {
      requireOwner(v);
      const project = visibleProject(id, v);
      const body = await readJson(req);
      const transcript = typeof body.transcript === 'string' ? body.transcript.trim().slice(0, 400_000) : '';
      const startAt = typeof body.startAt === 'string' && !Number.isNaN(Date.parse(body.startAt)) ? new Date(body.startAt).toISOString() : now();
      if (transcript.length < 50) throw new HttpError(400, 'Pega la transcripción o tus notas de la reunión.');
      const m = insert({
        client_id: project.client_id,
        project_id: project.id,
        title: str(body.title, 200) || 'Reunión',
        start_at: startAt,
        end_at: startAt,
        status: 'esperando',
        transcript,
        transcript_source: 'manual',
      });
      await tryGenerate(m);
      json(res, 201, view(get(m.id)!, v));
      return true;
    }

    case 'GET meetings/:id': {
      const m = visible(id, v);
      const out = view(m, v);
      json(res, 200, v.kind === 'owner' && url.searchParams.get('transcript') === '1' ? { ...out, transcript: m.transcript } : out);
      return true;
    }

    case 'PATCH meetings/:id': {
      requireOwner(v);
      const m = visible(id, v);
      const body = await readJson(req);
      if ('projectId' in body) {
        const pid = Number(body.projectId) || null;
        if (pid && !db.getProject(pid)) throw new HttpError(400, 'El proyecto no existe.');
        // Otra fase no sirve en otro proyecto: al cambiar de proyecto, la reunión queda fuera de las fases.
        update(m.id, { project_id: pid, phase_id: pid === m.project_id ? m.phase_id : null, ...(pid ? { client_id: db.getProject(pid)!.client_id } : {}) });
      }
      if ('proposalId' in body) {
        const proposalId = Number(body.proposalId) || null;
        if (proposalId && !getProposal(proposalId)) throw new HttpError(400, 'La propuesta no existe.');
        update(m.id, { proposal_id: proposalId });
      }
      if ('phaseId' in body) {
        const phaseId = Number(body.phaseId) || null;
        const current = get(m.id)!;
        if (phaseId && db.getPhase(phaseId)?.project_id !== current.project_id) throw new HttpError(400, 'La fase no es del proyecto de la reunión.');
        update(m.id, { phase_id: phaseId });
      }
      json(res, 200, view(get(m.id)!, v));
      return true;
    }

    // Volver a buscar en Meet (por ejemplo, si la transcripción tardó más de lo normal).
    case 'POST meetings/:id/lookup': {
      requireOwner(v);
      const m = visible(id, v);
      if (m.status === 'aprobada') throw new HttpError(409, 'La reunión ya fue aprobada.');
      if (!google.connectionStatus().connected) throw new HttpError(409, 'Conecta Google en Configuración.');
      let result: string;
      try {
        result = await lookupTranscript(m, true);
      } catch (err) {
        throw new HttpError(502, (err as Error).message);
      }
      json(res, 200, { result, meeting: view(get(m.id)!, v) });
      return true;
    }

    // Transcripción o notas desde un documento de Drive elegido con el selector (permiso drive.file).
    case 'POST meetings/:id/transcript/drive': {
      requireOwner(v);
      const m = visible(id, v);
      if (m.status === 'aprobada') throw new HttpError(409, 'La reunión ya fue aprobada.');
      const fileId = str((await readJson(req)).fileId, 200);
      if (!/^[\w-]{10,}$/.test(fileId)) throw new HttpError(400, 'Elige el documento en Drive.');
      let text: string;
      let url: string | null;
      try {
        const meta = await google.fileMeta(fileId);
        if (!google.isGoogleNative(meta.mimeType) && !/^text\//.test(meta.mimeType)) {
          throw new HttpError(400, `«${meta.name}» no es un documento de texto. Elige el documento de la transcripción o de las notas (no el video).`);
        }
        text = (await google.fileText(fileId, meta.mimeType)).trim();
        url = meta.webViewLink ?? null;
      } catch (err) {
        if (err instanceof HttpError) throw err;
        throw new HttpError(502, (err as Error).message);
      }
      if (text.length < 50) throw new HttpError(400, 'El documento está vacío o es muy corto.');
      update(m.id, { transcript: text.slice(0, 400_000), transcript_source: 'drive', transcript_url: url, error: null });
      await tryGenerate(get(m.id)!);
      json(res, 200, view(get(m.id)!, v));
      return true;
    }

    case 'POST meetings/:id/transcript':
    case 'POST meetings/:id/generate': {
      requireOwner(v);
      const m = visible(id, v);
      if (m.status === 'aprobada') throw new HttpError(409, 'La reunión ya fue aprobada.');
      if (route.endsWith('transcript')) {
        const text = str((await readJson(req)).transcript, 400_000);
        if (text.length < 50) throw new HttpError(400, 'La transcripción es muy corta.');
        update(m.id, { transcript: text, transcript_source: 'manual' });
      }
      const fresh = get(m.id)!;
      if (!fresh.transcript) throw new HttpError(400, 'Primero pega la transcripción.');
      await tryGenerate(fresh);
      json(res, 200, view(get(m.id)!, v));
      return true;
    }

    // Vista previa del correo con lo que está en pantalla, sin guardar nada.
    case 'POST meetings/:id/preview': {
      requireOwner(v);
      const m = visible(id, v);
      const body = await readJson(req);
      const project = db.getProject(Number(body.projectId) || m.project_id || 0);
      if (!project && m.kind !== 'cliente') throw new HttpError(400, 'Elige el proyecto de la reunión.');
      const clientId = project?.client_id ?? m.client_id;
      const to = str(body.to, 200) || (clientId ? db.getClientAccount(clientId)?.email : '') || prospectOf(m)?.email || '';
      const content = readContent(body);
      const mail = summaryMail(m, project, to, project ? content : { ...content, tasks: [], changes: [] });
      json(res, 200, { subject: mail.subject, to, html: mail.html });
      return true;
    }

    case 'POST meetings/:id/discard': {
      requireOwner(v);
      const m = visible(id, v);
      if (m.status === 'aprobada') throw new HttpError(409, 'La reunión ya fue aprobada.');
      update(m.id, { status: 'descartada' });
      json(res, 200, view(get(m.id)!, v));
      return true;
    }

    case 'POST meetings/:id/approve': {
      requireOwner(v);
      const m = visible(id, v);
      if (m.status === 'aprobada') throw new HttpError(409, 'La reunión ya fue aprobada.');
      const body = await readJson(req);
      const project = db.getProject(Number(body.projectId) || m.project_id || 0);
      // Una reunión con cliente sin proyecto se aprueba igual: se envía el resumen, sin crear tareas.
      if (!project && m.kind !== 'cliente') throw new HttpError(400, 'Elige el proyecto de la reunión.');
      const read = readContent(body);
      const content = project ? read : { ...read, tasks: [], changes: [] };
      const { summary, agreements, tasks } = content;
      if (!summary) throw new HttpError(400, 'El resumen está vacío.');
      const recipients = [...new Set((Array.isArray(body.recipients) ? body.recipients : []).map((e) => str(e, 200).toLowerCase()))].filter((e) =>
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e),
      );
      const sendAt = readSendAt(body.sendAt);

      const created = !project
        ? []
        : db.transaction(() =>
            tasks.map((t) =>
              db.createTask({
                projectId: project.id,
                phaseId: null,
                title: t.title,
                description: t.description,
                side: t.side,
                assigneeId: t.assigneeId,
                startDate: null,
                dueDate: t.dueDate,
                position: db.nextTaskPosition(project.id),
                source: 'reunion',
              }),
            ),
          );
      // Ajustes sobre entregas existentes: cada uno es una ronda, con el pedido escrito en la tarea.
      const adjusted: { title: string; round: number; extra: boolean }[] = [];
      const skippedChanges: string[] = [];
      for (const c of project ? content.changes : []) {
        const t = db.getTask(c.taskId);
        if (!t || t.project_id !== project!.id) continue;
        if (!isDelivery(t)) {
          skippedChanges.push(`«${t.title}» no es una entrega al cliente: anota el pedido como comentario o crea una tarea.`);
          continue;
        }
        if (t.status !== 'en_revision' && t.status !== 'completada') {
          skippedChanges.push(`«${t.title}» ya está en ajustes o no está entregada: anota el pedido como comentario.`);
          continue;
        }
        const r = requestChanges(t, project!, c.request, v, { meeting: m.title });
        adjusted.push({ title: t.title, round: r.round, extra: r.extra });
      }
      update(m.id, {
        status: 'aprobada',
        project_id: project?.id ?? null,
        client_id: project?.client_id ?? m.client_id,
        summary,
        agreements: JSON.stringify(agreements),
        task_ids: JSON.stringify(created.map((t) => t.id)),
        approved_at: now(),
        approved_by: v.email,
        sent_to: JSON.stringify(recipients),
      });
      const a = actor(v);
      if (project) {
        db.logActivity({
          projectId: project.id,
          actorKind: a.kind,
          actorName: a.name,
          type: 'meeting_approved',
          data: { title: m.title, tasks: created.length, changes: adjusted.length, excerpt: summary.slice(0, 140) },
        });
        const path = `/proyectos/${project.id}?tab=reuniones`;
        notify('meeting_summary', { actor: v, projectId: project.id, title: `Resumen de la reunión «${m.title}»`, body: `${created.length} tareas nuevas`, path });
      }
      for (const t of project ? created : []) {
        if (t.assignee_id && project) {
          notify('team_assigned', {
            actor: v,
            projectId: project.id,
            taskId: t.id,
            accountId: t.assignee_id,
            title: `Te asignaron «${t.title}»`,
            body: `De la reunión «${m.title}»`,
            path: `/proyectos/${project.id}?tarea=${t.id}`,
          });
        }
      }

      // El resumen sale de inmediato (no espera el agrupado de avisos): es un entregable para el cliente.
      // O a la hora que elegiste: se guarda un correo por destinatario y salen solos.
      const mail = { sent: [] as string[], failed: [] as string[], error: null as string | null, scheduledAt: null as string | null };
      if (recipients.length && sendAt) {
        for (const to of recipients) {
          scheduleMail({ kind: 'summary', refId: m.id, sendAt, mail: summaryMail(m, project, to, content), label: `resumen de «${m.title}»`, path: `/reuniones/${m.id}` });
        }
        mail.scheduledAt = sendAt;
      } else if (recipients.length) {
        if (!google.connectionStatus().connected) mail.error = 'Google no está conectado: el correo no se envió.';
        else {
          for (const to of recipients) {
            try {
              await google.sendMail(summaryMail(m, project, to, content));
              mail.sent.push(to);
            } catch (err) {
              mail.failed.push(to);
              mail.error = (err as Error).message;
            }
          }
        }
      }
      json(res, 200, { meeting: view(get(m.id)!, v), tasks: created.length, adjusted, skippedChanges, mail });
      return true;
    }
  }
  return false;
}

