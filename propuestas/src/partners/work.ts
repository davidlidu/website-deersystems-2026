import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, json, readJson } from '../http.ts';
import type { Viewer } from './auth.ts';
import { actor, isStaff, noteView, optDate, requireStaff, str, taskView, teamNames, visibleProject, visibleTask } from './common.ts';
import * as db from './db.ts';
import { notify } from './notify.ts';
import { announceUpdate } from './updates.ts';

const STATUS_LABEL: Record<db.TaskStatus, string> = {
  pendiente: 'Pendiente',
  en_progreso: 'En progreso',
  en_revision: 'En revisión',
  bloqueada: 'Bloqueada',
  completada: 'Completada',
};
const taskPath = (projectId: number, taskId: number) => `/proyectos/${projectId}?tarea=${taskId}`;

/** Etiquetas de los campos para la bitácora ("cambió la fecha de entrega"). */
const FIELD_LABEL: Record<string, string> = {
  title: 'título',
  description: 'descripción',
  side: 'responsable',
  assignee_id: 'responsable',
  phase_id: 'fase',
  start_date: 'fecha de inicio',
  due_date: 'fecha de entrega',
};

function log(v: Viewer, projectId: number, type: string, data: Record<string, unknown>, opts: { taskId?: number | null; internal?: boolean } = {}) {
  const a = actor(v);
  db.logActivity({ projectId, taskId: opts.taskId, actorKind: a.kind, actorName: a.name, type, data, internal: opts.internal });
}

/** Lee y valida los campos editables de una tarea. Solo devuelve los que vienen en el cuerpo. */
function taskFields(body: Record<string, unknown>, projectId: number, current?: db.Task): db.TaskFields {
  const f: db.TaskFields = {};
  if ('title' in body) {
    f.title = str(body.title, 200);
    if (!f.title) throw new HttpError(400, 'La tarea necesita un título.');
  }
  if ('description' in body) f.description = typeof body.description === 'string' ? body.description.trim().slice(0, 5000) : '';
  if (body.side === 'cliente' || body.side === 'deersystems') f.side = body.side;
  if ('assigneeId' in body) {
    const id = Number(body.assigneeId) || null;
    if (id && !db.listTeam().some((a) => a.id === id)) throw new HttpError(400, 'Esa persona no es del equipo.');
    f.assignee_id = id;
  }
  if ('phaseId' in body) {
    const id = Number(body.phaseId) || null;
    if (id && db.getPhase(id)?.project_id !== projectId) throw new HttpError(400, 'La fase no es de este proyecto.');
    f.phase_id = id;
  }
  if ('startDate' in body) f.start_date = optDate(body.startDate) ?? null;
  if ('dueDate' in body) f.due_date = optDate(body.dueDate) ?? null;
  if ('isMeeting' in body) f.kind = body.isMeeting === true ? 'reunion' : 'tarea';
  // Una tarea del cliente no tiene responsable del equipo.
  if (f.side === 'cliente') f.assignee_id = null;
  // Se compara con lo que ya tiene la tarea: cambiar solo una de las dos fechas también cuenta.
  const start = f.start_date !== undefined ? f.start_date : current?.start_date;
  const due = f.due_date !== undefined ? f.due_date : current?.due_date;
  if (start && due && start > due) throw new HttpError(400, 'La entrega no puede ser antes del inicio.');
  return f;
}

/**
 * Tareas, fases, notas, avances y bitácora. Devuelve false si la ruta no es de aquí.
 * Permisos: el equipo y el administrador editan todo; el cliente solo cambia el estado de
 * sus tareas, comenta y deja notas compartidas.
 */
