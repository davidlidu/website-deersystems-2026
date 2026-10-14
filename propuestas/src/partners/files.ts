import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname } from 'node:path';
import { Readable } from 'node:stream';
import * as google from '../google.ts';
import { HttpError, json, MIME, readBody, readJson as readJsonBody } from '../http.ts';
import type { Viewer } from './auth.ts';
import { actor, isStaff, visibleProject, visibleTask } from './common.ts';
import * as db from './db.ts';
import { notify } from './notify.ts';

const MAX_FILE_BYTES = 50 * 1024 * 1024;

/** Lo único que se muestra en el navegador; lo demás se descarga (un .html o .svg subido podría ejecutar código). */
const INLINE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf']);

type Att = db.Attachment & db.AttachmentExtra;

/**
 * El ojo abre el visor de Drive. Tú siempre tienes acceso; los demás, solo si el archivo es compartido
 * y ya tiene el acceso por enlace. Si no, se usa la vista del portal (imágenes y PDF) o no hay vista.
 */
function viewUrl(a: Att, v: Viewer): string | null {
  const drive = a.drive_url ?? google.fileUrl(a.drive_file_id);
  if (v.kind === 'owner' || (a.visibility === 'shared' && a.link_shared)) return drive;
  return INLINE.has(a.mime) ? `/api/attachments/${a.id}/download?inline=1` : null;
}

function attachmentView(raw: db.Attachment, v: Viewer) {
  const a = raw as Att;
  const me = actor(v);
  const mine = a.author_kind === me.kind && a.author_id === me.id;
  return {
    id: a.id,
    taskId: a.task_id,
    name: a.name,
    mime: a.mime,
    size: a.size,
    visibility: a.visibility,
    authorKind: a.author_kind,
    authorName: a.author_name,
    createdAt: a.created_at,
    canDelete: mine || v.kind === 'owner',
    canChangeVisibility: isStaff(v),
    viewUrl: viewUrl(a, v),
    downloadName: google.isGoogleNative(a.mime) ? `${a.name}.pdf` : a.name,
    /** Viene de tu Drive (no se subió): quitarlo de aquí no lo borra de Drive. */
    linked: !!a.linked,
  };
}

/** Activa o quita el acceso por enlace en Drive. Si Google lo rechaza (p. ej. política del dominio), queda registrado sin romper nada. */
async function syncSharing(a: db.Attachment, shared: boolean): Promise<void> {
  try {
    await google.setLinkSharing(a.drive_file_id, shared);
    db.updateAttachment(a.id, { link_shared: shared ? 1 : 0 });
  } catch (err) {
    console.warn(`Drive: no se pudo ${shared ? 'compartir' : 'dejar de compartir'} «${a.name}» por enlace:`, (err as Error).message);
    if (!shared) db.updateAttachment(a.id, { link_shared: 0 });
  }
}

/** Comparte por enlace los archivos compartidos que aún no lo tienen (los subidos antes de este cambio). */
export function startShareFixer(): void {
  const run = async () => {
    if (!google.connectionStatus().connected) return;
    for (const a of db.pendingLinkShares()) await syncSharing(a, true);
  };
  setTimeout(() => run().catch(() => {}), 20_000).unref();
  setInterval(() => run().catch(() => {}), 60 * 60_000).unref();
}

/** Carpeta del proyecto: DeerSystems Partners / Cliente / Proyecto. Se crea la primera vez. */
async function projectFolder(project: db.Project): Promise<string> {
  const root = await google.rootFolder();
  const client = db.getClient(project.client_id)!;
  const clientFolder = await google.ensureFolder(db.clientFolder(client.id), client.name, root.id, (id) => db.setClientFolder(client.id, id));
  return google.ensureFolder(db.projectFolder(project.id), project.name, clientFolder, (id) => db.setProjectFolder(project.id, id));
}

function visibleAttachment(id: number, v: Viewer): db.Attachment {
  const a = db.getAttachment(id);
  if (!a) throw new HttpError(404, 'El archivo no existe.');
  visibleProject(a.project_id, v);
  if (!isStaff(v) && a.visibility === 'internal') throw new HttpError(404, 'El archivo no existe.');
  return a;
}

const driveError = (err: unknown) =>
  err instanceof google.GoogleError ? new HttpError(502, err.message) : (err as Error);

