import { db } from '../db.ts';

/** Estados fijos de una tarea, en el orden en que avanza. */
export const TASK_STATUSES = ['pendiente', 'en_progreso', 'en_revision', 'bloqueada', 'completada'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
/** Lo que un cliente puede hacer con sus propias tareas: nunca darlas por completadas. */
export const CLIENT_STATUSES: readonly TaskStatus[] = ['pendiente', 'en_progreso', 'en_revision'];

export const PROJECT_STATUSES = ['activo', 'pausado', 'finalizado'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export type Role = 'team' | 'client';
/** "deersystems" = lo resuelve tu lado (tú o alguien del equipo); "cliente" = le toca al cliente. */
export type Side = 'deersystems' | 'cliente';

export interface Client {
  id: number;
  name: string;
  contact_name: string;
  email: string;
  phone: string;
  created_at: string;
}

export interface Account {
  id: number;
  email: string;
  name: string;
  role: Role;
  client_id: number | null;
  password_hash: string;
  active: number;
  session_version: number;
  last_login_at: string | null;
  created_at: string;
}

export interface Project {
  id: number;
  client_id: number;
  proposal_id: number | null;
  name: string;
  scope: string;
  pricing: string;
  approved_option: string;
  approval_notes: string;
  status: ProjectStatus;
  start_date: string | null;
  end_date: string | null;
  approved_at: string;
  approved_by: string;
  created_at: string;
  updated_at: string;
}

export interface Phase {
  id: number;
  project_id: number;
  name: string;
  position: number;
}

export interface Task {
  id: number;
  project_id: number;
  phase_id: number | null;
  title: string;
  description: string;
  status: TaskStatus;
  side: Side;
  assignee_id: number | null;
  start_date: string | null;
  due_date: string | null;
  position: number;
  source: 'propuesta' | 'manual' | 'reunion';
  /** 'reunion' = reunión con el cliente en el cronograma (se pinta con la franja naranja). */
  kind: 'tarea' | 'reunion';
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    contact_name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL UNIQUE,
    phone TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL CHECK (role IN ('team', 'client')),
    client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
    password_hash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    session_version INTEGER NOT NULL DEFAULT 1,
    last_login_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS password_resets (
    token_hash TEXT PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    proposal_id INTEGER,
    name TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT '',
    pricing TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'activo',
    start_date TEXT,
    end_date TEXT,
    approved_at TEXT NOT NULL,
    approved_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS projects_client ON projects(client_id);
  CREATE INDEX IF NOT EXISTS projects_proposal ON projects(proposal_id);
  CREATE TABLE IF NOT EXISTS phases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    phase_id INTEGER REFERENCES phases(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pendiente',
    side TEXT NOT NULL DEFAULT 'deersystems',
    assignee_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    start_date TEXT,
    due_date TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'manual',
    completed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS tasks_project ON tasks(project_id);
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ai_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    purpose TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    latency_ms INTEGER NOT NULL DEFAULT 0,
    ok INTEGER NOT NULL,
    error TEXT
  );
  CREATE INDEX IF NOT EXISTS ai_usage_at ON ai_usage(at);
`);

/** Columnas agregadas después de la primera versión: se crean si la base es anterior. */
function addColumn(table: string, column: string, definition: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
addColumn('projects', 'approved_option', "TEXT NOT NULL DEFAULT ''");
addColumn('projects', 'approval_notes', "TEXT NOT NULL DEFAULT ''");

const now = () => new Date().toISOString();
const all = <T>(sql: string, ...params: (string | number | null)[]) => db.prepare(sql).all(...params) as unknown as T[];
const one = <T>(sql: string, ...params: (string | number | null)[]) =>
  db.prepare(sql).get(...params) as unknown as T | undefined;

/** Ejecuta varias escrituras como una sola: o quedan todas o ninguna. */
export function transaction<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// ───────── Ajustes (JSON por clave) ─────────

export function getSetting<T>(key: string): T | null {
  const row = one<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
  return row ? (JSON.parse(row.value) as T) : null;
}

export function setSetting(key: string, value: unknown): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    JSON.stringify(value),
  );
}

export function deleteSetting(key: string): void {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key);
}

// ───────── Cuentas ─────────

export const getAccount = (id: number) => one<Account>('SELECT * FROM accounts WHERE id = ?', id);
export const getAccountByEmail = (email: string) => one<Account>('SELECT * FROM accounts WHERE email = ?', email);
export const getClientAccount = (clientId: number) =>
  one<Account>("SELECT * FROM accounts WHERE client_id = ? AND role = 'client'", clientId);
export const listTeam = () => all<Account>("SELECT * FROM accounts WHERE role = 'team' ORDER BY name, email");

export function createAccount(a: { email: string; name: string; role: Role; clientId: number | null; passwordHash: string }) {
  const { lastInsertRowid } = db
    .prepare('INSERT INTO accounts (email, name, role, client_id, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(a.email, a.name, a.role, a.clientId, a.passwordHash, now());
  return getAccount(Number(lastInsertRowid))!;
}

/** Cambia la contraseña y cierra todas las sesiones abiertas de esa cuenta. */
export function setPassword(id: number, passwordHash: string): void {
  db.prepare('UPDATE accounts SET password_hash = ?, session_version = session_version + 1 WHERE id = ?').run(passwordHash, id);
}

export function updateAccount(id: number, fields: { name?: string; active?: boolean }): void {
  if (fields.name !== undefined) db.prepare('UPDATE accounts SET name = ? WHERE id = ?').run(fields.name, id);
  if (fields.active !== undefined) {
    db.prepare('UPDATE accounts SET active = ?, session_version = session_version + 1 WHERE id = ?').run(
      fields.active ? 1 : 0,
      id,
    );
  }
}

export function touchLogin(id: number): void {
  db.prepare('UPDATE accounts SET last_login_at = ? WHERE id = ?').run(now(), id);
}

export function deleteAccount(id: number): void {
  db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
}

export function createReset(tokenHash: string, accountId: number, expiresAt: string): void {
  db.prepare('DELETE FROM password_resets WHERE account_id = ? OR expires_at < ?').run(accountId, now());
  db.prepare('INSERT INTO password_resets (token_hash, account_id, expires_at) VALUES (?, ?, ?)').run(
    tokenHash,
    accountId,
    expiresAt,
  );
}

/** Consume el enlace de recuperación: sirve una sola vez y solo antes de vencer. */
export function useReset(tokenHash: string): number | null {
  const row = one<{ account_id: number; expires_at: string; used: number }>(
    'SELECT * FROM password_resets WHERE token_hash = ?',
    tokenHash,
  );
  if (!row || row.used || row.expires_at < now()) return null;
  db.prepare('UPDATE password_resets SET used = 1 WHERE token_hash = ?').run(tokenHash);
  return row.account_id;
}

// ───────── Clientes ─────────

export const getClient = (id: number) => one<Client>('SELECT * FROM clients WHERE id = ?', id);
export const getClientByEmail = (email: string) => one<Client>('SELECT * FROM clients WHERE email = ?', email);

export function listClients() {
  return all<Client & { projects: number; active_projects: number; last_login_at: string | null; account_active: number | null }>(
    `SELECT c.*,
       (SELECT COUNT(*) FROM projects p WHERE p.client_id = c.id) AS projects,
       (SELECT COUNT(*) FROM projects p WHERE p.client_id = c.id AND p.status = 'activo') AS active_projects,
       a.last_login_at, a.active AS account_active
     FROM clients c LEFT JOIN accounts a ON a.client_id = c.id AND a.role = 'client'
     ORDER BY c.name`,
  );
}

export function createClient(c: { name: string; contactName: string; email: string; phone: string }): Client {
  const { lastInsertRowid } = db
    .prepare('INSERT INTO clients (name, contact_name, email, phone, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(c.name, c.contactName, c.email, c.phone, now());
  return getClient(Number(lastInsertRowid))!;
}

export function updateClient(id: number, fields: { name?: string; contact_name?: string; phone?: string }): void {
  for (const [col, value] of Object.entries(fields)) {
    if (value !== undefined) db.prepare(`UPDATE clients SET ${col} = ? WHERE id = ?`).run(value, id);
  }
}

// ───────── Proyectos, fases y tareas ─────────

export interface Progress {
  total: number;
  done: number;
  percent: number;
}

/** % de avance = tareas completadas / total. Sin tareas, 0 %. */
export function progressOf(projectId: number): Progress {
  const row = one<{ total: number; done: number }>(
    "SELECT COUNT(*) AS total, COALESCE(SUM(status = 'completada'), 0) AS done FROM tasks WHERE project_id = ?",
    projectId,
  )!;
  return { ...row, percent: row.total ? Math.round((row.done / row.total) * 100) : 0 };
}

export const getProject = (id: number) => one<Project>('SELECT * FROM projects WHERE id = ?', id);
export const listProjects = (clientId?: number) =>
  clientId === undefined
    ? all<Project>("SELECT * FROM projects ORDER BY status = 'activo' DESC, approved_at DESC")
    : all<Project>("SELECT * FROM projects WHERE client_id = ? ORDER BY status = 'activo' DESC, approved_at DESC", clientId);
export const projectsForProposal = (proposalId: number) =>
  all<Project>('SELECT * FROM projects WHERE proposal_id = ? ORDER BY approved_at', proposalId);

export function createProject(p: {
  clientId: number;
  proposalId: number | null;
  name: string;
  scope: string;
  pricing: string;
  approvedOption: string;
  approvalNotes: string;
  startDate: string | null;
  endDate: string | null;
  by: string;
}): Project {
  const t = now();
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO projects (client_id, proposal_id, name, scope, pricing, approved_option, approval_notes, start_date, end_date, approved_at, approved_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(p.clientId, p.proposalId, p.name, p.scope, p.pricing, p.approvedOption, p.approvalNotes, p.startDate, p.endDate, t, p.by, t, t);
  return getProject(Number(lastInsertRowid))!;
}

export function updateProject(
  id: number,
  fields: Partial<Pick<Project, 'name' | 'scope' | 'pricing' | 'approved_option' | 'approval_notes' | 'status' | 'start_date' | 'end_date'>>,
): void {
  for (const [col, value] of Object.entries(fields)) {
    if (value !== undefined) db.prepare(`UPDATE projects SET ${col} = ?, updated_at = ? WHERE id = ?`).run(value, now(), id);
  }
}

export function deleteProject(id: number): void {
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
}

export const listPhases = (projectId: number) =>
  all<Phase>('SELECT * FROM phases WHERE project_id = ? ORDER BY position, id', projectId);

export function createPhase(projectId: number, name: string, position: number): Phase {
  const { lastInsertRowid } = db
    .prepare('INSERT INTO phases (project_id, name, position) VALUES (?, ?, ?)')
    .run(projectId, name, position);
  return one<Phase>('SELECT * FROM phases WHERE id = ?', Number(lastInsertRowid))!;
}

export const getTask = (id: number) => one<Task>('SELECT * FROM tasks WHERE id = ?', id);
export const listTasks = (projectId: number) =>
  all<Task>('SELECT * FROM tasks WHERE project_id = ? ORDER BY position, id', projectId);

export function createTask(t: {
  projectId: number;
  phaseId: number | null;
  title: string;
  description: string;
  side: Side;
  assigneeId: number | null;
  startDate: string | null;
  dueDate: string | null;
  position: number;
  source: Task['source'];
  kind?: Task['kind'];
}): Task {
  const ts = now();
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO tasks (project_id, phase_id, title, description, side, assignee_id, start_date, due_date, position, source, kind, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(t.projectId, t.phaseId, t.title, t.description, t.side, t.assigneeId, t.startDate, t.dueDate, t.position, t.source, t.kind ?? 'tarea', ts, ts);
  return getTask(Number(lastInsertRowid))!;
}

export function setTaskStatus(id: number, status: TaskStatus): void {
  db.prepare(
    `UPDATE tasks SET status = ?, updated_at = ?,
       completed_at = CASE WHEN ? = 'completada' THEN COALESCE(completed_at, ?) ELSE NULL END
     WHERE id = ?`,
  ).run(status, now(), status, now(), id);
}

// ───────── Consumo de IA ─────────

export interface UsageRow {
  provider: string;
  model: string;
  purpose: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  latency_ms: number;
  ok: boolean;
  error: string | null;
}

export function logUsage(u: UsageRow): void {
  db.prepare(
    `INSERT INTO ai_usage (at, provider, model, purpose, input_tokens, output_tokens, cost_usd, latency_ms, ok, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(now(), u.provider, u.model, u.purpose, u.input_tokens, u.output_tokens, u.cost_usd, u.latency_ms, u.ok ? 1 : 0, u.error);
}

/** Totales desde una fecha, agrupados por proveedor y modelo. */
export function usageSince(since: string) {
  return all<{ provider: string; model: string; calls: number; failed: number; input_tokens: number; output_tokens: number; cost_usd: number }>(
    `SELECT provider, model, COUNT(*) AS calls, SUM(ok = 0) AS failed,
       SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, SUM(cost_usd) AS cost_usd
     FROM ai_usage WHERE at >= ? GROUP BY provider, model ORDER BY cost_usd DESC, calls DESC`,
    since,
  );
}

export function usageByDay(since: string) {
  return all<{ day: string; calls: number; tokens: number; cost_usd: number }>(
    `SELECT substr(at, 1, 10) AS day, COUNT(*) AS calls, SUM(input_tokens + output_tokens) AS tokens, SUM(cost_usd) AS cost_usd
     FROM ai_usage WHERE at >= ? GROUP BY day ORDER BY day`,
    since,
  );
}

export const recentUsage = (limit: number) =>
  all<UsageRow & { id: number; at: string }>('SELECT * FROM ai_usage ORDER BY id DESC LIMIT ?', limit);

// ───────── Fase 2: edición de tareas y fases, notas, avances y bitácora ─────────

db.exec(`
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'nota' CHECK (kind IN ('nota', 'avance')),
    visibility TEXT NOT NULL DEFAULT 'shared' CHECK (visibility IN ('shared', 'internal')),
    author_kind TEXT NOT NULL,
    author_id INTEGER,
    author_name TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS notes_project ON notes(project_id, created_at);
  CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    task_id INTEGER,
    actor_kind TEXT NOT NULL,
    actor_name TEXT NOT NULL,
    type TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    internal INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS activity_project ON activity(project_id, id);
`);

export type TaskFields = Partial<
  Pick<Task, 'title' | 'description' | 'side' | 'assignee_id' | 'phase_id' | 'start_date' | 'due_date' | 'position' | 'kind'>
>;

export function updateTask(id: number, fields: TaskFields): void {
  for (const [col, value] of Object.entries(fields)) {
    if (value !== undefined) db.prepare(`UPDATE tasks SET ${col} = ?, updated_at = ? WHERE id = ?`).run(value, now(), id);
  }
}

export function deleteTask(id: number): void {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
}

export function nextTaskPosition(projectId: number): number {
  return one<{ p: number }>('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM tasks WHERE project_id = ?', projectId)!.p;
}

export const getPhase = (id: number) => one<Phase>('SELECT * FROM phases WHERE id = ?', id);

export function nextPhasePosition(projectId: number): number {
  return one<{ p: number }>('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM phases WHERE project_id = ?', projectId)!.p;
}

export function updatePhase(id: number, fields: { name?: string; position?: number }): void {
  if (fields.name !== undefined) db.prepare('UPDATE phases SET name = ? WHERE id = ?').run(fields.name, id);
  if (fields.position !== undefined) db.prepare('UPDATE phases SET position = ? WHERE id = ?').run(fields.position, id);
}

/** Las tareas de la fase no se borran: quedan "Sin fase". */
export function deletePhase(id: number): void {
  db.prepare('DELETE FROM phases WHERE id = ?').run(id);
}

export interface Note {
  id: number;
  project_id: number;
  task_id: number | null;
  kind: 'nota' | 'avance';
  visibility: 'shared' | 'internal';
  author_kind: 'owner' | 'team' | 'client';
  author_id: number | null;
  author_name: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export const getNote = (id: number) => one<Note>('SELECT * FROM notes WHERE id = ?', id);

/** Notas de un proyecto (o de una tarea). Sin `internal`, el cliente no ve las internas. */
export function listNotes(projectId: number, opts: { internal: boolean; taskId?: number | null; kind?: Note['kind'] }) {
  const where = ['project_id = ?'];
  const params: (string | number)[] = [projectId];
  if (!opts.internal) where.push("visibility = 'shared'");
  if (opts.taskId === null) where.push('task_id IS NULL');
  else if (opts.taskId !== undefined) {
    where.push('task_id = ?');
    params.push(opts.taskId);
  }
  if (opts.kind) {
    where.push('kind = ?');
    params.push(opts.kind);
  }
  return all<Note>(`SELECT * FROM notes WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC`, ...params);
}

/** Cantidad de comentarios por tarea, para mostrar el contador en la lista. */
export function commentCounts(projectId: number, internal: boolean): Map<number, number> {
  const rows = all<{ task_id: number; n: number }>(
    `SELECT task_id, COUNT(*) AS n FROM notes WHERE project_id = ? AND task_id IS NOT NULL ${internal ? '' : "AND visibility = 'shared'"} GROUP BY task_id`,
    projectId,
  );
  return new Map(rows.map((r) => [r.task_id, r.n]));
}

export function createNote(n: Omit<Note, 'id' | 'created_at' | 'updated_at'>): Note {
  const t = now();
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO notes (project_id, task_id, kind, visibility, author_kind, author_id, author_name, body, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(n.project_id, n.task_id, n.kind, n.visibility, n.author_kind, n.author_id, n.author_name, n.body, t, t);
  return getNote(Number(lastInsertRowid))!;
}

export function updateNote(id: number, body: string): void {
  db.prepare('UPDATE notes SET body = ?, updated_at = ? WHERE id = ?').run(body, now(), id);
}

export function deleteNote(id: number): void {
  db.prepare('DELETE FROM notes WHERE id = ?').run(id);
}

export interface Activity {
  id: number;
  project_id: number;
  task_id: number | null;
  actor_kind: string;
  actor_name: string;
  type: string;
  data: string;
  internal: number;
  created_at: string;
}

/** Bitácora: cada cambio queda registrado. `internal` = no lo ve el cliente. */
export function logActivity(a: {
  projectId: number;
  taskId?: number | null;
  actorKind: string;
  actorName: string;
  type: string;
  data?: Record<string, unknown>;
  internal?: boolean;
}): void {
  db.prepare(
    `INSERT INTO activity (project_id, task_id, actor_kind, actor_name, type, data, internal, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(a.projectId, a.taskId ?? null, a.actorKind, a.actorName, a.type, JSON.stringify(a.data ?? {}), a.internal ? 1 : 0, now());
}

export function listActivity(projectId: number, opts: { internal: boolean; taskId?: number; limit?: number }) {
  const where = ['project_id = ?'];
  const params: (string | number)[] = [projectId];
  if (!opts.internal) where.push('internal = 0');
  if (opts.taskId !== undefined) {
    where.push('task_id = ?');
    params.push(opts.taskId);
  }
  params.push(opts.limit ?? 200);
  return all<Activity>(`SELECT * FROM activity WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`, ...params);
}

// ───────── Fase 3: notificaciones y adjuntos en Drive ─────────

db.exec(`
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient_kind TEXT NOT NULL CHECK (recipient_kind IN ('owner', 'account')),
    recipient_id INTEGER,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    task_id INTEGER,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    link TEXT NOT NULL DEFAULT '/',
    read_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS notifications_recipient ON notifications(recipient_kind, recipient_id, id);
  CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
    drive_file_id TEXT NOT NULL,
    name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    visibility TEXT NOT NULL DEFAULT 'shared' CHECK (visibility IN ('shared', 'internal')),
    author_kind TEXT NOT NULL,
    author_id INTEGER,
    author_name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS attachments_project ON attachments(project_id, id);
`);
addColumn('clients', 'drive_folder_id', 'TEXT');
addColumn('projects', 'drive_folder_id', 'TEXT');

/** Destinatario de una notificación: el administrador (sin cuenta) o una cuenta del equipo o cliente. */
export type Recipient = { kind: 'owner' } | { kind: 'account'; id: number };

const recipientWhere = (r: Recipient) =>
  r.kind === 'owner' ? { sql: "recipient_kind = 'owner'", params: [] as number[] } : { sql: "recipient_kind = 'account' AND recipient_id = ?", params: [r.id] };

export interface Notification {
  id: number;
  recipient_kind: 'owner' | 'account';
  recipient_id: number | null;
  project_id: number | null;
  task_id: number | null;
  type: string;
  title: string;
  body: string;
  link: string;
  read_at: string | null;
  created_at: string;
}

export function createNotification(
  r: Recipient,
  n: { projectId: number | null; taskId?: number | null; type: string; title: string; body: string; link: string; collapse?: boolean },
): void {
  // Varios cambios seguidos de la misma tarea sin leer se funden en un solo aviso, que se actualiza.
  if (n.collapse && n.taskId) {
    const w = recipientWhere(r);
    const prev = one<{ id: number }>(
      `SELECT id FROM notifications WHERE ${w.sql} AND read_at IS NULL AND type = ? AND task_id = ? AND created_at > ? ORDER BY id DESC LIMIT 1`,
      ...w.params,
      n.type,
      n.taskId,
      new Date(Date.now() - 30 * 60_000).toISOString(),
    );
    if (prev) {
      db.prepare('UPDATE notifications SET title = ?, body = ?, link = ?, created_at = ? WHERE id = ?').run(n.title, n.body, n.link, now(), prev.id);
      return;
    }
  }
  db.prepare(
    `INSERT INTO notifications (recipient_kind, recipient_id, project_id, task_id, type, title, body, link, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(r.kind, r.kind === 'account' ? r.id : null, n.projectId, n.taskId ?? null, n.type, n.title, n.body, n.link, now());
}

export function listNotifications(r: Recipient, limit = 40) {
  const w = recipientWhere(r);
  return all<Notification>(`SELECT * FROM notifications WHERE ${w.sql} ORDER BY id DESC LIMIT ?`, ...w.params, limit);
}

export function unreadCount(r: Recipient): number {
  const w = recipientWhere(r);
  return one<{ n: number }>(`SELECT COUNT(*) AS n FROM notifications WHERE ${w.sql} AND read_at IS NULL`, ...w.params)!.n;
}

/** Marca como leídas: todas, o solo las indicadas (siempre del mismo destinatario). */
export function markRead(r: Recipient, ids?: number[]): void {
  const w = recipientWhere(r);
  if (ids?.length) {
    db.prepare(
      `UPDATE notifications SET read_at = ? WHERE ${w.sql} AND read_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`,
    ).run(now(), ...w.params, ...ids);
  } else {
    db.prepare(`UPDATE notifications SET read_at = ? WHERE ${w.sql} AND read_at IS NULL`).run(now(), ...w.params);
  }
}

/** Las notificaciones viejas y leídas no hacen falta: se limpian a los 90 días. */
export function pruneNotifications(): void {
  db.prepare('DELETE FROM notifications WHERE read_at IS NOT NULL AND created_at < ?').run(
    new Date(Date.now() - 90 * 86_400_000).toISOString(),
  );
}

export interface Attachment {
  id: number;
  project_id: number;
  task_id: number | null;
  drive_file_id: string;
  name: string;
  mime: string;
  size: number;
  visibility: 'shared' | 'internal';
  author_kind: 'owner' | 'team' | 'client';
  author_id: number | null;
  author_name: string;
  created_at: string;
}

export const getAttachment = (id: number) => one<Attachment>('SELECT * FROM attachments WHERE id = ?', id);

export function listAttachments(projectId: number, opts: { internal: boolean; taskId?: number }) {
  const where = ['project_id = ?'];
  const params: (string | number)[] = [projectId];
  if (!opts.internal) where.push("visibility = 'shared'");
  if (opts.taskId !== undefined) {
    where.push('task_id = ?');
    params.push(opts.taskId);
  }
  return all<Attachment>(`SELECT * FROM attachments WHERE ${where.join(' AND ')} ORDER BY id DESC`, ...params);
}

export function attachmentCounts(projectId: number, internal: boolean): Map<number, number> {
  const rows = all<{ task_id: number; n: number }>(
    `SELECT task_id, COUNT(*) AS n FROM attachments WHERE project_id = ? AND task_id IS NOT NULL ${internal ? '' : "AND visibility = 'shared'"} GROUP BY task_id`,
    projectId,
  );
  return new Map(rows.map((r) => [r.task_id, r.n]));
}

export function createAttachment(a: Omit<Attachment, 'id' | 'created_at'>): Attachment {
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO attachments (project_id, task_id, drive_file_id, name, mime, size, visibility, author_kind, author_id, author_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(a.project_id, a.task_id, a.drive_file_id, a.name, a.mime, a.size, a.visibility, a.author_kind, a.author_id, a.author_name, now());
  return getAttachment(Number(lastInsertRowid))!;
}

export function deleteAttachment(id: number): void {
  db.prepare('DELETE FROM attachments WHERE id = ?').run(id);
}

export function setClientFolder(id: number, folderId: string | null): void {
  db.prepare('UPDATE clients SET drive_folder_id = ? WHERE id = ?').run(folderId, id);
}

export function setProjectFolder(id: number, folderId: string | null): void {
  db.prepare('UPDATE projects SET drive_folder_id = ? WHERE id = ?').run(folderId, id);
}

export function clientFolder(id: number): string | null {
  return one<{ f: string | null }>('SELECT drive_folder_id AS f FROM clients WHERE id = ?', id)?.f ?? null;
}

export function projectFolder(id: number): string | null {
  return one<{ f: string | null }>('SELECT drive_folder_id AS f FROM projects WHERE id = ?', id)?.f ?? null;
}

// Archivos: enlace de Drive, si ya se compartió por enlace y si viene de tu Drive (no se sube ni se borra).
addColumn('attachments', 'drive_url', 'TEXT');
addColumn('attachments', 'link_shared', 'INTEGER NOT NULL DEFAULT 0');
addColumn('attachments', 'linked', 'INTEGER NOT NULL DEFAULT 0');
if (!(db.prepare('PRAGMA table_info(tasks)').all() as { name: string }[]).some((c) => c.name === 'kind')) {
  addColumn('tasks', 'kind', "TEXT NOT NULL DEFAULT 'tarea'");
  // Proyectos creados antes: las reuniones de avance del plan se reconocen por el título.
  db.exec("UPDATE tasks SET kind = 'reunion' WHERE source = 'propuesta' AND title LIKE 'Reuni_n%'");
}

export interface AttachmentExtra {
  drive_url: string | null;
  link_shared: number;
  linked: number;
}

export function updateAttachment(id: number, fields: Partial<{ visibility: 'shared' | 'internal'; link_shared: number; drive_url: string | null }>): void {
  for (const [col, value] of Object.entries(fields)) {
    if (value !== undefined) db.prepare(`UPDATE attachments SET ${col} = ? WHERE id = ?`).run(value, id);
  }
}

export function setAttachmentSource(id: number, fields: { drive_url: string | null; linked: boolean }): void {
  db.prepare('UPDATE attachments SET drive_url = ?, linked = ? WHERE id = ?').run(fields.drive_url, fields.linked ? 1 : 0, id);
}

/** Archivos compartidos que aún no tienen el acceso por enlace (subidos antes de este cambio, o si falló). */
export const pendingLinkShares = () =>
  all<Attachment & AttachmentExtra>("SELECT * FROM attachments WHERE visibility = 'shared' AND link_shared = 0 ORDER BY id LIMIT 50");

// Preferencias de avisos de cada persona (cliente o equipo): {tipo: {app, email}}. Solo pueden apagar.
addColumn('accounts', 'notify_prefs', "TEXT NOT NULL DEFAULT '{}'");

export type PersonalPrefs = Record<string, { app?: boolean; email?: boolean }>;

export function getPersonalPrefs(accountId: number): PersonalPrefs {
  const row = one<{ p: string }>('SELECT notify_prefs AS p FROM accounts WHERE id = ?', accountId);
  try {
    return row ? (JSON.parse(row.p) as PersonalPrefs) : {};
  } catch {
    return {};
  }
}

export function setPersonalPrefs(accountId: number, prefs: PersonalPrefs): void {
  db.prepare('UPDATE accounts SET notify_prefs = ? WHERE id = ?').run(JSON.stringify(prefs), accountId);
}

// Tour guiado: si la persona lo terminó, no se vuelve a mostrar (en ningún dispositivo).
addColumn('accounts', 'tour_done', 'INTEGER NOT NULL DEFAULT 0');

export function tourDone(accountId: number | null): boolean {
  if (accountId === null) return !!getSetting<boolean>('owner_tour_done');
  return !!one<{ d: number }>('SELECT tour_done AS d FROM accounts WHERE id = ?', accountId)?.d;
}

export function setTourDone(accountId: number | null, done: boolean): void {
  if (accountId === null) setSetting('owner_tour_done', done);
  else db.prepare('UPDATE accounts SET tour_done = ? WHERE id = ?').run(done ? 1 : 0, accountId);
}
