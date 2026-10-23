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

export function visibleProject(id: number, v: Viewer): db.Project {
  const p = db.getProject(id);
  // Para un cliente, un proyecto ajeno es indistinguible de uno que no existe.
  if (!p || (v.kind === 'client' && p.client_id !== v.clientId)) throw new HttpError(404, 'El proyecto no existe.');
  return p;
}

export function visibleTask(id: number, v: Viewer): { task: db.Task; project: db.Project } {
  const task = db.getTask(id);
  if (!task) throw new HttpError(404, 'La tarea no existe.');
  return { task, project: visibleProject(task.project_id, v) };
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
  };
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
    ai: !!n.ai,
    emailedAt: n.emailed_at,
    createdAt: n.created_at,
    updatedAt: n.updated_at,
    canEdit: mine,
    canDelete: mine || v.kind === 'owner',
  };
}
