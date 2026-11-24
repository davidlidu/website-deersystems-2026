import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { request, type IncomingMessage, type ServerResponse } from 'node:http';
import { PARTNERS_HOST, PARTNERS_URL, PORT } from '../config.ts';
import { db as sqlite } from '../db.ts';
import { HttpError, json, readBody, readJson, redirect } from '../http.ts';
import { clearFailures, clientIp, internalOwnerCookie, rateLimited, readCookies, recordFailure, sessionViewer as viewer, setCookie, type Viewer } from './auth.ts';
import { requireOwner, str } from './common.ts';
import * as db from './db.ts';

/**
 * Servidor MCP: conecta Claude (claude.ai, la app de escritorio, el móvil o Claude Code) con el portal.
 *
 * - Transporte «Streamable HTTP» en POST /mcp, respondiendo JSON (sin flujo SSE).
 * - Acceso con token Bearer: uno personal que creas en Configuración, o uno que se obtiene por OAuth 2.1
 *   (registro dinámico + PKCE) cuando agregas el conector en claude.ai y autorizas con tu cuenta de administrador.
 * - Cada herramienta llama a la misma API del portal como administrador (por la red interna del propio
 *   servidor), así que valida, avisa y anota en la bitácora exactamente igual que la app.
 * - Lectura de todo, y como acciones solo: crear tareas, cambiar estados y campos, y comentar. Nada de borrar
 *   ni de facturación.
 */

const PARTNERS_ORIGIN = new URL(PARTNERS_URL).origin;
const MCP_URL = `${PARTNERS_URL}/mcp`;
const RESOURCE_METADATA = `${PARTNERS_URL}/.well-known/oauth-protected-resource`;
const SCOPE = 'partners';
const ACCESS_SECONDS = 8 * 3600;
const REFRESH_SECONDS = 90 * 24 * 3600;
const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS mcp_clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    redirect_uris TEXT NOT NULL DEFAULT '[]',
    secret_hash TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS mcp_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL CHECK (kind IN ('personal', 'oauth')),
    name TEXT NOT NULL DEFAULT '',
    client_id TEXT REFERENCES mcp_clients(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT,
    refresh_hash TEXT UNIQUE,
    refresh_expires_at TEXT,
    created_at TEXT NOT NULL,
    last_used_at TEXT
  );
  CREATE INDEX IF NOT EXISTS mcp_tokens_client ON mcp_tokens(client_id) WHERE client_id IS NOT NULL;
