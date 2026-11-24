import { HttpError } from '../http.ts';
import type { Viewer } from './auth.ts';
import * as db from './db.ts';

export const isStaff = (v: Viewer) => v.kind === 'owner' || v.kind === 'team';

export function requireOwner(v: Viewer): void {
  if (v.kind !== 'owner') throw new HttpError(403, 'Solo el administrador puede hacer esto.');
}

export function requireStaff(v: Viewer): void {
  if (!isStaff(v)) throw new HttpError(403, 'No tienes permiso para esto.');
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** "YYYY-MM-DD" → fecha; null → borrar; cualquier otra cosa → no tocar. */
export const optDate = (v: unknown) =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : v === null ? null : undefined;

/** Quién firma en notas y bitácora. */
export function actor(v: Viewer) {
  return {
    kind: v.kind,
    id: v.kind === 'owner' ? null : v.account.id,
    name: v.kind === 'owner' ? 'DeerSystems' : v.name || v.email,
  };
}

/** Un proyecto del cliente que esta persona puede ver (todos, o solo los asignados si es un ejecutivo). */
export const clientSees = (v: Extract<Viewer, { kind: 'client' }>, p: { id: number; client_id: number }) =>
  p.client_id === v.clientId && (!v.projects || v.projects.has(p.id));

/** Pagos, cuentas de cobro y estado de cuenta: tú y las personas del cliente que tengan ese permiso (el equipo, nunca). */
export const seesMoney = (v: Viewer) => v.kind === 'owner' || (v.kind === 'client' && v.billing);

export function visibleProject(id: number, v: Viewer): db.Project {
  const p = db.getProject(id);
  // Para un cliente, un proyecto ajeno es indistinguible de uno que no existe.
  if (!p || (v.kind === 'client' && !clientSees(v, p))) throw new HttpError(404, 'El proyecto no existe.');
  return p;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Persona del cliente limitada a sus tareas (el equipo del cliente en un proyecto compartido): ¿esta tarea es suya?
 * Lo es si la tiene como persona del cliente, por su nombre o por la persona del equipo del proyecto ligada a su cuenta.
 */
export function accountOwnsTask(a: db.Account, t: db.Task, p?: db.Project | null): boolean {
  if (!a.own_tasks) return true;
  if (!t.client_assignee) return false;
  const who = norm(t.client_assignee);
  if (a.name && norm(a.name) === who) return true;
  const project = p ?? db.getProject(t.project_id);
  let people: { name?: unknown; accountId?: unknown }[] = [];
  try {
    people = JSON.parse(project?.people || '[]');
  } catch {
    people = [];
  }
  return people.some((x) => x.accountId === a.id && typeof x.name === 'string' && norm(x.name) === who);
}

/** ¿Ve todo el proyecto, o solo sus tareas? */
export const limitedToOwnTasks = (v: Viewer) => v.kind === 'client' && !!v.account.own_tasks;

export const seesTask = (v: Viewer, t: db.Task, p?: db.Project | null) => v.kind !== 'client' || accountOwnsTask(v.account, t, p);

export function visibleTask(id: number, v: Viewer): { task: db.Task; project: db.Project } {
  const task = db.getTask(id);
  if (!task) throw new HttpError(404, 'La tarea no existe.');
  const project = visibleProject(task.project_id, v);
  if (!seesTask(v, task, project)) throw new HttpError(404, 'La tarea no existe.');
  return { task, project };
}

/** Lo de una tarea (comentarios, archivos, historial): solo si esta persona ve la tarea. Sin tarea, lo del proyecto. */
export function seesTaskId(v: Viewer, taskId: number | null, project: db.Project, cache?: Map<number, boolean>): boolean {
  if (!taskId || !limitedToOwnTasks(v)) return true;
  if (cache?.has(taskId)) return cache.get(taskId)!;
  const t = db.getTask(taskId);
  const ok = !!t && t.project_id === project.id && seesTask(v, t, project);
  cache?.set(taskId, ok);
  return ok;
}

export const teamNames = () => new Map(db.listTeam().map((a) => [a.id, a.name || a.email]));

export function taskView(t: db.Task, v: Viewer, team: Map<number, string>, comments?: Map<number, number>, files?: Map<number, number>) {
  return {
    id: t.id,
    phaseId: t.phase_id,
    title: t.title,
    description: t.description,
    status: t.status,
    side: t.side,
    assigneeId: t.assignee_id,
    assigneeName: t.assignee_id ? (team.get(t.assignee_id) ?? null) : null,
    clientAssignee: t.client_assignee || null,
    startDate: t.start_date,
    dueDate: t.due_date,
    completedAt: t.completed_at,
    source: t.source,
    isMeeting: t.kind === 'reunion',
    comments: comments?.get(t.id) ?? 0,
    files: files?.get(t.id) ?? 0,
    // El cliente solo mueve las tareas de su lado, y nunca las que ya están completadas.
    canChangeStatus: isStaff(v) || (t.side === 'cliente' && t.status !== 'completada'),
    canEdit: isStaff(v),
    // Entregas y ajustes: si es entrega al cliente, rondas usadas, incluidas (0 = sin límite) y quién aprobó.
    clientDelivery: !!t.client_delivery,
    revisionRound: t.revision_round ?? 0,
    revisionsIncluded: db.includedRounds(db.getProject(t.project_id)),
    approvedAt: t.approved_at ?? null,
    approvedBy: t.approved_by ?? null,
    canReview: canReview(t, v),
  };
}

/**
 * Aprobar o pedir ajustes: solo las entregas al cliente (no las tareas operativas ni las reuniones), cuando están en
 * revisión; el equipo además reabre las completadas.
 */
export const isDelivery = (t: db.Task) => !!t.client_delivery && t.side === 'deersystems' && t.kind !== 'reunion';

export function canReview(t: db.Task, v: Viewer): boolean {
  if (!isDelivery(t)) return false;
  return t.status === 'en_revision' || (isStaff(v) && t.status === 'completada');
}

export function noteView(n: db.Note, v: Viewer) {
  const me = actor(v);
  const mine = n.author_kind === me.kind && n.author_id === me.id;
  return {
    id: n.id,
    taskId: n.task_id,
    kind: n.kind,
    visibility: n.visibility,
    authorKind: n.author_kind,
    authorName: n.author_name,
    body: n.body,
    // El cliente no ve qué se redactó con IA: para él, lo publica DeerSystems.
    ai: v.kind !== 'client' && !!n.ai,
    emailedAt: n.emailed_at,
    createdAt: n.created_at,
    updatedAt: n.updated_at,
    canEdit: mine,
    canDelete: mine || v.kind === 'owner',
  };
}
