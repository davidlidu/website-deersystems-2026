import { randomBytes } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join } from 'node:path';
import { AiError, completeJson } from '../ai.ts';
import { DATA_DIR, PARTNERS_URL } from '../config.ts';
import { db as sqlite } from '../db.ts';
import * as google from '../google.ts';
import { HttpError, json, readBody, readJson, sendFile } from '../http.ts';
import { brandedMessage } from '../mail.ts';
import type { Viewer } from './auth.ts';
import { clientSees, EMAIL_RE, requireOwner, str } from './common.ts';
import * as db from './db.ts';
import { notify } from './notify.ts';

/**
 * Formularios y onboardings: los creas en Partners (a mano o con IA), los envías a un cliente con un enlace propio,
 * el cliente los llena (se guarda solo mientras escribe) y los envía. Las respuestas, los archivos y los comentarios
 * quedan en el espacio del cliente, para consultarlos tú y para la IA.
 *
 * Cada envío guarda una copia del formulario: si después editas el formulario, lo ya enviado no cambia.
 */

export type FieldType =
  | 'seccion'
  | 'texto'
  | 'parrafo'
  | 'email'
  | 'telefono'
  | 'numero'
  | 'fecha'
  | 'url'
  | 'unica'
  | 'multiple'
  | 'lista'
  | 'sino'
  | 'escala'
  | 'archivo';
export const FIELD_TYPES: FieldType[] = ['seccion', 'texto', 'parrafo', 'email', 'telefono', 'numero', 'fecha', 'url', 'unica', 'multiple', 'lista', 'sino', 'escala', 'archivo'];
const WITH_OPTIONS: FieldType[] = ['unica', 'multiple', 'lista'];

export interface Field {
  id: string;
  type: FieldType;
  label: string;
  help: string;
  required: boolean;
  options: string[];
}

export interface FormDef {
  title: string;
  description: string;
  fields: Field[];
  /** El cliente puede subir archivos (PNG, JPG, PDF, Excel, Word) además de los campos de tipo archivo. */
  allowFiles: boolean;
  /** Sección de comentarios al final. */
  comments: boolean;
}

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS forms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    def TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS form_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    form_id INTEGER,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    token TEXT NOT NULL UNIQUE,
    def TEXT NOT NULL,
    answers TEXT NOT NULL DEFAULT '{}',
    comment TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pendiente',
    sent_to TEXT NOT NULL DEFAULT '[]',
    submitted_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    submitted_at TEXT
  );
  CREATE INDEX IF NOT EXISTS form_links_client ON form_links(client_id, id);
  CREATE TABLE IF NOT EXISTS form_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    link_id INTEGER NOT NULL REFERENCES form_links(id) ON DELETE CASCADE,
    field_id TEXT,
    name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
