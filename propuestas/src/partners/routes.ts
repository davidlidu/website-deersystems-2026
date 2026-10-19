import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ai from '../ai.ts';
import { DEV_LOGIN, GOOGLE_CLIENT_ID, PARTNERS_URL, PUBLIC_URL, SUPERADMIN_EMAIL } from '../config.ts';
import { getProposal, listProposals, updateProposal, type Proposal } from '../db.ts';
import * as proposals from '../proposals.ts';
import { resolveFile } from '../storage.ts';
import * as google from '../google.ts';
import { HttpError, json, readJson, redirect, sendFile } from '../http.ts';
import * as mail from '../mail.ts';
import {
  checkNewPassword,
  clearFailures,
  clientIp,
  endSession,
  generatePassword,
  hashPassword,
  hashToken,
  newToken,
  rateLimited,
  readCookies,
  recordFailure,
  setCookie,
  startAccountSession,
  startOwnerSession,
  STATE_COOKIE,
  verifyPassword,
  viewer,
  type Viewer,
} from './auth.ts';
import * as db from './db.ts';
import { handleFiles } from './files.ts';
import { handleMeetings, scheduleMeeting } from './meetings.ts';
import { handleBilling } from './billing.ts';
import { handleFinance } from './finance.ts';
import { handleImport } from './import-smartbilling.ts';
import { handleOnlinePayments, handleWompiWebhook } from './online-payments.ts';
import { createPayments, handlePayments } from './payments.ts';
import * as notifications from './notify.ts';
import { handleWork } from './work.ts';
import { autoUpdatesOn, handleUpdates } from './updates.ts';
import { actor, EMAIL_RE, isStaff, optDate, requireOwner, requireStaff, str, taskView, teamNames, visibleProject } from './common.ts';
import { adjustPlan, detectOptions, extractDraft, normalizeDraft, type Approval } from './extract.ts';

const APP_DIR = fileURLToPath(new URL('../../public/partners/', import.meta.url));
const PARTNERS_ORIGIN = new URL(PARTNERS_URL).origin;

// ───────── Vistas según quién mira ─────────

function proposalUrl(proposalId: number | null): string | null {
  const p = proposalId ? getProposal(proposalId) : undefined;
  return p?.active ? `${PUBLIC_URL}/${p.slug}` : null;
}

/** El equipo nunca recibe precios ni el enlace a la propuesta (que también los tiene). */
function projectSummary(p: db.Project, v: Viewer) {
  const seesMoney = v.kind !== 'team';
  const client = db.getClient(p.client_id);
  return {
    id: p.id,
    clientId: p.client_id,
    clientName: client?.name ?? '',
    name: p.name,
    approvedOption: p.approved_option,
    status: p.status,
    startDate: p.start_date,
    endDate: p.end_date,
    approvedAt: p.approved_at,
    progress: db.progressOf(p.id),
    ...(seesMoney ? { proposalUrl: proposalUrl(p.proposal_id) } : {}),
  };
}

function projectDetail(p: db.Project, v: Viewer) {
  const team = teamNames();
  const comments = db.commentCounts(p.id, isStaff(v));
  const files = db.attachmentCounts(p.id, isStaff(v));
  return {
    ...projectSummary(p, v),
    scope: p.scope,
    approvalNotes: p.approval_notes,
    ...(v.kind !== 'team' ? { pricing: p.pricing } : {}),
    ...(isStaff(v) ? { autoUpdates: autoUpdatesOn(p.id) } : {}),
    phases: db.listPhases(p.id).map((ph) => ({ id: ph.id, name: ph.name })),
    tasks: db.listTasks(p.id).map((t) => taskView(t, v, team, comments, files)),
  };
}

// ───────── Correo ─────────

/** Envía si Google está conectado. Nunca rompe la operación principal: informa si no se pudo. */
async function trySend(m: google.Mail): Promise<{ sent: boolean; error?: string }> {
  if (!google.connectionStatus().connected) return { sent: false, error: 'Google no está conectado: el correo no se envió.' };
  try {
    await google.sendMail(m);
    return { sent: true };
  } catch (err) {
    console.error(err);
    return { sent: false, error: (err as Error).message };
  }
}

// ───────── Login, Google y recuperación ─────────

