import type { IncomingMessage, ServerResponse } from 'node:http';
import { AiError, completeJson } from '../ai.ts';
import { HttpError, json, readJson } from '../http.ts';
import type { Viewer } from './auth.ts';
import { actor, canReview, isDelivery, isStaff, requireOwner, str, taskView, teamNames, visibleProject, visibleTask } from './common.ts';
import * as db from './db.ts';
import { notify } from './notify.ts';

/**
 * Entregas y ajustes. Una entrega del equipo pasa a «En revisión» (se le avisa al cliente); el cliente la aprueba o
 * pide ajustes desde la plataforma, el equipo registra lo que dijo el cliente por otro medio, o los ajustes salen de
 * la transcripción de una reunión. Cada pedido de ajustes es una ronda: se cuentan contra las incluidas en el proyecto
 * y, si se pasa, queda marcado como adicional (cobrarlo o no lo decides tú).
 */

const taskPath = (projectId: number, taskId: number) => `/proyectos/${projectId}?tarea=${taskId}`;

/** Quién firma: la persona del cliente, o alguien del equipo «(por el cliente)». */
function signer(v: Viewer): string {
  const a = actor(v);
  return v.kind === 'client' ? a.name : `${a.name} (por el cliente)`;
}

export interface ChangesResult {
  round: number;
  included: number;
  extra: boolean;
}

/**
 * Pide ajustes sobre una entrega: suma la ronda, la devuelve a En progreso, deja el pedido escrito como comentario
 * compartido en la tarea, lo anota en la bitácora y avisa. `from` dice de dónde salió (la plataforma o una reunión).
 */
export function requestChanges(task: db.Task, project: db.Project, note: string, v: Viewer, from: { meeting?: string } = {}): ChangesResult {
  const included = db.includedRounds(project);
  const round = (task.revision_round ?? 0) + 1;
  const extra = included > 0 && round > included;
  const a = actor(v);
  const head = `**Ajustes solicitados · ronda ${round}${included > 0 ? ` de ${included} incluidas` : ''}${extra ? ' (adicional)' : ''}**`;
  const origin = from.meeting ? `\n\nDe la reunión «${from.meeting}».` : v.kind !== 'client' ? '\n\nRegistrado por el equipo a pedido del cliente.' : '';
  db.transaction(() => {
    db.requestTaskChanges(task.id);
    db.createNote({
      project_id: project.id,
      task_id: task.id,
      kind: 'nota',
      visibility: 'shared',
      author_kind: a.kind,
      author_id: a.id,
      author_name: a.name,
      body: `${head}${origin}\n\n${note}`,
    });
    db.logActivity({
      projectId: project.id,
      taskId: task.id,
      actorKind: a.kind,
      actorName: a.name,
      type: 'task_changes',
      data: { title: task.title, round, extra, meeting: from.meeting ?? null },
    });
  });
  const path = taskPath(project.id, task.id);
  if (v.kind === 'client') {
    notify('client_review', { actor: v, projectId: project.id, taskId: task.id, title: `${a.name} pidió ajustes en «${task.title}»${extra ? ' (ronda adicional)' : ''}`, body: note, path });
  }
  if (task.assignee_id) {
    notify('team_assigned', {
      actor: v,
      projectId: project.id,
      taskId: task.id,
      accountId: task.assignee_id,
      title: `Ajustes en «${task.title}» (ronda ${round}${extra ? ', adicional' : ''})`,
      body: note,
      path,
    });
  }
  return { round, included, extra };
}

/** Tareas del equipo que pueden ser entregas al cliente (las del cliente y las reuniones, nunca). */
const candidates = (projectId: number) => db.listTasks(projectId).filter((t) => t.side === 'deersystems' && t.kind !== 'reunion');

/** La IA clasifica las tareas del equipo de un proyecto que ya existe: entrega al cliente u operativa. No guarda nada. */
async function detectDeliveries(project: db.Project) {
  const tasks = candidates(project.id);
  if (!tasks.length) return { suggestions: [], ai: null };
  const phases = new Map(db.listPhases(project.id).map((p) => [p.id, p.name]));
  const { data, completion } = await completeJson<{ deliveries?: unknown }>({
    profile: 'propuestas',
    purpose: 'entregas al cliente',
    system: 'Eres el asistente de operaciones de DeerSystems. Clasificas las tareas de un proyecto. Responde SOLO con JSON válido.',
    prompt: `Proyecto: "${project.name}".
Alcance (extracto): ${project.scope.slice(0, 3000) || '—'}

Tareas del equipo (JSON):
${JSON.stringify(tasks.map((t) => ({ id: t.id, fase: t.phase_id ? (phases.get(t.phase_id) ?? '') : '', titulo: t.title, descripcion: t.description.slice(0, 200) })))}

¿Cuáles son entregas al cliente? Una entrega es una tarea cuyo resultado se le entrega al cliente para que lo revise y apruebe (un diseño, un prototipo, un módulo o funcionalidad terminada, un informe, contenido, el sitio o la app publicados). No lo son las tareas operativas o internas (configurar servidores o accesos, instalar, migrar datos, pruebas internas, despliegues técnicos, documentación interna).

Devuelve: { "deliveries": [ids de las tareas que son entregas al cliente] }`,
    maxOutputTokens: 2048,
  });
  const ids = new Set((Array.isArray(data.deliveries) ? data.deliveries : []).map(Number));
  return {
    suggestions: tasks.map((t) => ({ id: t.id, title: t.title, phase: t.phase_id ? (phases.get(t.phase_id) ?? '') : '', status: t.status, current: !!t.client_delivery, suggested: ids.has(t.id) })),
    ai: { provider: completion.provider, model: completion.model, costUsd: completion.costUsd, latencyMs: completion.latencyMs },
  };
}

