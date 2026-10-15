import type { IncomingMessage, ServerResponse } from 'node:http';
import { AiError, completeJson } from '../ai.ts';
import { PARTNERS_URL, SUPERADMIN_EMAIL } from '../config.ts';
import { db as sqlite } from '../db.ts';
import * as google from '../google.ts';
import { HttpError, json, readJson } from '../http.ts';
import { meetingSummary } from '../mail.ts';
import type { Viewer } from './auth.ts';
import { actor, optDate, requireOwner, str, visibleProject } from './common.ts';
import * as db from './db.ts';
import { notify } from './notify.ts';

/**
 * Reuniones con clientes: se leen de Google Calendar (eventos donde participa el correo de un cliente),
 * se busca la transcripción de Meet al terminar, la IA propone resumen, acuerdos y tareas, y tú lo
 * apruebas antes de que llegue al cliente.
 *
 * Estados: programada → esperando (terminó, falta transcripción) → borrador (IA lista) → aprobada.
 * También: sin_transcripcion, error (la IA falló, se puede reintentar) y descartada.
 */
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
  transcript_source: 'meet' | 'manual' | null;
  transcript_url: string | null;
  summary: string;
  agreements: string;
  proposed_tasks: string;
  task_ids: string;
  ai: string | null;
  error: string | null;
  approved_at: string | null;
  approved_by: string | null;
  sent_to: string;
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

const now = () => new Date().toISOString();
const get = (id: number) => sqlite.prepare('SELECT * FROM meetings WHERE id = ?').get(id) as unknown as Row | undefined;
const byEvent = (eventId: string) => sqlite.prepare('SELECT * FROM meetings WHERE event_id = ?').get(eventId) as unknown as Row | undefined;
const parse = <T>(s: string | null, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};

function update(id: number, fields: Partial<Omit<Row, 'id' | 'created_at'>>): void {
  for (const [col, value] of Object.entries(fields)) {
    sqlite.prepare(`UPDATE meetings SET ${col} = ?, updated_at = ? WHERE id = ?`).run(value as string | number | null, now(), id);
  }
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
    clientId: m.client_id,
    clientName: client?.name ?? null,
    title: m.title,
    startAt: m.start_at,
    endAt: m.end_at,
    meetUrl: m.meet_url,
    status: m.status,
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
          proposedTasks: parse<ProposedTask[]>(m.proposed_tasks, []),
          hasTranscript: !!m.transcript,
          transcriptSource: m.transcript_source,
          transcriptUrl: m.transcript_url,
          ai: parse<Record<string, unknown> | null>(m.ai, null),
          error: m.error,
          sentTo: parse<string[]>(m.sent_to, []),
        }
      : {}),
  };
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

// ───────── Quién es quién ─────────

function staffEmails(): Set<string> {
  return new Set([SUPERADMIN_EMAIL, ...db.listTeam().map((a) => a.email)]);
}