async function handleAuth(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const route = `${req.method} ${url.pathname}`;
  if (req.method === 'POST' && req.headers.origin !== PARTNERS_ORIGIN) throw new HttpError(403, 'Origen no permitido.');

  switch (route) {
    case 'POST /auth/login': {
      const body = await readJson(req);
      const email = str(body.email, 200).toLowerCase();
      const password = typeof body.password === 'string' ? body.password : '';
      const keys = [`ip:${clientIp(req)}`, `email:${email}`];
      if (keys.some(rateLimited)) throw new HttpError(429, 'Demasiados intentos. Espera unos minutos.');
      const account = db.getAccountByEmail(email);
      const ok = account?.active ? await verifyPassword(password, account.password_hash) : false;
      if (!account || !ok) {
        keys.forEach(recordFailure);
        throw new HttpError(401, 'Correo o contraseña incorrectos.');
      }
      keys.forEach(clearFailures);
      db.touchLogin(account.id);
      startAccountSession(res, account);
      return json(res, 200, { ok: true });
    }

    case 'POST /auth/logout':
      endSession(res);
      return json(res, 200, { ok: true });

    case 'POST /auth/forgot': {
      const body = await readJson(req);
      const email = str(body.email, 200).toLowerCase();
      const key = `forgot:${clientIp(req)}`;
      if (rateLimited(key)) throw new HttpError(429, 'Demasiadas solicitudes. Espera unos minutos.');
      recordFailure(key);
      const account = db.getAccountByEmail(email);
      if (account?.active) {
        const token = newToken();
        db.createReset(hashToken(token), account.id, new Date(Date.now() + 3600_000).toISOString());
        const result = await trySend(mail.passwordReset({ to: email, url: `${PARTNERS_URL}/restablecer?token=${token}` }));
        if (!result.sent) console.warn(`No se envió el enlace de recuperación a ${email}: ${result.error}`);
      }
      // Misma respuesta exista o no la cuenta, para no revelar qué correos están registrados.
      return json(res, 200, { ok: true });
    }

    case 'POST /auth/reset': {
      const body = await readJson(req);
      const password = (() => {
        try {
          return checkNewPassword(body.password);
        } catch (err) {
          throw new HttpError(400, (err as Error).message);
        }
      })();
      const accountId = db.useReset(hashToken(str(body.token, 200)));
      if (!accountId) throw new HttpError(400, 'El enlace venció o ya se usó. Pide uno nuevo.');
      db.setPassword(accountId, await hashPassword(password));
      return json(res, 200, { ok: true });
    }

    case 'GET /auth/google':
    case 'GET /auth/google/connect': {
      if (!GOOGLE_CLIENT_ID) return redirect(res, '/login?error=config');
      const mode = route.endsWith('connect') ? 'connect' : 'login';
      if (mode === 'connect' && viewer(req)?.kind !== 'owner') return redirect(res, '/login');
      const state = randomBytes(24).toString('base64url');
      setCookie(res, STATE_COOKIE, `${mode}.${state}`, 600);
      return redirect(res, google.authUrl(state, mode));
    }

    case 'GET /auth/google/callback': {
      const [mode, expected] = (readCookies(req)[STATE_COOKIE] ?? '').split('.');
      setCookie(res, STATE_COOKIE, '', 0);
      const back = mode === 'connect' ? '/configuracion?google=' : '/login?error=';
      const code = url.searchParams.get('code');
      if (!expected || url.searchParams.get('state') !== expected || !code) return redirect(res, `${back}state`);
      const result = await google.exchangeCode(code).catch(() => null);
      if (!result) return redirect(res, `${back}google`);
      if (result.email !== SUPERADMIN_EMAIL) return redirect(res, `${back}unauthorized`);
      if (mode === 'connect') {
        if (viewer(req)?.kind !== 'owner') return redirect(res, '/login');
        if (!result.refreshToken) return redirect(res, `${back}norefresh`);
        google.saveConnection(result.email, result.refreshToken, result.scopes);
        return redirect(res, `${back}ok`);
      }
      startOwnerSession(res, result.email);
      return redirect(res, '/');
    }

    case 'GET /auth/dev':
      if (!DEV_LOGIN) break;
      startOwnerSession(res, SUPERADMIN_EMAIL);
      return redirect(res, '/');
  }
  throw new HttpError(404, 'Ruta no encontrada.');
}

// ───────── Aprobar propuesta → cliente + proyecto + tareas ─────────