`);

interface TokenRow {
  id: number;
  kind: 'personal' | 'oauth';
  name: string;
  client_id: string | null;
  token_hash: string;
  expires_at: string | null;
  refresh_hash: string | null;
  refresh_expires_at: string | null;
  created_at: string;
  last_used_at: string | null;
}
interface ClientRow {
  id: string;
  name: string;
  redirect_uris: string;
  secret_hash: string | null;
  created_at: string;
}

const now = () => new Date().toISOString();
const later = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();
const sha = (s: string) => createHash('sha256').update(s).digest('base64url');
const secret = (prefix: string) => `${prefix}_${randomBytes(32).toString('base64url')}`;
const getClient = (id: string) => sqlite.prepare('SELECT * FROM mcp_clients WHERE id = ?').get(id) as unknown as ClientRow | undefined;

/** Borra lo vencido: accesos OAuth sin renovación vigente y registros de clientes que nunca se autorizaron. */
function prune() {
  sqlite.prepare("DELETE FROM mcp_tokens WHERE kind = 'oauth' AND refresh_expires_at < ?").run(now());
  sqlite
    .prepare('DELETE FROM mcp_clients WHERE created_at < ? AND NOT EXISTS (SELECT 1 FROM mcp_tokens t WHERE t.client_id = mcp_clients.id)')
    .run(new Date(Date.now() - 7 * 86400_000).toISOString());
}
prune();

/** Token Bearer válido → su fila (y anota el último uso, como mucho cada 5 minutos). */
function authenticate(req: IncomingMessage): TokenRow | null {
  const m = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization ?? ''));
  if (!m) return null;
  const row = sqlite.prepare('SELECT * FROM mcp_tokens WHERE token_hash = ?').get(sha(m[1])) as unknown as TokenRow | undefined;
  if (!row || (row.expires_at && row.expires_at < now())) return null;
  if (!row.last_used_at || Date.now() - Date.parse(row.last_used_at) > 5 * 60_000) {
    sqlite.prepare('UPDATE mcp_tokens SET last_used_at = ? WHERE id = ?').run(now(), row.id);
  }
  return row;
}

// ───────── Llamadas a la API del portal (como administrador, por la red interna) ─────────

class ToolError extends Error {}

function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const r = request(
      {
        host: '127.0.0.1',
        port: PORT,
        method,
        path: `/api/${path}`,
        timeout: 90_000,
        headers: {
          Host: PARTNERS_HOST,
          Origin: PARTNERS_ORIGIN,
          Cookie: internalOwnerCookie(),
          ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString();
          let out: any = {};
          try {
            out = text ? JSON.parse(text) : {};
          } catch {
            out = { error: text.slice(0, 300) };
          }
          if ((res.statusCode ?? 500) >= 400) reject(new ToolError(out?.error ?? `Error ${res.statusCode}`));
          else resolve(out as T);
        });
      },
    );
    r.on('timeout', () => r.destroy(new ToolError('El portal tardó demasiado en responder.')));
    r.on('error', reject);
    r.end(data);
  });
}

// ───────── Herramientas ─────────

type Args = Record<string, unknown>;
interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  write?: boolean;
  run: (a: Args) => Promise<unknown>;
}

const num = (v: unknown, name: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ToolError(`Falta ${name} (un número).`);
  return n;
};
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const DATE = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'AAAA-MM-DD' };
const STATUS = { type: 'string', enum: [...db.TASK_STATUSES] };
const SIDE = { type: 'string', enum: ['deersystems', 'cliente'] };
const schema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });

/** Tarea compacta: lo que sirve para razonar sobre ella, sin banderas de la interfaz. */
function task(t: any, phases?: Map<number, string>) {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    side: t.side,
    assignee: t.assigneeName,
    phase: t.phaseId && phases ? phases.get(t.phaseId) : undefined,
    startDate: t.startDate,
    dueDate: t.dueDate,
    completedAt: t.completedAt,
    meeting: t.isMeeting,
    clientDelivery: t.clientDelivery,
    revisionRound: t.revisionRound || undefined,
    approvedBy: t.approvedBy,
    comments: t.comments || undefined,
    files: t.files || undefined,
    projectId: t.projectId,
  };
}

const note = (n: any) => ({ id: n.id, taskId: n.taskId, kind: n.kind, visibility: n.visibility, author: n.authorName, createdAt: n.createdAt, body: n.body });

const meetingRow = (m: any) => ({
  id: m.id,
  title: m.title,
  startAt: m.startAt,
  status: m.status,
  tentative: m.tentative,
  kind: m.kind,
  projectId: m.projectId,
  project: m.projectName,
  client: m.clientName,
  meetUrl: m.meetUrl,
  summary: typeof m.summary === 'string' ? m.summary.slice(0, 600) : undefined,
});

const projectOfTask = (taskId: number) => {
  const t = db.getTask(taskId);
  if (!t) throw new ToolError('La tarea no existe.');
  return t.project_id;
};

const TOOLS: Tool[] = [
  {
    name: 'list_projects',
    title: 'Listar proyectos',
    description: 'Proyectos con su cliente, estado, fechas y avance (tareas completadas / total). Por defecto solo los que no están finalizados.',
    inputSchema: schema({
      status: { type: 'string', enum: ['activo', 'pausado', 'finalizado', 'todos'], description: 'Por defecto: activos y en pausa.' },
      client: { type: 'string', description: 'Filtra por nombre de cliente (contiene).' },
    }),
    run: async (a) => {
      const list = await api<any[]>('GET', 'projects');
      const q = text(a.client).toLowerCase();
      return list
        .filter((p) => (a.status === 'todos' ? true : a.status ? p.status === a.status : p.status !== 'finalizado'))
        .filter((p) => !q || String(p.clientName).toLowerCase().includes(q))
        .map((p) => ({ id: p.id, name: p.name, clientId: p.clientId, client: p.clientName, status: p.status, startDate: p.startDate, endDate: p.endDate, progress: p.progress }));
    },
  },
  {
    name: 'list_clients',
    title: 'Listar clientes',
    description: 'Clientes con su contacto y cuántos proyectos tienen (activos y en total).',
    inputSchema: schema({ search: { type: 'string', description: 'Filtra por nombre o contacto (contiene).' } }),
    run: async (a) => {
      const q = text(a.search).toLowerCase();
      return (await api<any[]>('GET', 'clients'))
        .filter((c) => !q || `${c.name} ${c.contact_name}`.toLowerCase().includes(q))
        .map((c) => ({ id: c.id, name: c.name, contact: c.contact_name, email: c.email, phone: c.phone, city: c.city, projects: c.projects, activeProjects: c.active_projects, lastLogin: c.last_login_at }));
    },
  },
  {
    name: 'get_project',
    title: 'Ver proyecto',
    description: 'Detalle de un proyecto: alcance aprobado, fases, todas sus tareas (estado, responsable, fechas, si es entrega al cliente y rondas de ajustes) y avance.',
    inputSchema: schema({ projectId: { type: 'integer' }, includeScope: { type: 'boolean', description: 'Incluir el texto del alcance (largo). Por defecto sí.' } }, ['projectId']),
    run: async (a) => {
      const p = await api<any>('GET', `projects/${num(a.projectId, 'projectId')}`);
      const phases = new Map<number, string>(p.phases.map((ph: any) => [ph.id, ph.name]));
      return {
        id: p.id,
        name: p.name,
        client: p.clientName,
        clientId: p.clientId,
        status: p.status,
        startDate: p.startDate,
        endDate: p.endDate,
        approvedOption: p.approvedOption,
        approvalNotes: p.approvalNotes,
        progress: p.progress,
        revisionsIncluded: p.revisionsIncluded,
        phases: p.phases,
        tasks: p.tasks.map((t: any) => task(t, phases)),
        ...(a.includeScope === false ? {} : { scope: p.scope }),
      };
    },
  },
  {
    name: 'search_tasks',
    title: 'Buscar tareas',
    description:
      'Tareas de todos los proyectos no finalizados (o de uno), con filtros. Útil para «qué vence esta semana», «qué está bloqueado» o «qué tiene pendiente el cliente».',
    inputSchema: schema({
      projectId: { type: 'integer' },
      status: { type: 'array', items: STATUS, description: 'Uno o varios estados.' },
      side: SIDE,
      assigneeId: { type: 'integer', description: 'Persona del equipo (ver list_team).' },
      dueFrom: DATE,
      dueTo: DATE,
      search: { type: 'string', description: 'Texto en el título o la descripción.' },
      onlyDeliveries: { type: 'boolean', description: 'Solo entregas al cliente.' },
      includeFinished: { type: 'boolean', description: 'Incluir proyectos finalizados.' },
      limit: { type: 'integer', description: 'Máximo de resultados (por defecto 100).' },
    }),
    run: async (a) => {
      const d = await api<any>('GET', `deliveries${a.includeFinished ? '?all=1' : ''}`);
      const projects = new Map<number, string>(d.projects.map((p: any) => [p.id, `${p.name} · ${p.clientName}`]));
      const phases = new Map<number, string>(d.projects.flatMap((p: any) => p.phases.map((ph: any) => [ph.id, ph.name])));
      const statuses = Array.isArray(a.status) ? (a.status as string[]) : null;
      const q = text(a.search).toLowerCase();
      const out = (d.tasks as any[])
        .filter((t) => !a.projectId || t.projectId === Number(a.projectId))
        .filter((t) => !statuses?.length || statuses.includes(t.status))
        .filter((t) => !a.side || t.side === a.side)
        .filter((t) => !a.assigneeId || t.assigneeId === Number(a.assigneeId))
        .filter((t) => !a.dueFrom || (t.dueDate && t.dueDate >= String(a.dueFrom)))
        .filter((t) => !a.dueTo || (t.dueDate && t.dueDate <= String(a.dueTo)))
        .filter((t) => !a.onlyDeliveries || t.clientDelivery)
        .filter((t) => !q || `${t.title} ${t.description}`.toLowerCase().includes(q))
        .sort((x, y) => String(x.dueDate ?? '9999').localeCompare(String(y.dueDate ?? '9999')));
      const limit = Math.min(Math.max(Number(a.limit) || 100, 1), 500);
      return { total: out.length, tasks: out.slice(0, limit).map((t) => ({ ...task(t, phases), project: projects.get(t.projectId) })) };
    },
  },
  {
    name: 'get_task',
    title: 'Ver tarea',
    description: 'Una tarea con su descripción completa y sus comentarios (compartidos con el cliente e internos).',
    inputSchema: schema({ taskId: { type: 'integer' } }, ['taskId']),
    run: async (a) => {
      const id = num(a.taskId, 'taskId');
      const pid = projectOfTask(id);
      const [p, notes] = await Promise.all([api<any>('GET', `projects/${pid}`), api<any[]>('GET', `projects/${pid}/notes?taskId=${id}`)]);
      const t = p.tasks.find((x: any) => x.id === id);
      if (!t) throw new ToolError('La tarea no existe.');
      const phases = new Map<number, string>(p.phases.map((ph: any) => [ph.id, ph.name]));
      return { ...task(t, phases), description: t.description, project: p.name, projectId: p.id, client: p.clientName, comments: notes.map(note) };
    },
  },
  {
    name: 'list_updates',
    title: 'Ver avances y notas',
    description: 'Avances publicados (kind=avance) o notas del proyecto (kind=nota), del más reciente al más antiguo.',
    inputSchema: schema({ projectId: { type: 'integer' }, kind: { type: 'string', enum: ['avance', 'nota'] }, limit: { type: 'integer' } }, ['projectId']),
    run: async (a) => {
      const kind = a.kind === 'nota' ? 'nota' : 'avance';
      const list = await api<any[]>('GET', `projects/${num(a.projectId, 'projectId')}/notes?kind=${kind}`);
      return list.slice(0, Math.min(Number(a.limit) || 20, 100)).map(note);
    },
  },
  {
    name: 'get_activity',
    title: 'Ver bitácora',
    description: 'Bitácora técnica del proyecto: quién hizo qué y cuándo (cambios de estado, tareas creadas, ajustes, reuniones…).',
    inputSchema: schema({ projectId: { type: 'integer' }, limit: { type: 'integer' } }, ['projectId']),
    run: async (a) => {
      const r = await api<any>('GET', `projects/${num(a.projectId, 'projectId')}/activity`);
      const items: any[] = Array.isArray(r) ? r : (r.items ?? []);
      return items.slice(0, Math.min(Number(a.limit) || 40, 200));
    },
  },
  {
    name: 'list_meetings',
    title: 'Listar reuniones',
    description: 'Reuniones (de un proyecto o todas), con fecha, estado y un extracto del resumen.',
    inputSchema: schema({ projectId: { type: 'integer' }, from: DATE, to: DATE, limit: { type: 'integer' } }),
    run: async (a) => {
      const list: any[] = a.projectId ? await api<any[]>('GET', `projects/${num(a.projectId, 'projectId')}/meetings`) : (await api<any>('GET', 'meetings')).items;
      return list
        .filter((m) => !a.from || String(m.startAt).slice(0, 10) >= String(a.from))
        .filter((m) => !a.to || String(m.startAt).slice(0, 10) <= String(a.to))
        .slice(0, Math.min(Number(a.limit) || 30, 300))
        .map(meetingRow);
    },
  },
  {
    name: 'get_meeting',
    title: 'Ver reunión',
    description: 'Una reunión: asistentes, resumen, acuerdos, tareas y ajustes propuestos, y opcionalmente la transcripción.',
    inputSchema: schema({ meetingId: { type: 'integer' }, includeTranscript: { type: 'boolean' } }, ['meetingId']),
    run: async (a) => {
      const m = await api<any>('GET', `meetings/${num(a.meetingId, 'meetingId')}${a.includeTranscript ? '?transcript=1' : ''}`);
      return {
        ...meetingRow(m),
        endAt: m.endAt,
        summary: m.summary,
        attendees: m.attendees,
        agreements: m.agreements,
        taskIds: m.taskIds,
        proposedTasks: m.proposedTasks,
        proposedChanges: m.proposedChanges,
        ...(a.includeTranscript ? { transcript: typeof m.transcript === 'string' ? m.transcript.slice(0, 60_000) : null } : {}),
      };
    },
  },
  {
    name: 'get_payments',
    title: 'Ver pagos del proyecto',
    description: 'Pagos pactados del proyecto: concepto, valor, fecha y si ya se pagó. Solo lectura.',
    inputSchema: schema({ projectId: { type: 'integer' } }, ['projectId']),
    run: async (a) => (await api<any>('GET', `projects/${num(a.projectId, 'projectId')}/payments`)).payments,
  },
  {
    name: 'get_client_statement',
    title: 'Estado de cuenta',
    description: 'Estado de cuenta de un cliente: totales, cuentas de cobro y abonos. Solo lectura.',
    inputSchema: schema({ clientId: { type: 'integer' } }, ['clientId']),
    run: async (a) => api('GET', `clients/${num(a.clientId, 'clientId')}/statement`),
  },
  {
    name: 'list_team',
    title: 'Ver equipo',
    description: 'Personas del equipo de DeerSystems (para asignar tareas por id).',
    inputSchema: schema({}),
    run: async () => (await api<any[]>('GET', 'team')).map((m) => ({ id: m.id, name: m.name, email: m.email, active: m.active })),
  },

  // ── Acciones
  {
    name: 'create_task',
    title: 'Crear tarea',
    write: true,
    description:
      'Crea una tarea en un proyecto. Si es del cliente (side=cliente), al cliente le llega el aviso; si tiene responsable, a esa persona también. clientDelivery=true la marca como entrega que el cliente revisa y aprueba.',
    inputSchema: schema(
      {
        projectId: { type: 'integer' },
        title: { type: 'string' },
        description: { type: 'string' },
        side: { ...SIDE, description: 'De quién es. Por defecto deersystems.' },
        phaseId: { type: 'integer', description: 'Fase del proyecto (ver get_project).' },
        assigneeId: { type: 'integer', description: 'Persona del equipo (ver list_team).' },
        startDate: DATE,
        dueDate: DATE,
        clientDelivery: { type: 'boolean' },
      },
      ['projectId', 'title'],
    ),
    run: async (a) => {
      const body: Args = { title: text(a.title) };
      for (const k of ['description', 'side', 'phaseId', 'assigneeId', 'startDate', 'dueDate', 'clientDelivery']) if (a[k] !== undefined) body[k] = a[k];
      const r = await api<any>('POST', `projects/${num(a.projectId, 'projectId')}/tasks`, body);
      return { created: task(r.task), progress: r.progress, url: `${PARTNERS_URL}/proyectos/${a.projectId}?tarea=${r.task.id}` };
    },
  },
  {
    name: 'update_task',
    title: 'Actualizar tarea',
    write: true,
    description:
      'Cambia el estado o los datos de una tarea. Pasar una entrega al cliente a en_revision le avisa al cliente para que la revise. Solo manda los campos que cambian.',
    inputSchema: schema(
      {
        taskId: { type: 'integer' },
        status: STATUS,
        title: { type: 'string' },
        description: { type: 'string' },
        side: SIDE,
        assigneeId: { type: ['integer', 'null'], description: 'null = sin responsable.' },
        phaseId: { type: 'integer' },
        startDate: { ...DATE, type: ['string', 'null'] },
        dueDate: { ...DATE, type: ['string', 'null'] },
        clientDelivery: { type: 'boolean' },
      },
      ['taskId'],
    ),
    run: async (a) => {
      const id = num(a.taskId, 'taskId');
      const body: Args = {};
      for (const k of ['status', 'title', 'description', 'side', 'assigneeId', 'phaseId', 'startDate', 'dueDate', 'clientDelivery']) if (a[k] !== undefined) body[k] = a[k];
      if (!Object.keys(body).length) throw new ToolError('No indicaste nada que cambiar.');
      const r = await api<any>('PATCH', `tasks/${id}`, body);
      return { updated: task(r.task ?? r), progress: r.progress };
    },
  },
  {
    name: 'add_comment',
    title: 'Comentar',
    write: true,
    description:
      'Deja un comentario en una tarea (taskId) o una nota en el proyecto (projectId). Por defecto es interno (solo el equipo). Con shared=true lo ve el cliente y le llega el aviso: úsalo solo si te lo piden.',
    inputSchema: schema({ taskId: { type: 'integer' }, projectId: { type: 'integer' }, body: { type: 'string', description: 'Texto (admite Markdown).' }, shared: { type: 'boolean' } }, ['body']),
    run: async (a) => {
      const body = text(a.body);
      if (!body) throw new ToolError('Escribe el comentario.');
      const taskId = a.taskId ? num(a.taskId, 'taskId') : null;
      const projectId = taskId ? projectOfTask(taskId) : num(a.projectId, 'projectId o taskId');
      const n = await api<any>('POST', `projects/${projectId}/notes`, { body, kind: 'nota', visibility: a.shared === true ? 'shared' : 'internal', ...(taskId ? { taskId } : {}) });
      return { created: note(n) };
    },
  },
];

const INSTRUCTIONS = `Portal de clientes de DeerSystems (agencia de software): clientes, proyectos con fases y tareas, reuniones, avances y pagos.
- Estados de tarea: pendiente, en_progreso, en_revision, bloqueada, completada. «side» dice de quién es la tarea: deersystems (el equipo) o cliente.
- Una «entrega al cliente» (clientDelivery) la revisa el cliente: la aprueba o pide ajustes; cada pedido es una ronda (revisionRound).
- Fechas AAAA-MM-DD, zona horaria de Bogotá. Para ids de proyecto, cliente, tarea o persona usa list_projects, list_clients, search_tasks y list_team.
- Las acciones quedan en la bitácora a nombre de DeerSystems y disparan los mismos avisos que en la app. Los comentarios son internos salvo que pidan compartirlos con el cliente.`;

function toolList() {
  return TOOLS.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: t.write
      ? { title: t.title, readOnlyHint: false, destructiveHint: false, idempotentHint: t.name === 'update_task', openWorldHint: false }
      : { title: t.title, readOnlyHint: true, openWorldHint: false },
  }));
}

/** Sin nulos, vacíos ni falsos: menos ruido para el modelo. */
const compact = (value: unknown) =>
  JSON.stringify(value, (k, v) => (k !== '' && (v === null || v === undefined || v === '' || v === false || (Array.isArray(v) && v.length === 0)) ? undefined : v));

async function callTool(name: string, args: Args) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { content: [{ type: 'text', text: `No existe la herramienta «${name}».` }], isError: true };
  try {
    const out = await tool.run(args ?? {});
    return { content: [{ type: 'text', text: compact(out) ?? 'null' }] };
  } catch (err) {
    if (err instanceof ToolError) return { content: [{ type: 'text', text: err.message }], isError: true };
    console.error(`[mcp] ${name}:`, (err as Error).message);
    return { content: [{ type: 'text', text: 'Error interno del portal.' }], isError: true };
  }
}

// ───────── JSON-RPC ─────────

interface Rpc {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, any>;
}

async function rpc(msg: Rpc): Promise<object | null> {
  const isRequest = msg.id !== undefined && msg.id !== null;
  const ok = (result: unknown) => ({ jsonrpc: '2.0', id: msg.id, result });
  const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id: msg.id ?? null, error: { code, message } });
  if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(-32600, 'Solicitud no válida.');
  if (!isRequest) return null; // notificaciones (initialized, cancelled…): no llevan respuesta
  switch (msg.method) {
    case 'initialize': {
      const asked = String(msg.params?.protocolVersion ?? '');
      return ok({
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'deersystems-partners', title: 'DeerSystems Partners', version: '1.0.0' },
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({ tools: toolList() });
    case 'tools/call':
      return ok(await callTool(String(msg.params?.name ?? ''), (msg.params?.arguments ?? {}) as Args));
    case 'resources/list':
      return ok({ resources: [] });
    case 'prompts/list':
      return ok({ prompts: [] });
  }
  return fail(-32601, `Método no soportado: ${msg.method}`);
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id',
  'Access-Control-Max-Age': '86400',
};
const cors = (res: ServerResponse) => Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

function unauthorized(res: ServerResponse, error?: string) {
  res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${RESOURCE_METADATA}"${error ? `, error="${error}"` : ''}`);
  json(res, 401, { error: 'Falta un token válido. Conecta Claude desde Configuración → Claude (MCP).' });
}

