import type { IncomingMessage, ServerResponse } from 'node:http';
import { AiError, completeJson } from '../ai.ts';
import { HttpError, json, readJson } from '../http.ts';
import type { Viewer } from './auth.ts';
import { actor, requireOwner, str } from './common.ts';
import * as db from './db.ts';
import { checkSlots } from './availability.ts';
import { meetingOfTask, moveMeeting } from './meetings.ts';

/**
 * Ajustar con IA el plan de un proyecto que ya está en marcha: «reprograma las reuniones con el cliente a partir del
 * 1 de diciembre», «corre una semana lo pendiente de la Fase 2». La IA propone cambios sobre las tareas que existen;
 * se muestran para revisar y solo se guardan al aplicarlos. Las reuniones agendadas mueven también su evento de Calendar.
 */

type Side = 'deersystems' | 'cliente';

export interface TaskUpdate {
  id: number;
  title?: string;
  description?: string;
  side?: Side;
  phaseId?: number | null;
  startDate?: string | null;
  dueDate?: string | null;
  /** Hora de la reunión agendada (HH:MM), si se mueve. */
  time?: string;
}
export interface TaskCreate {
  /** Fase existente o el nombre de una nueva. */
  phaseId: number | null;
  phaseName: string;
  title: string;
  description: string;
  side: Side;
  startDate: string | null;
  dueDate: string | null;
  kind: 'tarea' | 'reunion';
}
export interface PlanOps {
  updates: TaskUpdate[];
  creates: TaskCreate[];
  deletes: number[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const date = (v: unknown) => (typeof v === 'string' && DATE_RE.test(v) ? v : null);
const side = (v: unknown): Side | undefined => (v === 'cliente' || v === 'deersystems' ? v : undefined);
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
const bogotaTime = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Bogota' });

/** Valida lo que propone la IA (o lo que devuelve la pantalla al aplicar) contra el proyecto tal como está ahora. */
export function normalizeOps(projectId: number, raw: Record<string, unknown>): { ops: PlanOps; skipped: string[] } {
  const tasks = new Map(db.listTasks(projectId).map((t) => [t.id, t]));
  const phases = db.listPhases(projectId);
  const phaseByName = new Map(phases.map((p) => [p.name.trim().toLowerCase(), p.id]));
  const phaseIds = new Set(phases.map((p) => p.id));
  const skipped: string[] = [];
  const phaseOf = (o: Record<string, unknown>): number | null | undefined => {
    if (Number(o.phaseId) && phaseIds.has(Number(o.phaseId))) return Number(o.phaseId);
    const name = str(o.phase, 120).trim().toLowerCase();
    return name ? (phaseByName.get(name) ?? undefined) : undefined;
  };

  const updates: TaskUpdate[] = [];
  for (const o of (Array.isArray(raw.updates) ? raw.updates : []) as Record<string, unknown>[]) {
    const t = tasks.get(Number(o?.id));
    if (!t) continue;
    if (t.status === 'completada') {
      skipped.push(`«${t.title}» ya está completada: no se cambia.`);
      continue;
    }
    const u: TaskUpdate = { id: t.id };
    const title = str(o.title, 200).trim();
    if (title && title !== t.title) u.title = title;
    if (typeof o.description === 'string' && str(o.description, 4000) !== t.description) u.description = str(o.description, 4000);
    const s = side(o.side);
    if (s && s !== t.side) u.side = s;
    const ph = phaseOf(o);
    if (ph !== undefined && ph !== t.phase_id) u.phaseId = ph;
    let start = 'startDate' in o ? date(o.startDate) : t.start_date;
    let due = 'dueDate' in o ? date(o.dueDate) : t.due_date;
    if (t.kind === 'reunion') {
      // Una reunión ocurre en un solo día: vale la fecha que se haya cambiado.
      const day = ('dueDate' in o && date(o.dueDate)) || ('startDate' in o && date(o.startDate)) || t.due_date || t.start_date;
      start = due = day;
    }
    if (start && due && start > due) [start, due] = [due, start];
    if (start !== t.start_date) u.startDate = start;
    if (due !== t.due_date) u.dueDate = due;
    const m = t.kind === 'reunion' ? meetingOfTask(t.id) : null;
    if (m?.scheduled) {
      const time = typeof o.time === 'string' && TIME_RE.test(o.time) ? o.time : null;
      if (time && time !== bogotaTime(m.startAt)) u.time = time;
      if (u.phaseId !== undefined || u.side || u.description !== undefined) {
        // La reunión agendada manda en su tarea: aquí solo se mueve (fecha, hora, título).
        delete u.phaseId;
        delete u.side;
        delete u.description;
      }
    }
    if (Object.keys(u).length > 1) updates.push(u);
  }

  const creates: TaskCreate[] = [];
  for (const o of ((Array.isArray(raw.creates) ? raw.creates : []) as Record<string, unknown>[]).slice(0, 40)) {
    const title = str(o?.title, 200).trim();
    if (!title) continue;
    const ph = phaseOf(o);
    let start = date(o.startDate);
    let due = date(o.dueDate);
    if (start && due && start > due) [start, due] = [due, start];
    creates.push({
      phaseId: ph ?? null,
      phaseName: ph ? '' : str(o.phase ?? o.phaseName, 120).trim(),
      title,
      description: str(o.description, 4000),
      side: side(o.side) ?? 'deersystems',
      startDate: o.kind === 'reunion' ? (due ?? start) : start,
      dueDate: due ?? (o.kind === 'reunion' ? start : null),
      kind: o.kind === 'reunion' ? 'reunion' : 'tarea',
    });
  }

  const deletes: number[] = [];
  for (const id of (Array.isArray(raw.deletes) ? raw.deletes : []).map(Number)) {
    const t = tasks.get(id);
    if (!t || deletes.includes(id)) continue;
    if (t.status === 'completada') skipped.push(`«${t.title}» ya está completada: no se elimina.`);
    else if (t.kind === 'reunion' && meetingOfTask(t.id)?.scheduled)
      skipped.push(`«${t.title}» es una reunión agendada: cancélala desde Calendario de reuniones si ya no va.`);
    else deletes.push(id);
  }
  return { ops: { updates, creates, deletes }, skipped };
}

/**
 * Regla de fechas para la IA. Por defecto, solo lunes a viernes; con «Permitir fin de semana» (una excepción acordada,
 * p. ej. un adicional que se trabaja el sábado y el domingo) las tareas pueden caer en cualquier día. Las reuniones
 * siguen en días hábiles: la agenda solo ofrece horarios de lunes a viernes.
 */
export function weekdaysRule(allowWeekends: boolean): string {
  return allowWeekends
    ? 'Fechas desde hoy en adelante, coherentes: el inicio no puede ser después de la entrega. EXCEPCIÓN ACORDADA: las tareas pueden caer en sábado o domingo si la instrucción lo pide o lo necesita para cumplir; no muevas a fin de semana lo que no se pide.'
    : 'Fechas en días hábiles (lunes a viernes), desde hoy en adelante, coherentes: el inicio no puede ser después de la entrega. Si la instrucción exige trabajar en fin de semana, no propongas cambios y explica en "changes" que hay que marcar «Permitir fin de semana».';
}

/** Aviso de horario por tarea: se movió al siguiente libre (`clash: false`) o sigue cruzada (`clash: true`). */
type Notes = Map<number, { text: string; clash: boolean }>;

/**
 * Las reuniones agendadas que el ajuste mueve no pueden cruzarse con tu agenda ni entre sí: si chocan, pasan al
 * siguiente horario libre y queda dicho; si no hay uno libre, quedan marcadas para que las resuelvas.
 */
async function placeMoves(ops: PlanOps): Promise<Notes> {
  const notes: Notes = new Map();
  const moves = ops.updates
    .map((u) => {
      const t = db.getTask(u.id)!;
      const m = t.kind === 'reunion' ? meetingOfTask(t.id) : null;
      if (!m?.scheduled || (u.dueDate === undefined && u.startDate === undefined && !u.time)) return null;
      const date = u.dueDate ?? u.startDate ?? t.due_date;
      if (!date) return null;
      const minutes = Math.round((Date.parse(m.endAt) - Date.parse(m.startAt)) / 60_000);
      return { u, meetingId: m.id, date, time: u.time ?? bogotaTime(m.startAt), minutes };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  if (!moves.length) return notes;
  // Cada reunión que se mueve no choca con su propio horario anterior.
  const { slots } = await checkSlots(
    moves.map((x) => ({ date: x.date, time: x.time, durationMinutes: x.minutes })),
    moves.map((x) => x.meetingId),
  );
  moves.forEach((x, i) => {
    const s = slots[i];
    if (!s?.conflict) return;
    const why = `se cruzaba con «${s.conflict.title}» (${s.conflict.start} – ${s.conflict.end})`;
    if (s.suggestion) {
      x.u.startDate = s.suggestion.date;
      x.u.dueDate = s.suggestion.date;
      x.u.time = s.suggestion.time;
      notes.set(x.u.id, { text: `Pasó al siguiente horario libre: ${why}.`, clash: false });
    } else notes.set(x.u.id, { text: `Se cruza con «${s.conflict.title}» y no hay un horario libre cercano: muévela a mano.`, clash: true });
  });
  return notes;
}

/** Para mostrar antes de aplicar: qué cambia en cada tarea, en palabras. */
export function preview(projectId: number, ops: PlanOps, notes: Notes = new Map()) {
  const tasks = new Map(db.listTasks(projectId).map((t) => [t.id, t]));
  const phases = new Map(db.listPhases(projectId).map((p) => [p.id, p.name]));
  return {
    updates: ops.updates.map((u) => {
      const t = tasks.get(u.id)!;
      const m = t.kind === 'reunion' ? meetingOfTask(t.id) : null;
      return {
        id: u.id,
        title: t.title,
        kind: t.kind,
        calendar: !!m?.scheduled,
        before: {
          title: t.title,
          startDate: t.start_date,
          dueDate: t.due_date,
          time: m?.scheduled ? bogotaTime(m.startAt) : null,
          phase: t.phase_id ? (phases.get(t.phase_id) ?? '') : '',
          side: t.side,
        },
        after: {
          title: u.title ?? t.title,
          startDate: u.startDate !== undefined ? u.startDate : t.start_date,
          dueDate: u.dueDate !== undefined ? u.dueDate : t.due_date,
          time: m?.scheduled ? (u.time ?? bogotaTime(m.startAt)) : null,
          phase: u.phaseId !== undefined ? (u.phaseId ? (phases.get(u.phaseId) ?? '') : '') : t.phase_id ? (phases.get(t.phase_id) ?? '') : '',
          side: u.side ?? t.side,
        },
        descriptionChanged: u.description !== undefined,
        note: notes.get(u.id)?.text ?? null,
        clash: notes.get(u.id)?.clash ?? false,
      };
    }),
    creates: ops.creates.map((c) => ({ ...c, phase: c.phaseId ? (phases.get(c.phaseId) ?? '') : c.phaseName })),
    deletes: ops.deletes.map((id) => ({ id, title: tasks.get(id)!.title, kind: tasks.get(id)!.kind })),
  };
}

async function suggest(project: db.Project, instruction: string, allowWeekends = false) {
  const phases = db.listPhases(project.id);
  const phaseName = new Map(phases.map((p) => [p.id, p.name]));
  const tasks = db.listTasks(project.id).map((t) => {
    const m = t.kind === 'reunion' ? meetingOfTask(t.id) : null;
    return {
      id: t.id,
      phase: t.phase_id ? (phaseName.get(t.phase_id) ?? '') : '',
      title: t.title,
      kind: t.kind,
      side: t.side,
      status: t.status,
      startDate: t.start_date,
      dueDate: t.due_date,
      ...(m?.scheduled ? { time: bogotaTime(m.startAt), agendadaEnCalendar: true } : {}),
      description: t.description.slice(0, 200),
    };
  });
  const { data, completion } = await completeJson<Record<string, unknown>>({
    profile: 'propuestas',
    purpose: 'ajuste del plan del proyecto',
    system: `Eres el asistente de operaciones de DeerSystems. Ajustas el plan de trabajo de un proyecto en marcha según lo que pide el responsable.
Responde SOLO con un objeto JSON válido, en español, sin comentarios ni texto adicional.`,
    prompt: `Hoy es ${today()} (${new Date().toLocaleDateString('es-CO', { weekday: 'long', timeZone: 'America/Bogota' })}). Proyecto: "${project.name}". Inicio: ${project.start_date ?? 'sin fecha'}. Entrega estimada: ${project.end_date ?? 'sin fecha'}.

FASES: ${JSON.stringify(phases.map((p) => p.name))}

TAREAS ACTUALES (JSON; kind "reunion" = reunión con el cliente):
${JSON.stringify(tasks)}

LO QUE HAY QUE AJUSTAR:
"""
${instruction}
"""

Devuelve SOLO los cambios, con esta forma:
{
  "updates": [{ "id": 12, "title": "...", "description": "...", "side": "deersystems | cliente", "phase": "nombre exacto de una fase", "startDate": "YYYY-MM-DD", "dueDate": "YYYY-MM-DD", "time": "HH:MM" }],
  "creates": [{ "phase": "nombre de una fase (existente o nueva)", "title": "...", "description": "...", "side": "deersystems | cliente", "kind": "tarea | reunion", "startDate": "YYYY-MM-DD", "dueDate": "YYYY-MM-DD" }],
  "deletes": [34],
  "changes": ["cambio hecho, en una frase corta", "..."]
}

Reglas:
- En "updates" pon el "id" y SOLO los campos que cambian. No repitas tareas que quedan igual.
- No toques tareas con status "completada".
- Cambia SOLO lo que se pide y lo que sea consecuencia directa (p. ej. correr las fechas siguientes de esa fase si se mueve una tarea).
- ${weekdaysRule(allowWeekends)}
- Reuniones: ocurren en un solo día (startDate = dueDate) y siempre en días hábiles (lunes a viernes). Si piden reprogramarlas "a partir de" una fecha, conserva el orden y el espaciado entre ellas, y la primera queda en esa fecha o el siguiente día hábil. "time" solo para las que tienen "agendadaEnCalendar"; conserva su hora salvo que pidan otra.
- "deletes" solo si lo piden de forma explícita.
- No incluyas precios ni valores en tareas.
- "changes": entre 1 y 8 frases que expliquen qué cambiaste. Si la instrucción no se puede aplicar, no propongas cambios y explícalo en "changes".`,
    maxOutputTokens: 8192,
  });
  const { ops, skipped } = normalizeOps(project.id, data);
  const notes = await placeMoves(ops);
  const changes = (Array.isArray(data.changes) ? data.changes : [])
    .map((c) => str(c, 300))
    .filter(Boolean)
    .slice(0, 8);
  return {
    ops,
    preview: preview(project.id, ops, notes),
    changes,
    warnings: skipped,
    ai: { provider: completion.provider, model: completion.model, costUsd: completion.costUsd, latencyMs: completion.latencyMs },
  };
}

async function apply(project: db.Project, raw: Record<string, unknown>, instruction: string, v: Viewer) {
  const { ops, skipped } = normalizeOps(project.id, raw);
  const errors = [...skipped];
  // Las reuniones agendadas se mueven con su evento de Calendar (después, fuera de la transacción).
  const moves: { meetingId: number; date: string; time: string; title: string | null; label: string }[] = [];
  let applied = 0;
  db.transaction(() => {
    const newPhases = new Map<string, number>();
    let position = db.nextTaskPosition(project.id);
    for (const u of ops.updates) {
      const t = db.getTask(u.id)!;
      const m = t.kind === 'reunion' ? meetingOfTask(t.id) : null;
      if (m?.scheduled) {
        const day = u.dueDate ?? u.startDate ?? t.due_date;
        if ((u.dueDate !== undefined || u.startDate !== undefined || u.time || u.title) && day)
          moves.push({ meetingId: m.id, date: day, time: u.time ?? bogotaTime(m.startAt), title: u.title ?? null, label: u.title ?? t.title });
        continue;
      }
      db.updateTask(u.id, {
        title: u.title,
        description: u.description,
        side: u.side,
        phase_id: u.phaseId,
        start_date: u.startDate,
        due_date: u.dueDate,
        ...(u.side === 'cliente' ? { assignee_id: null } : {}),
      });
      applied++;
    }
    for (const c of ops.creates) {
      let phaseId = c.phaseId;
      if (!phaseId && c.phaseName) {
        const k = c.phaseName.toLowerCase();
        phaseId = newPhases.get(k) ?? db.createPhase(project.id, c.phaseName, db.nextPhasePosition(project.id)).id;
        newPhases.set(k, phaseId);
      }
      db.createTask({
        projectId: project.id,
        phaseId,
        title: c.title,
        description: c.description,
        side: c.side,
        assigneeId: null,
        startDate: c.startDate,
        dueDate: c.dueDate,
        position: position++,
        source: 'manual',
        kind: c.kind,
      });
      applied++;
    }
    for (const id of ops.deletes) {
      db.deleteTask(id);
      applied++;
    }
  });
  // Si una reunión va al horario que deja otra que también se mueve, la primera vuelta puede chocar:
  // se reintenta mientras alguna avance, y lo que siga sin poder moverse se informa.
  let pending = moves;
  let failed: { mv: (typeof moves)[number]; message: string }[] = [];
  while (pending.length) {
    failed = [];
    for (const mv of pending) {
      try {
        await moveMeeting(mv.meetingId, mv.date, mv.time, mv.title, v);
        applied++;
      } catch (err) {
        failed.push({ mv, message: (err as Error).message });
      }
    }
    if (failed.length === pending.length) break;
    pending = failed.map((f) => f.mv);
  }
  for (const f of failed) errors.push(`No se movió la reunión «${f.mv.label}»: ${f.message}`);
  // La entrega estimada sigue a la tarea más tardía si el ajuste la corre.
  const latest = db
    .listTasks(project.id)
    .map((t) => t.due_date)
    .filter((d): d is string => !!d)
    .sort()
    .pop();
  if (latest && (!project.end_date || latest > project.end_date)) db.updateProject(project.id, { end_date: latest });
  if (applied) {
    const a = actor(v);
    db.logActivity({ projectId: project.id, actorKind: a.kind, actorName: a.name, type: 'plan_adjusted', data: { instruction: instruction.slice(0, 300), changes: applied } });
  }
  return { applied, errors, calendarMoved: moves.length - errors.filter((e) => e.startsWith('No se movió')).length };
}

export async function handlePlanAdjust(route: string, id: number, req: IncomingMessage, res: ServerResponse, v: Viewer): Promise<boolean> {
  if (route !== 'POST projects/:id/plan/adjust' && route !== 'POST projects/:id/plan/apply') return false;
  requireOwner(v);
  const project = db.getProject(id);
  if (!project) throw new HttpError(404, 'El proyecto no existe.');
  const body = await readJson(req, 256 * 1024);
  const instruction = str(body.instruction, 3000).trim();
  if (route.endsWith('/adjust')) {
    if (instruction.length < 5) throw new HttpError(400, 'Escribe qué quieres ajustar del plan.');
    try {
      json(res, 200, await suggest(project, instruction, body.allowWeekends === true));
    } catch (err) {
      if (err instanceof AiError) throw new HttpError(502, err.message);
      throw err;
    }
    return true;
  }
  json(res, 200, await apply(project, (body.ops ?? {}) as Record<string, unknown>, instruction, v));
  return true;
}
