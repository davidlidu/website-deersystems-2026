import type { IncomingMessage } from 'node:http';
import { MAX_UPLOAD_BYTES, PUBLIC_URL } from './config.ts';
import * as db from './db.ts';
import { HttpError, readBody } from './http.ts';
import { checkSlug, copyVersion, removeAll, slugify, unpack, versionExists, writeVersion } from './storage.ts';

/**
 * Operaciones de propuestas que comparten el panel de propuestas y partners.
 * Cada reemplazo guarda una versión nueva y conserva las anteriores: se pueden ver y restaurar.
 * La URL pública siempre es la de propuestas.deersystems.net, se publique desde donde se publique.
 */

export interface ProposalVersion {
  id: number;
  proposal_id: number;
  version: number;
  filename: string;
  has_assets: number;
  size: number;
  note: string;
  created_at: string;
  created_by: string;
}

db.db.exec(`
  CREATE TABLE IF NOT EXISTS proposal_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    proposal_id INTEGER NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    filename TEXT NOT NULL,
    has_assets INTEGER NOT NULL DEFAULT 0,
    size INTEGER NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL,
    UNIQUE (proposal_id, version)
  );
`);

// Propuestas publicadas antes del historial: su versión actual queda como la primera registrada.
db.db.exec(`
  INSERT OR IGNORE INTO proposal_versions (proposal_id, version, filename, has_assets, size, note, created_at, created_by)
  SELECT id, version, filename, has_assets, size, '', updated_at, updated_by FROM proposals
`);

const now = () => new Date().toISOString();

export const publicUrl = (slug: string) => `${PUBLIC_URL}/${slug}`;

export function listVersions(proposalId: number): ProposalVersion[] {
  return db.db.prepare('SELECT * FROM proposal_versions WHERE proposal_id = ? ORDER BY version DESC').all(proposalId) as unknown as ProposalVersion[];
}

function recordVersion(p: { proposalId: number; version: number; filename: string; hasAssets: boolean; size: number; note: string; by: string }): void {
  db.db
    .prepare(
      `INSERT OR REPLACE INTO proposal_versions (proposal_id, version, filename, has_assets, size, note, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(p.proposalId, p.version, p.filename, p.hasAssets ? 1 : 0, p.size, p.note, now(), p.by);
}

/** Lee el archivo subido (cuerpo crudo, .html o .zip). */
export async function readUpload(req: IncomingMessage, url: URL) {
  const filename = (url.searchParams.get('filename') ?? '').trim();
  if (!filename) throw new HttpError(400, 'Falta el nombre del archivo.');
  const content = unpack(filename, await readBody(req, MAX_UPLOAD_BYTES));
  return { filename, ...content, hasAssets: content.files.size > 1 };
}

export async function publish(upload: Awaited<ReturnType<typeof readUpload>>, opts: { slug?: string; title?: string; by: string }) {
  const slug = slugify(opts.slug || upload.filename);
  checkSlug(slug);
  if (db.getProposalBySlug(slug)) {
    throw new HttpError(409, `Ya existe una propuesta en /${slug}. Usa "Reemplazar" para actualizarla.`);
  }
  const created = db.createProposal({ slug, title: (opts.title ?? '').trim().slice(0, 200), by: opts.by, ...upload });
  try {
    await writeVersion(created.id, created.version, upload.files);
  } catch (err) {
    db.deleteProposal(created.id);
    await removeAll(created.id);
    throw err;
  }
  recordVersion({ proposalId: created.id, version: created.version, filename: upload.filename, hasAssets: upload.hasAssets, size: upload.size, note: 'Publicación inicial', by: opts.by });
  return created;
}

/** Nuevo contenido con la misma URL. La versión anterior se conserva en el historial. */
export async function replace(current: db.Proposal, upload: Awaited<ReturnType<typeof readUpload>>, opts: { by: string; note?: string }) {
  const version = current.version + 1;
  await writeVersion(current.id, version, upload.files);
  db.setProposalContent(current.id, { version, by: opts.by, ...upload });
  recordVersion({ proposalId: current.id, version, filename: upload.filename, hasAssets: upload.hasAssets, size: upload.size, note: (opts.note ?? '').slice(0, 300), by: opts.by });
  return db.getProposal(current.id)!;
}

/** Vuelve a publicar una versión anterior como una versión nueva (el historial sigue completo). */
export async function restore(current: db.Proposal, from: number, by: string) {
  const old = listVersions(current.id).find((v) => v.version === from);
  if (!old || !(await versionExists(current.id, from))) throw new HttpError(404, 'Esa versión ya no está disponible.');
  if (from === current.version) throw new HttpError(400, 'Esa ya es la versión publicada.');
  const version = current.version + 1;
  await copyVersion(current.id, from, version);
  db.setProposalContent(current.id, { version, filename: old.filename, hasAssets: !!old.has_assets, size: old.size, by });
  recordVersion({ proposalId: current.id, version, filename: old.filename, hasAssets: !!old.has_assets, size: old.size, note: `Restaurada desde la v${from}`, by });
  return db.getProposal(current.id)!;
}

export async function remove(current: db.Proposal): Promise<void> {
  db.deleteProposal(current.id);
  await removeAll(current.id);
}
