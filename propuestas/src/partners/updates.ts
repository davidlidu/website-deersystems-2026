import type { IncomingMessage, ServerResponse } from 'node:http';
import { AiError, complete } from '../ai.ts';
import { PARTNERS_URL } from '../config.ts';
import { db as sqlite } from '../db.ts';
import * as google from '../google.ts';
import { HttpError, json, readJson } from '../http.ts';
import { projectUpdate } from '../mail.ts';
import type { Viewer } from './auth.ts';
import { noteView, requireStaff, visibleProject } from './common.ts';
import * as db from './db.ts';
import { clientEmailFor, notify } from './notify.ts';

/**
 * Generador de avances: arma el avance del día con lo que pasó en el proyecto (tareas completadas o enviadas a revisión,
 * reuniones, archivos compartidos y la próxima reunión), con enlaces a cada cosa. La IA lo redacta; si no responde,
 * queda una versión armada con los mismos datos. Cada proyecto puede publicarlo solo, todos los días a las 5:00 p. m.
 */

const TZ = 'America/Bogota';
export const AUTO_HOUR = 17;
const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
const today = () => dayOf(new Date().toISOString());
const when = (iso: string) =>
  new Date(iso).toLocaleString('es-CO', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });

interface Link {
  title: string;
  url: string;
}

interface DayFacts {
  completed: Link[];
  review: Link[];
  meetings: (Link & { summary: string })[];
  files: string[];
  next: (Link & { when: string }) | null;
  progress: db.Progress;
}

const taskUrl = (projectId: number, taskId: number) => `${PARTNERS_URL}/proyectos/${projectId}?tarea=${taskId}`;
const meetingsUrl = (projectId: number) => `${PARTNERS_URL}/proyectos/${projectId}?tab=reuniones`;
// Corchetes y paréntesis romperían el enlace en Markdown.
const label = (s: string) => s.replace(/[[\]()]/g, ' ').replace(/\s+/g, ' ').trim();

function facts(project: db.Project, date = today()): DayFacts {
  const tasks = db.listTasks(project.id);
  const completed = tasks.filter((t) => t.status === 'completada' && t.completed_at && dayOf(t.completed_at) === date && t.kind !== 'reunion');
  // Lo que se mandó hoy a revisión (y sigue ahí): la bitácora dice cuándo cambió de estado.
  const toReview = new Set(
    db
      .listActivity(project.id, { internal: false, limit: 300 })
      .filter((a) => a.type === 'task_status' && a.task_id && dayOf(a.created_at) === date && JSON.parse(a.data).to === 'en_revision')
      .map((a) => a.task_id!),
  );
  const review = tasks.filter((t) => toReview.has(t.id) && t.status === 'en_revision');
  const files = db
    .listActivity(project.id, { internal: false, limit: 300 })
    .filter((a) => a.type === 'file_added' && dayOf(a.created_at) === date)
    .map((a) => String(JSON.parse(a.data).name ?? ''))
    .filter(Boolean);

  const rows = sqlite
    .prepare("SELECT id, title, start_at, status, summary, meet_url FROM meetings WHERE project_id = ? AND status <> 'descartada' ORDER BY start_at")
    .all(project.id) as { id: number; title: string; start_at: string; status: string; summary: string; meet_url: string | null }[];
  const meetings = rows
    .filter((m) => dayOf(m.start_at) === date && new Date(m.start_at) <= new Date())
    // El resumen solo se cuenta si ya se aprobó: antes es un borrador que el cliente no ha visto.
    .map((m) => ({ title: label(m.title), url: meetingsUrl(project.id), summary: m.status === 'aprobada' ? m.summary.slice(0, 1500) : '' }));
  const upcoming = rows.find((m) => m.status === 'programada' && new Date(m.start_at) > new Date());

  return {
    completed: completed.map((t) => ({ title: label(t.title), url: taskUrl(project.id, t.id) })),
    review: review.map((t) => ({ title: label(t.title), url: taskUrl(project.id, t.id) })),
    meetings,
    files,
    next: upcoming ? { title: label(upcoming.title), url: upcoming.meet_url || meetingsUrl(project.id), when: when(upcoming.start_at) } : null,
    progress: db.progressOf(project.id),
  };
}

