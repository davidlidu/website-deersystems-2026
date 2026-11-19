import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AiError } from '../ai.ts';
import { HOME_URL } from '../config.ts';
import { db as sqlite, getProposal, type Proposal } from '../db.ts';
import * as google from '../google.ts';
import { HttpError, json, readJson } from '../http.ts';
import * as mail from '../mail.ts';
import { resolveFile } from '../storage.ts';
import { EMAIL_RE, str } from './common.ts';
import * as db from './db.ts';
import { extractDraft, type Draft } from './extract.ts';
import { notify } from './notify.ts';
import type { PaymentInput } from './payments.ts';

/**
 * Aprobación desde la propuesta: el cliente abre /{slug}/aprobar, elige la opción y acepta.
 * Queda registrado quién, cuándo y qué versión aprobó, y en segundo plano la IA arma el plan de trabajo.
 * No se crea nada para el cliente (acceso, reuniones, cobros) hasta que tú revisas el plan y creas el proyecto.
 */

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS proposal_approvals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    proposal_id INTEGER NOT NULL,
    version INTEGER NOT NULL,
    option_id TEXT NOT NULL DEFAULT '',
    option_name TEXT NOT NULL DEFAULT '',
    option_summary TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    company TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    ip TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'generando',
    draft TEXT,
    ai TEXT,
    error TEXT,
    project_id INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS proposal_approvals_proposal ON proposal_approvals(proposal_id);
  -- Opciones o fases que se retiraron del alcance de un proyecto después de aprobadas (ver scope.ts).
  CREATE TABLE IF NOT EXISTS scope_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    option_id TEXT NOT NULL DEFAULT '',
    option_name TEXT NOT NULL DEFAULT '',
    amount REAL,
    currency TEXT NOT NULL DEFAULT 'COP',
    reason TEXT NOT NULL DEFAULT '',
    label_before TEXT NOT NULL DEFAULT '',
    label_after TEXT NOT NULL DEFAULT '',
    phases TEXT NOT NULL DEFAULT '[]',
    tasks_removed INTEGER NOT NULL DEFAULT 0,
    payments TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS scope_changes_project ON scope_changes(project_id, id);
