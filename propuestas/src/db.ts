import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR, SUPERADMIN_EMAIL } from './config.ts';

export interface Proposal {
  id: number;
  slug: string;
  title: string;
  filename: string;
  has_assets: number;
  version: number;
  size: number;
  active: number;
  views: number;
  last_viewed_at: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string;
}

export interface User {
  email: string;
  added_by: string;
  created_at: string;
}

mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(join(DATA_DIR, 'propuestas.sqlite'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS proposals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL DEFAULT '',
    filename TEXT NOT NULL,
    has_assets INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1,
    size INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    views INTEGER NOT NULL DEFAULT 0,
    last_viewed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS users (
    email TEXT PRIMARY KEY,
    added_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`);

const now = () => new Date().toISOString();

export function listProposals(): Proposal[] {
  return db.prepare('SELECT * FROM proposals ORDER BY updated_at DESC').all() as unknown as Proposal[];
}

export function getProposal(id: number): Proposal | undefined {
  return db.prepare('SELECT * FROM proposals WHERE id = ?').get(id) as unknown as Proposal | undefined;
}

export function getProposalBySlug(slug: string): Proposal | undefined {
  return db.prepare('SELECT * FROM proposals WHERE slug = ?').get(slug) as unknown as Proposal | undefined;
}

export function createProposal(p: {
  slug: string;
  title: string;
  filename: string;
  hasAssets: boolean;
  size: number;
  by: string;
}): Proposal {
  const t = now();
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO proposals (slug, title, filename, has_assets, size, created_at, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(p.slug, p.title, p.filename, p.hasAssets ? 1 : 0, p.size, t, t, p.by);
  return getProposal(Number(lastInsertRowid))!;
}

/** Apunta la propuesta a una versión nueva del contenido. El slug no cambia. */
export function setProposalContent(
  id: number,
  p: { version: number; filename: string; hasAssets: boolean; size: number; by: string },
): void {
  db.prepare(
    'UPDATE proposals SET version = ?, filename = ?, has_assets = ?, size = ?, updated_at = ?, updated_by = ? WHERE id = ?',
  ).run(p.version, p.filename, p.hasAssets ? 1 : 0, p.size, now(), p.by, id);
}

export function updateProposal(id: number, fields: { title?: string; active?: boolean }): void {
  if (fields.title !== undefined) db.prepare('UPDATE proposals SET title = ? WHERE id = ?').run(fields.title, id);
  if (fields.active !== undefined)
    db.prepare('UPDATE proposals SET active = ? WHERE id = ?').run(fields.active ? 1 : 0, id);
}

export function deleteProposal(id: number): void {
  db.prepare('DELETE FROM proposals WHERE id = ?').run(id);
}

export function countView(id: number): void {
  db.prepare('UPDATE proposals SET views = views + 1, last_viewed_at = ? WHERE id = ?').run(now(), id);
}

export function listUsers(): User[] {
  return db.prepare('SELECT * FROM users ORDER BY created_at').all() as unknown as User[];
}

export function addUser(email: string, by: string): void {
  db.prepare('INSERT OR IGNORE INTO users (email, added_by, created_at) VALUES (?, ?, ?)').run(email, by, now());
}

export function removeUser(email: string): void {
  db.prepare('DELETE FROM users WHERE email = ?').run(email);
}

export function isAllowed(email: string): boolean {
  return email === SUPERADMIN_EMAIL || !!db.prepare('SELECT 1 FROM users WHERE email = ?').get(email);
}
