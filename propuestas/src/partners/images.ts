import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { DATA_DIR } from '../config.ts';
import { db as sqlite } from '../db.ts';
import { HttpError, json, readBody } from '../http.ts';
import type { Viewer } from './auth.ts';
import { actor, visibleProject, visibleTask } from './common.ts';

/**
 * Capturas e imágenes pegadas en comentarios y notas. Se guardan en el servidor (no en Drive, para que pegar una
 * captura sea inmediato y no dependa de la conexión con Google) y el comentario las lleva como ![captura](/api/images/{id}).
 * Las ve quien ve el proyecto y, si la imagen es de una tarea, quien ve esa tarea.
 */

const IMAGES_DIR = join(DATA_DIR, 'images');
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
    file TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    author_kind TEXT NOT NULL,
    author_id INTEGER,
    author_name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS images_project ON images(project_id);
`);

interface ImageRow {
  id: number;
  project_id: number;
  task_id: number | null;
  file: string;
  mime: string;
}

/** El tipo se lee de los primeros bytes (no del nombre ni de lo que diga el navegador): solo imágenes de verdad. */
function sniff(b: Buffer): string | null {
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 6 && /^GIF8[79]a/.test(b.subarray(0, 6).toString('latin1'))) return 'image/gif';
  if (b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

export async function handleImages(route: string, id: number, req: IncomingMessage, res: ServerResponse, v: Viewer, url: URL): Promise<boolean> {
  switch (route) {
    case 'POST projects/:id/images': {
      const project = visibleProject(id, v);
      let taskId: number | null = null;
      const taskParam = Number(url.searchParams.get('taskId'));
      if (taskParam) {
        const { task } = visibleTask(taskParam, v);
        if (task.project_id !== project.id) throw new HttpError(400, 'La tarea no es de este proyecto.');
        taskId = task.id;
      }
      const data = await readBody(req, MAX_IMAGE_BYTES);
      const mime = sniff(data);
      if (!mime) throw new HttpError(400, 'Solo se pueden pegar imágenes PNG, JPG, GIF o WebP.');
      const file = `${randomBytes(12).toString('hex')}.${EXT[mime]}`;
      await mkdir(IMAGES_DIR, { recursive: true });
      await writeFile(join(IMAGES_DIR, file), data);
      const a = actor(v);
      const r = sqlite
        .prepare('INSERT INTO images (project_id, task_id, file, mime, size, author_kind, author_id, author_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(project.id, taskId, file, mime, data.length, a.kind, a.id, a.name, new Date().toISOString());
      json(res, 201, { id: Number(r.lastInsertRowid), url: `/api/images/${r.lastInsertRowid}` });
      return true;
    }

    case 'GET images/:id': {
      const img = sqlite.prepare('SELECT id, project_id, task_id, file, mime FROM images WHERE id = ?').get(id) as ImageRow | undefined;
      if (!img) throw new HttpError(404, 'La imagen no existe.');
      visibleProject(img.project_id, v);
      if (img.task_id) visibleTask(img.task_id, v);
      const data = await readFile(join(IMAGES_DIR, img.file)).catch(() => null);
      if (!data) throw new HttpError(404, 'La imagen no existe.');
      res.writeHead(200, {
        'Content-Type': img.mime,
        'Content-Length': String(data.length),
        'Cache-Control': 'private, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': 'sandbox',
      });
      res.end(data);
      return true;
    }
  }
  return false;
}

/** Para avisos y correos: las imágenes del Markdown se cambian por un texto. */
export const withoutImages = (text: string) => text.replace(/!\[[^\]]*\]\(\/api\/images\/\d+\)/g, '[imagen]');