`);

/**
 * Propuesta vinculada a un cliente que ya existe: al aprobarla desde el enlace no se le piden sus datos
 * (ya los tienes) y el proyecto se crea para ese cliente. Sin vínculo, es un cliente nuevo y llena el formulario.
 */
const hasColumn = (table: string, col: string) => (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === col);
if (!hasColumn('proposals', 'client_id')) sqlite.exec('ALTER TABLE proposals ADD COLUMN client_id INTEGER');
if (!hasColumn('proposal_approvals', 'client_id')) sqlite.exec('ALTER TABLE proposal_approvals ADD COLUMN client_id INTEGER');

/** El cliente vinculado a la propuesta: el elegido a mano o, si no, el de un proyecto que ya salió de ella. */
export function proposalClient(proposalId: number): db.Client | null {
  const row = sqlite.prepare('SELECT client_id FROM proposals WHERE id = ?').get(proposalId) as { client_id: number | null } | undefined;
  const id = row?.client_id ?? db.projectsForProposal(proposalId)[0]?.client_id ?? null;
  return id ? (db.getClient(id) ?? null) : null;
}

export function setProposalClient(proposalId: number, clientId: number | null): void {
  sqlite.prepare('UPDATE proposals SET client_id = ? WHERE id = ?').run(clientId, proposalId);
}

/** Quien aprueba en nombre de un cliente conocido: su contacto y el correo del acceso al portal (o el del cliente). */
function knownContact(c: db.Client): { name: string; email: string; company: string; phone: string } {
  const account = db.getClientAccount(c.id);
  return { name: c.contact_name || account?.name || c.name, email: (account?.email ?? c.email ?? '').toLowerCase(), company: c.name, phone: c.phone ?? '' };
}

/** Para mostrar en la página pública sin exponer el correo completo: a•••@empresa.com */
const maskEmail = (e: string) => e.replace(/^(.)[^@]*(@.*)$/, '$1•••$2');

/** generando → listo (o error) → convertida (creaste el proyecto) o descartada. */
export type ApprovalStatus = 'generando' | 'listo' | 'error' | 'convertida' | 'descartada';

export interface ApprovalRow {
  id: number;
  proposal_id: number;
  version: number;
  option_id: string;
  option_name: string;
  option_summary: string;
  name: string;
  email: string;
  company: string;
  phone: string;
  notes: string;
  ip: string;
  user_agent: string;
  status: ApprovalStatus;
  draft: string | null;
  ai: string | null;
  error: string | null;
  project_id: number | null;
  created_at: string;
  updated_at: string;
}

const now = () => new Date().toISOString();
export const getApproval = (id: number) => sqlite.prepare('SELECT * FROM proposal_approvals WHERE id = ?').get(id) as unknown as ApprovalRow | undefined;
const setApproval = (id: number, fields: Partial<Pick<ApprovalRow, 'status' | 'draft' | 'ai' | 'error' | 'project_id'>>) => {
  for (const [k, v] of Object.entries(fields)) sqlite.prepare(`UPDATE proposal_approvals SET ${k} = ?, updated_at = ? WHERE id = ?`).run(v ?? null, now(), id);
};

// Un plan que se estaba generando cuando el servidor se reinició (despliegue) no va a terminar: se marca para reintentar.
sqlite
  .prepare("UPDATE proposal_approvals SET status = 'error', error = 'Se interrumpió mientras se generaba el plan. Reintenta.' WHERE status = 'generando'")
  .run();

/** Aprobaciones abiertas (sin proyecto creado ni descartadas) de una propuesta, para la lista de propuestas. */
export function openApprovals(proposalId: number) {
  return (
    sqlite
      .prepare("SELECT * FROM proposal_approvals WHERE proposal_id = ? AND status NOT IN ('convertida', 'descartada') ORDER BY id DESC")
      .all(proposalId) as unknown as ApprovalRow[]
  ).map(approvalSummary);
}

export function approvalSummary(a: ApprovalRow) {
  return {
    id: a.id,
    status: a.status,
    version: a.version,
    name: a.name,
    email: a.email,
    company: a.company,
    phone: a.phone,
    notes: a.notes,
    optionName: a.option_name,
    error: a.error,
    createdAt: a.created_at,
  };
}

// ───────── Datos de la propuesta ─────────

interface GeneratedData {
  meta?: {
    titulo?: string;
    cliente?: string;
    nro?: string;
    aprobacion?: {
      moneda?: string;
      /** Las opciones se suman (fases o módulos): el cliente puede aprobar varias o todas. */
      combinables?: boolean;
      opciones?: {
        id: string;
        nombre: string;
        resumen?: string;
        precio?: number;
        precioTexto?: string;
      }[];
      pagos?: {
        concepto: string;
        cuando: string;
        fecha?: string | null;
        porcentaje: number;
        valores: Record<string, number>;
      }[];
    };
  };
  slides?: {
    role?: string;
    type?: string;
    title?: string;
    plans?: { name: string; price: string; unit?: string; items?: string[] }[];
  }[];
}

/** Las propuestas de generar_propuesta.py traen su contenido en <script type="application/json" id="propuesta">. */
export async function generatedData(p: Pick<Proposal, 'id' | 'version'>): Promise<GeneratedData | null> {
  const path = resolveFile(p.id, p.version, 'index.html');
  const html = path ? await readFile(path, 'utf8').catch(() => '') : '';
  const m = /<script\b[^>]*id=["']propuesta["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (!m) return null;
  try {
    return JSON.parse(m[1]) as GeneratedData;
  } catch {
    return null;
  }
}

export interface PublicOption {
  id: string;
  name: string;
  summary: string;
  price: string;
  /** Valor numérico, para sumar el total cuando se aprueban varias. */
  amount: number | null;
}

/** Alternativas que el cliente puede elegir. Sin datos estructurados (propuestas hechas a mano), una sola oferta. */
export function optionsOf(data: GeneratedData | null): PublicOption[] {
  const ap = data?.meta?.aprobacion;
  if (ap?.opciones && ap.opciones.length > 1) {
    return ap.opciones.map((o) => ({
      id: o.id,
      name: o.nombre,
      summary: o.resumen ?? '',
      price: o.precioTexto ?? '',
      amount: typeof o.precio === 'number' ? o.precio : null,
    }));
  }
  // Propuestas generadas antes de incluir meta.aprobacion: los planes de la diapositiva de inversión.
  const plans = data?.slides?.find((s) => s.role === 'inversion' || s.type === 'pricing')?.plans ?? [];
  if (plans.length > 1) {
    return plans.map((pl, i) => ({
      id: String.fromCharCode(65 + i),
      name: pl.name,
      summary: (pl.items ?? []).slice(0, 3).join(' · '),
      price: `${pl.price} ${pl.unit ?? ''}`.trim(),
      amount: null,
    }));
  }
  return [];
}

const PHASE_RE = /^(fase|etapa|m[oó]dulo)\b/i;

/**
 * ¿Las opciones se suman (fases, módulos) en vez de ser alternativas (plan A o B)? Lo dice `meta.aprobacion.combinables`;
 * en propuestas anteriores a ese campo, se deduce de que todos los planes de la inversión se llamen «Fase…», «Etapa…» o «Módulo…».
 */
function combinable(data: GeneratedData | null, options: PublicOption[]): boolean {
  if (options.length < 2) return false;
  const flag = data?.meta?.aprobacion?.combinables;
  if (typeof flag === 'boolean') return flag;
  const plans = data?.slides?.find((s) => s.role === 'inversion' || s.type === 'pricing')?.plans ?? [];
  const names = plans.length === options.length ? plans.map((p) => p.name) : options.map((o) => o.name.replace(/^opci[oó]n\s+\w+\s*·\s*/i, ''));
  return names.every((n) => PHASE_RE.test(n.trim()));
}

/** «Opción 2 · Seguimiento v1» → «Seguimiento v1». */
export const shortName = (o: PublicOption) => o.name.replace(/^opci[oó]n\s+\w+\s*·\s*/i, '').trim() || o.name;

/** Lo que se guarda cuando el cliente aprueba varias opciones a la vez. */
export function combined(chosen: PublicOption[], all: PublicOption[]): { id: string; name: string; summary: string } {
  if (chosen.length === 1) return { id: chosen[0].id, name: chosen[0].name, summary: chosen[0].summary };
  const ids = chosen.map((o) => o.id);
  const list = ids.length === 2 ? ids.join(' y ') : `${ids.slice(0, -1).join(', ')} y ${ids[ids.length - 1]}`;
  let name = chosen.length === all.length ? `Propuesta completa (opciones ${list})` : `Opciones ${list} · ${chosen.map(shortName).join(', ')}`;
  if (name.length > 160) name = `${name.slice(0, 157).trimEnd()}…`;
  const summary = chosen.map((o) => `${o.name}${o.summary ? ` (${o.summary})` : ''}${o.price ? ` — ${o.price}` : ''}`).join('\n');
  return { id: ids.join(','), name, summary };
}

/** El plan de pagos exacto de la propuesta para la opción aprobada (en vez de que la IA lo lea del texto). */
export function paymentsOf(data: GeneratedData | null, optionId: string): PaymentInput[] | null {
  const ap = data?.meta?.aprobacion;
  if (!ap?.pagos?.length) return null;
  // Varias opciones aprobadas («1,2,4»): cada pago va por opción, p. ej. «Anticipo · Plan de negocio 2027».
  const keys = optionId ? optionId.split(',') : [Object.keys(ap.pagos[0].valores ?? {})[0] || '_'];
  const names = new Map((ap.opciones ?? []).map((o) => [o.id, o.nombre.replace(/^opci[oó]n\s+\w+\s*·\s*/i, '').trim() || o.nombre]));
  const currency = ap.moneda === 'USD' ? 'USD' : 'COP';
  // Agrupado por opción (fase): su anticipo y luego su pago contra entrega.
  const out = keys.flatMap((key) =>
    ap.pagos!
      .filter((p) => typeof p.valores?.[key] === 'number' && p.valores[key] > 0)
      .map((p) => {
        const base = p.fecha || /^al aprobar$/i.test(p.cuando) ? p.concepto : `${p.concepto} · ${p.cuando}`;
        return {
          label: (keys.length > 1 ? `${base} · ${names.get(key) ?? `Opción ${key}`}` : base).slice(0, 160),
          percent: p.porcentaje > 0 ? Math.round(p.porcentaje * 100) / 100 : null,
          amount: p.valores[key],
          currency,
          dueDate: p.fecha && /^\d{4}-\d{2}-\d{2}$/.test(p.fecha) ? p.fecha : null,
        };
      }),
  ) as PaymentInput[];
  return out.length ? out : null;
}

/** Opciones que el cliente ya aprobó en esta propuesta (las descartadas no cuentan), con la fecha de la primera vez. */
function alreadyApproved(proposalId: number): Map<string, string> {
  const rows = sqlite
    .prepare("SELECT option_id, created_at FROM proposal_approvals WHERE proposal_id = ? AND status != 'descartada' AND option_id != '' ORDER BY id")
    .all(proposalId) as { option_id: string; created_at: string }[];
  // Lo que se retiró después del alcance (scope.ts) vuelve a quedar disponible para aprobarlo otra vez.
  const removed = new Set(
    (
      sqlite
        .prepare('SELECT s.option_id FROM scope_changes s JOIN projects p ON p.id = s.project_id WHERE p.proposal_id = ? AND s.option_id != \'\'')
        .all(proposalId) as { option_id: string }[]
    ).flatMap((r) => r.option_id.split(',')),
  );
  const out = new Map<string, string>();
  for (const r of rows) for (const id of r.option_id.split(',')) if (!out.has(id) && !removed.has(id)) out.set(id, r.created_at);
  return out;
}

const dateEs = (iso: string) =>
  new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Bogota' });

// ───────── Página pública: /{slug}/aprobar ─────────

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(p: Proposal, data: GeneratedData | null, options: PublicOption[], multi: boolean, approved: Map<string, string>, client: db.Client | null): string {
  const title = data?.meta?.titulo || p.title || 'Propuesta DeerSystems';
  const nro = data?.meta?.nro ? `Propuesta N.º DS-${data.meta.nro}` : 'Propuesta';
  const company = client?.name ?? data?.meta?.cliente ?? '';
  // Sin correo guardado (cliente solo de facturación) no hay a dónde mandar la confirmación: llena el formulario.
  const known = client && knownContact(client).email ? knownContact(client) : null;
  const currency = data?.meta?.aprobacion?.moneda === 'USD' ? 'USD' : 'COP';
  const pending = options.filter((o) => !approved.has(o.id));
  const someDone = pending.length < options.length;
  const opts = multi
    ? `<fieldset class="opts" data-currency="${currency}"><legend>¿Qué apruebas?</legend>
        <p class="muted legend-hint">${
          someDone ? 'Ya aprobaste parte de la propuesta. Elige lo que quieres sumar ahora: una, varias o todo lo pendiente.' : 'Puedes aprobar una, varias o la propuesta completa.'
        }</p>
        ${
          pending.length > 1
            ? `<label class="opt opt--all"><input type="checkbox" id="all">
          <span><strong>${someDone ? 'Todo lo pendiente' : 'Propuesta completa'}</strong><small>${
            someDone ? `Las ${pending.length} opciones que faltan` : `Todas las opciones (${options.length})`
          }</small>${pending.every((o) => o.amount !== null) ? `<em data-total-all></em>` : ''}</span></label>`
            : ''
        }
        ${options
          .map((o) => {
            const at = approved.get(o.id);
            const body = `<span><strong>${esc(o.name)}</strong>${o.summary ? `<small>${esc(o.summary)}</small>` : ''}${
              at ? `<small class="ok">✓ Aprobada el ${esc(dateEs(at))}</small>` : o.price ? `<em>${esc(o.price)}</em>` : ''
            }</span>`;
            return at
              ? `<label class="opt is-done"><input type="checkbox" checked disabled>${body}</label>`
              : `<label class="opt"><input type="checkbox" name="options" value="${esc(o.id)}"${o.amount !== null ? ` data-amount="${o.amount}"` : ''}>${body}</label>`;
          })
          .join('')}
        <p class="total" id="total" hidden></p></fieldset>`
    : options.length
    ? `<fieldset class="opts"><legend>¿Qué opción apruebas?</legend>${options
        .map(
          (o, i) => `<label class="opt"><input type="radio" name="option" value="${esc(o.id)}" required${i === 0 && options.length === 1 ? ' checked' : ''}>
          <span><strong>${esc(o.name)}</strong>${o.summary ? `<small>${esc(o.summary)}</small>` : ''}${o.price ? `<em>${esc(o.price)}</em>` : ''}</span></label>`,
        )
        .join('')}</fieldset>`
    : '';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Aprobar · ${esc(title)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@600;700&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
<style>
:root{--canvas:#0a1622;--card:#0f1f2e;--surface:#132638;--hairline:rgba(148,163,184,.18);--ink:#f1f5f9;--body:#cbd5e1;--mute:#94a3b8;--verde:#7ed957;--cian:#38bdf8;--rojo:#f87171}
*{box-sizing:border-box}body{margin:0;background:var(--canvas);color:var(--body);font:400 15px/1.6 Inter,system-ui,sans-serif}
main{max-width:640px;margin:0 auto;padding:32px 16px 64px}
.brand{font:700 18px/1 'Space Grotesk',sans-serif;letter-spacing:-.02em;text-decoration:none;color:var(--ink)}.brand b{color:var(--verde)}
.card{margin-top:24px;background:var(--card);border:1px solid var(--hairline);border-radius:16px;padding:28px 24px}
.eyebrow{font:500 11px/1.4 'JetBrains Mono',monospace;letter-spacing:.18em;text-transform:uppercase;color:var(--cian);margin:0 0 10px}
h1{margin:0 0 12px;font:700 26px/1.2 'Space Grotesk',sans-serif;letter-spacing:-.03em;color:var(--ink)}
p{margin:0 0 14px}a{color:var(--cian)}
form{display:grid;gap:16px;margin-top:8px}
label.f{display:grid;gap:6px;font:500 13px/1.4 Inter,sans-serif;color:var(--mute)}
input[type=text],input[type=email],input[type=tel],textarea{width:100%;padding:12px 14px;border-radius:10px;border:1px solid var(--hairline);background:var(--surface);color:var(--ink);font:400 15px/1.4 Inter,sans-serif}
input[type=text]:focus,input[type=email]:focus,input[type=tel]:focus,textarea:focus{outline:2px solid var(--cian);outline-offset:1px}
input[type=radio]:focus,input[type=checkbox]:focus{outline:none}
.opt:has(input:focus-visible){outline:2px solid var(--cian);outline-offset:2px}.check:has(input:focus-visible) span{text-decoration:underline}
textarea{min-height:90px;resize:vertical}
.row{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:560px){.row{grid-template-columns:1fr}}
fieldset.opts{border:0;padding:0;margin:0;display:grid;gap:10px}legend{font:600 15px/1.4 'Space Grotesk',sans-serif;color:var(--ink);margin-bottom:8px}
.opt{display:flex;gap:12px;align-items:flex-start;padding:14px;border:1px solid var(--hairline);border-radius:12px;background:var(--surface);cursor:pointer}
.opt:has(input:checked){border-color:var(--verde)}.opt input{margin-top:4px;accent-color:var(--verde)}
.opt span{display:grid;gap:2px}.opt strong{color:var(--ink)}.opt small{color:var(--mute);font-size:13px}.opt em{font:500 13px/1.4 'JetBrains Mono',monospace;color:var(--verde);font-style:normal}
.opt.is-done{cursor:default;opacity:.75}.opt .ok{color:var(--verde)}
.opt--all{border-style:dashed}.opt--all:has(input:checked){border-style:solid;background:rgba(126,217,87,.08)}
.legend-hint{margin:-6px 0 2px}.total{margin:4px 0 0;font:600 15px/1.4 'Space Grotesk',sans-serif;color:var(--ink)}.total em{font:500 14px/1.4 'JetBrains Mono',monospace;color:var(--verde);font-style:normal}
.check{display:flex;gap:10px;align-items:flex-start;font-size:14px}.check input{margin-top:4px;accent-color:var(--verde)}
.hp{position:absolute;left:-9999px}
button{justify-self:start;padding:13px 24px;border:0;border-radius:8px;background:var(--verde);color:#0a1622;font:600 15px/1 Inter,sans-serif;cursor:pointer}
button:disabled{opacity:.6;cursor:wait}
.err{color:var(--rojo);font-size:14px;margin:0}.muted{color:var(--mute);font-size:13px}
.done h1{color:var(--verde)}
.known{padding:14px 16px;border:1px solid rgba(126,217,87,.35);border-radius:12px;background:rgba(126,217,87,.06)}.known p{margin:0 0 6px}.known__who{color:var(--ink)}
.linkbtn{padding:0;border:0;background:none;color:var(--cian);font:500 13px/1.4 Inter,sans-serif;text-decoration:underline;cursor:pointer}
input[readonly]{opacity:.7}
#who{display:grid;gap:16px}#who[hidden],.known[hidden]{display:none}
</style></head><body><main>
<a class="brand" href="${esc(HOME_URL)}"><b>Deer</b>Systems</a>
${
  multi && !pending.length
    ? `<section class="card done"><p class="eyebrow">${esc(nro)}</p><h1>Ya aprobaste toda la propuesta</h1>
  <p>Todas las opciones de «${esc(title)}» están aprobadas. Si quieres ajustar algo, escríbenos a <a href="mailto:ceo@deersystems.net">ceo@deersystems.net</a>.</p>
  <p><a href="./">Volver a la propuesta</a></p></section>`
    : ''
}<section class="card" id="form-card"${multi && !pending.length ? ' hidden' : ''}>
  <p class="eyebrow">${esc(nro)}</p>
  <h1>Aprobar la propuesta</h1>
  <p>${esc(title)}. Al aprobarla confirmas el alcance, la inversión y la forma de pago tal como aparecen en <a href="./">la propuesta</a>. Con eso preparamos el plan de trabajo y te contactamos para agendar el arranque.</p>
  <form id="f" novalidate>
    ${opts}
${
  known
    ? `<div class="known" id="known">
      <p class="known__who">Apruebas como <strong>${esc(known.name)}</strong> · ${esc(known.company)}${known.email ? `<br><span class="muted">${esc(maskEmail(known.email))}</span>` : ''}</p>
      <p class="muted">Ya tenemos tus datos: no hace falta llenarlos. La confirmación llega a ese correo.</p>
      <button type="button" class="linkbtn" id="other">¿Apruebas a nombre de otra persona de ${esc(known.company)}?</button>
    </div>
    <input type="hidden" name="known" value="1">`
    : ''
}<div id="who"${known ? ' hidden' : ''}>
    <div class="row">
      <label class="f">Tu nombre<input type="text" name="name" autocomplete="name"${known ? '' : ' required'} maxlength="160"></label>
      <label class="f">Tu correo<input type="email" name="email" autocomplete="email"${known ? '' : ' required'} maxlength="200"></label>
    </div>
    <div class="row">
      <label class="f">Empresa<input type="text" name="company" autocomplete="organization" maxlength="160" value="${esc(company)}"${known ? ' readonly' : ''}></label>
      <label class="f">Teléfono (opcional)<input type="tel" name="phone" autocomplete="tel" maxlength="60"></label>
    </div>
    </div>
    <label class="f">Comentarios (opcional)<textarea name="notes" maxlength="2000" placeholder="Ajustes, fecha en la que quieres arrancar, a quién más incluir…"></textarea></label>
    <label class="hp" aria-hidden="true">Sitio web<input type="text" name="website" tabindex="-1" autocomplete="off"></label>
    <label class="check"><input type="checkbox" name="accept" required><span>Acepto la propuesta y sus condiciones.</span></label>
    <p class="err" id="err" role="alert" hidden></p>
    <button type="submit">Aprobar propuesta</button>
    <p class="muted">Te llega una confirmación a tu correo. Si algo no cuadra, responde ese correo y lo revisamos antes de arrancar.</p>
  </form>
</section>
<section class="card done" id="done" hidden>
  <p class="eyebrow">Propuesta aprobada</p>
  <h1>¡Gracias! Recibimos tu aprobación.</h1>
  <p>Ya estamos preparando el plan de trabajo. Te escribimos pronto para confirmar la fecha de arranque y los siguientes pasos.</p>
  <p><a href="./">Volver a la propuesta</a></p>
</section>
<script>
(function(){
  var f=document.getElementById('f'),err=document.getElementById('err'),btn=f.querySelector('button');
  function fail(m){err.textContent=m;err.hidden=false;}
  var all=document.getElementById('all'),boxes=[].slice.call(f.querySelectorAll('input[name=options]')),total=document.getElementById('total');
  if(boxes.length){
    var cur=f.querySelector('fieldset').getAttribute('data-currency');
    var money=function(n){return '$'+n.toLocaleString('es-CO',{maximumFractionDigits:2})+' '+cur;};
    var priced=boxes.every(function(b){return b.hasAttribute('data-amount');});
    var sum=function(list){return list.reduce(function(t,b){return t+Number(b.getAttribute('data-amount'));},0);};
    var ta=f.querySelector('[data-total-all]');if(ta)ta.textContent=money(sum(boxes));
    var sync=function(){
      var on=boxes.filter(function(b){return b.checked;});
      if(all){all.checked=on.length===boxes.length;all.indeterminate=on.length>0&&on.length<boxes.length;}
      btn.textContent=on.length===boxes.length&&!document.querySelector('.opt.is-done')?'Aprobar la propuesta completa':on.length>1?'Aprobar '+on.length+' opciones':'Aprobar propuesta';
      if(!on.length||!priced){total.hidden=true;return;}
      total.innerHTML='';total.appendChild(document.createTextNode((on.length===1?'1 opción':on.length+' opciones')+' · total '));
      var em=document.createElement('em');em.textContent=money(sum(on));total.appendChild(em);total.hidden=false;
    };
    if(all)all.addEventListener('change',function(){boxes.forEach(function(b){b.checked=all.checked;});sync();});
    boxes.forEach(function(b){b.addEventListener('change',sync);});
  }
  var other=document.getElementById('other');
  if(other)other.addEventListener('click',function(){
    document.getElementById('known').hidden=true;document.getElementById('who').hidden=false;
    var k=f.querySelector('input[name=known]');if(k)k.remove();
    var n=f.querySelector('input[name=name]'),m=f.querySelector('input[name=email]');n.required=true;m.required=true;n.focus();
  });
  f.addEventListener('submit',function(e){
    e.preventDefault();err.hidden=true;
    var d=new FormData(f),o={};d.forEach(function(v,k){if(k!=='options')o[k]=v;});o.accept=!!f.accept.checked;
    if(boxes.length){o.options=boxes.filter(function(b){return b.checked;}).map(function(b){return b.value;});if(!o.options.length)return fail('Elige al menos una opción, o la propuesta completa.');}
    if(f.querySelector('input[name=option]')&&!o.option)return fail('Elige la opción que apruebas.');
    var asKnown=!!f.querySelector('input[name=known]');
    if(!asKnown&&!String(o.name||'').trim())return fail('Escribe tu nombre.');
    if(!asKnown&&!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(String(o.email||'').trim()))return fail('Escribe un correo válido.');
    if(!o.accept)return fail('Marca que aceptas la propuesta.');
    var label=btn.textContent;btn.disabled=true;btn.textContent='Enviando…';
    fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(o)})
      .then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||'No se pudo enviar.');});})
      .then(function(){document.getElementById('form-card').hidden=true;document.getElementById('done').hidden=false;window.scrollTo(0,0);})
      .catch(function(x){fail(x.message);btn.disabled=false;btn.textContent=label;});
  });
})();
</script>
</main></body></html>`;
}