`);

const FILES_DIR = join(DATA_DIR, 'form-files');
const MAX_FILE = 15 * 1024 * 1024;
const MAX_FILES = 40;
const now = () => new Date().toISOString();
const parse = <T>(s: string | null, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};

// ───────── Validación ─────────

export function cleanDef(raw: unknown): FormDef {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const used = new Set<string>();
  const fields = (Array.isArray(b.fields) ? b.fields : []).slice(0, 80).flatMap((x, i): Field[] => {
    const f = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const type = FIELD_TYPES.includes(f.type as FieldType) ? (f.type as FieldType) : 'texto';
    const label = str(f.label, 300);
    if (!label) return [];
    let id = str(f.id, 40).replace(/[^\w-]/g, '') || `c${i + 1}`;
    while (used.has(id)) id = `${id}_${i}`;
    used.add(id);
    const options = WITH_OPTIONS.includes(type)
      ? [...new Set((Array.isArray(f.options) ? f.options : []).map((o) => str(o, 200)).filter(Boolean))].slice(0, 40)
      : [];
    return [{ id, type, label, help: str(f.help, 600), required: type !== 'seccion' && f.required === true, options }];
  });
  return {
    title: str(b.title, 200),
    description: str(b.description, 3000),
    fields,
    allowFiles: b.allowFiles === true,
    comments: b.comments !== false,
  };
}

/** Solo se guardan respuestas a campos del formulario, con el tipo que corresponde. */
function cleanAnswers(def: FormDef, raw: unknown): Record<string, unknown> {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const f of def.fields) {
    if (f.type === 'seccion' || f.type === 'archivo' || !(f.id in b)) continue;
    const v = b[f.id];
    if (f.type === 'multiple') out[f.id] = (Array.isArray(v) ? v : []).map((x) => str(x, 200)).filter((x) => f.options.includes(x));
    else if (f.type === 'unica' || f.type === 'lista') out[f.id] = f.options.includes(String(v)) ? String(v) : '';
    else if (f.type === 'sino') out[f.id] = v === 'si' || v === 'no' ? v : '';
    else if (f.type === 'escala') out[f.id] = Number(v) >= 1 && Number(v) <= 5 ? Number(v) : '';
    else out[f.id] = str(v, f.type === 'parrafo' ? 10_000 : 1000);
  }
  return out;
}

const empty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);

/** Campos obligatorios sin responder (para no dejar enviar el formulario incompleto). */
function missingRequired(def: FormDef, answers: Record<string, unknown>, files: FileRow[]): string[] {
  return def.fields
    .filter((f) => f.required)
    .filter((f) => (f.type === 'archivo' ? !files.some((x) => x.field_id === f.id) : empty(answers[f.id])))
    .map((f) => f.label);
}

// ───────── Archivos ─────────

const ALLOWED: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.pdf': 'application/pdf',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/** El contenido debe coincidir con la extensión (no basta con renombrar un archivo). */
function looksRight(ext: string, data: Buffer): boolean {
  const head = data.subarray(0, 8);
  if (ext === '.png') return head.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  if (ext === '.jpg' || ext === '.jpeg') return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  if (ext === '.pdf') return head.subarray(0, 4).toString() === '%PDF';
  if (ext === '.xlsx' || ext === '.docx') return head[0] === 0x50 && head[1] === 0x4b; // zip (Office moderno)
  if (ext === '.xls' || ext === '.doc') return head.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0])); // Office 97-2003
  return false;
}

interface FileRow {
  id: number;
  link_id: number;
  field_id: string | null;
  name: string;
  mime: string;
  size: number;
  created_at: string;
}
const filePath = (f: Pick<FileRow, 'id' | 'link_id'>) => join(FILES_DIR, String(f.link_id), String(f.id));
const filesOf = (linkId: number) => sqlite.prepare('SELECT * FROM form_files WHERE link_id = ? ORDER BY id').all(linkId) as unknown as FileRow[];

// ───────── Envíos (enlaces) ─────────

interface LinkRow {
  id: number;
  form_id: number | null;
  client_id: number;
  project_id: number | null;
  token: string;
  def: string;
  answers: string;
  comment: string;
  status: 'pendiente' | 'en_progreso' | 'enviado';
  sent_to: string;
  submitted_by: string | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
}
const getLink = (id: number) => sqlite.prepare('SELECT * FROM form_links WHERE id = ?').get(id) as unknown as LinkRow | undefined;
const byToken = (t: string) => sqlite.prepare('SELECT * FROM form_links WHERE token = ?').get(t) as unknown as LinkRow | undefined;
export const formUrl = (token: string) => `${PARTNERS_URL}/f/${token}`;

function progress(def: FormDef, answers: Record<string, unknown>, files: FileRow[]) {
  const asked = def.fields.filter((f) => f.type !== 'seccion');
  const done = asked.filter((f) => (f.type === 'archivo' ? files.some((x) => x.field_id === f.id) : !empty(answers[f.id]))).length;
  return { done, total: asked.length };
}

function linkSummary(l: LinkRow) {
  const def = cleanDef(parse(l.def, {}));
  const files = filesOf(l.id);
  const client = db.getClient(l.client_id);
  const project = l.project_id ? db.getProject(l.project_id) : undefined;
  return {
    id: l.id,
    formId: l.form_id,
    title: def.title,
    clientId: l.client_id,
    clientName: client?.name ?? '',
    projectId: l.project_id,
    projectName: project?.name ?? null,
    status: l.status,
    url: formUrl(l.token),
    progress: progress(def, parse(l.answers, {}), files),
    files: files.length,
    createdAt: l.created_at,
    updatedAt: l.updated_at,
    submittedAt: l.submitted_at,
    submittedBy: l.submitted_by,
    sentTo: parse<string[]>(l.sent_to, []),
  };
}

function linkDetail(l: LinkRow, base = '/api') {
  return {
    ...linkSummary(l),
    def: cleanDef(parse(l.def, {})),
    answers: parse<Record<string, unknown>>(l.answers, {}),
    comment: l.comment,
    fileList: filesOf(l.id).map((f) => ({ id: f.id, fieldId: f.field_id, name: f.name, mime: f.mime, size: f.size, createdAt: f.created_at, url: `${base}/form-files/${f.id}` })),
  };
}

/** Las respuestas en texto, para la IA y para leerlas de corrido (p. ej. en el espacio del cliente). */
export function answersText(l: LinkRow): string {
  const def = cleanDef(parse(l.def, {}));
  const answers = parse<Record<string, unknown>>(l.answers, {});
  const files = filesOf(l.id);
  const lines = [`# ${def.title}`];
  for (const f of def.fields) {
    if (f.type === 'seccion') lines.push('', `## ${f.label}`);
    else if (f.type === 'archivo') lines.push(`- ${f.label}: ${files.filter((x) => x.field_id === f.id).map((x) => x.name).join(', ') || '(sin archivo)'}`);
    else {
      const v = answers[f.id];
      lines.push(`- ${f.label}: ${empty(v) ? '(sin respuesta)' : Array.isArray(v) ? v.join(', ') : String(v)}`);
    }
  }
  const loose = files.filter((x) => !x.field_id);
  if (loose.length) lines.push('', `Archivos adjuntos: ${loose.map((x) => x.name).join(', ')}`);
  if (l.comment) lines.push('', `Comentarios: ${l.comment}`);
  return lines.join('\n');
}