async function handleMcpEndpoint(req: IncomingMessage, res: ServerResponse) {
  cors(res);
  // Solo POST: no hay flujo de eventos del servidor (GET) ni sesiones que cerrar (DELETE).
  if (req.method !== 'POST') {
    res.writeHead(405, { Allow: 'POST', ...CORS });
    return void res.end();
  }
  const ip = `mcp:${clientIp(req)}`;
  if (rateLimited(ip)) throw new HttpError(429, 'Demasiados intentos. Espera unos minutos.');
  const token = authenticate(req);
  if (!token) {
    if (req.headers.authorization) recordFailure(ip);
    return unauthorized(res, req.headers.authorization ? 'invalid_token' : undefined);
  }
  clearFailures(ip);
  let body: unknown;
  try {
    body = JSON.parse((await readBody(req, 1024 * 1024)).toString());
  } catch {
    return json(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'JSON no válido.' } });
  }
  const batch = Array.isArray(body);
  const messages: unknown[] = batch ? (body as unknown[]) : [body];
  const replies = (await Promise.all(messages.map((m) => rpc((m ?? {}) as Rpc)))).filter((r) => r !== null);
  if (!replies.length) {
    res.writeHead(202, CORS);
    return void res.end();
  }
  json(res, 200, batch ? replies : replies[0]);
}