/** En la propuesta publicada, el botón de aprobar (antes un mailto) lleva a /{slug}/aprobar. */
export function approveScript(slug: string): string {
  const url = JSON.stringify(`/${slug}/aprobar`);
  return `<script>(function(){var u=${url};window.DS_APPROVE_URL=u;function fix(){var a=document.querySelectorAll('a[href^="mailto:"]');for(var i=0;i<a.length;i++){if(/Aprobaci/i.test(decodeURIComponent(a[i].getAttribute('href')||''))){a[i].setAttribute('href',u);a[i].removeAttribute('target');}}}fix();document.addEventListener('DOMContentLoaded',fix);})();</script>`;
}

// Límite por IP: 5 aprobaciones por hora (el formulario es público).
const hits = new Map<string, number[]>();
function rateLimit(ip: string) {
  const t = Date.now();
  const recent = (hits.get(ip) ?? []).filter((x) => t - x < 3_600_000);
  if (recent.length >= 5) throw new HttpError(429, 'Demasiados intentos. Espera un rato o escríbenos a ceo@deersystems.net.');
  recent.push(t);
  hits.set(ip, recent);
}

export async function handleApprovalPage(req: IncomingMessage, res: ServerResponse, proposal: Proposal): Promise<void> {
  const data = await generatedData(proposal);
  const options = optionsOf(data);
  const multi = combinable(data, options);
  if (req.method === 'GET' || req.method === 'HEAD') {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'X-Frame-Options': 'DENY',
    });
    return void res.end(req.method === 'HEAD' ? undefined : page(proposal, data, options, multi, alreadyApproved(proposal.id), proposalClient(proposal.id)));
  }
  if (req.method !== 'POST') throw new HttpError(405, 'Método no permitido.');

  const body = await readJson(req, 16 * 1024);
  // Campo trampa: solo lo llenan los robots. Se responde como si todo fuera bien.
  if (str(body.website, 200)) return json(res, 200, { ok: true });
  const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '')
    .split(',')[0]
    .trim();
  // Cliente ya conocido: sin cambiar de persona, se usan sus datos guardados.
  const client = proposalClient(proposal.id);
  const known = client ? knownContact(client) : null;
  const useKnown = !!known && known.email !== '' && !str(body.email, 200);
  const name = useKnown ? known.name : str(body.name, 160);
  const email = useKnown ? known.email : str(body.email, 200).toLowerCase();
  if (!name) throw new HttpError(400, 'Escribe tu nombre.');
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Escribe un correo válido.');
  if (body.accept !== true) throw new HttpError(400, 'Marca que aceptas la propuesta.');
  // Con opciones que se suman llega la lista (`options`); con alternativas, una sola (`option`).
  const wanted = new Set(multi && Array.isArray(body.options) ? body.options.map((x) => str(x, 20)) : [str(body.option, 20)]);
  const chosen = options.filter((o) => wanted.has(o.id));
  if (options.length && (!chosen.length || (!multi && chosen.length > 1)))
    throw new HttpError(400, multi ? 'Elige al menos una opción, o la propuesta completa.' : 'Elige la opción que apruebas.');
  if (multi) {
    const done = alreadyApproved(proposal.id);
    const repeated = chosen.filter((o) => done.has(o.id));
    if (repeated.length)
      throw new HttpError(
        409,
        `${repeated.map(shortName).join(', ')} ya ${repeated.length > 1 ? 'están aprobadas' : 'está aprobada'}. Recarga la página para ver lo que falta.`,
      );
  }
  const option = chosen.length ? combined(chosen, options) : undefined;
  // Solo cuentan los envíos válidos: un error al llenar el formulario no bloquea al cliente.
  rateLimit(ip);

  // Doble clic o reenvío: si ya aprobó lo mismo en las últimas 24 h y sigue abierta, no se repite.
  // Otra opción (p. ej. la fase siguiente) sí entra como aprobación nueva.
  const dup = sqlite
    .prepare(
      "SELECT id FROM proposal_approvals WHERE proposal_id = ? AND email = ? AND option_id = ? AND status IN ('generando', 'listo', 'error') AND created_at > ?",
    )
    .get(proposal.id, email, option?.id ?? '', new Date(Date.now() - 86_400_000).toISOString());
  if (dup) return json(res, 200, { ok: true });

  const t = now();
  const { lastInsertRowid } = sqlite
    .prepare(
      `INSERT INTO proposal_approvals (proposal_id, version, option_id, option_name, option_summary, name, email, company, phone, notes, ip, user_agent, status, client_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'generando', ?, ?, ?)`,
    )
    .run(
      proposal.id,
      proposal.version,
      option?.id ?? '',
      option?.name ?? '',
      option?.summary ?? '',
      name,
      email,
      client ? client.name : str(body.company, 160),
      str(body.phone, 60) || (useKnown ? known.phone : ''),
      str(body.notes, 2000),
      ip.slice(0, 64),
      String(req.headers['user-agent'] ?? '').slice(0, 300),
      client?.id ?? null,
      t,
      t,
    );
  const id = Number(lastInsertRowid);
  json(res, 200, { ok: true });

  const title = data?.meta?.titulo || proposal.title || proposal.slug;
  notify('proposal_approved', {
    actor: null,
    projectId: null,
    title: `${name} aprobó «${title}»`,
    body: `${option ? `${option.name}. ` : ''}Estamos armando el plan de trabajo con IA para que lo revises.`,
    path: `/propuestas/${proposal.id}/aprobar?aprobacion=${id}`,
  });
  void confirmToClient(email, name, title, option?.name ?? '');
  void generatePlan(id);
}

