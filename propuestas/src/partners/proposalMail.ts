import type { IncomingMessage, ServerResponse } from 'node:http';
import { db as sqlite, getProposal } from '../db.ts';
import * as google from '../google.ts';
import { HttpError, json, readJson } from '../http.ts';
import { proposalsOffer } from '../mail.ts';
import * as proposals from '../proposals.ts';
import type { Viewer } from './auth.ts';
import { proposalClient, setProposalClient } from './approvals.ts';
import { EMAIL_RE, requireOwner, str } from './common.ts';
import * as pdb from './db.ts';

/**
 * Enviar una o varias propuestas publicadas por correo, en un solo mensaje comercial, a quien elijas.
 * Cada envío queda registrado para ver en la lista a quién y cuándo se mandó cada propuesta.
 */

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS proposal_sends (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    proposal_id INTEGER NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
    to_emails TEXT NOT NULL,
    subject TEXT NOT NULL,
    sent_at TEXT NOT NULL,
    sent_by TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS proposal_sends_proposal ON proposal_sends(proposal_id, id);
`);

/** El último envío de una propuesta, para mostrarlo en la lista. */
export function lastSend(proposalId: number): { to: string; at: string; count: number } | null {
  const row = sqlite
    .prepare('SELECT to_emails AS "to", sent_at AS at, (SELECT COUNT(*) FROM proposal_sends WHERE proposal_id = ?) AS count FROM proposal_sends WHERE proposal_id = ? ORDER BY id DESC LIMIT 1')
    .get(proposalId, proposalId) as { to: string; at: string; count: number } | undefined;
  return row ?? null;
}

interface Draft {
  to: string[];
  subject: string;
  name: string;
  message: string;
  items: { id: number; title: string; note: string; url: string }[];
}

async function readDraft(req: IncomingMessage, strict: boolean): Promise<Draft> {
  const body = await readJson(req, 256 * 1024);
  const rawTo = Array.isArray(body.to) ? body.to.join(',') : String(body.to ?? '');
  const to = [...new Set(rawTo.split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (strict) {
    if (!to.length) throw new HttpError(400, 'Escribe al menos un correo de destino.');
    const bad = to.find((e) => !EMAIL_RE.test(e));
    if (bad) throw new HttpError(400, `«${bad}» no es un correo válido.`);
    if (to.length > 10) throw new HttpError(400, 'Máximo 10 destinatarios por envío.');
  }
  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (!rawItems.length) throw new HttpError(400, 'Elige al menos una propuesta.');
  if (rawItems.length > 10) throw new HttpError(400, 'Máximo 10 propuestas por correo.');
  const items = rawItems.map((raw) => {
    const r = raw as Record<string, unknown>;
    const p = getProposal(Number(r.id));
    if (!p) throw new HttpError(404, 'Una de las propuestas ya no existe.');
    if (strict && !p.active) throw new HttpError(400, `«${p.title || p.slug}» está pausada: actívala antes de enviarla (si no, el cliente verá un 404).`);
    return { id: p.id, title: str(r.title, 160) || p.title || p.slug, note: str(r.note, 600), url: proposals.publicUrl(p.slug) };
  });
  const subject = str(body.subject, 200) || (items.length > 1 ? `${items.length} propuestas de DeerSystems para ti` : `Tu propuesta: ${items[0].title}`);
  return { to, subject, name: str(body.name, 120), message: String(body.message ?? '').slice(0, 4000), items };
}

export async function handleProposalMail(route: string, req: IncomingMessage, res: ServerResponse, v: Viewer): Promise<boolean> {
  switch (route) {
    // Cómo se verá el correo con lo que hay en pantalla.
    case 'POST proposals/send/preview': {
      requireOwner(v);
      const d = await readDraft(req, false);
      const m = proposalsOffer({ to: d.to.join(', ') || 'cliente@empresa.com', subject: d.subject, name: d.name, message: d.message, items: d.items });
      json(res, 200, { subject: m.subject, to: m.to, html: m.html });
      return true;
    }

    case 'POST proposals/send': {
      requireOwner(v);
      if (!google.connectionStatus().connected) throw new HttpError(409, 'Conecta Google en Configuración para enviar correos.');
      const d = await readDraft(req, true);
      const m = proposalsOffer({ to: d.to.join(', '), subject: d.subject, name: d.name, message: d.message, items: d.items });
      try {
        await google.sendMail(m);
      } catch (err) {
        throw err instanceof google.GoogleError ? new HttpError(502, err.message) : err;
      }
      const at = new Date().toISOString();
      const log = sqlite.prepare('INSERT INTO proposal_sends (proposal_id, to_emails, subject, sent_at, sent_by) VALUES (?, ?, ?, ?, ?)');
      for (const it of d.items) log.run(it.id, d.to.join(', '), d.subject, at, v.email);
      // Enviada a un cliente que ya existe: queda vinculada, así al aprobarla no se le piden sus datos.
      const known = new Set(d.to.map((e) => pdb.getClientByEmail(e)?.id ?? pdb.getAccountByEmail(e)?.client_id).filter((x): x is number => !!x));
      if (known.size === 1) {
        const [clientId] = known;
        for (const it of d.items) if (!proposalClient(it.id)) setProposalClient(it.id, clientId);
      }
      json(res, 200, { ok: true, to: d.to, count: d.items.length });
      return true;
    }
  }
  return false;
}
