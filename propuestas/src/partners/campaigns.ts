import type { IncomingMessage, ServerResponse } from 'node:http';
import { SUPERADMIN_EMAIL } from '../config.ts';
import { db as sqlite } from '../db.ts';
import * as google from '../google.ts';
import { HttpError, json, readJson } from '../http.ts';
import { brandedMessage } from '../mail.ts';
import type { Viewer } from './auth.ts';
import { EMAIL_RE, requireOwner, str } from './common.ts';
import * as db from './db.ts';

/**
 * Correos con la marca desde Partners (solo el administrador): renovaciones de dominio y hosting, avisos,
 * recordatorios. Un mismo mensaje a varios destinatarios, cada uno en su propio correo (nadie ve a los demás) y con
 * sus datos: {nombre}, {empresa}, {correo} y los que agregues (p. ej. {dominio}, {vence}, {valor}).
 * Se envía desde la cuenta de Google conectada; queda el historial con el resultado de cada envío.
 */

export interface Draft {
  subject: string;
  eyebrow: string;
  title: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  footnote: string;
  /** Datos propios de cada destinatario (además de nombre, empresa y correo), p. ej. ["dominio", "vence", "valor"]. */
  fields: string[];
}

export interface Recipient {
  email: string;
  name: string;
  company: string;
  /** Valor de cada dato propio para este destinatario. */
  data: Record<string, string>;
}

interface Result {
  email: string;
  ok: boolean;
  error?: string;
}

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS mail_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    draft TEXT NOT NULL,
    seed_key TEXT UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS mail_campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject TEXT NOT NULL,
    draft TEXT NOT NULL,
    recipients TEXT NOT NULL DEFAULT '[]',
    results TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'enviando',
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    finished_at TEXT
  );