const isEmpty = (f: DayFacts) => !f.completed.length && !f.review.length && !f.meetings.length && !f.files.length;
const pct = (p: db.Progress) => (p.total ? Math.round((p.done / p.total) * 100) : 0);

/** El avance sin IA: los mismos datos, en el mismo formato. */
function template(project: db.Project, f: DayFacts): string {
  const lines: string[] = [];
  lines.push(isEmpty(f) ? `¡Hola! Les compartimos cómo va **${project.name}**.` : `¡Hola! Este es el avance de hoy en **${project.name}**.`);
  const hitos = [
    ...f.completed.map((t) => `- Tarea finalizada: [${t.title}](${t.url})`),
    ...f.review.map((t) => `- Lista para su revisión: [${t.title}](${t.url})`),
    ...f.meetings.map((m) => `- Reunión realizada: [${m.title}](${m.url})`),
    ...f.files.map((n) => `- Archivo compartido: ${n}`),
  ];
  if (hitos.length) lines.push('', '**Hitos del día:**', ...hitos);
  if (f.next) lines.push('', `**Próxima reunión:** [${f.next.title}](${f.next.url}), ${f.next.when}.`);
  if (f.progress.total) lines.push('', `Vamos en **${pct(f.progress)} %** del proyecto (${f.progress.done} de ${f.progress.total} tareas).`);
  lines.push('', 'Quedamos atentos a sus comentarios.');
  return lines.join('\n');
}

const SYSTEM = `Eres el asistente de DeerSystems, una empresa colombiana de software, automatización e IA.
Redactas el avance diario que DeerSystems le publica a su cliente en el portal del proyecto.
Escribe en español, cálido y profesional, en segunda persona del plural. Responde SOLO con el texto en Markdown, sin explicaciones.`;

async function aiDraft(project: db.Project, f: DayFacts): Promise<string> {
  const list = (items: Link[]) => items.map((t) => `- [${t.title}](${t.url})`).join('\n') || '- ninguna';
  const completion = await complete({
    profile: 'reuniones', // datos del cliente: solo proveedores privados
    purpose: 'avance',
    system: SYSTEM,
    // Holgado: en los modelos que razonan, el razonamiento también gasta de aquí y cortaba el avance.
    maxOutputTokens: 8192,
    prompt: `Proyecto: ${project.name}
Avance total: ${pct(f.progress)} % (${f.progress.done} de ${f.progress.total} tareas).

Tareas completadas hoy:
${list(f.completed)}

Tareas enviadas hoy a revisión del cliente:
${list(f.review)}

Reuniones de hoy:
${f.meetings.map((m) => `- [${m.title}](${m.url})${m.summary ? `\n  Resumen aprobado: ${m.summary.replace(/\n+/g, ' ')}` : ''}`).join('\n') || '- ninguna'}

Archivos compartidos hoy: ${f.files.join(', ') || 'ninguno'}
Próxima reunión: ${f.next ? `[${f.next.title}](${f.next.url}), ${f.next.when}` : 'ninguna agendada'}

Escribe el avance:
- Un saludo breve y una frase que resuma el día.
- "**Hitos del día:**" con viñetas; cada tarea o reunión con su enlace exacto, en formato [texto](url). No cambies las URL.
- Si hay tareas en revisión, pide con amabilidad que las revisen.
- La próxima reunión con su enlace, si la hay, y el porcentaje de avance.
- Cierra con "Quedamos atentos a sus comentarios."
- Máximo 160 palabras. Sin títulos con #, sin emojis, sin inventar nada que no esté arriba.`,
  });
  const text = completion.text.trim().replace(/^```(?:markdown|md)?\s*/i, '').replace(/```$/, '').trim();
  if (!text) throw new AiError('La IA no devolvió texto.');
  if (completion.truncated) throw new AiError('la respuesta llegó incompleta');
  return text.slice(0, 10_000);
}