// ───────── OAuth 2.1 (para agregar el conector en claude.ai) ─────────

interface Code {
  clientId: string;
  redirectUri: string;
  challenge: string;
  exp: number;
}
const codes = new Map<string, Code>();
const NEXT_COOKIE = 'dp_next';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Destino válido para volver al terminar: https, o http solo en la máquina local (Claude Code). */
function okRedirect(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    return u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname));
  } catch {
    return false;
  }
}

function metadata() {
  return {
    issuer: PARTNERS_URL,
    authorization_endpoint: `${PARTNERS_URL}/oauth/authorize`,
    token_endpoint: `${PARTNERS_URL}/oauth/token`,
    registration_endpoint: `${PARTNERS_URL}/oauth/register`,
    revocation_endpoint: `${PARTNERS_URL}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    scopes_supported: [SCOPE],
  };
}

function page(res: ServerResponse, title: string, inner: string, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https: http://localhost:* http://127.0.0.1:*; base-uri 'none'",
  });
  res.end(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · DeerSystems Partners</title>
<style>
:root{color-scheme:light dark;--bg:#0c0f0d;--card:#151a17;--line:#2a322d;--fg:#e9efe9;--muted:#9aa69d;--accent:#00b4d8}
@media (prefers-color-scheme:light){:root{--bg:#f4f6f3;--card:#fff;--line:#dfe5df;--fg:#16201a;--muted:#5d6b61;--accent:#00a3c4}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;padding:16px}
.card{width:100%;max-width:440px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:28px}
h1{font-size:20px;margin:0 0 6px}p{margin:8px 0;color:var(--muted)}strong{color:var(--fg)}
ul{margin:12px 0 4px;padding-left:18px;color:var(--muted)}li{margin:4px 0}
.row{display:flex;gap:10px;margin-top:22px}button,a.btn{flex:1;border-radius:9px;padding:11px 14px;font:inherit;font-weight:600;cursor:pointer;text-align:center;text-decoration:none}
.primary{background:var(--accent);color:#0c0f0d;border:0}.outline{background:none;color:var(--fg);border:1px solid var(--line)}
.eyebrow{font:12px ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--accent)}
</style></head><body><main class="card"><div class="eyebrow">DeerSystems Partners</div>${inner}</main></body></html>`);
}