`);

const now = () => new Date().toISOString();
const parse = <T>(s: string | null, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};

// Un envío que quedó a medias cuando el servidor se reinició (despliegue) no va a terminar.
sqlite.prepare("UPDATE mail_campaigns SET status = 'interrumpido', finished_at = ? WHERE status = 'enviando'").run(now());

/** Nombre de un dato propio como variable: «Fecha de vencimiento» → fecha_de_vencimiento. */
const fieldKey = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30);

export function cleanDraft(raw: unknown): Draft {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const fields = [...new Set((Array.isArray(b.fields) ? b.fields : []).map((f) => fieldKey(str(f, 40))).filter(Boolean))]
    .filter((f) => !['nombre', 'empresa', 'correo'].includes(f))
    .slice(0, 8);
  return {
    subject: str(b.subject, 200),
    eyebrow: str(b.eyebrow, 80),
    title: str(b.title, 200),
    body: typeof b.body === 'string' ? b.body.trim().slice(0, 20_000) : '',
    ctaLabel: str(b.ctaLabel, 80),
    ctaUrl: /^https?:\/\//.test(str(b.ctaUrl, 500)) ? str(b.ctaUrl, 500) : '',
    footnote: str(b.footnote, 500),
    fields,
  };
}

function cleanRecipients(raw: unknown, fields: string[]): Recipient[] {
  const seen = new Set<string>();
  const out: Recipient[] = [];
  for (const x of Array.isArray(raw) ? raw : []) {
    const r = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const email = str(r.email, 200).toLowerCase();
    if (!EMAIL_RE.test(email) || seen.has(email)) continue;
    seen.add(email);
    const data = (r.data && typeof r.data === 'object' ? r.data : {}) as Record<string, unknown>;
    out.push({
      email,
      name: str(r.name, 160),
      company: str(r.company, 160),
      data: Object.fromEntries(fields.map((f) => [f, str(data[f], 300)])),
    });
  }
  return out.slice(0, 500);
}

/** Reemplaza {nombre}, {empresa}, {correo} y los datos propios. Si no hay nombre, el saludo queda sin él. */
function fill(text: string, r: Recipient): string {
  const first = r.name.split(/\s+/)[0] ?? '';
  const values: Record<string, string> = { nombre: first, nombre_completo: r.name, empresa: r.company, correo: r.email, ...r.data };
  return text
    .replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? values[k] : m))
    .replace(/Hola ,/g, 'Hola,')
    .replace(/[ \t]{2,}/g, ' ');
}

function render(d: Draft, r: Recipient) {
  return brandedMessage({
    to: r.email,
    subject: fill(d.subject, r),
    eyebrow: fill(d.eyebrow, r),
    title: fill(d.title, r),
    body: fill(d.body, r),
    cta: d.ctaLabel && d.ctaUrl ? { label: fill(d.ctaLabel, r), url: fill(d.ctaUrl, r) } : null,
    footnote: fill(d.footnote, r),
  });
}

/** Variables que usa el mensaje y que le faltan a algún destinatario (para avisar antes de enviar). */
function missing(d: Draft, list: Recipient[]): { email: string; fields: string[] }[] {
  const text = [d.subject, d.eyebrow, d.title, d.body, d.ctaLabel, d.ctaUrl, d.footnote].join('\n');
  const used = new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  return list
    .map((r) => ({
      email: r.email,
      fields: [...used].filter((k) => (k === 'empresa' ? !r.company : k === 'nombre' || k === 'nombre_completo' ? !r.name : k in r.data ? !r.data[k] : false)),
    }))
    .filter((x) => x.fields.length);
}

// ───────── Plantillas de correo ─────────

const SEEDS: { key: string; name: string; draft: Draft }[] = [
  {
    key: 'renovacion-dominio-hosting',
    name: 'Renovación de dominio y hosting',
    draft: {
      subject: 'Renovación de tu dominio y hosting · {dominio}',
      eyebrow: 'Renovación de servicios',
      title: 'Es momento de renovar tu dominio y hosting',
      body: [
        'Hola {nombre},',
        'Te escribimos para recordarte que el dominio **{dominio}** y el hosting de tu sitio web vencen el **{vence}**.',
        'Para que tu sitio y tus correos sigan funcionando sin interrupciones, la renovación por un año tiene un valor de **{valor}**.',
        '## Qué incluye la renovación',
        '- Dominio {dominio} por un año más\n- Hosting con certificado de seguridad (SSL)\n- Copias de seguridad y soporte de DeerSystems',
        'Responde este correo para confirmar la renovación y te enviamos la cuenta de cobro. Si ya hiciste el pago, no tienes que hacer nada más.',
      ].join('\n\n'),
      ctaLabel: '',
      ctaUrl: '',
      footnote: 'Si el dominio vence, el sitio y los correos dejan de funcionar y recuperarlo puede tener un costo adicional.',
      fields: ['dominio', 'vence', 'valor'],
    },
  },
];

function seed(): void {
  const done = new Set(db.getSetting<string[]>('mail_templates_seeded') ?? []);
  for (const s of SEEDS) {
    if (done.has(s.key)) continue;
    sqlite
      .prepare('INSERT OR IGNORE INTO mail_templates (name, draft, seed_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(s.name, JSON.stringify(s.draft), s.key, now(), now());
    done.add(s.key);
  }
  db.setSetting('mail_templates_seeded', [...done]);
}
seed();

interface TemplateRow {
  id: number;
  name: string;
  draft: string;
  seed_key: string | null;
  updated_at: string;
}
const templateView = (t: TemplateRow) => ({ id: t.id, name: t.name, base: !!t.seed_key, updatedAt: t.updated_at, draft: cleanDraft(parse(t.draft, {})) });

// ───────── Destinatarios sugeridos ─────────

/** Los clientes con sus correos (acceso al portal, contacto y otros), para elegir a quién enviar. */
function contacts() {
  return db.listClients().flatMap((c) => {
    const out: { clientId: number; email: string; name: string; company: string; label: string }[] = [];
    const add = (email: string | null | undefined, name: string, label: string) => {
      const e = email?.trim().toLowerCase();
      if (e && EMAIL_RE.test(e) && !out.some((x) => x.email === e)) out.push({ clientId: c.id, email: e, name, company: c.name, label });
    };
    for (const a of db.listClientAccounts(c.id)) if (a.active) add(a.email, a.name || c.contact_name, a.is_primary ? 'Cuenta principal' : 'Acceso al portal');
    add(c.email, c.contact_name || '', 'Correo de contacto');
    for (const e of db.extraEmails(c)) add(e.email, '', e.label || 'Otro correo');
    return out;
  });
}

// ───────── Envío ─────────

interface CampaignRow {
  id: number;
  subject: string;
  draft: string;
  recipients: string;
  results: string;
  status: 'enviando' | 'enviado' | 'con_errores' | 'interrumpido';
  created_by: string;
  created_at: string;
  finished_at: string | null;
}
const getCampaign = (id: number) => sqlite.prepare('SELECT * FROM mail_campaigns WHERE id = ?').get(id) as unknown as CampaignRow | undefined;
const campaignView = (c: CampaignRow, full = false) => {
  const recipients = parse<Recipient[]>(c.recipients, []);
  const results = parse<Result[]>(c.results, []);
  return {
    id: c.id,
    subject: c.subject,
    status: c.status,
    total: recipients.length,
    sent: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    createdAt: c.created_at,
    finishedAt: c.finished_at,
    ...(full ? { draft: cleanDraft(parse(c.draft, {})), recipients, results } : {}),
  };
};

/** Uno por uno, con una pausa corta para no chocar con los límites de Gmail. */
async function run(id: number, d: Draft, list: Recipient[]): Promise<void> {
  const results: Result[] = [];
  for (const r of list) {
    try {
      await google.sendMail(render(d, r));
      results.push({ email: r.email, ok: true });
    } catch (err) {
      results.push({ email: r.email, ok: false, error: (err as Error).message.slice(0, 300) });
    }
    sqlite.prepare('UPDATE mail_campaigns SET results = ? WHERE id = ?').run(JSON.stringify(results), id);
    await new Promise((ok) => setTimeout(ok, 400));
  }
  const status = results.some((r) => !r.ok) ? 'con_errores' : 'enviado';
  sqlite.prepare('UPDATE mail_campaigns SET status = ?, finished_at = ? WHERE id = ?').run(status, now(), id);
}

function requireGoogle() {
  if (!google.connectionStatus().connected) throw new HttpError(503, 'Conecta Google en Configuración para enviar correos.');
}

export async function handleCampaigns(route: string, id: number, req: IncomingMessage, res: ServerResponse, v: Viewer): Promise<boolean> {
  if (!route.includes('mail-')) return false;
  requireOwner(v);
  switch (route) {
    case 'GET mail-campaigns': {
      const rows = sqlite.prepare('SELECT * FROM mail_campaigns ORDER BY id DESC LIMIT 100').all() as unknown as CampaignRow[];
      const templates = sqlite.prepare('SELECT * FROM mail_templates ORDER BY name COLLATE NOCASE').all() as unknown as TemplateRow[];
      const g = google.connectionStatus();
      json(res, 200, {
        campaigns: rows.map((c) => campaignView(c)),
        templates: templates.map(templateView),
        contacts: contacts(),
        from: g.connected ? g.email : null,
      });
      return true;
    }
    case 'GET mail-campaigns/:id': {
      const c = getCampaign(id);
      if (!c) throw new HttpError(404, 'El envío no existe.');
      json(res, 200, campaignView(c, true));
      return true;
    }

    // Vista previa con los datos de un destinatario (o de ejemplo) y lo que les falta a los demás.
    case 'POST mail-campaigns/preview': {
      const body = await readJson(req, 2_000_000);
      const d = cleanDraft(body.draft);
      const list = cleanRecipients(body.recipients, d.fields);
      const sample = list[Number(body.index) || 0] ?? { email: 'cliente@empresa.com', name: 'Nombre', company: 'Empresa', data: Object.fromEntries(d.fields.map((f) => [f, `{${f}}`])) };
      const m = render(d, sample);
      json(res, 200, { to: m.to, subject: m.subject, html: m.html, missing: missing(d, list) });
      return true;
    }

    // Prueba: el correo con los datos del primer destinatario, a tu propia cuenta.
    case 'POST mail-campaigns/test': {
      requireGoogle();
      const body = await readJson(req, 2_000_000);
      const d = cleanDraft(body.draft);
      if (!d.subject || !d.body) throw new HttpError(400, 'Escribe el asunto y el mensaje.');
      const list = cleanRecipients(body.recipients, d.fields);
      const sample = list[Number(body.index) || 0] ?? { email: SUPERADMIN_EMAIL, name: '', company: '', data: {} };
      const to = google.connectionStatus().connected ? (google.connectionStatus() as { email: string }).email || SUPERADMIN_EMAIL : SUPERADMIN_EMAIL;
      const m = render(d, sample);
      try {
        await google.sendMail({ ...m, to, subject: `[Prueba] ${m.subject}` });
      } catch (err) {
        throw err instanceof google.GoogleError ? new HttpError(502, err.message) : err;
      }
      json(res, 200, { ok: true, to });
      return true;
    }

    case 'POST mail-campaigns': {
      requireGoogle();
      const body = await readJson(req, 2_000_000);
      const d = cleanDraft(body.draft);
      if (!d.subject) throw new HttpError(400, 'Escribe el asunto.');
      if (!d.body) throw new HttpError(400, 'Escribe el mensaje.');
      const list = cleanRecipients(body.recipients, d.fields);
      if (!list.length) throw new HttpError(400, 'Agrega al menos un destinatario con un correo válido.');
      const { lastInsertRowid } = sqlite
        .prepare('INSERT INTO mail_campaigns (subject, draft, recipients, created_by, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(d.subject, JSON.stringify(d), JSON.stringify(list), v.email, now());
      const cid = Number(lastInsertRowid);
      void run(cid, d, list).catch((err) => {
        console.error('Envío de correos:', err);
        sqlite.prepare("UPDATE mail_campaigns SET status = 'con_errores', finished_at = ? WHERE id = ?").run(now(), cid);
      });
      json(res, 201, campaignView(getCampaign(cid)!));
      return true;
    }

    case 'POST mail-templates':
    case 'PUT mail-templates/:id': {
      const body = await readJson(req, 200_000);
      const name = str(body.name, 120);
      if (!name) throw new HttpError(400, 'Ponle un nombre a la plantilla.');
      const d = cleanDraft(body.draft);
      if (!d.subject || !d.body) throw new HttpError(400, 'La plantilla necesita asunto y mensaje.');
      if (route.startsWith('PUT')) {
        const r = sqlite.prepare('UPDATE mail_templates SET name = ?, draft = ?, updated_at = ? WHERE id = ?').run(name, JSON.stringify(d), now(), id);
        if (!r.changes) throw new HttpError(404, 'La plantilla no existe.');
      } else {
        id = Number(sqlite.prepare('INSERT INTO mail_templates (name, draft, created_at, updated_at) VALUES (?, ?, ?, ?)').run(name, JSON.stringify(d), now(), now()).lastInsertRowid);
      }
      json(res, 200, templateView(sqlite.prepare('SELECT * FROM mail_templates WHERE id = ?').get(id) as unknown as TemplateRow));
      return true;
    }
    case 'DELETE mail-templates/:id':
      sqlite.prepare('DELETE FROM mail_templates WHERE id = ?').run(id);
      json(res, 200, { ok: true });
      return true;
  }
  return false;
}
