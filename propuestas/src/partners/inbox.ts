import type { IncomingMessage, ServerResponse } from 'node:http';
import { AiError, completeJson } from '../ai.ts';
import { db as sqlite } from '../db.ts';
import * as google from '../google.ts';
import { HttpError, json, readJson } from '../http.ts';
import type { Viewer } from './auth.ts';
import { requireOwner, str } from './common.ts';
import * as db from './db.ts';
import { notify } from './notify.ts';

/**
 * Solicitudes de cotización desde tu correo: cada 10 minutos se revisan los correos nuevos de la bandeja de Gmail
 * (sin promociones, redes sociales ni notificaciones) y la IA decide si alguno pide una cotización o propuesta. Si es
 * así, queda en Propuestas → Solicitudes con su resumen y te llega el aviso. Desde ahí respondes con la propuesta en el
 * mismo hilo de Gmail.
 *
 * Solo se manda a la IA (proveedores privados) el remitente, el asunto y el texto del correo, recortado.
 */

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS quote_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gmail_id TEXT NOT NULL UNIQUE,
    thread_id TEXT NOT NULL,
    message_id TEXT,
    from_email TEXT NOT NULL,
    from_name TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '',
    received_at TEXT NOT NULL,
    snippet TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    is_quote INTEGER NOT NULL DEFAULT 0,
    company TEXT NOT NULL DEFAULT '',
    contact TEXT NOT NULL DEFAULT '',
    service TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    requirements TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'nueva',
    proposal_ids TEXT NOT NULL DEFAULT '[]',
    replied_at TEXT,
    ai TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS quote_requests_quote ON quote_requests(is_quote, received_at);
`);

export type RequestStatus = 'nueva' | 'en_proceso' | 'respondida' | 'descartada';

interface Row {
  id: number;
  gmail_id: string;
  thread_id: string;
  message_id: string | null;
  from_email: string;
  from_name: string;
  subject: string;
  received_at: string;
  snippet: string;
  body: string;
  is_quote: number;
  company: string;
  contact: string;
  service: string;
  summary: string;
  requirements: string;
  status: RequestStatus;
  proposal_ids: string;
  replied_at: string | null;
  ai: string | null;
  created_at: string;
}

interface Settings {
  enabled: boolean;
}
interface State {
  lastScanAt: string | null;
  lastError: string | null;
  scanned: number;
}

const settings = (): Settings => ({ enabled: true, ...(db.getSetting<Partial<Settings>>('inbox') ?? {}) });
const state = (): State => ({ lastScanAt: null, lastError: null, scanned: 0, ...(db.getSetting<Partial<State>>('inbox_state') ?? {}) });
const setState = (s: Partial<State>) => db.setSetting('inbox_state', { ...state(), ...s });
const canRead = () => google.connectionStatus().connected && google.hasAnyScope('gmail.readonly', 'gmail.modify');
const now = () => new Date().toISOString();
const parse = <T>(s: string | null, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};

export const getRequest = (id: number) => sqlite.prepare('SELECT * FROM quote_requests WHERE id = ?').get(id) as unknown as Row | undefined;

/** Búsqueda de Gmail: lo nuevo de la bandeja principal, sin lo que envías tú ni promociones, redes y notificaciones. */
const QUERY = 'in:inbox newer_than:3d -from:me -category:promotions -category:social -category:updates -category:forums';

interface Verdict {
  isQuote?: unknown;
  company?: unknown;
  contact?: unknown;
  service?: unknown;
  summary?: unknown;
  requirements?: unknown;
}

async function classify(m: google.InboxMessage): Promise<{ v: Verdict; ai: Record<string, unknown> }> {
  const { data, completion } = await completeJson<Verdict>({
    profile: 'propuestas',
    purpose: 'solicitud',
    system: `Eres el asistente de DeerSystems, agencia colombiana de desarrollo web, e-commerce, automatización e IA. Lees UN correo recibido y decides si es una SOLICITUD DE COTIZACIÓN O PROPUESTA de un cliente o agencia (pide precio, alcance, propuesta, presupuesto o ajustes nuevos que hay que cotizar).