export async function handleReviews(route: string, id: number, req: IncomingMessage, res: ServerResponse, v: Viewer): Promise<boolean> {
  switch (route) {
    case 'POST tasks/:id/review': {
      const { task, project } = visibleTask(id, v);
      const body = await readJson(req);
      const decision = body.decision === 'approve' ? 'approve' : body.decision === 'changes' ? 'changes' : null;
      if (!decision) throw new HttpError(400, 'Elige aprobar o pedir ajustes.');
      if (!canReview(task, v)) {
        if (!isDelivery(task)) throw new HttpError(409, 'Esta tarea no es una entrega al cliente: es operativa del equipo y no lleva aprobación.');
        throw new HttpError(409, task.status === 'completada' ? 'Esta entrega ya está aprobada.' : 'Esta entrega todavía no está lista para revisar.');
      }
      // Una completada solo se reabre con ajustes (aprobarla de nuevo no tiene sentido).
      if (decision === 'approve' && task.status === 'completada') throw new HttpError(409, 'Esta entrega ya está aprobada.');

      if (decision === 'approve') {
        const by = signer(v);
        const a = actor(v);
        db.transaction(() => {
          db.approveTask(task.id, by);
          db.logActivity({ projectId: project.id, taskId: task.id, actorKind: a.kind, actorName: a.name, type: 'task_approved', data: { title: task.title, round: task.revision_round ?? 0 } });
        });
        if (v.kind === 'client') {
          notify('client_review', { actor: v, projectId: project.id, taskId: task.id, title: `${a.name} aprobó «${task.title}»`, body: project.name, path: taskPath(project.id, task.id) });
        }
      } else {
        const note = str(body.note, 4000);
        if (note.length < 5) throw new HttpError(400, 'Escribe qué hay que ajustar.');
        requestChanges(task, project, note, v);
      }
      const fresh = db.getTask(task.id)!;
      json(res, 200, { task: taskView(fresh, v, teamNames(), db.commentCounts(project.id, isStaff(v))), progress: db.progressOf(project.id) });
      return true;
    }

    // Detectar con IA qué tareas del equipo son entregas al cliente (para revisar antes de guardar).
    case 'POST projects/:id/deliveries/detect': {
      requireOwner(v);
      const project = visibleProject(id, v);
      try {
        json(res, 200, await detectDeliveries(project));
      } catch (err) {
        if (err instanceof AiError) throw new HttpError(502, err.message);
        throw err;
      }
      return true;
    }

    // Guardar la clasificación: { deliveries: [ids] } = entregas al cliente; el resto de las tareas del equipo, operativas.
    case 'PUT projects/:id/deliveries': {
      requireOwner(v);
      const project = visibleProject(id, v);
      const body = await readJson(req);
      const ids = new Set((Array.isArray(body.deliveries) ? body.deliveries : []).map(Number));
      let changed = 0;
      db.transaction(() => {
        for (const t of candidates(project.id)) {
          const want = ids.has(t.id) ? 1 : 0;
          if (want !== (t.client_delivery ? 1 : 0)) {
            db.updateTask(t.id, { client_delivery: want });
            changed++;
          }
        }
      });
      if (changed) {
        const a = actor(v);
        db.logActivity({ projectId: project.id, actorKind: a.kind, actorName: a.name, type: 'deliveries_marked', data: { deliveries: ids.size, changed }, internal: true });
      }
      json(res, 200, { changed, deliveries: candidates(project.id).filter((t) => t.client_delivery).length });
      return true;
    }

    // Rondas incluidas por defecto (todas las entregas, salvo que el proyecto diga otra cosa).
    case 'GET settings/reviews':
      requireOwner(v);
      json(res, 200, { revisionRounds: db.defaultRevisionRounds() });
      return true;

    case 'PUT settings/reviews': {
      requireOwner(v);
      const body = await readJson(req);
      const n = Number(body.revisionRounds);
      if (!Number.isInteger(n) || n < 0 || n > 20) throw new HttpError(400, 'Las rondas incluidas van de 0 (sin límite) a 20.');
      db.setSetting('reviews', { revisionRounds: n });
      json(res, 200, { revisionRounds: n });
      return true;
    }

    // Rondas de este proyecto (p. ej. lo que dice la propuesta). null = las de Configuración.
    case 'PUT projects/:id/reviews': {
      requireOwner(v);
      const project = visibleProject(id, v);
      const body = await readJson(req);
      const raw = body.revisionRounds;
      const n = raw === null || raw === '' ? null : Number(raw);
      if (n !== null && (!Number.isInteger(n) || n < 0 || n > 20)) throw new HttpError(400, 'Las rondas incluidas van de 0 (sin límite) a 20.');
      db.updateProject(project.id, { revision_rounds: n });
      json(res, 200, { revisionRounds: n, effective: db.includedRounds({ revision_rounds: n }), default: db.defaultRevisionRounds() });
      return true;
    }
  }
  return false;
}