/** Formularios de un cliente con sus respuestas en texto (para la IA en la próxima fase y el conector MCP). */
export function clientFormsText(clientId: number): { title: string; status: string; submittedAt: string | null; text: string }[] {
  return (sqlite.prepare('SELECT * FROM form_links WHERE client_id = ? ORDER BY id DESC').all(clientId) as unknown as LinkRow[]).map((l) => ({
    title: cleanDef(parse(l.def, {})).title,
    status: l.status,
    submittedAt: l.submitted_at,
    text: answersText(l),
  }));
}

// ───────── IA ─────────

async function draftWithAi(brief: string): Promise<FormDef> {
  if (brief.length < 15) throw new HttpError(400, 'Describe un poco más el formulario: para qué es y qué información necesitas.');
  const { data } = await completeJson<Record<string, unknown>>({
    profile: 'propuestas',
    purpose: 'formulario',
    system: `Eres el asistente de DeerSystems, una agencia colombiana de desarrollo web, automatización e IA. Diseñas formularios de onboarding claros y cortos para que los clientes entreguen la información de su proyecto.
Escribe en español neutro, tuteando. Agrupa con secciones. Usa el tipo de campo que mejor sirva y marca como obligatorio solo lo indispensable.
Devuelve SOLO JSON con esta forma:
{"title": "...", "description": "1 o 2 frases de para qué es y cuánto toma", "allowFiles": true si conviene que suban logos, fotos o documentos, "comments": true,
 "fields": [{"type": "seccion | texto | parrafo | email | telefono | numero | fecha | url | unica | multiple | lista | sino | escala | archivo", "label": "pregunta", "help": "ayuda corta o vacío", "required": true|false, "options": ["solo para unica, multiple y lista"]}]}
"escala" es de 1 a 5. "archivo" es para pedir un archivo concreto (logo, manual de marca, catálogo en PDF o Excel...).`,
    prompt: brief.slice(0, 4000),
    maxOutputTokens: 4000,
  });
  return cleanDef(data);
}