NO lo es: facturas, notificaciones automáticas, boletines, publicidad, respuestas de seguimiento sin pedido nuevo, correos internos, ofertas de proveedores para venderle a DeerSystems.
Devuelve SOLO JSON: {"isQuote": true|false, "company": "empresa o marca del cliente (o de la agencia)", "contact": "nombre de quien escribe", "service": "qué se pide en 3 a 8 palabras", "summary": "1 o 2 frases de lo que pide", "requirements": ["requerimiento concreto", "... hasta 10"]}. Si no es cotización, deja los demás campos vacíos.`,
    prompt: `De: ${m.from}\nAsunto: ${m.subject}\nFecha: ${m.date}\n\n${m.text.slice(0, 7000)}`,
    maxOutputTokens: 1200,
  });
  return { v: data, ai: { provider: completion.provider, model: completion.model, costUsd: completion.costUsd } };
}

let running = false;

/** Revisa la bandeja: los correos que no se han visto se clasifican (hasta 12 por vuelta, para cuidar el costo). */
export async function scan(): Promise<{ checked: number; found: number }> {
  if (running) return { checked: 0, found: 0 };
  if (!settings().enabled || !canRead()) return { checked: 0, found: 0 };
  running = true;
  let checked = 0;
  let found = 0;
  try {
    const ids = await google.inboxIds(QUERY, 30);
    const seen = new Set(
      ids.length
        ? (sqlite.prepare(`SELECT gmail_id FROM quote_requests WHERE gmail_id IN (${ids.map(() => '?').join(',')})`).all(...ids) as { gmail_id: string }[]).map((r) => r.gmail_id)
        : [],
    );
    for (const id of ids.filter((x) => !seen.has(x)).slice(0, 12)) {
      const m = await google.inboxMessage(id);
      checked++;
      // Sin texto o de una dirección automática: no se gasta IA.
      const automatic = /no-?reply|mailer-daemon|notifications?@|notificaciones@|noreply/i.test(m.fromEmail);
      let v: Verdict = { isQuote: false };
      let ai: Record<string, unknown> | null = null;
      if (!automatic && m.text.length > 30) {
        try {
          ({ v, ai } = await classify(m));
        } catch (err) {
          // Sin IA no se marca como visto: se reintenta en la próxima vuelta.
          if (err instanceof AiError) {
            setState({ lastError: `IA: ${err.message}` });
            break;
          }
          throw err;
        }
      }
      const isQuote = v.isQuote === true;
      sqlite
        .prepare(
          `INSERT OR IGNORE INTO quote_requests (gmail_id, thread_id, message_id, from_email, from_name, subject, received_at, snippet, body, is_quote, company, contact, service, summary, requirements, ai, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          m.id,
          m.threadId,
          m.messageId,
          m.fromEmail,
          m.fromName,
          m.subject.slice(0, 300),
          m.date,
          m.snippet.slice(0, 500),
          isQuote ? m.text : '',
          isQuote ? 1 : 0,
          str(v.company, 160),
          str(v.contact, 160) || m.fromName,
          str(v.service, 200),
          str(v.summary, 800),
          JSON.stringify((Array.isArray(v.requirements) ? v.requirements : []).map((x) => str(x, 300)).filter(Boolean).slice(0, 12)),
          ai ? JSON.stringify(ai) : null,
          now(),
        );
      if (isQuote) {
        found++;
        const r = sqlite.prepare('SELECT id FROM quote_requests WHERE gmail_id = ?').get(m.id) as { id: number };
        notify('quote_request', {
          actor: null,
          projectId: null,
          title: `Solicitud de cotización: ${str(v.company, 80) || m.fromName || m.fromEmail}`,
          body: str(v.service, 120) || m.subject,
          path: `/propuestas?tab=solicitudes&solicitud=${r.id}`,
        });
      }
    }
    // Lo que no era cotización se borra a los 30 días (solo sirve para no volver a revisarlo).
    sqlite.prepare('DELETE FROM quote_requests WHERE is_quote = 0 AND created_at < ?').run(new Date(Date.now() - 30 * 86_400_000).toISOString());
    setState({ lastScanAt: now(), lastError: null, scanned: state().scanned + checked });
    return { checked, found };
  } catch (err) {
    setState({ lastScanAt: now(), lastError: (err as Error).message.slice(0, 300) });
    throw err;
  } finally {
    running = false;
  }
}

