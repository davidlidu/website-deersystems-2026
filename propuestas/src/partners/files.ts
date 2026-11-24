import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, extname, join, sep } from 'node:path';
import { Readable } from 'node:stream';
import { DATA_DIR } from '../config.ts';
import * as google from '../google.ts';
import { HttpError, json, MIME, readBody, readJson as readJsonBody, sendFile } from '../http.ts';
import { unpack } from '../storage.ts';
import { viewer, type Viewer } from './auth.ts';
import { actor, isStaff, seesTaskId, visibleProject, visibleTask } from './common.ts';
import * as db from './db.ts';
import { notify } from './notify.ts';

const MAX_FILE_BYTES = 50 * 1024 * 1024;

/** Lo único que se muestra en el navegador; lo demás se descarga (un .html o .svg subido podría ejecutar código). */
const INLINE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf']);

type Att = db.Attachment & db.AttachmentExtra;

/**
 * Páginas HTML (entregas con animaciones, prototipos…): se guardan en el servidor, no en Drive, y se abren en
 * /paginas/{token}/ como una propuesta. Corren aisladas (CSP sandbox, sin allow-same-origin): sus scripts funcionan,
 * pero no pueden leer la sesión del portal ni llamar a su API.
 */
const PAGES_DIR = join(DATA_DIR, 'pages');
const pageDir = (id: number) => join(PAGES_DIR, String(id));
export const pageUrl = (token: string) => `/paginas/${token}/`;
const isPage = (a: db.Attachment) => !!(a as Att).page_token;
const pageFileName = (name: string) => (/\.html?$/i.test(name) ? name : `${name.replace(/\.zip$/i, '')}.html`);

/**
 * El ojo abre el visor de Drive. Tú siempre tienes acceso; los demás, solo si el archivo es compartido
 * y ya tiene el acceso por enlace. Si no, se usa la vista del portal (imágenes y PDF) o no hay vista.
 */