export async function handleWork(route: string, id: number, req: IncomingMessage, res: ServerResponse, v: Viewer): Promise<boolean> {
  const staff = isStaff(v);
  const team = () => teamNames();

  switch (route) {
    // ── Tareas
    case 'POST projects/:id/tasks': {
      requireStaff(v);
      const project = visibleProject(id, v);
      const body = await readJson(req);
      const f = taskFields(body, project.id);
      if (!f.title) throw new HttpError(400, 'La tarea necesita un título.');
      const task = db.createTask({
        projectId: project.id,
        phaseId: f.phase_id ?? null,
        title: f.title,
        description: f.description ?? '',
        side: f.side ?? 'deersystems',
        assigneeId: f.assignee_id ?? null,
        startDate: f.start_date ?? null,
        dueDate: f.due_date ?? null,
        position: db.nextTaskPosition(project.id),
        source: 'manual',
        kind: f.kind,
      });
      log(v, project.id, 'task_created', { title: task.title, side: task.side }, { taskId: task.id });
      const path = taskPath(project.id, task.id);
      if (task.side === 'cliente') {
        notify('client_task', { actor: v, projectId: project.id, taskId: task.id, title: `Tienes una tarea nueva: «${task.title}»`, body: project.name, path });
      }
      if (task.assignee_id) {
        notify('team_assigned', { actor: v, projectId: project.id, taskId: task.id, accountId: task.assignee_id, title: `Te asignaron «${task.title}»`, body: project.name, path });
      }
      json(res, 201, { task: taskView(task, v, team()), progress: db.progressOf(project.id) });
      return true;
    }

    case 'PATCH tasks/:id': {
      const { task, project } = visibleTask(id, v);
      const body = await readJson(req);

      if ('status' in body) {
        const status = db.TASK_STATUSES.find((s) => s === body.status);
        if (!status) throw new HttpError(400, 'Estado no válido.');
        if (!staff && (task.side !== 'cliente' || task.status === 'completada' || !db.CLIENT_STATUSES.includes(status))) {
          throw new HttpError(403, 'Esta tarea la gestiona DeerSystems.');
        }
        if (status !== task.status) {
          db.setTaskStatus(task.id, status);
          log(v, project.id, 'task_status', { title: task.title, from: task.status, to: status }, { taskId: task.id });
          if (v.kind === 'client') {
            notify('client_status', {
              actor: v,
              projectId: project.id,
              taskId: task.id,
              title: `${v.name} movió «${task.title}» a ${STATUS_LABEL[status]}`,
              body: project.name,
              path: taskPath(project.id, task.id),
            });
          }
        }
      }

      const editable = Object.keys(body).filter((k) => k !== 'status');
      if (editable.length) {
        requireStaff(v);
        const f = taskFields(body, project.id, task);
        const changed = (Object.keys(f) as (keyof db.TaskFields)[]).filter((k) => f[k] !== task[k]);
        if (changed.length) {
          db.updateTask(task.id, f);
          const labels = [...new Set(changed.map((k) => FIELD_LABEL[k] ?? k))];
          log(v, project.id, 'task_updated', { title: f.title ?? task.title, fields: labels }, { taskId: task.id });
          const title = f.title ?? task.title;
          const path = taskPath(project.id, task.id);
          if (f.side === 'cliente' && task.side !== 'cliente') {
            notify('client_task', { actor: v, projectId: project.id, taskId: task.id, title: `Tienes una tarea nueva: «${title}»`, body: project.name, path });
          }
          if (f.assignee_id && f.assignee_id !== task.assignee_id) {
            notify('team_assigned', { actor: v, projectId: project.id, taskId: task.id, accountId: f.assignee_id, title: `Te asignaron «${title}»`, body: project.name, path });
          }
        }
      }
      const fresh = db.getTask(task.id)!;
      json(res, 200, { task: taskView(fresh, v, team(), db.commentCounts(project.id, staff)), progress: db.progressOf(project.id) });
      return true;
    }

    case 'DELETE tasks/:id': {
      requireStaff(v);
      const { task, project } = visibleTask(id, v);
      db.deleteTask(task.id);
      log(v, project.id, 'task_deleted', { title: task.title }, { taskId: task.id });
      json(res, 200, { progress: db.progressOf(project.id) });
      return true;
    }

    // ── Fases
    case 'POST projects/:id/phases': {
      requireStaff(v);
      const project = visibleProject(id, v);
      const name = str((await readJson(req)).name, 120);
      if (!name) throw new HttpError(400, 'La fase necesita un nombre.');
      const phase = db.createPhase(project.id, name, db.nextPhasePosition(project.id));
      log(v, project.id, 'phase_created', { name });
      json(res, 201, { id: phase.id, name: phase.name });
      return true;
    }

    case 'PATCH phases/:id': {
      requireStaff(v);
      const phase = db.getPhase(id);
      if (!phase) throw new HttpError(404, 'La fase no existe.');
      visibleProject(phase.project_id, v);
      const body = await readJson(req);
      const name = str(body.name, 120);
      db.updatePhase(phase.id, {
        name: name || undefined,
        position: Number.isInteger(body.position) ? (body.position as number) : undefined,
      });
      if (name && name !== phase.name) log(v, phase.project_id, 'phase_renamed', { from: phase.name, to: name });
      json(res, 200, { ok: true });
      return true;
    }

    case 'DELETE phases/:id': {
      requireStaff(v);
      const phase = db.getPhase(id);
      if (!phase) throw new HttpError(404, 'La fase no existe.');
      visibleProject(phase.project_id, v);
      db.deletePhase(phase.id);
      log(v, phase.project_id, 'phase_deleted', { name: phase.name });
      json(res, 200, { ok: true });
      return true;
    }

    // ── Notas, comentarios y avances
    case 'GET projects/:id/notes': {
      const project = visibleProject(id, v);
      const url = new URL(req.url ?? '/', 'http://x');
      const taskParam = url.searchParams.get('taskId');
      const kind = url.searchParams.get('kind');
      const notes = db.listNotes(project.id, {
        internal: staff,
        // taskId=… → comentarios de esa tarea; sin taskId → notas del proyecto (no de tareas).
        taskId: taskParam ? Number(taskParam) : null,
        kind: kind === 'avance' || kind === 'nota' ? kind : undefined,
      });
      json(res, 200, notes.map((n) => noteView(n, v)));
      return true;
    }

    case 'POST projects/:id/notes': {
      const project = visibleProject(id, v);
      const body = await readJson(req);
      const text = typeof body.body === 'string' ? body.body.trim().slice(0, 10_000) : '';
      if (!text) throw new HttpError(400, 'Escribe algo.');
      const kind = body.kind === 'avance' ? 'avance' : 'nota';
      if (kind === 'avance') requireStaff(v);
      // El cliente solo escribe notas compartidas; el equipo puede dejar notas y avances solo para el equipo.
      const visibility = staff && body.visibility === 'internal' ? 'internal' : 'shared';
      let taskId: number | null = null;
      let taskTitle: string | null = null;
      if (body.taskId) {
        const { task } = visibleTask(Number(body.taskId), v);
        if (task.project_id !== project.id) throw new HttpError(400, 'La tarea no es de este proyecto.');
        taskId = task.id;
        taskTitle = task.title;
      }
      const a = actor(v);
      const note = db.createNote({
        project_id: project.id,
        task_id: taskId,
        kind,
        visibility,
        author_kind: a.kind,
        author_id: a.id,
        author_name: a.name,
        body: text,
        ai: kind === 'avance' && body.ai === true,
      });
      log(
        v,
        project.id,
        kind === 'avance' ? 'update_posted' : taskId ? 'comment_added' : 'note_added',
        { taskTitle, excerpt: text.slice(0, 140), visibility },
        { taskId, internal: visibility === 'internal' },
      );
      let email: Awaited<ReturnType<typeof announceUpdate>> | null = null;
      const path = taskId ? taskPath(project.id, taskId) : `/proyectos/${project.id}?tab=${kind === 'avance' ? 'avances' : 'notas'}`;
      if (v.kind === 'client') {
        notify('client_comment', {
          actor: v,
          projectId: project.id,
          taskId,
          title: taskTitle ? `${v.name} comentó en «${taskTitle}»` : `${v.name} dejó una nota en ${project.name}`,
          body: text,
          path,
        });
      } else if (kind === 'avance') {
        if (visibility === 'shared') email = await announceUpdate(project, note, v);
      } else if (visibility === 'shared') {
        notify('staff_comment', {
          actor: v,
          projectId: project.id,
          taskId,
          title: taskTitle ? `DeerSystems comentó en «${taskTitle}»` : `DeerSystems dejó una nota en ${project.name}`,
          body: text,
          path,
        });
      }
      json(res, 201, { ...noteView(db.getNote(note.id)!, v), ...(email ? { email } : {}) });
      return true;
    }

    case 'PATCH notes/:id':
    case 'DELETE notes/:id': {
      const note = db.getNote(id);
      if (!note) throw new HttpError(404, 'La nota no existe.');
      visibleProject(note.project_id, v);
      if (!staff && note.visibility === 'internal') throw new HttpError(404, 'La nota no existe.');
      const view = noteView(note, v);
      if (req.method === 'PATCH') {
        if (!view.canEdit) throw new HttpError(403, 'Solo quien la escribió puede editarla.');
        const patch = await readJson(req);
        const text = str(patch.body, 10_000);
        if (!text) throw new HttpError(400, 'Escribe algo.');
        const visibility = staff && (patch.visibility === 'internal' || patch.visibility === 'shared') ? patch.visibility : undefined;
        db.updateNote(note.id, text, visibility);
        json(res, 200, noteView(db.getNote(note.id)!, v));
      } else {
        if (!view.canDelete) throw new HttpError(403, 'Solo quien la escribió puede borrarla.');
        db.deleteNote(note.id);
        json(res, 200, { ok: true });
      }
      return true;
    }

    // ── Bitácora
    case 'GET projects/:id/activity': {
      const project = visibleProject(id, v);
      const taskParam = new URL(req.url ?? '/', 'http://x').searchParams.get('taskId');
      const rows = db.listActivity(project.id, { internal: staff, taskId: taskParam ? Number(taskParam) : undefined });
      json(
        res,
        200,
        rows.map((r) => ({
          id: r.id,
          taskId: r.task_id,
          actorKind: r.actor_kind,
          actorName: r.actor_name,
          type: r.type,
          data: JSON.parse(r.data),
          internal: !!r.internal,
          createdAt: r.created_at,
        })),
      );
      return true;
    }
  }
  return false;
}