async function approve(body: Record<string, unknown>, v: Viewer) {
  const proposalId = Number(body.proposalId) || null;
  if (proposalId && !getProposal(proposalId)) throw new HttpError(404, 'La propuesta no existe.');

  const project = (body.project ?? {}) as Record<string, unknown>;
  const name = str(project.name, 120);
  if (!name) throw new HttpError(400, 'Falta el nombre del proyecto.');
  const draft = normalizeDraft({
    phases: body.phases,
    scope: project.scope,
    pricing: project.pricing,
    approvedOption: project.approvedOption,
    approvalNotes: project.approvalNotes,
    meetings: body.meetings,
    payments: body.payments,
  });
  // Qué reuniones agendar en Calendar al crear el proyecto (las demás quedan solo como tarea).
  const rawMeetings = Array.isArray(body.meetings) ? (body.meetings as { schedule?: unknown }[]) : [];
  if (!draft.phases.some((p) => p.tasks.length)) throw new HttpError(400, 'El proyecto necesita al menos una tarea.');

  const teamIds = new Set(db.listTeam().map((a) => a.id));
  const rawPhases = Array.isArray(body.phases) ? (body.phases as { tasks?: { assigneeId?: unknown }[] }[]) : [];

  // Cliente existente (por id o por correo) o uno nuevo con su cuenta.
  const c = (body.client ?? {}) as Record<string, unknown>;
  let client = Number(c.id) ? db.getClient(Number(c.id)) : undefined;
  if (Number(c.id) && !client) throw new HttpError(404, 'El cliente no existe.');
  const email = str(c.email, 200).toLowerCase();
  if (!client) {
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'El correo del cliente no es válido.');
    client = db.getClientByEmail(email);
  }
  let password: string | null = null;
  let passwordHash = '';
  const needsAccount = !client || !db.getClientAccount(client.id);
  // Un cliente solo de facturación (sin correo) recibe aquí su acceso: el correo llega en el formulario.
  const loginEmail = client?.email || email;
  if (needsAccount) {
    if (!EMAIL_RE.test(loginEmail)) throw new HttpError(400, 'Ese cliente no tiene correo: escríbelo para crearle el acceso al portal.');
    const other = db.getAccountByEmail(loginEmail);
    if (other || loginEmail === SUPERADMIN_EMAIL) {
      throw new HttpError(409, `El correo ${loginEmail} ya se usa en otra cuenta (equipo o administrador).`);
    }
    password = generatePassword();
    passwordHash = await hashPassword(password);
  }
  if (!client && !str(c.name, 160)) throw new HttpError(400, 'Falta el nombre del cliente.');

  const created = db.transaction(() => {
    const theClient =
      client ??
      db.createClient({ name: str(c.name, 160), contactName: str(c.contactName, 160), email, phone: str(c.phone, 60) });
    if (needsAccount) {
      if (!theClient.email) db.updateClient(theClient.id, { email: loginEmail });
      db.createAccount({
        email: loginEmail,
        name: theClient.contact_name || theClient.name,
        role: 'client',
        clientId: theClient.id,
        passwordHash,
      });
    }
    const p = db.createProject({
      clientId: theClient.id,
      proposalId,
      name,
      scope: draft.scope,
      pricing: draft.pricing,
      approvedOption: draft.approvedOption,
      approvalNotes: draft.approvalNotes,
      startDate: optDate(project.startDate) ?? null,
      endDate: optDate(project.endDate) ?? null,
      by: v.email,
    });
    let position = 0;
    const phaseIds: number[] = [];
    draft.phases.forEach((ph, i) => {
      const phase = db.createPhase(p.id, ph.name, i);
      phaseIds.push(phase.id);
      ph.tasks.forEach((t, j) => {
        const assignee = Number(rawPhases[i]?.tasks?.[j]?.assigneeId);
        db.createTask({
          projectId: p.id,
          phaseId: phase.id,
          title: t.title,
          description: t.description,
          side: t.side,
          assigneeId: t.side === 'deersystems' && teamIds.has(assignee) ? assignee : null,
          startDate: t.startDate,
          dueDate: t.dueDate,
          position: position++,
          source: 'propuesta',
        });
      });
    });
    // Reuniones de avance: también son tareas del cronograma, en su fase y con su fecha.
    for (const m of draft.meetings) {
      db.createTask({
        projectId: p.id,
        phaseId: phaseIds[m.phaseIndex] ?? null,
        title: m.title,
        description: m.purpose,
        side: 'deersystems',
        assigneeId: null,
        startDate: m.date,
        dueDate: m.date,
        position: position++,
        source: 'propuesta',
        kind: 'reunion',
      });
    }
    createPayments(p.id, draft.payments);
    const a = actor(v);
    db.logActivity({ projectId: p.id, actorKind: a.kind, actorName: a.name, type: 'project_created', data: { tasks: position } });
    return { project: p, client: theClient };
  });

  const account = db.getClientAccount(created.client.id)!;
  const notify = body.notify !== false;
  const mailResult = notify
    ? await trySend(
        password
          ? mail.welcomeClient({ to: account.email, name: account.name, projectName: name, password })
          : mail.newProjectForClient({ to: account.email, name: account.name, projectName: name }),
      )
    : { sent: false };

  // Después de la bienvenida: las invitaciones de Calendar de las reuniones marcadas para agendar.
  const meetings = { scheduled: 0, errors: [] as string[] };
  for (const [i, m] of draft.meetings.entries()) {
    if (rawMeetings[i]?.schedule !== true) continue;
    try {
      await scheduleMeeting(
        created.project,
        { title: m.title, date: m.date, time: m.time, durationMinutes: m.durationMinutes, agenda: m.purpose, includeClient: true, teamIds: [], guests: [] },
        v,
      );
      meetings.scheduled++;
    } catch (err) {
      meetings.errors.push(`«${m.title}»: ${(err as Error).message}`);
    }
  }

  return {
    project: projectSummary(created.project, v),
    client: created.client,
    // Se muestra una sola vez, por si el correo no salió o quieres enviarla por otro medio.
    password,
    mail: mailResult,
    meetings,
  };
}

// ───────── Propuestas ─────────