function viewUrl(a: Att, v: Viewer): string | null {
  if (a.page_token) return pageUrl(a.page_token);
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
    downloadName: a.page_token ? pageFileName(a.name) : google.isGoogleNative(a.mime) ? `${a.name}.pdf` : a.name,
    /** Viene de tu Drive (no se subió): quitarlo de aquí no lo borra de Drive. */
    linked: !!a.linked,
    /** Página HTML publicada por el servidor: se abre en el portal en vez de descargarse. */
    page: !!a.page_token,
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
  const project = visibleProject(a.project_id, v);
  if (!isStaff(v) && a.visibility === 'internal') throw new HttpError(404, 'El archivo no existe.');
  if (!seesTaskId(v, a.task_id, project)) throw new HttpError(404, 'El archivo no existe.');
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
      if (taskId) visibleTask(taskId, v);
      const seen = new Map<number, boolean>();
      json(
        res,
        200,
        db
          .listAttachments(project.id, { internal: staff, taskId })
          .filter((a) => seesTaskId(v, a.task_id, project, seen))
          .map((a) => attachmentView(a, v)),
      );
      return true;
    }

    case 'POST projects/:id/attachments': {
      const project = visibleProject(id, v);
      const name = (url.searchParams.get('filename') ?? '').trim().replace(/[\\/]/g, '-').slice(0, 200);
      if (!name) throw new HttpError(400, 'Falta el nombre del archivo.');
      // Tu equipo publica páginas HTML (un .html, o un .zip con sus imágenes y scripts si se pide como página).
      const asPage = staff && (/\.html?$/i.test(name) || (url.searchParams.get('page') === '1' && /\.zip$/i.test(name)));
      if (!asPage && !google.connectionStatus().connected) throw new HttpError(503, 'Los archivos se guardan en Google Drive, que aún no está conectado.');
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
      const a = actor(v);
      const author = { visibility, author_kind: a.kind, author_id: a.id, author_name: a.name } as const;

      let att: db.Attachment;
      let page: string | null = null;
      if (asPage) {
        const content = unpack(name, data);
        att = db.createAttachment({ project_id: project.id, task_id: taskId, drive_file_id: '', name, mime: 'text/html', size: content.size, ...author });
        try {
          await writePage(att.id, content.files);
        } catch (err) {
          db.deleteAttachment(att.id);
          await rm(pageDir(att.id), { recursive: true, force: true });
          throw err;
        }
        const token = randomBytes(18).toString('base64url');
        db.setAttachmentPage(att.id, token);
        page = pageUrl(token);
      } else {
        let file: google.DriveFile;
        try {
          file = await google.uploadFile(await projectFolder(project), name, mime, data);
        } catch (err) {
          throw driveError(err);
        }
        att = db.createAttachment({ project_id: project.id, task_id: taskId, drive_file_id: file.id, name, mime, size: data.length, ...author });
        db.setAttachmentSource(att.id, { drive_url: file.webViewLink ?? null, linked: false });
        if (visibility === 'shared') await syncSharing(att, true);
      }
      db.logActivity({
        projectId: project.id,
        taskId,
        actorKind: a.kind,
        actorName: a.name,
        type: 'file_added',
        data: { name, taskTitle, visibility, ...(page ? { page } : {}) },
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
        if (!isPage(a)) await syncSharing(a, visibility === 'shared');
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
      if (isPage(a)) {
        // La página se descarga como su index.html (con assets, estos quedan en el servidor).
        const html = await readFile(join(pageDir(a.id), 'index.html')).catch(() => null);
        if (!html) throw new HttpError(404, 'El archivo no existe.');
        const name = pageFileName(a.name);
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
          'Content-Length': String(html.length),
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        res.end(html);
        return true;
      }
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
      if (extra.page_token) {
        await rm(pageDir(a.id), { recursive: true, force: true });
      } else if (extra.linked) {
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

async function writePage(id: number, files: Map<string, Uint8Array>): Promise<void> {
  const dir = pageDir(id);
  await rm(dir, { recursive: true, force: true });
  for (const [path, content] of files) {
    const target = join(dir, ...path.split('/'));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
}

/** Contra todo: la página corre como un origen aparte y sin acceso a la sesión ni a la API del portal. */
const PAGE_CSP = 'sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-presentation allow-pointer-lock';

/**
 * /paginas/{token}/ruta. La página principal pide sesión y que la persona pueda ver el archivo (un interno no lo ve
 * el cliente). Sus imágenes, estilos y scripts se piden desde el sandbox, que no manda cookies: los protege el token.
 */
export async function handlePage(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const notFound = () => {
    throw new HttpError(404, 'La página no existe o ya no está disponible.');
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Método no permitido.');
  const segments = url.pathname.slice('/paginas/'.length).split('/').map(decodeURIComponent);
  const a = /^[\w-]{20,}$/.test(segments[0]) ? db.getAttachmentByPageToken(segments[0]) : undefined;
  if (!a) return notFound();
  // Sin la barra final, las rutas relativas del HTML no resolverían bajo la carpeta de la página.
  if (segments.length === 1) {
    res.writeHead(302, { Location: pageUrl(a.page_token!) + url.search });
    return void res.end();
  }
  let rel = segments.slice(1).join('/');
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  const isIndex = rel === 'index.html';
  if (isIndex) {
    const v = viewer(req);
    if (!v) {
      res.writeHead(302, { Location: `/login?next=${encodeURIComponent(url.pathname)}` });
      return void res.end();
    }
    visibleAttachment(a.id, v);
  }
  const dir = pageDir(a.id);
  const file = join(dir, ...rel.split('/'));
  if (!file.startsWith(dir + sep)) return notFound();
  const sent = await sendFile(req, res, file, {
    'Cache-Control': 'private, no-cache',
    'Content-Security-Policy': PAGE_CSP,
    // El token va en la URL: que no se filtre a otros sitios.
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'X-Content-Type-Options': 'nosniff',
    // El sandbox es otro origen: fuentes y módulos JS de la página necesitan CORS para cargar.
    ...(isIndex ? {} : { 'Access-Control-Allow-Origin': '*' }),
  });
  if (!sent) notFound();
}