export async function draftUpdate(project: db.Project): Promise<{ body: string; ai: boolean; empty: boolean; warning?: string }> {
  const f = facts(project);
  const empty = isEmpty(f);
  // Un día sin movimientos no necesita IA: la plantilla deja la base para escribir.
  if (empty) return { body: template(project, f), ai: false, empty };
  try {
    return { body: await aiDraft(project, f), ai: true, empty };
  } catch (err) {
    return { body: template(project, f), ai: false, empty, warning: `La IA no respondió (${(err as Error).message}); se armó con los datos del día.` };
  }
}

export const autoUpdatesOn = (projectId: number) =>
  !!(sqlite.prepare('SELECT auto_updates FROM projects WHERE id = ?').get(projectId) as { auto_updates?: number } | undefined)?.auto_updates;

// ───────── El avance por correo ─────────

/** El correo del avance (para enviarlo o verlo antes). Sin `noteId`, el enlace va a la pestaña de avances. */
function updateMail(project: db.Project, to: string, body: string, createdAt: string, noteId?: number) {
  return projectUpdate({
    to,
    projectName: project.name,
    body,
    date: new Date(createdAt).toLocaleDateString('es-CO', { timeZone: TZ, day: 'numeric', month: 'long' }),
    url: `${PARTNERS_URL}/proyectos/${project.id}?tab=avances${noteId ? `&avance=${noteId}` : ''}`,
  });
}

/** Le manda al cliente el avance completo por correo y lo deja marcado, para no enviarlo dos veces. */
export async function emailUpdate(project: db.Project, note: db.Note): Promise<void> {
  const client = db.getClientAccount(project.client_id);
  if (!client?.active) throw new HttpError(409, 'El cliente no tiene acceso activo al portal: no hay a qué correo enviarlo.');
  if (!google.connectionStatus().connected) throw new HttpError(409, 'Conecta Google en Configuración para enviar correos.');
  await google.sendMail(updateMail(project, client.email, note.body, note.created_at, note.id));
  db.markNoteEmailed(note.id);
}

/**
 * Al publicar un avance compartido: el aviso en la app y, si corresponde, el avance completo por correo
 * (en vez del resumen corto de avisos). `email`: lo que elegiste al publicar; sin elegir (el envío diario
 * automático), se sigue lo configurado en Avisos. 'off' = no se envió por correo.
 */
export async function announceUpdate(project: db.Project, note: db.Note, actor: Viewer | null, email?: boolean): Promise<'sent' | 'off' | 'error'> {
  notify('staff_update', { actor, projectId: project.id, title: `Nuevo avance en ${project.name}`, body: note.body, path: `/proyectos/${project.id}?tab=avances`, skipEmail: true });
  if (!(email ?? !!clientEmailFor('staff_update', project.id))) return 'off';
  try {
    await emailUpdate(project, note);
    return 'sent';
  } catch (err) {
    console.error(`No se pudo enviar por correo el avance ${note.id}:`, (err as Error).message);
    return 'error';
  }
}

// ───────── Envío automático diario ─────────

async function publishAuto(project: db.Project): Promise<boolean> {
  const date = today();
  // Si alguien ya publicó un avance hoy, no se duplica.
  if (db.listNotes(project.id, { internal: true, taskId: null, kind: 'avance' }).some((n) => dayOf(n.created_at) === date)) return false;
  const f = facts(project, date);
  if (isEmpty(f)) return false;
  const { body, ai } = await draftUpdate(project);
  const note = db.createNote({
    project_id: project.id,
    task_id: null,
    kind: 'avance',
    visibility: 'shared',
    author_kind: 'owner',
    author_id: null,
    author_name: 'DeerSystems',
    body,
    ai,
  });
  db.logActivity({ projectId: project.id, actorKind: 'owner', actorName: 'DeerSystems', type: 'update_posted', data: { excerpt: body.slice(0, 140), auto: true } });
  await announceUpdate(project, note, null);
  return true;
}