// ───────── API del administrador (y del cliente para lo suyo) ─────────

interface FormRow {
  id: number;
  def: string;
  created_at: string;
  updated_at: string;
}
const formView = (f: FormRow) => {
  const sent = sqlite.prepare('SELECT COUNT(*) AS n, SUM(status = \'enviado\') AS done FROM form_links WHERE form_id = ?').get(f.id) as { n: number; done: number | null };
  return { id: f.id, def: cleanDef(parse(f.def, {})), updatedAt: f.updated_at, sent: sent.n, answered: sent.done ?? 0 };
};

/** Un envío que esta persona puede ver: tú, o alguien del cliente dueño del formulario. */
function visibleLink(id: number, v: Viewer): LinkRow {
  const l = getLink(id);
  if (!l) throw new HttpError(404, 'El formulario no existe.');
  if (v.kind === 'owner') return l;
  if (v.kind === 'client' && v.clientId === l.client_id) {
    const p = l.project_id ? db.getProject(l.project_id) : undefined;
    if (!p || clientSees(v, p)) return l;
  }
  throw new HttpError(404, 'El formulario no existe.');
}

export async function handleForms(route: string, id: number, req: IncomingMessage, res: ServerResponse, v: Viewer): Promise<boolean> {
  if (!/ (forms|form-links|form-files|clients\/:id\/forms|me\/forms)/.test(route)) return false;
  switch (route) {
    case 'GET forms': {
      requireOwner(v);
      const forms = sqlite.prepare('SELECT * FROM forms ORDER BY updated_at DESC').all() as unknown as FormRow[];
      const links = sqlite.prepare('SELECT * FROM form_links ORDER BY id DESC LIMIT 300').all() as unknown as LinkRow[];
      const clients = db.listClients().map((c) => ({ id: c.id, name: c.name, email: c.email, contact: c.contact_name, projects: db.listProjects(c.id).map((p) => ({ id: p.id, name: p.name })) }));
      json(res, 200, { forms: forms.map(formView), links: links.map(linkSummary), clients });
      return true;
    }
    case 'POST forms':
    case 'PUT forms/:id': {
      requireOwner(v);
      const body = await readJson(req, 200_000);
      const def = cleanDef(body.def);
      if (!def.title) throw new HttpError(400, 'Ponle un título al formulario.');
      if (!def.fields.some((f) => f.type !== 'seccion')) throw new HttpError(400, 'Agrega al menos una pregunta.');
      for (const f of def.fields) if (WITH_OPTIONS.includes(f.type) && f.options.length < 2) throw new HttpError(400, `«${f.label}» necesita al menos dos opciones.`);
      if (route.startsWith('PUT')) {
        const r = sqlite.prepare('UPDATE forms SET def = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(def), now(), id);
        if (!r.changes) throw new HttpError(404, 'El formulario no existe.');
      } else {
        id = Number(sqlite.prepare('INSERT INTO forms (def, created_at, updated_at) VALUES (?, ?, ?)').run(JSON.stringify(def), now(), now()).lastInsertRowid);
      }
      json(res, 200, formView(sqlite.prepare('SELECT * FROM forms WHERE id = ?').get(id) as unknown as FormRow));
      return true;
    }
    case 'DELETE forms/:id':
      requireOwner(v);
      // Lo ya enviado se conserva (tiene su propia copia del formulario).
      sqlite.prepare('DELETE FROM forms WHERE id = ?').run(id);
      json(res, 200, { ok: true });
      return true;

    case 'POST forms/draft': {
      requireOwner(v);
      const body = await readJson(req);
      try {
        json(res, 200, await draftWithAi(str(body.brief, 4000)));
      } catch (err) {
        if (err instanceof AiError) throw new HttpError(502, err.message);
        throw err;
      }
      return true;
    }

    // Enviar a un cliente: crea su enlace (con una copia del formulario) y, si hay correos, se lo manda con la marca.
    case 'POST forms/:id/send': {
      requireOwner(v);
      const f = sqlite.prepare('SELECT * FROM forms WHERE id = ?').get(id) as unknown as FormRow | undefined;
      if (!f) throw new HttpError(404, 'El formulario no existe.');
      const body = await readJson(req);
      const client = db.getClient(Number(body.clientId));
      if (!client) throw new HttpError(400, 'Elige el cliente.');
      const project = Number(body.projectId) ? db.getProject(Number(body.projectId)) : undefined;
      if (project && project.client_id !== client.id) throw new HttpError(400, 'El proyecto no es de ese cliente.');
      const to = [...new Set((Array.isArray(body.to) ? body.to : []).map((e) => str(e, 200).toLowerCase()).filter((e) => EMAIL_RE.test(e)))].slice(0, 20);
      const def = cleanDef(parse(f.def, {}));
      const token = randomBytes(24).toString('base64url');
      const t = now();
      const linkId = Number(
        sqlite
          .prepare('INSERT INTO form_links (form_id, client_id, project_id, token, def, sent_to, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(f.id, client.id, project?.id ?? null, token, JSON.stringify(def), JSON.stringify(to), t, t).lastInsertRowid,
      );
      const url = formUrl(token);
      const mailed: string[] = [];
      const errors: string[] = [];
      if (to.length) {
        if (!google.connectionStatus().connected) errors.push('Google no está conectado: copia el enlace y envíalo por otro medio.');
        else {
          const message = str(body.message, 3000) || `Hola {nombre},\n\nPara avanzar con tu proyecto necesitamos que nos compartas algunos datos. Te toma unos minutos y se guarda solo mientras lo llenas: puedes dejarlo y seguir después.`;
          for (const email of to) {
            const name = (db.listClientAccounts(client.id).find((a) => a.email.toLowerCase() === email)?.name || client.contact_name || '').split(/\s+/)[0];
            try {
              await google.sendMail(
                brandedMessage({
                  to: email,
                  subject: str(body.subject, 200) || `${def.title} · DeerSystems`,
                  eyebrow: 'Formulario',
                  title: def.title,
                  body: message.replace(/\{nombre\}/g, name).replace(/Hola ,/g, 'Hola,'),
                  cta: { label: 'Llenar el formulario', url },
                  footnote: 'Si tienes dudas, responde este correo.',
                }),
              );
              mailed.push(email);
            } catch (err) {
              errors.push(`${email}: ${(err as Error).message}`);
            }
          }
        }
      }
      // Aviso en el portal (y push) a las personas del cliente que ven el proyecto.
      if (project) notify('form_requested', { actor: v, projectId: project.id, title: `Tienes un formulario por llenar: «${def.title}»`, body: 'Se guarda solo mientras lo llenas.', path: `/f/${token}` });
      json(res, 201, { link: linkSummary(getLink(linkId)!), mailed, errors });
      return true;
    }

    case 'GET form-links/:id':
      json(res, 200, linkDetail(visibleLink(id, v)));
      return true;
    case 'POST form-links/:id/reopen': {
      requireOwner(v);
      const l = visibleLink(id, v);
      sqlite.prepare("UPDATE form_links SET status = 'en_progreso', updated_at = ? WHERE id = ?").run(now(), l.id);
      json(res, 200, linkSummary(getLink(l.id)!));
      return true;
    }
    case 'DELETE form-links/:id': {
      requireOwner(v);
      const l = visibleLink(id, v);
      sqlite.prepare('DELETE FROM form_links WHERE id = ?').run(l.id);
      await rm(join(FILES_DIR, String(l.id)), { recursive: true, force: true });
      json(res, 200, { ok: true });
      return true;
    }
    case 'GET form-files/:id': {
      const f = sqlite.prepare('SELECT * FROM form_files WHERE id = ?').get(id) as unknown as FileRow | undefined;
      if (!f) throw new HttpError(404, 'El archivo no existe.');
      visibleLink(f.link_id, v);
      await serveFile(req, res, f);
      return true;
    }

    // El espacio del cliente: sus formularios (tú en la ficha del cliente; el cliente, los suyos).
    case 'GET clients/:id/forms': {
      requireOwner(v);
      const rows = sqlite.prepare('SELECT * FROM form_links WHERE client_id = ? ORDER BY id DESC').all(id) as unknown as LinkRow[];
      json(res, 200, rows.map(linkSummary));
      return true;
    }
    case 'GET me/forms': {
      if (v.kind !== 'client') {
        json(res, 200, []);
        return true;
      }
      const rows = (sqlite.prepare('SELECT * FROM form_links WHERE client_id = ? ORDER BY id DESC').all(v.clientId) as unknown as LinkRow[]).filter((l) => {
        const p = l.project_id ? db.getProject(l.project_id) : undefined;
        return !p || clientSees(v, p);
      });
      json(res, 200, rows.map(linkSummary));
      return true;
    }
  }
  return false;
}

async function serveFile(req: IncomingMessage, res: ServerResponse, f: FileRow) {
  const safe = f.name.replace(/[^\w.\- ()áéíóúñÁÉÍÓÚÑ]/g, '_');
  const ok = await sendFile(req, res, filePath(f), {
    'Content-Type': f.mime,
    'Content-Disposition': `${f.mime.startsWith('image/') || f.mime === 'application/pdf' ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(safe)}`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  if (!ok) throw new HttpError(404, 'El archivo no está disponible.');
}

// ───────── Formulario público: /f/{token} (el cliente lo llena sin iniciar sesión) ─────────

/** /api/public/forms/{token}[/submit | /files | /files/{id}] — el enlace es la llave (24 bytes al azar). */
export async function handlePublicForms(req: IncomingMessage, res: ServerResponse, url: URL, origin: string): Promise<void> {
  const parts = url.pathname.slice('/api/public/forms/'.length).split('/');
  const l = byToken(parts[0] ?? '');
  if (!l) throw new HttpError(404, 'Este enlace no existe o ya no está disponible.');
  if (req.method !== 'GET' && req.headers.origin !== origin) throw new HttpError(403, 'Origen no permitido.');
  const def = cleanDef(parse(l.def, {}));
  const base = `/api/public/forms/${l.token}`;
  const detail = () => {
    const d = linkDetail(getLink(l.id)!, base);
    // Lo que ve el cliente: sin datos internos de envío.
    return { ...d, sentTo: undefined, fileList: d.fileList.map((f) => ({ ...f, url: `${base}/files/${f.id}` })) };
  };
  const locked = l.status === 'enviado';
  const sub = parts.slice(1).join('/');

  if (req.method === 'GET' && sub === '') return json(res, 200, detail());
  if (req.method === 'GET' && /^files\/\d+$/.test(sub)) {
    const f = filesOf(l.id).find((x) => x.id === Number(parts[2]));
    if (!f) throw new HttpError(404, 'El archivo no existe.');
    return serveFile(req, res, f);
  }
  if (locked) throw new HttpError(409, 'Este formulario ya se envió. Si necesitas cambiar algo, escríbenos y lo reabrimos.');

  // Guardar mientras escribe.
  if (req.method === 'PUT' && sub === '') {
    const body = await readJson(req, 300_000);
    const answers = { ...parse<Record<string, unknown>>(l.answers, {}), ...cleanAnswers(def, body.answers) };
    const comment = def.comments && typeof body.comment === 'string' ? body.comment.trim().slice(0, 10_000) : l.comment;
    sqlite.prepare("UPDATE form_links SET answers = ?, comment = ?, status = 'en_progreso', updated_at = ? WHERE id = ?").run(JSON.stringify(answers), comment, now(), l.id);
    return json(res, 200, { ok: true, savedAt: now() });
  }

  if (req.method === 'POST' && sub === 'submit') {
    const body = await readJson(req, 300_000);
    const answers = { ...parse<Record<string, unknown>>(l.answers, {}), ...cleanAnswers(def, body.answers) };
    const comment = def.comments && typeof body.comment === 'string' ? body.comment.trim().slice(0, 10_000) : l.comment;
    const missing = missingRequired(def, answers, filesOf(l.id));
    if (missing.length) throw new HttpError(400, `Faltan respuestas obligatorias: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}.`);
    const who = str(body.name, 160);
    sqlite
      .prepare("UPDATE form_links SET answers = ?, comment = ?, status = 'enviado', submitted_at = ?, submitted_by = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(answers), comment, now(), who || null, now(), l.id);
    const client = db.getClient(l.client_id);
    notify('form_submitted', {
      actor: null,
      projectId: l.project_id,
      title: `${client?.name ?? 'Un cliente'} envió «${def.title}»`,
      body: who ? `Lo llenó ${who}.` : 'Ya puedes ver las respuestas.',
      path: `/formularios?envio=${l.id}`,
    });
    if (l.project_id) db.logActivity({ projectId: l.project_id, actorKind: 'client', actorName: who || client?.name || 'Cliente', type: 'form_submitted', data: { title: def.title } });
    return json(res, 200, detail());
  }

  // Subir un archivo (a un campo de tipo archivo, o como adjunto si el formulario lo permite).
  if (req.method === 'POST' && sub === 'files') {
    const fieldId = url.searchParams.get('field') || null;
    const field = fieldId ? def.fields.find((f) => f.id === fieldId && f.type === 'archivo') : undefined;
    if (fieldId && !field) throw new HttpError(400, 'Ese campo no recibe archivos.');
    if (!fieldId && !def.allowFiles) throw new HttpError(403, 'Este formulario no recibe archivos adjuntos.');
    if (filesOf(l.id).length >= MAX_FILES) throw new HttpError(400, `Máximo ${MAX_FILES} archivos por formulario.`);
    const name = (url.searchParams.get('filename') ?? '').trim().replace(/[\\/]/g, '-').slice(0, 200);
    const ext = extname(name).toLowerCase();
    if (!ALLOWED[ext]) throw new HttpError(400, 'Solo se aceptan imágenes PNG o JPG, documentos PDF, Excel (.xls, .xlsx) o Word (.doc, .docx).');
    const data = await readBody(req, MAX_FILE);
    if (!data.length) throw new HttpError(400, 'El archivo está vacío.');
    if (!looksRight(ext, data)) throw new HttpError(400, `«${name}» no parece un archivo ${ext.slice(1).toUpperCase()} válido.`);
    const fileId = Number(
      sqlite
        .prepare('INSERT INTO form_files (link_id, field_id, name, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(l.id, fieldId, name, ALLOWED[ext], data.length, now()).lastInsertRowid,
    );
    await mkdir(join(FILES_DIR, String(l.id)), { recursive: true });
    await writeFile(filePath({ id: fileId, link_id: l.id }), data);
    sqlite.prepare("UPDATE form_links SET status = 'en_progreso', updated_at = ? WHERE id = ?").run(now(), l.id);
    return json(res, 201, detail());
  }
  if (req.method === 'DELETE' && /^files\/\d+$/.test(sub)) {
    const f = filesOf(l.id).find((x) => x.id === Number(parts[2]));
    if (!f) throw new HttpError(404, 'El archivo no existe.');
    sqlite.prepare('DELETE FROM form_files WHERE id = ?').run(f.id);
    await rm(filePath(f), { force: true });
    return json(res, 200, detail());
  }
  throw new HttpError(404, 'Ruta no encontrada.');
}
