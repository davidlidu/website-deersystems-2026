import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { endSession, googleAuthUrl, googleCallback, googleConfigured, sessionEmail, startSession } from './auth.ts';
import { DEV_LOGIN, HOME_URL, MAX_UPLOAD_BYTES, PORT, PUBLIC_URL, SUPERADMIN_EMAIL } from './config.ts';
import * as db from './db.ts';
import { checkSlug, removeAll, removeVersion, resolveFile, slugify, unpack, UploadError, writeVersion } from './storage.ts';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.pdf': 'application/pdf',
};

/** Vistas previas de enlaces y rastreadores: no cuentan como apertura del cliente. */
const BOT_UA = /bot|crawl|spider|preview|whatsapp|facebookexternalhit|slack|telegram|discord|curl|wget/i;

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const tooBig = () => new HttpError(413, `El archivo supera el máximo de ${Math.round(limit / 1024 / 1024)} MB.`);
    if (Number(req.headers['content-length'] ?? 0) > limit) return reject(tooBig());
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        chunks.length = 0;
        reject(tooBig());
      } else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  try {
    const body = JSON.parse((await readBody(req, 64 * 1024)).toString() || '{}');
    if (body && typeof body === 'object') return body;
  } catch (err) {
    if (err instanceof HttpError) throw err;
  }
  throw new HttpError(400, 'JSON no válido.');
}

/** Sirve un archivo con ETag y rangos. Devuelve false si no existe. */
async function sendFile(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  headers: Record<string, string>,
  status = 200,
): Promise<boolean> {
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) return false;

  const etag = `"${info.size.toString(36)}-${Math.round(info.mtimeMs).toString(36)}"`;
  const base = {
    'Content-Type': MIME[extname(path).toLowerCase()] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    ETag: etag,
    ...headers,
  };
  if (status === 200 && req.headers['if-none-match'] === etag) {
    res.writeHead(304, base);
    res.end();
    return true;
  }

  let start = 0;
  let end = info.size - 1;
  const range = status === 200 && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range && (range[1] || range[2])) {
    if (range[1]) {
      start = Number(range[1]);
      if (range[2]) end = Math.min(Number(range[2]), end);
    } else {
      start = Math.max(info.size - Number(range[2]), 0);
    }
    if (start > end) {
      res.writeHead(416, { 'Content-Range': `bytes */${info.size}` });
      res.end();
      return true;
    }
    status = 206;
    Object.assign(base, { 'Content-Range': `bytes ${start}-${end}/${info.size}` });
  }

  res.writeHead(status, { ...base, 'Content-Length': info.size === 0 ? 0 : end - start + 1 });
  if (req.method === 'HEAD' || info.size === 0) res.end();
  else createReadStream(path, { start, end }).pipe(res);
  return true;
}

async function notFound(req: IncomingMessage, res: ServerResponse): Promise<void> {
  await sendFile(req, res, join(PUBLIC_DIR, '404.html'), { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }, 404);
}

const ADMIN_HEADERS = { 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'X-Robots-Tag': 'noindex' };

async function handleAuth(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const route = `${req.method} ${url.pathname}`;
  if (route === 'GET /auth/google') {
    return redirect(res, googleConfigured() ? googleAuthUrl(res) : '/admin/login?error=config');
  }
  if (route === 'GET /auth/google/callback') {
    const result = await googleCallback(req, res, url.searchParams).catch(() => ({ error: 'google' as const }));
    if ('error' in result) return redirect(res, `/admin/login?error=${result.error}`);
    startSession(res, result.email);
    return redirect(res, '/admin');
  }
  if (route === 'GET /auth/dev' && DEV_LOGIN) {
    startSession(res, SUPERADMIN_EMAIL);
    return redirect(res, '/admin');
  }
  if (route === 'POST /auth/logout') {
    endSession(res);
    return redirect(res, '/admin/login');
  }
  return notFound(req, res);
}