export async function handleFiles(route: string, id: number, req: IncomingMessage, res: ServerResponse, v: Viewer, url: URL): Promise<boolean> {
  const staff = isStaff(v);

  switch (route) {
    case 'GET projects/:id/attachments': {
      const project = visibleProject(id, v);
      const taskId = Number(url.searchParams.get('taskId')) || undefined;
      json(res, 200, db.listAttachments(project.id, { internal: staff, taskId }).map((a) => attachmentView(a, v)));
      return true;
    }

    case 'POST projects/:id/attachments': {
      const project = visibleProject(id, v);
      if (!google.connectionStatus().connected) throw new HttpError(503, 'Los archivos se guardan en Google Drive, que aún no está conectado.');
      const name = (url.searchParams.get('filename') ?? '').trim().replace(/[\\/]/g, '-').slice(0, 200);
      if (!name) throw new HttpError(400, 'Falta el nombre del archivo.');
      let taskId: number | null = null;
      let taskTitle: string | null = null;
      const taskParam = Number(url.searchParams.get('taskId'));
      if (taskParam) {
        const { task } = visibleTask(taskParam, v);
        if (task.project_id !== project.id) throw new HttpError(400, 'La tarea no es de este proyecto.');
        taskId = task.id;
        taskTitle = task.title;
      }
      // El cliente solo sube archivos compartidos.
      const visibility = staff && url.searchParams.get('visibility') === 'internal' ? 'internal' : 'shared';
      const data = await readBody(req, MAX_FILE_BYTES);
      if (!data.length) throw new HttpError(400, 'El archivo está vacío.');
      const declared = String(req.headers['content-type'] ?? '').split(';')[0].trim();
      const mime =
        declared && declared !== 'application/octet-stream'
          ? declared
          : (MIME[extname(name).toLowerCase()]?.split(';')[0] ?? 'application/octet-stream');

      let file: google.DriveFile;
      try {
        file = await google.uploadFile(await projectFolder(project), name, mime, data);
      } catch (err) {
        throw driveError(err);
      }
      const a = actor(v);
      const att = db.createAttachment({
        project_id: project.id,
        task_id: taskId,
        drive_file_id: file.id,
        name,
        mime,
        size: data.length,
        visibility,
        author_kind: a.kind,
        author_id: a.id,
        author_name: a.name,
      });
      db.setAttachmentSource(att.id, { drive_url: file.webViewLink ?? null, linked: false });
      if (visibility === 'shared') await syncSharing(att, true);
      db.logActivity({
        projectId: project.id,
        taskId,
        actorKind: a.kind,
        actorName: a.name,
        type: 'file_added',
        data: { name, taskTitle, visibility },
        internal: visibility === 'internal',
      });
      const path = taskId ? `/proyectos/${project.id}?tarea=${taskId}` : `/proyectos/${project.id}?tab=archivos`;
      if (v.kind === 'client') {
        notify('client_file', { actor: v, projectId: project.id, taskId, title: `${v.name} subió «${name}»`, body: taskTitle ? `En «${taskTitle}»` : project.name, path });
      } else if (visibility === 'shared') {
        notify('staff_file', { actor: v, projectId: project.id, taskId, title: `DeerSystems compartió «${name}»`, body: taskTitle ? `En «${taskTitle}»` : project.name, path });
      }
      json(res, 201, attachmentView(db.getAttachment(att.id)!, v));
      return true;
    }

    // Archivos elegidos de tu Drive con Google Picker: se enlazan (no se copian ni se suben).
    case 'POST projects/:id/attachments/drive': {
      if (v.kind !== 'owner') throw new HttpError(403, 'Solo el administrador puede agregar archivos desde Drive.');
      const project = visibleProject(id, v);
      const body = (await readJsonBody(req)) as { fileIds?: unknown; taskId?: unknown; visibility?: unknown };
      const ids = (Array.isArray(body.fileIds) ? body.fileIds : []).filter((x): x is string => typeof x === 'string' && /^[\w-]{10,}$/.test(x)).slice(0, 20);
      if (!ids.length) throw new HttpError(400, 'No llegó ningún archivo.');
      let taskId: number | null = null;
      if (body.taskId) {
        const { task } = visibleTask(Number(body.taskId), v);
        if (task.project_id !== project.id) throw new HttpError(400, 'La tarea no es de este proyecto.');
        taskId = task.id;
      }
      const visibility = body.visibility === 'internal' ? 'internal' : 'shared';
      const a = actor(v);
      const added = [];
      for (const fileId of ids) {
        let meta: google.DriveFile;
        try {
          meta = await google.fileMeta(fileId);
        } catch (err) {
          throw driveError(err);
        }
        const att = db.createAttachment({
          project_id: project.id,
          task_id: taskId,
          drive_file_id: meta.id,
          name: meta.name.slice(0, 200),
          mime: meta.mimeType,
          size: Number(meta.size) || 0,
          visibility,
          author_kind: a.kind,
          author_id: a.id,
          author_name: a.name,
        });
        db.setAttachmentSource(att.id, { drive_url: meta.webViewLink ?? null, linked: true });
        if (visibility === 'shared') await syncSharing(att, true);
        db.logActivity({ projectId: project.id, taskId, actorKind: a.kind, actorName: a.name, type: 'file_added', data: { name: meta.name, visibility }, internal: visibility === 'internal' });
        added.push(attachmentView(db.getAttachment(att.id)!, v));
      }
      if (visibility === 'shared') {
        const path = taskId ? `/proyectos/${project.id}?tarea=${taskId}` : `/proyectos/${project.id}?tab=archivos`;
        const title = added.length === 1 ? `DeerSystems compartió «${added[0].name}»` : `DeerSystems compartió ${added.length} archivos`;
        notify('staff_file', { actor: v, projectId: project.id, taskId, title, body: project.name, path });
      }
      json(res, 201, added);
      return true;
    }

    // Cambiar un archivo entre compartido e interno.
    case 'PATCH attachments/:id': {
      if (!isStaff(v)) throw new HttpError(403, 'No tienes permiso para esto.');
      const a = db.getAttachment(id);
      if (!a) throw new HttpError(404, 'El archivo no existe.');
      const project = visibleProject(a.project_id, v);
      const body = (await readJsonBody(req)) as { visibility?: unknown };
      const visibility = body.visibility === 'internal' ? 'internal' : body.visibility === 'shared' ? 'shared' : null;
      if (!visibility) throw new HttpError(400, 'Visibilidad no válida.');
      if (visibility !== a.visibility) {
        db.updateAttachment(a.id, { visibility });
        await syncSharing(a, visibility === 'shared');
        const me = actor(v);
        db.logActivity({
          projectId: project.id,
          taskId: a.task_id,
          actorKind: me.kind,
          actorName: me.name,
          type: 'file_visibility',
          data: { name: a.name, visibility },
          // Volverlo interno no se le anuncia al cliente; compartirlo sí.
          internal: visibility === 'internal',
        });
        if (visibility === 'shared') {
          const path = a.task_id ? `/proyectos/${project.id}?tarea=${a.task_id}` : `/proyectos/${project.id}?tab=archivos`;
          notify('staff_file', { actor: v, projectId: project.id, taskId: a.task_id, title: `DeerSystems compartió «${a.name}»`, body: project.name, path });
        }
      }
      json(res, 200, attachmentView(db.getAttachment(a.id)!, v));
      return true;
    }

    case 'GET settings/google/picker': {
      if (v.kind !== 'owner') throw new HttpError(403, 'Solo el administrador puede hacer esto.');
      const apiKey = google.pickerApiKey();
      const appId = google.cloudProjectNumber();
      if (!apiKey || !appId || !google.connectionStatus().connected) {
        json(res, 200, { configured: false, hasKey: !!apiKey, appId });
        return true;
      }
      try {
        // El token de la cuenta conectada (la tuya): con drive.file, el Picker da acceso solo a lo que elijas.
        json(res, 200, { configured: true, hasKey: true, apiKey, appId, accessToken: await google.accessToken(), keyHint: `${apiKey.slice(0, 8)}…${apiKey.slice(-4)}` });
      } catch (err) {
        throw driveError(err);
      }
      return true;
    }

    case 'PUT settings/google/picker': {
      if (v.kind !== 'owner') throw new HttpError(403, 'Solo el administrador puede hacer esto.');
      const body = (await readJsonBody(req)) as { apiKey?: unknown };
      const key = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
      if (key && !/^AIza[\w-]{30,}$/.test(key)) throw new HttpError(400, 'Esa no parece una clave de API de Google (empieza por AIza…).');
      google.savePickerApiKey(key);
      json(res, 200, { hasKey: !!key });
      return true;
    }

    case 'GET attachments/:id/download': {
      const a = visibleAttachment(id, v);
      const native = google.isGoogleNative(a.mime);
      let r: Response;
      try {
        r = native ? await google.exportPdf(a.drive_file_id) : await google.downloadFile(a.drive_file_id);
      } catch (err) {
        throw driveError(err);
      }
      const mime = native ? 'application/pdf' : a.mime;
      const name = native ? `${a.name}.pdf` : a.name;
      const inline = url.searchParams.get('inline') === '1' && INLINE.has(mime);
      const length = r.headers.get('content-length');
      res.writeHead(200, {
        'Content-Type': INLINE.has(mime) ? mime : 'application/octet-stream',
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,
        ...(length ? { 'Content-Length': length } : {}),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': 'sandbox',
      });
      if (!r.body) {
        res.end();
        return true;
      }
      Readable.fromWeb(r.body as import('node:stream/web').ReadableStream).pipe(res);
      return true;
    }

    case 'DELETE attachments/:id': {
      const a = visibleAttachment(id, v);
      if (!attachmentView(a, v).canDelete) throw new HttpError(403, 'Solo quien lo subió puede borrarlo.');
      const extra = a as Att;
      if (extra.linked) {
        // Viene de tu Drive: no se toca el original, solo se le quita el acceso por enlace si se lo dimos.
        if (extra.link_shared) await google.setLinkSharing(a.drive_file_id, false).catch(() => {});
      } else {
        // Va a la papelera de Drive (recuperable 30 días). Si ya no estaba, igual se quita de aquí.
        await google.trashFile(a.drive_file_id).catch((err) => console.warn('Drive: no se pudo enviar a la papelera:', err.message));
      }
      db.deleteAttachment(a.id);
      const me = actor(v);
      db.logActivity({
        projectId: a.project_id,
        taskId: a.task_id,
        actorKind: me.kind,
        actorName: me.name,
        type: 'file_deleted',
        data: { name: a.name },
        internal: a.visibility === 'internal',
      });
      json(res, 200, { ok: true });
      return true;
    }
  }
  return false;
}