function backTo(uri: string, params: Record<string, string>) {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  return u.toString();
}

/** Lee el cuerpo de /oauth/token y /oauth/revoke: formulario (lo normal) o JSON. */
async function readForm(req: IncomingMessage): Promise<Record<string, string>> {
  const raw = (await readBody(req, 16 * 1024)).toString();
  if (String(req.headers['content-type'] ?? '').includes('json')) {
    try {
      const o = JSON.parse(raw);
      return Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k, String(v)]));
    } catch {
      return {};
    }
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

const oauthError = (res: ServerResponse, error: string, description: string, status = 400) => json(res, status, { error, error_description: description });

/** Credenciales del cliente en el pedido de token: id (y secreto, si se registró con uno). */
function clientFrom(req: IncomingMessage, form: Record<string, string>): ClientRow | null {
  let id = form.client_id;
  let given = form.client_secret;
  const basic = /^Basic\s+(\S+)$/i.exec(String(req.headers.authorization ?? ''));
  if (basic) {
    const [u, p] = Buffer.from(basic[1], 'base64').toString().split(':');
    id = decodeURIComponent(u ?? '');
    given = decodeURIComponent(p ?? '');
  }
  const client = id ? getClient(id) : undefined;
  if (!client) return null;
  if (client.secret_hash) {
    if (!given) return null;
    const a = Buffer.from(sha(given));
    const b = Buffer.from(client.secret_hash);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  }
  return client;
}