async function handleAdminPage(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Método no permitido.');
  const path = url.pathname.replace(/\/+$/, '');
  const logged = sessionEmail(req) !== null;
  if (path === '/admin') {
    if (!logged) return redirect(res, '/admin/login');
    await sendFile(req, res, join(PUBLIC_DIR, 'admin.html'), ADMIN_HEADERS);
  } else if (path === '/admin/login') {
    if (logged) return redirect(res, '/admin');
    await sendFile(req, res, join(PUBLIC_DIR, 'login.html'), ADMIN_HEADERS);
  } else if (/^\/admin\/static\/[\w.-]+$/.test(path)) {
    const ok = await sendFile(req, res, join(PUBLIC_DIR, path.slice('/admin/static/'.length)), { 'Cache-Control': 'no-cache' });
    if (!ok) await notFound(req, res);
  } else {
    await notFound(req, res);
  }
}

/** Lee el archivo subido (cuerpo crudo) y lo deja listo para publicar. */
async function readUpload(req: IncomingMessage, url: URL) {
  const filename = (url.searchParams.get('filename') ?? '').trim();
  if (!filename) throw new HttpError(400, 'Falta el nombre del archivo.');
  const content = unpack(filename, await readBody(req, MAX_UPLOAD_BYTES));
  return { filename, ...content, hasAssets: content.files.size > 1 };
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const email = sessionEmail(req);
  if (!email) throw new HttpError(401, 'Sesión no válida. Vuelve a entrar.');
  // Las cookies SameSite=Lax ya bloquean escrituras desde otros sitios; esto lo refuerza.
  if (req.method !== 'GET' && req.headers.origin !== new URL(PUBLIC_URL).origin) {
    throw new HttpError(403, 'Origen no permitido.');
  }
  const isSuper = email === SUPERADMIN_EMAIL;
  const parts = url.pathname.slice('/admin/api/'.length).split('/').map(decodeURIComponent);
  const route = `${req.method} ${parts[0]}${parts.length > 1 ? '/:id' : ''}${parts[2] ? `/${parts[2]}` : ''}`;

  const proposal = () => {
    const p = db.getProposal(Number(parts[1]));
    if (!p) throw new HttpError(404, 'La propuesta no existe.');
    return p;
  };

  switch (route) {
    case 'GET me':
      return json(res, 200, { email, superadmin: isSuper, publicUrl: PUBLIC_URL });

    case 'GET proposals':
      return json(res, 200, db.listProposals());

    case 'POST proposals': {
      const upload = await readUpload(req, url);
      const slug = slugify(url.searchParams.get('slug') || upload.filename);
      checkSlug(slug);
      if (db.getProposalBySlug(slug)) {
        throw new HttpError(409, `Ya existe una propuesta en /${slug}. Usa "Reemplazar" para actualizarla.`);
      }
      const title = (url.searchParams.get('title') ?? '').trim().slice(0, 200);
      const created = db.createProposal({ slug, title, by: email, ...upload });
      try {
        await writeVersion(created.id, created.version, upload.files);
      } catch (err) {
        db.deleteProposal(created.id);
        await removeAll(created.id);
        throw err;
      }
      return json(res, 201, created);
    }

    case 'PUT proposals/:id/file': {
      const current = proposal();
      const upload = await readUpload(req, url);
      const version = current.version + 1;
      await writeVersion(current.id, version, upload.files);
      db.setProposalContent(current.id, { version, by: email, ...upload });
      await removeVersion(current.id, current.version);
      return json(res, 200, db.getProposal(current.id));
    }

    case 'PATCH proposals/:id': {
      const current = proposal();
      const body = await readJson(req);
      db.updateProposal(current.id, {
        title: typeof body.title === 'string' ? body.title.trim().slice(0, 200) : undefined,
        active: typeof body.active === 'boolean' ? body.active : undefined,
      });
      return json(res, 200, db.getProposal(current.id));
    }

    case 'DELETE proposals/:id': {
      const current = proposal();
      db.deleteProposal(current.id);
      await removeAll(current.id);
      return json(res, 200, { ok: true });
    }

    case 'GET users':
      if (!isSuper) break;
      return json(res, 200, db.listUsers());

    case 'POST users': {
      if (!isSuper) break;
      const body = await readJson(req);
      const newEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) throw new HttpError(400, 'Correo no válido.');
      if (newEmail !== SUPERADMIN_EMAIL) db.addUser(newEmail, email);
      return json(res, 200, db.listUsers());
    }

    case 'DELETE users/:id':
      if (!isSuper) break;
      db.removeUser(parts[1].toLowerCase());
      return json(res, 200, db.listUsers());
  }
  throw new HttpError(isSuper ? 404 : 403, isSuper ? 'Ruta no encontrada.' : 'Solo el superusuario puede hacer esto.');
}

