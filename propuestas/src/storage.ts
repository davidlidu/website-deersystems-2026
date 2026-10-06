import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { unzipSync } from 'fflate';
import { DATA_DIR, MAX_UNPACKED_BYTES } from './config.ts';

const FILES_DIR = join(DATA_DIR, 'files');

/** Rutas que usa la propia app y no pueden ser el slug de una propuesta. */
const RESERVED = new Set(['admin', 'auth', 'api', 'healthz']);

export class UploadError extends Error {}

/** "PROP-2026-014 Acmé S.A.S.html" → "prop-2026-014-acme-s-a-s" */
export function slugify(name: string): string {
  return name
    .replace(/\.(html?|zip)$/i, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

export function checkSlug(slug: string): void {
  if (slug.length < 3) throw new UploadError('La URL debe tener al menos 3 caracteres.');
  if (RESERVED.has(slug)) throw new UploadError(`"${slug}" es una ruta reservada. Usa otro nombre.`);
}

export interface Unpacked {
  /** Ruta relativa con "/" → contenido. Siempre incluye index.html. */
  files: Map<string, Uint8Array>;
  size: number;
}

/** Convierte lo subido (.html suelto o .zip con assets) en el árbol de archivos a publicar. */
export function unpack(filename: string, data: Buffer): Unpacked {
  if (data.length === 0) throw new UploadError('El archivo está vacío.');
  const isZip = data.length > 4 && data.readUInt32LE(0) === 0x04034b50;
  if (!isZip) {
    if (!/\.html?$/i.test(filename)) throw new UploadError('Sube un archivo .html o un .zip con la propuesta.');
    return { files: new Map([['index.html', data]]), size: data.length };
  }

  let total = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(data, {
      filter: (f) => {
        if (f.name.endsWith('/') || isJunk(f.name)) return false;
        total += f.originalSize;
        if (total > MAX_UNPACKED_BYTES) throw new UploadError('El .zip descomprimido es demasiado grande.');
        return true;
      },
    });
  } catch (err) {
    if (err instanceof UploadError) throw err;
    throw new UploadError('No se pudo leer el .zip.');
  }

  let paths = Object.keys(entries).map((name) => ({ name, path: safePath(name) }));
  if (paths.length === 0) throw new UploadError('El .zip no contiene archivos.');

  // Un .zip de una carpeta trae todo bajo "carpeta/": se publica su contenido.
  const top = paths[0].path.split('/')[0];
  if (paths.every((p) => p.path.startsWith(top + '/'))) {
    paths = paths.map((p) => ({ name: p.name, path: p.path.slice(top.length + 1) }));
  }

  const rootHtml = paths.filter((p) => !p.path.includes('/') && /\.html?$/i.test(p.path));
  const index = rootHtml.find((p) => /^index\.html?$/i.test(p.path)) ?? (rootHtml.length === 1 ? rootHtml[0] : null);
  if (!index) {
    throw new UploadError('El .zip debe tener un index.html en la raíz (o un único .html).');
  }

  const files = new Map<string, Uint8Array>();
  for (const p of paths) files.set(p === index ? 'index.html' : p.path, entries[p.name]);
  return { files, size: total };
}

function isJunk(name: string): boolean {
  const base = name.split('/').pop()!;
  return name.startsWith('__MACOSX/') || base === '.DS_Store' || base === 'Thumbs.db' || base.startsWith('._');
}

function safePath(name: string): string {
  const parts = name.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length === 0 || parts.some((p) => p === '.' || p === '..')) {
    throw new UploadError(`Ruta no válida dentro del .zip: ${name}`);
  }
  return parts.join('/');
}

const versionDir = (id: number, version: number) => join(FILES_DIR, String(id), `v${version}`);

export async function writeVersion(id: number, version: number, files: Map<string, Uint8Array>): Promise<void> {
  const dir = versionDir(id, version);
  await rm(dir, { recursive: true, force: true });
  for (const [path, content] of files) {
    const target = join(dir, ...path.split('/'));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
}

export function removeVersion(id: number, version: number): Promise<void> {
  return rm(versionDir(id, version), { recursive: true, force: true });
}

export function removeAll(id: number): Promise<void> {
  return rm(join(FILES_DIR, String(id)), { recursive: true, force: true });
}

/** Ruta en disco de un archivo de la propuesta, o null si se sale de su carpeta. */
export function resolveFile(id: number, version: number, relPath: string): string | null {
  const dir = versionDir(id, version);
  const target = join(dir, ...relPath.split('/'));
  return target.startsWith(dir + sep) ? target : null;
}