function proposalView(p: Proposal) {
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    url: proposals.publicUrl(p.slug),
    active: !!p.active,
    views: p.views,
    lastViewedAt: p.last_viewed_at,
    version: p.version,
    filename: p.filename,
    size: p.size,
    updatedAt: p.updated_at,
    projects: db
      .projectsForProposal(p.id)
      .map((pr) => ({ id: pr.id, name: pr.name, clientId: pr.client_id, approvedOption: pr.approved_option })),
  };
}

/** /historial/{id}/{versión}/… — una versión anterior tal como se publicó. Solo el administrador. */
async function handleHistory(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  if (viewer(req)?.kind !== 'owner') return redirect(res, '/login');
  const [, , rawId, rawVersion, ...rest] = url.pathname.split('/');
  const p = getProposal(Number(rawId));
  const version = Number(rawVersion);
  if (!p || !Number.isInteger(version)) throw new HttpError(404, 'No encontrado.');
  // Las rutas relativas del HTML solo resuelven bien con la barra final.
  if (!rest.length) return redirect(res, `${url.pathname}/`);
  let rel = rest.map(decodeURIComponent).join('/');
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  const file = resolveFile(p.id, version, rel);
  const ok = file && (await sendFile(req, res, file, { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' }));
  if (!ok) throw new HttpError(404, 'Esa versión ya no está disponible.');
}

// ───────── API ─────────

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const v = viewer(req);
  if (!v) throw new HttpError(401, 'Sesión no válida. Vuelve a entrar.');
  if (req.method !== 'GET' && req.headers.origin !== PARTNERS_ORIGIN) throw new HttpError(403, 'Origen no permitido.');

  const parts = url.pathname.slice('/api/'.length).split('/').map(decodeURIComponent);
  // "settings/ai/test" se queda tal cual; "projects/12" → "projects/:id"; "team/3/password" → "team/:id/password".
  const isId = (s: string | undefined) => !!s && /^\d+$/.test(s);
  const route = `${req.method} ${parts.map((p) => (isId(p) ? ':id' : p)).join('/')}`;
  const id = Number(parts.find(isId));

  switch (route) {
    // ── Sesión
    case 'GET me':
      return json(res, 200, {
        email: v.email,
        name: v.name,
        role: v.kind,
        tourDone: db.tourDone(v.kind === 'owner' ? null : v.account.id),
        ...(v.kind === 'owner' ? { proposalsUrl: `${PUBLIC_URL}/admin` } : {}),
        ...(v.kind === 'client' ? { client: db.getClient(v.clientId) } : {}),
      });

    case 'POST me/password': {
      if (v.kind === 'owner') throw new HttpError(400, 'Tu cuenta entra con Google.');
      const body = await readJson(req);
      if (!(await verifyPassword(String(body.current ?? ''), v.account.password_hash))) {
        throw new HttpError(400, 'La contraseña actual no es correcta.');
      }
      let pw: string;
      try {
        pw = checkNewPassword(body.password);
      } catch (err) {
        throw new HttpError(400, (err as Error).message);
      }
      db.setPassword(v.account.id, await hashPassword(pw));
      // La sesión actual sigue: se renueva con la nueva versión.
      startAccountSession(res, db.getAccount(v.account.id)!);
      return json(res, 200, { ok: true });
    }

    // ── Tour guiado: "Terminar tour" lo marca como visto; "Volver a ver" lo reactiva.
    case 'POST me/tour': {
      const body = await readJson(req);
      db.setTourDone(v.kind === 'owner' ? null : v.account.id, body.done !== false);
      return json(res, 200, { tourDone: body.done !== false });
    }

    // ── Mis avisos (cliente y equipo)
    case 'GET me/notifications':
      return json(res, 200, notifications.personalSettings(v));

    case 'PUT me/notifications':
      return json(res, 200, notifications.savePersonal(v, await readJson(req)));

    // ── Proyectos (cada rol ve lo suyo)
    case 'GET projects': {
      const list = v.kind === 'client' ? db.listProjects(v.clientId) : db.listProjects();
      return json(res, 200, list.map((p) => projectSummary(p, v)));
    }

    case 'GET projects/:id':
      return json(res, 200, projectDetail(visibleProject(id, v), v));

    case 'PATCH projects/:id': {
      requireStaff(v);
      const p = visibleProject(id, v);
      const body = await readJson(req);
      const status = db.PROJECT_STATUSES.find((s) => s === body.status);
      if (status && status !== p.status) {
        const a = actor(v);
        db.logActivity({ projectId: p.id, actorKind: a.kind, actorName: a.name, type: 'project_status', data: { from: p.status, to: status } });
      }
      db.updateProject(p.id, {
        name: str(body.name, 120) || undefined,
        status,
        scope: typeof body.scope === 'string' ? body.scope.slice(0, 30_000) : undefined,
        approved_option: typeof body.approvedOption === 'string' ? str(body.approvedOption, 160) : undefined,
        approval_notes: typeof body.approvalNotes === 'string' ? str(body.approvalNotes, 2000) : undefined,
        start_date: optDate(body.startDate),
        end_date: optDate(body.endDate),
        ...(v.kind === 'owner' && typeof body.pricing === 'string' ? { pricing: body.pricing.slice(0, 20_000) } : {}),
      });
      return json(res, 200, projectDetail(db.getProject(p.id)!, v));
    }

    case 'DELETE projects/:id':
      requireOwner(v);
      visibleProject(id, v);
      db.deleteProject(id);
      return json(res, 200, { ok: true });

    // ── Clientes (equipo y administrador)
    case 'GET clients':
      requireStaff(v);
      return json(res, 200, db.listClients());

    case 'GET clients/:id': {
      requireStaff(v);
      const client = db.getClient(id);
      if (!client) throw new HttpError(404, 'El cliente no existe.');
      const account = db.getClientAccount(id);
      return json(res, 200, {
        ...client,
        account: account ? { email: account.email, active: !!account.active, lastLoginAt: account.last_login_at } : null,
        projects: db.listProjects(id).map((p) => projectSummary(p, v)),
      });
    }

    case 'PATCH clients/:id': {
      requireStaff(v);
      if (!db.getClient(id)) throw new HttpError(404, 'El cliente no existe.');
      const body = await readJson(req);
      const text = (k: string, max: number) => (typeof body[k] === 'string' ? str(body[k], max) : undefined);
      // Datos de facturación (documento, ciudad, dirección) y correo de contacto: solo el administrador.
      const billingFields =
        v.kind === 'owner'
          ? { doc_type: text('docType', 20), doc_number: text('docNumber', 40), city: text('city', 100), address: text('address', 200) }
          : {};
      let email: string | null | undefined;
      if (v.kind === 'owner' && typeof body.email === 'string') {
        email = str(body.email, 200).toLowerCase() || null;
        if (email && !EMAIL_RE.test(email)) throw new HttpError(400, 'El correo no es válido.');
        const other = email ? db.getClientByEmail(email) : undefined;
        if (other && other.id !== id) throw new HttpError(409, `Ese correo ya es de ${other.name}.`);
      }
      db.updateClient(id, {
        name: str(body.name, 160) || undefined,
        contact_name: text('contactName', 160),
        phone: text('phone', 60),
        email,
        ...billingFields,
      });
      const account = db.getClientAccount(id);
      if (account && typeof body.active === 'boolean') {
        requireOwner(v);
        db.updateAccount(account.id, { active: body.active });
      }
      return json(res, 200, db.getClient(id));
    }

    case 'POST clients': {
      // Cliente solo de facturación (sin acceso al portal), p. ej. para una cuenta de cobro suelta.
      requireOwner(v);
      const body = await readJson(req);
      const name = str(body.name, 160);
      if (!name) throw new HttpError(400, 'Falta el nombre del cliente.');
      const email = str(body.email, 200).toLowerCase() || null;
      if (email && !EMAIL_RE.test(email)) throw new HttpError(400, 'El correo no es válido.');
      if (email && db.getClientByEmail(email)) throw new HttpError(409, 'Ya existe un cliente con ese correo.');
      const client = db.createClient({
        name,
        contactName: str(body.contactName, 160),
        email,
        phone: str(body.phone, 60),
        docType: str(body.docType, 20),
        docNumber: str(body.docNumber, 40),
        city: str(body.city, 100),
        address: str(body.address, 200),
      });
      return json(res, 201, client);
    }

    case 'POST clients/:id/access': {
      // Dar acceso al portal a un cliente que no lo tiene (p. ej. importado de SmartBilling).
      requireOwner(v);
      const client = db.getClient(id);
      if (!client) throw new HttpError(404, 'El cliente no existe.');
      if (db.getClientAccount(id)) throw new HttpError(409, 'Ese cliente ya tiene acceso.');
      const body = await readJson(req);
      const email = str(body.email, 200).toLowerCase() || client.email || '';
      if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Escribe el correo con el que va a entrar.');
      const other = db.getClientByEmail(email);
      if ((other && other.id !== id) || db.getAccountByEmail(email) || email === SUPERADMIN_EMAIL) {
        throw new HttpError(409, `El correo ${email} ya se usa en otra cuenta.`);
      }
      const password = generatePassword();
      const passwordHash = await hashPassword(password);
      db.transaction(() => {
        if (client.email !== email) db.updateClient(id, { email });
        db.createAccount({ email, name: client.contact_name || client.name, role: 'client', clientId: id, passwordHash });
      });
      const project = db.listProjects(id)[0];
      const result =
        body.notify === false
          ? { sent: false }
          : await trySend(mail.welcomeClient({ to: email, name: client.contact_name || client.name, projectName: project?.name ?? null, password }));
      return json(res, 200, { password, mail: result });
    }

    case 'POST clients/:id/password': {
      requireOwner(v);
      const account = db.getClientAccount(id);
      if (!account) throw new HttpError(404, 'Ese cliente no tiene cuenta.');
      const password = generatePassword();
      db.setPassword(account.id, await hashPassword(password));
      const result = await trySend(mail.newPassword({ to: account.email, name: account.name, password }));
      return json(res, 200, { password, mail: result });
    }

    // ── Equipo
    case 'GET team':
      requireStaff(v);
      return json(
        res,
        200,
        db.listTeam().map((a) => ({
          id: a.id,
          name: a.name,
          email: a.email,
          active: !!a.active,
          lastLoginAt: a.last_login_at,
        })),
      );

    case 'POST team': {
      requireOwner(v);
      const body = await readJson(req);
      const email = str(body.email, 200).toLowerCase();
      const name = str(body.name, 160);
      if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Correo no válido.');
      if (!name) throw new HttpError(400, 'Falta el nombre.');
      if (email === SUPERADMIN_EMAIL || db.getAccountByEmail(email)) throw new HttpError(409, 'Ese correo ya tiene una cuenta.');
      const password = generatePassword();
      const account = db.createAccount({ email, name, role: 'team', clientId: null, passwordHash: await hashPassword(password) });
      const result = await trySend(mail.welcomeTeam({ to: email, name, password }));
      return json(res, 201, { id: account.id, password, mail: result });
    }

    case 'PATCH team/:id': {
      requireOwner(v);
      const a = db.getAccount(id);
      if (!a || a.role !== 'team') throw new HttpError(404, 'No existe.');
      const body = await readJson(req);
      db.updateAccount(id, {
        name: str(body.name, 160) || undefined,
        active: typeof body.active === 'boolean' ? body.active : undefined,
      });
      return json(res, 200, { ok: true });
    }

    case 'POST team/:id/password': {
      requireOwner(v);
      const a = db.getAccount(id);
      if (!a || a.role !== 'team') throw new HttpError(404, 'No existe.');
      const password = generatePassword();
      db.setPassword(id, await hashPassword(password));
      const result = await trySend(mail.newPassword({ to: a.email, name: a.name, password }));
      return json(res, 200, { password, mail: result });
    }

    case 'DELETE team/:id': {
      requireOwner(v);
      const a = db.getAccount(id);
      if (!a || a.role !== 'team') throw new HttpError(404, 'No existe.');
      db.deleteAccount(id);
      return json(res, 200, { ok: true });
    }

    // ── Propuestas y aprobación (solo administrador)
    case 'GET proposals':
      requireOwner(v);
      return json(res, 200, listProposals().map(proposalView));

    // ── Gestión de propuestas desde partners (la URL pública sigue en propuestas.deersystems.net)
    case 'POST proposals': {
      requireOwner(v);
      const upload = await proposals.readUpload(req, url);
      const created = await proposals.publish(upload, {
        slug: url.searchParams.get('slug') ?? undefined,
        title: url.searchParams.get('title') ?? '',
        by: v.email,
      });
      return json(res, 201, proposalView(created));
    }

    case 'PUT proposals/:id/file': {
      requireOwner(v);
      const current = getProposal(id);
      if (!current) throw new HttpError(404, 'La propuesta no existe.');
      const upload = await proposals.readUpload(req, url);
      const updated = await proposals.replace(current, upload, { by: v.email, note: url.searchParams.get('note') ?? '' });
      return json(res, 200, proposalView(updated));
    }

    case 'PATCH proposals/:id': {
      requireOwner(v);
      const current = getProposal(id);
      if (!current) throw new HttpError(404, 'La propuesta no existe.');
      const body = await readJson(req);
      updateProposal(current.id, {
        title: typeof body.title === 'string' ? body.title.trim().slice(0, 200) : undefined,
        active: typeof body.active === 'boolean' ? body.active : undefined,
      });
      return json(res, 200, proposalView(getProposal(current.id)!));
    }

    case 'DELETE proposals/:id': {
      requireOwner(v);
      const current = getProposal(id);
      if (!current) throw new HttpError(404, 'La propuesta no existe.');
      if (db.projectsForProposal(current.id).length) {
        throw new HttpError(409, 'Esta propuesta ya generó proyectos. Pausa el enlace en lugar de eliminarla, para no perder el historial.');
      }
      await proposals.remove(current);
      return json(res, 200, { ok: true });
    }

    case 'GET proposals/:id/versions': {
      requireOwner(v);
      const current = getProposal(id);
      if (!current) throw new HttpError(404, 'La propuesta no existe.');
      return json(
        res,
        200,
        proposals.listVersions(current.id).map((ver) => ({
          version: ver.version,
          filename: ver.filename,
          size: ver.size,
          note: ver.note,
          createdAt: ver.created_at,
          createdBy: ver.created_by,
          current: ver.version === current.version,
          viewUrl: `/historial/${current.id}/${ver.version}/`,
        })),
      );
    }

    case 'POST proposals/:id/versions/:id/restore': {
      requireOwner(v);
      const current = getProposal(id);
      if (!current) throw new HttpError(404, 'La propuesta no existe.');
      return json(res, 200, proposalView(await proposals.restore(current, Number(parts[3]), v.email)));
    }

    case 'POST proposals/:id/options': {
      requireOwner(v);
      const proposal = getProposal(id);
      if (!proposal) throw new HttpError(404, 'La propuesta no existe.');
      try {
        return json(res, 200, await detectOptions(proposal));
      } catch (err) {
        if (err instanceof ai.AiError) throw new HttpError(502, err.message);
        throw err;
      }
    }

    case 'POST proposals/:id/draft': {
      requireOwner(v);
      const proposal = getProposal(id);
      if (!proposal) throw new HttpError(404, 'La propuesta no existe.');
      const body = await readJson(req);
      const opt = body.option as Record<string, unknown> | null | undefined;
      const approval: Approval = {
        option: opt && str(opt.name, 160) ? { name: str(opt.name, 160), summary: str(opt.summary, 600) } : null,
        notes: str(body.notes, 2000),
      };
      try {
        const result = await extractDraft(proposal, approval);
        // Si el correo de la propuesta ya es de un cliente, se sugiere ese cliente.
        const existing = result.draft.clientEmail ? db.getClientByEmail(result.draft.clientEmail) : undefined;
        return json(res, 200, { ...result, existingClientId: existing?.id ?? null });
      } catch (err) {
        if (err instanceof ai.AiError) throw new HttpError(502, err.message);
        throw err;
      }
    }

    case 'POST proposals/:id/plan': {
      // Ajusta con IA el plan que está en pantalla, antes de crear el proyecto. No guarda nada.
      requireOwner(v);
      if (!getProposal(id)) throw new HttpError(404, 'La propuesta no existe.');
      const body = await readJson(req);
      const instruction = str(body.instruction, 3000);
      if (instruction.length < 5) throw new HttpError(400, 'Escribe qué quieres ajustar del plan.');
      const draft = normalizeDraft((body.plan ?? {}) as Record<string, unknown>);
      if (!draft.phases.length) throw new HttpError(400, 'El plan no tiene fases.');
      try {
        return json(
          res,
          200,
          await adjustPlan({
            plan: { startDate: draft.startDate, endDate: draft.endDate, phases: draft.phases, meetings: draft.meetings },
            instruction,
            projectName: str(body.projectName, 120),
            scope: str(body.scope, 30_000),
          }),
        );
      } catch (err) {
        if (err instanceof ai.AiError) throw new HttpError(502, err.message);
        throw err;
      }
    }

    case 'POST proposals/:id/welcome-preview': {
      // El correo que recibirá el cliente al crear el proyecto, con lo que hay en pantalla.
      requireOwner(v);
      const body = await readJson(req);
      const c = (body.client ?? {}) as Record<string, unknown>;
      const projectName = str(body.projectName, 120) || 'Tu proyecto';
      const existing = Number(c.id) ? db.getClient(Number(c.id)) : db.getClientByEmail(str(c.email, 200).toLowerCase());
      const account = existing ? db.getClientAccount(existing.id) : undefined;
      const mailPreview = account
        ? mail.newProjectForClient({ to: account.email, name: account.name, projectName })
        : mail.welcomeClient({
            to: existing?.email ?? (str(c.email, 200).toLowerCase() || 'cliente@correo.com'),
            name: existing?.contact_name || existing?.name || str(c.contactName, 160) || str(c.name, 160) || 'Cliente',
            projectName,
            password: '(se genera al crear el proyecto)',
          });
      return json(res, 200, { subject: mailPreview.subject, to: mailPreview.to, html: mailPreview.html, kind: account ? 'nuevo_proyecto' : 'bienvenida' });
    }

    case 'POST projects':
      requireOwner(v);
      return json(res, 201, await approve(await readJson(req), v));

    // ── Configuración: IA
    case 'GET settings/ai':
      requireOwner(v);
      return json(res, 200, ai.publicSettings());

    case 'PUT settings/ai':
      requireOwner(v);
      ai.saveSettings(await readJson(req));
      return json(res, 200, ai.publicSettings());

    case 'GET settings/ai/models': {
      requireOwner(v);
      const provider = url.searchParams.get('provider');
      if (provider !== 'gemini' && provider !== 'openrouter') throw new HttpError(400, 'Proveedor no válido.');
      try {
        return json(res, 200, await ai.listModels(provider));
      } catch (err) {
        throw new HttpError(502, (err as Error).message);
      }
    }

    case 'POST settings/ai/test': {
      requireOwner(v);
      const body = await readJson(req);
      const profile = ai.isProfile(body.profile) ? body.profile : 'propuestas';
      const target = ai.parseTarget(body) ?? undefined;
      const privateOnly = typeof body.privateOnly === 'boolean' ? body.privateOnly : undefined;
      try {
        return json(res, 200, { ok: true, ...(await ai.testConnection(profile, target, privateOnly)) });
      } catch (err) {
        return json(res, 200, { ok: false, error: (err as Error).message });
      }
    }

    case 'GET settings/ai/usage': {
      requireOwner(v);
      const now = new Date();
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
      const days30 = new Date(Date.now() - 30 * 86400_000).toISOString();
      const month = db.usageSince(monthStart);
      return json(res, 200, {
        month: {
          rows: month,
          calls: month.reduce((a, r) => a + r.calls, 0),
          costUsd: month.reduce((a, r) => a + (r.cost_usd ?? 0), 0),
          tokens: month.reduce((a, r) => a + (r.input_tokens ?? 0) + (r.output_tokens ?? 0), 0),
        },
        byDay: db.usageByDay(days30),
        recent: db.recentUsage(25),
        budgetUsd: ai.budget(),
        openrouter: await ai.openRouterKeyInfo(),
      });
    }

    // ── Notificaciones (campana del encabezado)
    case 'GET notifications': {
      const r = notifications.recipientOf(v);
      return json(res, 200, {
        unread: db.unreadCount(r),
        items: db.listNotifications(r).map((n) => ({
          id: n.id,
          type: n.type,
          title: n.title,
          body: n.body,
          link: n.link,
          read: !!n.read_at,
          createdAt: n.created_at,
        })),
      });
    }

    case 'POST notifications/read': {
      const body = await readJson(req);
      const ids = Array.isArray(body.ids) ? body.ids.map(Number).filter(Number.isInteger) : undefined;
      const r = notifications.recipientOf(v);
      db.markRead(r, ids);
      return json(res, 200, { unread: db.unreadCount(r) });
    }

    // ── Configuración: avisos
    case 'GET settings/notifications':
      requireOwner(v);
      return json(res, 200, {
        ...notifications.getSettings(),
        catalog: Object.entries(notifications.EVENTS).map(([key, e]) => ({ key, label: e.label, audience: e.audience })),
      });

    case 'PUT settings/notifications':
      requireOwner(v);
      notifications.saveSettings(await readJson(req));
      return json(res, 200, {
        ...notifications.getSettings(),
        catalog: Object.entries(notifications.EVENTS).map(([key, e]) => ({ key, label: e.label, audience: e.audience })),
      });

    // ── Configuración: Google
    case 'GET settings/google':
      requireOwner(v);
      return json(res, 200, { ...google.connectionStatus(), redirectUri: google.REDIRECT_URI, driveFolder: google.driveRoot()?.url ?? null });

    case 'POST settings/google/disconnect':
      requireOwner(v);
      google.disconnect();
      return json(res, 200, google.connectionStatus());

    case 'POST settings/google/test-mail': {
      requireOwner(v);
      const sample = mail.sample();
      const result = await trySend({ ...sample, to: v.email, subject: `[Prueba] ${sample.subject}` });
      if (!result.sent) throw new HttpError(502, result.error ?? 'No se pudo enviar.');
      return json(res, 200, { ok: true, to: v.email });
    }

    case 'GET settings/mail-preview': {
      requireOwner(v);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return void res.end(mail.sample().html);
    }
  }
  if (await handleWork(route, id, req, res, v)) return;
  if (await handleUpdates(route, id, req, res, v)) return;
  if (await handleFiles(route, id, req, res, v, url)) return;
  if (await handleMeetings(route, id, req, res, v, url)) return;
  if (await handlePayments(route, id, req, res, v)) return;
  if (await handleFinance(route, id, req, res, v, url)) return;
  if (await handleBilling(route, id, req, res, v, url)) return;
  if (await handleImport(route, id, req, res, v)) return;
  if (await handleOnlinePayments(route, id, req, res, v)) return;
  throw new HttpError(404, 'Ruta no encontrada.');
}

// ───────── Entrada del subdominio partners ─────────

const APP_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex, nofollow',
  // A otros dominios solo se envía el origen (https://partners.deersystems.net), nunca la ruta. Hace falta:
  // el selector de Drive (Google Picker) valida la clave de API contra ese origen.
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

export async function handlePartners(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const path = url.pathname;
  if (path.startsWith('/auth/')) return handleAuth(req, res, url);
  // Webhook de Wompi: sin sesión ni Origin; lo autentica la firma del evento.
  if (path === '/api/webhooks/wompi' && req.method === 'POST') return handleWompiWebhook(req, res);
  if (path.startsWith('/api/')) return handleApi(req, res, url);
  if (path.startsWith('/historial/')) return handleHistory(req, res, url);
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Método no permitido.');

  // Archivos del build de Vite: nombres con hash, se pueden cachear para siempre.
  if (/^\/assets\/[\w.-]+$/.test(path)) {
    const ok = await sendFile(req, res, join(APP_DIR, path), { 'Cache-Control': 'public, max-age=31536000, immutable' });
    if (ok) return;
    throw new HttpError(404, 'No encontrado.');
  }
  // Cualquier otra ruta la resuelve la app (React) en el navegador.
  const ok = await sendFile(req, res, join(APP_DIR, 'index.html'), APP_HEADERS);
  if (!ok) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Falta compilar la app de partners (npm run build:web).');
  }
}