/** /{slug} y /{slug}/ruta/al/asset. Cualquier otra cosa es un 404 neutro, sin pistas de qué existe. */
async function handleProposal(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return notFound(req, res);
  let segments: string[];
  try {
    segments = url.pathname.slice(1).split('/').map(decodeURIComponent);
  } catch {
    return notFound(req, res);
  }
  const proposal = db.getProposalBySlug(segments[0].toLowerCase());
  if (!proposal || !proposal.active) return notFound(req, res);

  // Con assets, las rutas relativas del HTML solo resuelven bien bajo /{slug}/.
  if (segments.length === 1 && proposal.has_assets) return redirect(res, `/${proposal.slug}/${url.search}`);

  let rel = segments.slice(1).join('/');
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  const file = resolveFile(proposal.id, proposal.version, rel);
  const sent =
    file !== null &&
    (await sendFile(req, res, file, {
      // no-cache: al reemplazar la propuesta el cliente ve la nueva versión de inmediato.
      'Cache-Control': 'no-cache',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
    }));
  if (!sent) return notFound(req, res);

  const isPage = rel === 'index.html' && req.method === 'GET' && !req.headers.range;
  if (isPage && !BOT_UA.test(req.headers['user-agent'] ?? '') && sessionEmail(req) === null) {
    db.countView(proposal.id);
  }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', PUBLIC_URL);
  const path = url.pathname;

  // La raíz no lista nada: con sesión lleva al panel y al resto lo manda al sitio principal.
  if (path === '/') return redirect(res, sessionEmail(req) ? '/admin' : HOME_URL);
  if (path === '/healthz') return json(res, 200, { ok: true });
  if (path === '/robots.txt') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return void res.end('User-agent: *\nDisallow: /\n');
  }
  if (path === '/favicon.svg' || path === '/favicon.ico') {
    await sendFile(req, res, join(PUBLIC_DIR, 'favicon.svg'), { 'Cache-Control': 'public, max-age=86400' });
    return;
  }
  if (path.startsWith('/auth/')) return handleAuth(req, res, url);
  if (path.startsWith('/admin/api/')) return handleApi(req, res, url);
  if (path === '/admin' || path.startsWith('/admin/')) return handleAdminPage(req, res, url);
  return handleProposal(req, res, url);
}

createServer((req, res) => {
  handle(req, res).catch((err) => {
    const badInput = err instanceof UploadError || err instanceof URIError;
    const status = err instanceof HttpError ? err.status : badInput ? 400 : 500;
    if (status === 500) console.error(err);
    if (res.headersSent) return void res.destroy();
    // Si el cliente sigue enviando el archivo, cerrar tras responder evita dejar la conexión colgada.
    res.setHeader('Connection', 'close');
    json(res, status, { error: status === 500 ? 'Error interno.' : err.message });
  });
}).listen(PORT, () => {
  console.log(`Propuestas DeerSystems en ${PUBLIC_URL} (puerto ${PORT})`);
  if (!googleConfigured()) console.warn('Falta GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET: el login con Google no funcionará.');
  if (DEV_LOGIN) console.warn(`DEV_LOGIN activo: ${PUBLIC_URL}/auth/dev entra como ${SUPERADMIN_EMAIL}.`);
});
