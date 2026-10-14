import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { endSession, googleAuthUrl, googleCallback, googleConfigured, sessionEmail, startSession } from './auth.ts';
import { DEV_LOGIN, HOME_URL, MAX_UPLOAD_BYTES, PARTNERS_HOST, PARTNERS_URL, PORT, PUBLIC_URL, SUPERADMIN_EMAIL } from './config.ts';
import * as db from './db.ts';
import { HttpError, json, readBody, readJson, redirect, sendFile } from './http.ts';
import { projectsForProposal, pruneNotifications } from './partners/db.ts';
import { startScheduler } from './partners/meetings.ts';
import { flushAll } from './partners/notify.ts';
import { handlePartners } from './partners/routes.ts';
import { checkSlug, removeAll, removeVersion, resolveFile, slugify, unpack, UploadError, writeVersion } from './storage.ts';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));

/** Vistas previas de enlaces y rastreadores: no cuentan como apertura del cliente. */
const BOT_UA = /bot|crawl|spider|preview|whatsapp|facebookexternalhit|slack|telegram|discord|curl|wget/i;

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
      return json(res, 200, { email, superadmin: isSuper, publicUrl: PUBLIC_URL, partnersUrl: PARTNERS_URL });

    case 'GET proposals':
      return json(
        res,
        200,
        db.listProposals().map((p) => ({
          ...p,
          projects: projectsForProposal(p.id).map((pr) => ({ id: pr.id, name: pr.name, approvedOption: pr.approved_option })),
        })),
      );

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
  // Un solo servidor para los dos subdominios: el Host decide cuál atiende.
  const partners = req.headers.host === PARTNERS_HOST;
  const url = new URL(req.url ?? '/', partners ? PARTNERS_URL : PUBLIC_URL);
  const path = url.pathname;

  if (path === '/healthz') return json(res, 200, { ok: true });
  if (path === '/robots.txt') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return void res.end('User-agent: *\nDisallow: /\n');
  }
  if (path === '/favicon.svg' || path === '/favicon.ico') {
    await sendFile(req, res, join(PUBLIC_DIR, 'favicon.svg'), { 'Cache-Control': 'public, max-age=86400' });
    return;
  }
  if (partners) return handlePartners(req, res, url);
  // La raíz no lista nada: con sesión lleva al panel y al resto lo manda al sitio principal.
  if (path === '/') return redirect(res, sessionEmail(req) ? '/admin' : HOME_URL);
  if (path.startsWith('/auth/')) return handleAuth(req, res, url);
  if (path.startsWith('/admin/api/')) return handleApi(req, res, url);
  if (path === '/admin' || path.startsWith('/admin/')) return handleAdminPage(req, res, url);
  return handleProposal(req, res, url);
}

pruneNotifications();
startScheduler();

// En cada despliegue Dokploy detiene el contenedor: antes de salir se envían los correos de avisos en cola.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    flushAll().finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 8000).unref();
  });
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
  console.log(`Propuestas DeerSystems en ${PUBLIC_URL} y partners en ${PARTNERS_URL} (puerto ${PORT})`);
  if (!googleConfigured()) console.warn('Falta GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET: el login con Google no funcionará.');
  if (DEV_LOGIN) {
    console.warn(`DEV_LOGIN activo: ${PUBLIC_URL}/auth/dev y ${PARTNERS_URL}/auth/dev entran como ${SUPERADMIN_EMAIL}.`);
  }
});