/** Correo → cliente, con el correo del cliente y el de su cuenta de acceso. */
function clientByEmail(): Map<string, number> {
  const map = new Map<string, number>();
  for (const c of db.listClients()) {
    map.set(c.email.toLowerCase(), c.id);
    const a = db.getClientAccount(c.id);
    if (a) map.set(a.email.toLowerCase(), c.id);
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
  const attendees = parse<Attendee[]>(m.attendees, []);
  const date = new Date(m.start_at).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

  const { data, completion } = await completeJson<{ summary?: unknown; agreements?: unknown; tasks?: unknown }>({
    profile: 'reuniones',
    purpose: 'reunion',
    system: SYSTEM,
    maxOutputTokens: 8192,
    prompt: `Proyecto: ${project?.name ?? 'sin proyecto asociado'}
Alcance aprobado (extracto): ${(project?.scope ?? '').slice(0, 3000) || '—'}

Tareas abiertas del proyecto (no las repitas):
${open.map((t) => `- ${t.title} [${t.side}]`).join('\n') || '- ninguna'}

Reunión: «${m.title}» del ${date}.
Asistentes: ${attendees.map((a) => `${a.name || a.email} (${a.side === 'deersystems' ? 'DeerSystems' : a.side === 'cliente' ? 'cliente' : 'invitado'})`).join(', ') || 'sin datos'}

Devuelve:
{
  "summary": "Markdown: un párrafo de contexto y luego viñetas con los temas tratados y las decisiones. Máximo 250 palabras.",
  "agreements": ["acuerdo concreto y verificable", "..."],
  "tasks": [
    { "title": "tarea accionable que empiece con verbo", "description": "qué hay que hacer y para qué, 1-2 frases", "side": "deersystems | cliente", "dueDate": "YYYY-MM-DD o null" }
  ]
}

Reglas:
- Solo tareas con un compromiso claro en la conversación. Nada inventado ni genérico.
- "side" es "cliente" si el compromiso lo asumió el cliente (enviar información, aprobar, dar accesos, pagar…); si no, "deersystems".
- Si se habló de una tarea que ya está abierta, no la crees de nuevo.
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
  update(m.id, {
    summary: str(data.summary, 20_000),
    agreements: JSON.stringify((Array.isArray(data.agreements) ? data.agreements : []).map((a) => str(a, 500)).filter(Boolean).slice(0, 30)),
    proposed_tasks: JSON.stringify(tasks),
    ai: JSON.stringify({ provider: completion.provider, model: completion.model, costUsd: completion.costUsd, latencyMs: completion.latencyMs }),
    status: 'borrador',
    error: null,
  });
  notify('meeting_draft', {
    actor: null,
    projectId: m.project_id,
    title: `Resumen listo para revisar: «${m.title}»`,
    body: `${tasks.length} tareas propuestas`,
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
        if (existing && ['programada', 'esperando'].includes(existing.status)) sqlite.prepare('DELETE FROM meetings WHERE id = ?').run(existing.id);
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
      if (!clientId) continue; // reunión sin clientes: no es de la plataforma
      state.found++;
      const start = new Date(e.start.dateTime).toISOString();
      const end = new Date(e.end.dateTime).toISOString();
      const fields = {
        title: e.summary?.trim() || 'Reunión',
        start_at: start,
        end_at: end,
        meet_code: meetCodeOf(e),
        meet_url: e.hangoutLink ?? null,
        calendar_url: e.htmlLink ?? null,
        attendees: JSON.stringify(attendees),
      };
      if (!existing) {
        insert({ event_id: e.id, client_id: clientId, project_id: lockedProject ?? projectFor(clientId), status: end < now() ? 'esperando' : 'programada', ...fields });
      } else {
        // El proyecto lo puedes cambiar a mano: la sincronización no lo pisa.
        update(existing.id, { ...fields, client_id: clientId, ...(existing.project_id ? {} : { project_id: projectFor(clientId) }) });
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
        const t = await google.meetTranscript(m.meet_code, m.start_at);
        if (t.state === 'ready') {
          update(m.id, { transcript: t.text, transcript_source: 'meet', transcript_url: t.docUrl });
          await tryGenerate(get(m.id)!);
          state.processed++;
        } else if (t.state === 'none' && Date.now() - new Date(m.end_at).getTime() > 3 * 3600_000) {
          // Tres horas después de terminar y sin transcripción: no se activó en esa reunión.
          update(m.id, { status: 'sin_transcripcion', error: 'Meet no generó transcripción para esta reunión.' });
        }
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
  project: db.Project,
  to: string,
  content: { summary: string; agreements: string[]; tasks: { title: string; side: db.Side; dueDate: string | null }[] },
) {
  const date = new Date(m.start_at).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Bogota' });
  const day = (iso: string) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'America/Bogota' });
  const bullets = (side: db.Side) =>
    content.tasks.filter((t) => t.side === side).map((t) => (t.dueDate ? `${t.title} · para el ${day(t.dueDate)}` : t.title));
  return meetingSummary({
    to,
    projectName: project.name,
    meetingTitle: m.title,
    date,
    summary: content.summary,
    agreements: content.agreements,
    ourTasks: bullets('deersystems'),
    clientTasks: bullets('cliente'),
    url: `${PARTNERS_URL}/proyectos/${project.id}?tab=reuniones`,
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
  };
}

// ───────── Agendar ─────────

export interface ScheduleInput {
  title: string;
  date: string | null;
  time: string | null;
  durationMinutes: number;
  agenda: string;
  includeClient: boolean;
  teamIds: number[];
  guests: string[];
}

/**
 * Crea la reunión con Meet en tu Calendar (Google envía las invitaciones) y la deja asignada al proyecto.
 * La usan el formulario de agendar y la aprobación de propuestas (reuniones de avance).
 */
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
  const account = db.getClientAccount(client.id);
  const emails = new Set<string>();
  if (input.includeClient) emails.add((account?.email ?? client.email).toLowerCase());
  const teamIds = new Set(input.teamIds);
  for (const a of db.listTeam()) if (a.active && teamIds.has(a.id)) emails.add(a.email.toLowerCase());
  for (const g of input.guests) {
    const e = g.trim().toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) emails.add(e);
  }
  emails.delete(SUPERADMIN_EMAIL); // tú eres el organizador
  if (!emails.size) throw new HttpError(400, 'Invita al menos a una persona.');
  const title = input.title.trim().slice(0, 200) || `Reunión · ${project.name}`;
  const agenda = input.agenda.trim().slice(0, 4000);

  let event: google.CalendarEvent;
  try {
    event = await google.createCalendarEvent({
      summary: title,
      description: [agenda, `Proyecto: ${project.name}`, `Sigue el proyecto en ${PARTNERS_URL}`].filter(Boolean).join('\n\n'),
      startIso: start.toISOString(),
      endIso: end.toISOString(),
      attendees: [...emails],
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
      [...emails].map((email) => ({ email, name: '', side: staff.has(email) ? 'deersystems' : clients.has(email) ? 'cliente' : 'otro' })),
    ),
    status: 'programada',
    });
  } catch (err) {
    // Si no se pudo registrar aquí, se cancela en Calendar para no dejar invitaciones huérfanas.
    await google.cancelCalendarEvent(event.id).catch(() => {});
    throw err;
  }
  const a = actor(v);
  const when = start.toLocaleString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota' });
  db.logActivity({ projectId: project.id, actorKind: a.kind, actorName: a.name, type: 'meeting_scheduled', data: { title, when } });
  notify('meeting_scheduled', { actor: v, projectId: project.id, title: `Reunión agendada: «${title}»`, body: when, path: `/proyectos/${project.id}?tab=reuniones` });
  return m;
}

// ───────── API ─────────

export async function handleMeetings(route: string, id: number, req: IncomingMessage, res: ServerResponse, v: Viewer, url: URL): Promise<boolean> {
  switch (route) {
    case 'GET meetings': {
      requireOwner(v);
      const rows = sqlite.prepare('SELECT * FROM meetings ORDER BY start_at DESC LIMIT 300').all() as unknown as Row[];
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
      const account = db.getClientAccount(client.id);
      json(res, 200, {
        client: { name: client.contact_name || client.name, company: client.name, email: account?.email ?? client.email },
        team: db.listTeam().filter((a) => a.active).map((a) => ({ id: a.id, name: a.name, email: a.email })),
        canSchedule: google.connectionStatus().connected && google.hasAnyScope('calendar.events'),
      });
      return true;
    }

    // Agendar desde la plataforma: crea el evento con Meet en tu Calendar, invita y lo deja en el proyecto.
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
      }, v);
      json(res, 201, view(m, v));
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
      sqlite.prepare('DELETE FROM meetings WHERE id = ?').run(m.id);
      if (m.project_id) {
        const a = actor(v);
        db.logActivity({ projectId: m.project_id, actorKind: a.kind, actorName: a.name, type: 'meeting_cancelled', data: { title: m.title } });
      }
      json(res, 200, { ok: true });
      return true;
    }

    case 'GET projects/:id/meetings': {
      const project = visibleProject(id, v);
      const rows = sqlite.prepare('SELECT * FROM meetings WHERE project_id = ? ORDER BY start_at DESC').all(project.id) as unknown as Row[];
      json(res, 200, rows.filter((m) => v.kind === 'owner' || ['programada', 'aprobada'].includes(m.status)).map((m) => view(m, v)));
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
        update(m.id, { project_id: pid, ...(pid ? { client_id: db.getProject(pid)!.client_id } : {}) });
      }
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
      if (!project) throw new HttpError(400, 'Elige el proyecto de la reunión.');
      const to = str(body.to, 200) || db.getClientAccount(project.client_id)?.email || '';
      const mail = summaryMail(m, project, to, readContent(body));
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
      if (!project) throw new HttpError(400, 'Elige el proyecto de la reunión.');
      const content = readContent(body);
      const { summary, agreements, tasks } = content;
      if (!summary) throw new HttpError(400, 'El resumen está vacío.');
      const recipients = [...new Set((Array.isArray(body.recipients) ? body.recipients : []).map((e) => str(e, 200).toLowerCase()))].filter((e) =>
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e),
      );

      const created = db.transaction(() =>
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
      update(m.id, {
        status: 'aprobada',
        project_id: project.id,
        client_id: project.client_id,
        summary,
        agreements: JSON.stringify(agreements),
        task_ids: JSON.stringify(created.map((t) => t.id)),
        approved_at: now(),
        approved_by: v.email,
        sent_to: JSON.stringify(recipients),
      });
      const a = actor(v);
      db.logActivity({
        projectId: project.id,
        actorKind: a.kind,
        actorName: a.name,
        type: 'meeting_approved',
        data: { title: m.title, tasks: created.length, excerpt: summary.slice(0, 140) },
      });
      const path = `/proyectos/${project.id}?tab=reuniones`;
      notify('meeting_summary', { actor: v, projectId: project.id, title: `Resumen de la reunión «${m.title}»`, body: `${created.length} tareas nuevas`, path });
      for (const t of created) {
        if (t.assignee_id) {
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
      const mail = { sent: [] as string[], failed: [] as string[], error: null as string | null };
      if (recipients.length) {
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
      json(res, 200, { meeting: view(get(m.id)!, v), tasks: created.length, mail });
      return true;
    }
  }
  return false;
}