export function startInboxScanner(): void {
  const tick = () => {
    if (settings().enabled && canRead()) scan().catch((err) => console.error('Bandeja de Gmail:', err.message));
  };
  setTimeout(tick, 60_000).unref();
  setInterval(tick, 10 * 60_000).unref();
}

/** Tras responder con la propuesta desde Partners. */
export function markReplied(id: number, proposalIds: number[]): void {
  const r = getRequest(id);
  if (!r) return;
  const ids = [...new Set([...parse<number[]>(r.proposal_ids, []), ...proposalIds])];
  sqlite.prepare("UPDATE quote_requests SET status = 'respondida', replied_at = ?, proposal_ids = ? WHERE id = ?").run(now(), JSON.stringify(ids), id);
}

function view(r: Row, full = false) {
  return {
    id: r.id,
    fromEmail: r.from_email,
    fromName: r.from_name,
    subject: r.subject,
    receivedAt: r.received_at,
    snippet: r.snippet,
    company: r.company,
    contact: r.contact,
    service: r.service,
    summary: r.summary,
    requirements: parse<string[]>(r.requirements, []),
    status: r.status,
    proposalIds: parse<number[]>(r.proposal_ids, []),
    repliedAt: r.replied_at,
    gmailUrl: `https://mail.google.com/mail/u/0/#all/${r.thread_id}`,
    knownClient: db.getClientByEmail(r.from_email)?.name ?? db.getAccountByEmail(r.from_email)?.name ?? null,
    ...(full ? { body: r.body } : {}),
  };
}

export async function handleInbox(route: string, id: number, req: IncomingMessage, res: ServerResponse, v: Viewer): Promise<boolean> {
  if (!route.includes('quote-requests') && !route.includes(' inbox/')) return false;
  requireOwner(v);
  switch (route) {
    case 'GET quote-requests': {
      const rows = sqlite.prepare('SELECT * FROM quote_requests WHERE is_quote = 1 ORDER BY received_at DESC LIMIT 200').all() as unknown as Row[];
      const g = google.connectionStatus();
      json(res, 200, {
        items: rows.map((r) => view(r)),
        inbox: { ...settings(), ...state(), connected: g.connected, canRead: canRead(), email: g.connected ? g.email : null },
      });
      return true;
    }
    case 'GET quote-requests/:id': {
      const r = getRequest(id);
      if (!r) throw new HttpError(404, 'La solicitud no existe.');
      json(res, 200, view(r, true));
      return true;
    }
    case 'PATCH quote-requests/:id': {
      const r = getRequest(id);
      if (!r) throw new HttpError(404, 'La solicitud no existe.');
      const body = await readJson(req);
      if (body.notQuote === true) {
        // No era una cotización: sale de la lista (queda como visto para no volver a revisarlo).
        sqlite.prepare("UPDATE quote_requests SET is_quote = 0, body = '' WHERE id = ?").run(r.id);
        json(res, 200, { ok: true });
        return true;
      }
      const status = ['nueva', 'en_proceso', 'respondida', 'descartada'].includes(String(body.status)) ? (body.status as RequestStatus) : r.status;
      sqlite.prepare('UPDATE quote_requests SET status = ? WHERE id = ?').run(status, r.id);
      json(res, 200, view(getRequest(r.id)!));
      return true;
    }
    case 'POST quote-requests/scan': {
      if (!canRead()) throw new HttpError(409, 'Falta el permiso para leer Gmail: vuelve a conectar Google en Configuración y acéptalo.');
      try {
        json(res, 200, await scan());
      } catch (err) {
        throw err instanceof google.GoogleError ? new HttpError(502, err.message) : err;
      }
      return true;
    }
    case 'PUT inbox/settings': {
      const body = await readJson(req);
      db.setSetting('inbox', { ...settings(), ...(typeof body.enabled === 'boolean' ? { enabled: body.enabled } : {}) });
      json(res, 200, settings());
      return true;
    }
  }
  return false;
}