async function confirmToClient(to: string, name: string, title: string, option: string) {
  if (!google.connectionStatus().connected) return;
  try {
    await google.sendMail(mail.proposalApproved({ to, name, proposalTitle: title, option }));
  } catch (err) {
    console.error('No se pudo enviar la confirmación de aprobación:', err);
  }
}

/** Si antes aprobó otras partes de la misma propuesta, la IA arma solo lo nuevo, como continuación. */
function earlierNote(a: ApprovalRow): string {
  const prev = sqlite
    .prepare("SELECT option_name FROM proposal_approvals WHERE proposal_id = ? AND id < ? AND status != 'descartada' AND option_name != '' ORDER BY id")
    .all(a.proposal_id, a.id) as { option_name: string }[];
  if (!prev.length) return '';
  return `Ya había aprobado antes ${prev.map((r) => `«${r.option_name}»`).join(', ')}, que ya está en marcha: este plan es SOLO para lo que aprueba ahora y se suma al proyecto existente. No repitas fases, tareas, reuniones de arranque ni pagos de lo anterior.`;
}

/** Arma el plan con IA (fases, tareas, reuniones) y le pone el plan de pagos exacto de la propuesta. */
export async function generatePlan(id: number): Promise<void> {
  const a = getApproval(id);
  const proposal = a ? getProposal(a.proposal_id) : undefined;
  if (!a || !proposal) return;
  setApproval(id, { status: 'generando', error: null });
  // La versión que el cliente aprobó, aunque después se haya reemplazado la propuesta.
  const approved = { ...proposal, version: a.version };
  try {
    const { draft, ai } = await extractDraft(approved, {
      option: a.option_name ? { name: a.option_name, summary: a.option_summary, multiple: a.option_id.includes(',') } : null,
      notes: [a.notes ? `Comentarios del cliente al aprobar: ${a.notes}` : '', earlierNote(a)].filter(Boolean).join('\n'),
    });
    draft.approvalNotes = a.notes;
    const exact = paymentsOf(await generatedData(approved), a.option_id);
    if (exact) draft.payments = exact;
    const linked = (a as ApprovalRow & { client_id: number | null }).client_id;
    const client = linked ? db.getClient(linked) : undefined;
    if (client) {
      // Cliente que ya existe: el proyecto es para él, con sus datos guardados (aunque apruebe otra persona de su empresa).
      const k = knownContact(client);
      draft.clientEmail = k.email;
      draft.contactName = k.name;
      draft.clientName = client.name;
      draft.clientPhone = k.phone || a.phone;
      if (a.email !== k.email) draft.approvalNotes = [`Aprobó ${a.name} (${a.email}) a nombre de ${client.name}.`, a.notes].filter(Boolean).join('\n');
    } else {
      // Quien aprobó es el contacto del cliente: su correo es el del acceso al portal.
      draft.clientEmail = a.email;
      draft.contactName = a.name;
      draft.clientName = draft.clientName || a.company || a.name;
      draft.clientPhone = draft.clientPhone || a.phone;
    }
    setApproval(id, {
      status: 'listo',
      draft: JSON.stringify(draft),
      ai: JSON.stringify(ai),
    });
    notify('proposal_approved', {
      actor: null,
      projectId: null,
      title: `Plan listo para revisar: «${proposal.title || proposal.slug}»`,
      body: `Aprobada por ${a.name}. Revisa y ajusta el plan antes de crear el proyecto.`,
      path: `/propuestas/${proposal.id}/aprobar?aprobacion=${id}`,
    });
  } catch (err) {
    const message = err instanceof AiError || err instanceof HttpError ? err.message : 'Error inesperado al generar el plan.';
    if (!(err instanceof AiError)) console.error(err);
    setApproval(id, { status: 'error', error: message });
    notify('proposal_approved', {
      actor: null,
      projectId: null,
      title: `No se pudo armar el plan de «${proposal.title || proposal.slug}»`,
      body: `${message} Ábrelo para reintentar.`,
      path: `/propuestas/${proposal.id}/aprobar?aprobacion=${id}`,
    });
  }
}

/** Para la pantalla de revisión en Partners: la aprobación con su plan. */
export function approvalDetail(a: ApprovalRow) {
  const draft = a.draft ? (JSON.parse(a.draft) as Draft) : null;
  const linked = (a as ApprovalRow & { client_id: number | null }).client_id;
  const existing = (linked ? db.getClient(linked) : undefined) ?? (draft?.clientEmail ? db.getClientByEmail(draft.clientEmail) : undefined);
  return {
    approval: approvalSummary(a),
    draft,
    ai: a.ai ? JSON.parse(a.ai) : null,
    existingClientId: existing?.id ?? null,
  };
}

export function closeApproval(id: number, status: 'convertida' | 'descartada', projectId?: number) {
  setApproval(id, { status, ...(projectId ? { project_id: projectId } : {}) });
}