/** Exportada para probarla; en producción la llama el temporizador. */
export async function autoTick(): Promise<void> {
  const hour = Number(new Date().toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }));
  const date = today();
  if (hour < AUTO_HOUR || db.getSetting<string>('auto_updates_day') === date) return;
  db.setSetting('auto_updates_day', date);
  const ids = sqlite.prepare("SELECT id FROM projects WHERE auto_updates = 1 AND status = 'activo'").all() as { id: number }[];
  for (const { id } of ids) {
    const p = db.getProject(id);
    if (p) await publishAuto(p).catch((err) => console.error(`Avance automático del proyecto ${id}:`, err));
  }
}

/** Revisa cada 5 minutos si ya son las 5:00 p. m. en Colombia y no se ha enviado hoy. */
export function startUpdatesScheduler(): void {
  setInterval(() => void autoTick(), 5 * 60_000).unref();
}

export async function handleUpdates(route: string, id: number, req: IncomingMessage, res: ServerResponse, v: Viewer): Promise<boolean> {
  switch (route) {
    case 'POST projects/:id/updates/draft': {
      requireStaff(v);
      json(res, 200, await draftUpdate(visibleProject(id, v)));
      return true;
    }

    // Para el editor de avances: a quién le llegaría el correo y si por defecto se envía.
    case 'GET projects/:id/updates/mail': {
      requireStaff(v);
      const project = visibleProject(id, v);
      const client = db.getClientAccount(project.client_id);
      const ready = !!client?.active && google.connectionStatus().connected;
      json(res, 200, {
        to: client?.active ? client.email : null,
        canSend: ready,
        defaultOn: ready && !!clientEmailFor('staff_update', project.id),
        reason: !client?.active ? 'El cliente no tiene acceso activo al portal.' : !ready ? 'Conecta Google en Configuración para enviar correos.' : null,
      });
      return true;
    }

    // Vista previa del correo de un avance (lo que está en el editor o uno ya publicado).
    case 'POST projects/:id/updates/mail-preview': {
      requireStaff(v);
      const project = visibleProject(id, v);
      const body = await readJson(req);
      const text = typeof body.body === 'string' ? body.body.trim().slice(0, 10_000) : '';
      if (!text) throw new HttpError(400, 'Escribe el avance para ver el correo.');
      const note = Number(body.noteId) ? db.getNote(Number(body.noteId)) : undefined;
      const to = db.getClientAccount(project.client_id)?.email ?? 'cliente@empresa.com';
      const m = updateMail(project, to, text, note?.created_at ?? new Date().toISOString(), note?.project_id === project.id ? note.id : undefined);
      json(res, 200, { subject: m.subject, to: m.to, html: m.html });
      return true;
    }

    case 'POST notes/:id/email': {
      requireStaff(v);
      const note = db.getNote(id);
      if (!note || note.kind !== 'avance') throw new HttpError(404, 'El avance no existe.');
      const project = visibleProject(note.project_id, v);
      if (note.visibility !== 'shared') throw new HttpError(400, 'Es un avance solo para el equipo: compártelo con el cliente antes de enviarlo.');
      if (note.emailed_at) throw new HttpError(409, 'Este avance ya se le envió por correo al cliente.');
      await emailUpdate(project, note);
      json(res, 200, noteView(db.getNote(note.id)!, v));
      return true;
    }

    case 'PUT projects/:id/updates/auto': {
      requireStaff(v);
      const project = visibleProject(id, v);
      const body = await readJson(req);
      if (typeof body.enabled !== 'boolean') throw new HttpError(400, 'Falta enabled.');
      sqlite.prepare('UPDATE projects SET auto_updates = ? WHERE id = ?').run(body.enabled ? 1 : 0, project.id);
      json(res, 200, { enabled: body.enabled, hour: AUTO_HOUR });
      return true;
    }
  }
  return false;
}