function issue(res: ServerResponse, grant: { id?: number; clientId: string; name: string }) {
  const access = secret('dsp');
  const refresh = secret('dspr');
  if (grant.id) {
    sqlite
      .prepare('UPDATE mcp_tokens SET token_hash = ?, expires_at = ?, refresh_hash = ?, refresh_expires_at = ? WHERE id = ?')
      .run(sha(access), later(ACCESS_SECONDS), sha(refresh), later(REFRESH_SECONDS), grant.id);
  } else {
    sqlite
      .prepare(
        "INSERT INTO mcp_tokens (kind, name, client_id, token_hash, expires_at, refresh_hash, refresh_expires_at, created_at) VALUES ('oauth', ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(grant.name, grant.clientId, sha(access), later(ACCESS_SECONDS), sha(refresh), later(REFRESH_SECONDS), now());
  }
  res.setHeader('Pragma', 'no-cache');
  json(res, 200, { access_token: access, token_type: 'Bearer', expires_in: ACCESS_SECONDS, refresh_token: refresh, scope: SCOPE });
}

/** Al volver del login con Google: si se venía de autorizar a Claude, se regresa a esa pantalla. */
export function takeNext(req: IncomingMessage, res: ServerResponse): string | null {
  const next = decodeURIComponent(readCookies(req)[NEXT_COOKIE] ?? '');
  if (!next) return null;
  setCookie(res, NEXT_COOKIE, '', 0);
  return next.startsWith('/oauth/authorize?') ? next : null;
}

function authorizeParams(p: URLSearchParams | Record<string, string>) {
  const get = (k: string) => (p instanceof URLSearchParams ? p.get(k) : p[k]) ?? '';
  return {
    clientId: get('client_id'),
    redirectUri: get('redirect_uri'),
    state: get('state'),
    challenge: get('code_challenge'),
    method: get('code_challenge_method'),
    responseType: get('response_type'),
  };
}

/** Valida el pedido de autorización. Si el destino no es confiable, no se redirige allí: se muestra el error. */
function checkAuthorize(res: ServerResponse, q: ReturnType<typeof authorizeParams>): ClientRow | null {
  const client = getClient(q.clientId);
  const uris: string[] = client ? JSON.parse(client.redirect_uris) : [];
  if (!client || !uris.includes(q.redirectUri)) {
    page(res, 'Enlace no válido', '<h1>Enlace no válido</h1><p>Esta solicitud de conexión no es válida o venció. Vuelve a agregar el conector desde Claude.</p>', 400);
    return null;
  }
  if (q.responseType !== 'code' || !q.challenge || q.method !== 'S256') {
    redirect(res, backTo(q.redirectUri, { error: 'invalid_request', error_description: 'Se requiere PKCE (S256).', state: q.state }));
    return null;
  }
  return client;
}

/** Rutas públicas del MCP y de OAuth. Devuelve false si la ruta no es de aquí. */
export async function handleMcpHttp(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const isOAuth = path.startsWith('/oauth/') || path.startsWith('/.well-known/');
  if (path !== '/mcp' && !isOAuth) return false;

  // Preflight del navegador (inspectores MCP, clientes web). La autorización con la pantalla no lo necesita.
  if (req.method === 'OPTIONS' && path !== '/oauth/authorize') {
    res.writeHead(204, CORS);
    res.end();
    return true;
  }
  if (path === '/mcp') {
    await handleMcpEndpoint(req, res);
    return true;
  }

  if (path.startsWith('/.well-known/oauth-protected-resource')) {
    cors(res);
    json(res, 200, { resource: MCP_URL, authorization_servers: [PARTNERS_URL], bearer_methods_supported: ['header'], scopes_supported: [SCOPE], resource_name: 'DeerSystems Partners' });
    return true;
  }
  if (path.startsWith('/.well-known/oauth-authorization-server') || path.startsWith('/.well-known/openid-configuration')) {
    cors(res);
    json(res, 200, metadata());
    return true;
  }

  // Registro dinámico de clientes (RFC 7591): claude.ai se registra solo la primera vez.
  if (path === '/oauth/register' && req.method === 'POST') {
    cors(res);
    const key = `mcp-register:${clientIp(req)}`;
    if (rateLimited(key)) return oauthError(res, 'too_many_requests', 'Demasiados registros. Espera unos minutos.', 429), true;
    recordFailure(key); // cuenta todos los registros: máximo 8 cada 15 minutos por IP
    const body = await readJson(req, 16 * 1024).catch(() => ({}) as Record<string, unknown>);
    const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : [];
    if (!uris.length || uris.length > 10 || !uris.every(okRedirect)) {
      oauthError(res, 'invalid_redirect_uri', 'Las direcciones de regreso deben ser https (o http en localhost).');
      return true;
    }
    const method = ['client_secret_post', 'client_secret_basic'].includes(String(body.token_endpoint_auth_method)) ? String(body.token_endpoint_auth_method) : 'none';
    const id = `dsc_${randomBytes(16).toString('base64url')}`;
    const clientSecret = method === 'none' ? null : secret('dscs');
    const name = str(body.client_name, 80) || 'Claude';
    sqlite
      .prepare('INSERT INTO mcp_clients (id, name, redirect_uris, secret_hash, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, name, JSON.stringify(uris), clientSecret ? sha(clientSecret) : null, now());
    json(res, 201, {
      client_id: id,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      ...(clientSecret ? { client_secret: clientSecret, client_secret_expires_at: 0 } : {}),
      client_name: name,
      redirect_uris: uris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: method,
      scope: SCOPE,
    });
    return true;
  }

  // Pantalla de autorización: entras como administrador y apruebas la conexión.
  if (path === '/oauth/authorize' && req.method === 'GET') {
    const q = authorizeParams(url.searchParams);
    const client = checkAuthorize(res, q);
    if (!client) return true;
    const v = viewer(req);
    if (!v) {
      setCookie(res, NEXT_COOKIE, encodeURIComponent(`${url.pathname}${url.search}`), 900);
      redirect(res, '/login');
      return true;
    }
    if (v.kind !== 'owner') {
      page(res, 'Sin permiso', '<h1>Solo el administrador</h1><p>Conectar Claude al portal solo lo puede autorizar la cuenta de administrador de DeerSystems.</p>', 403);
      return true;
    }
    const host = new URL(q.redirectUri).host;
    const hidden = Object.entries({ client_id: q.clientId, redirect_uri: q.redirectUri, state: q.state, code_challenge: q.challenge, code_challenge_method: q.method, response_type: q.responseType })
      .map(([k, val]) => `<input type="hidden" name="${k}" value="${esc(val)}">`)
      .join('');
    page(
      res,
      'Conectar Claude',
      `<h1>Conectar «${esc(client.name)}»</h1>
<p>Va a acceder a DeerSystems Partners como <strong>${esc(v.email)}</strong> y volverá a <strong>${esc(host)}</strong>.</p>
<ul><li>Ver clientes, proyectos, tareas, reuniones, avances y pagos.</li><li>Crear tareas, cambiar su estado y datos, y comentar.</li><li>No puede borrar nada ni tocar la facturación.</li></ul>
<p>Puedes desconectarlo cuando quieras en Configuración → Claude (MCP).</p>
<form method="post" action="/oauth/authorize">${hidden}<div class="row">
<button class="outline" name="decision" value="deny">Cancelar</button><button class="primary" name="decision" value="allow" autofocus>Permitir</button></div></form>`,
    );
    return true;
  }

  if (path === '/oauth/authorize' && req.method === 'POST') {
    if (req.headers.origin !== PARTNERS_ORIGIN) throw new HttpError(403, 'Origen no permitido.');
    const form = await readForm(req);
    const q = authorizeParams(form);
    const client = checkAuthorize(res, q);
    if (!client) return true;
    if (viewer(req)?.kind !== 'owner') throw new HttpError(403, 'Solo el administrador puede autorizar.');
    if (form.decision !== 'allow') {
      redirect(res, backTo(q.redirectUri, { error: 'access_denied', state: q.state }));
      return true;
    }
    for (const [k, c] of codes) if (c.exp < Date.now()) codes.delete(k);
    const code = randomBytes(32).toString('base64url');
    codes.set(sha(code), { clientId: client.id, redirectUri: q.redirectUri, challenge: q.challenge, exp: Date.now() + 5 * 60_000 });
    redirect(res, backTo(q.redirectUri, { code, state: q.state }));
    return true;
  }

  if (path === '/oauth/token' && req.method === 'POST') {
    cors(res);
    res.setHeader('Cache-Control', 'no-store');
    const form = await readForm(req);
    const client = clientFrom(req, form);
    if (!client) return oauthError(res, 'invalid_client', 'Cliente no reconocido.', 401), true;

    if (form.grant_type === 'authorization_code') {
      const key = sha(form.code ?? '');
      const c = codes.get(key);
      codes.delete(key); // de un solo uso
      if (!c || c.exp < Date.now() || c.clientId !== client.id || c.redirectUri !== form.redirect_uri) {
        return oauthError(res, 'invalid_grant', 'El código venció o no es válido.'), true;
      }
      if (!form.code_verifier || sha(form.code_verifier) !== c.challenge) return oauthError(res, 'invalid_grant', 'La verificación PKCE no coincide.'), true;
      // Volver a conectar el mismo cliente reemplaza su conexión anterior (no se acumulan).
      sqlite.prepare("DELETE FROM mcp_tokens WHERE kind = 'oauth' AND client_id = ?").run(client.id);
      issue(res, { clientId: client.id, name: client.name });
      return true;
    }
    if (form.grant_type === 'refresh_token') {
      const row = sqlite.prepare('SELECT * FROM mcp_tokens WHERE refresh_hash = ?').get(sha(form.refresh_token ?? '')) as unknown as TokenRow | undefined;
      if (!row || row.client_id !== client.id || !row.refresh_expires_at || row.refresh_expires_at < now()) {
        return oauthError(res, 'invalid_grant', 'La sesión venció. Vuelve a conectar.'), true;
      }
      issue(res, { id: row.id, clientId: client.id, name: row.name });
      return true;
    }
    return oauthError(res, 'unsupported_grant_type', 'Tipo de permiso no soportado.'), true;
  }

  if (path === '/oauth/revoke' && req.method === 'POST') {
    cors(res);
    const form = await readForm(req);
    const h = sha(form.token ?? '');
    sqlite.prepare("DELETE FROM mcp_tokens WHERE kind = 'oauth' AND (token_hash = ? OR refresh_hash = ?)").run(h, h);
    res.writeHead(200);
    res.end();
    return true;
  }

  throw new HttpError(404, 'Ruta no encontrada.');
}

// ───────── Configuración → Claude (MCP) ─────────

function connections() {
  prune();
  const rows = sqlite.prepare('SELECT * FROM mcp_tokens ORDER BY created_at DESC').all() as unknown as TokenRow[];
  return {
    url: MCP_URL,
    connections: rows.map((r) => ({ id: r.id, kind: r.kind, name: r.name, createdAt: r.created_at, lastUsedAt: r.last_used_at })),
  };
}

export async function handleMcpSettings(route: string, id: number, req: IncomingMessage, res: ServerResponse, v: Viewer): Promise<boolean> {
  switch (route) {
    case 'GET settings/mcp':
      requireOwner(v);
      json(res, 200, connections());
      return true;

    // Token personal para Claude Code o la app de escritorio: se muestra una sola vez.
    case 'POST settings/mcp/tokens': {
      requireOwner(v);
      const body = await readJson(req);
      const name = str(body.name, 60) || 'Token personal';
      if ((sqlite.prepare("SELECT COUNT(*) AS n FROM mcp_tokens WHERE kind = 'personal'").get() as { n: number }).n >= 20) {
        throw new HttpError(400, 'Ya tienes 20 tokens. Revoca alguno que no uses.');
      }
      const token = secret('dsp');
      sqlite.prepare("INSERT INTO mcp_tokens (kind, name, token_hash, created_at) VALUES ('personal', ?, ?, ?)").run(name, sha(token), now());
      json(res, 201, { token, ...connections() });
      return true;
    }

    case 'DELETE settings/mcp/connections/:id': {
      requireOwner(v);
      sqlite.prepare('DELETE FROM mcp_tokens WHERE id = ?').run(id);
      json(res, 200, connections());
      return true;
    }
  }
  return false;
}
