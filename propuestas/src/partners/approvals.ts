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
`);

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
}

/** Alternativas que el cliente puede elegir. Sin datos estructurados (propuestas hechas a mano), una sola oferta. */
function optionsOf(data: GeneratedData | null): PublicOption[] {
  const ap = data?.meta?.aprobacion;
  if (ap?.opciones && ap.opciones.length > 1) {
    return ap.opciones.map((o) => ({
      id: o.id,
      name: o.nombre,
      summary: o.resumen ?? '',
      price: o.precioTexto ?? '',
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
    }));
  }
  return [];
}

/** El plan de pagos exacto de la propuesta para la opción aprobada (en vez de que la IA lo lea del texto). */
export function paymentsOf(data: GeneratedData | null, optionId: string): PaymentInput[] | null {
  const ap = data?.meta?.aprobacion;
  if (!ap?.pagos?.length) return null;
  const key = optionId || Object.keys(ap.pagos[0].valores ?? {})[0] || '_';
  const currency = ap.moneda === 'USD' ? 'USD' : 'COP';
  const out = ap.pagos
    .filter((p) => typeof p.valores?.[key] === 'number' && p.valores[key] > 0)
    .map((p) => ({
      label: p.fecha || /^al aprobar$/i.test(p.cuando) ? p.concepto : `${p.concepto} · ${p.cuando}`.slice(0, 160),
      percent: p.porcentaje > 0 ? Math.round(p.porcentaje * 100) / 100 : null,
      amount: p.valores[key],
      currency,
      dueDate: p.fecha && /^\d{4}-\d{2}-\d{2}$/.test(p.fecha) ? p.fecha : null,
    })) as PaymentInput[];
  return out.length ? out : null;
}

// ───────── Página pública: /{slug}/aprobar ─────────

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(p: Proposal, data: GeneratedData | null, options: PublicOption[]): string {
  const title = data?.meta?.titulo || p.title || 'Propuesta DeerSystems';
  const nro = data?.meta?.nro ? `Propuesta N.º DS-${data.meta.nro}` : 'Propuesta';
  const company = data?.meta?.cliente ?? '';
  const opts = options.length
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
input:focus,textarea:focus{outline:2px solid var(--cian);outline-offset:1px}
textarea{min-height:90px;resize:vertical}
.row{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:560px){.row{grid-template-columns:1fr}}
fieldset.opts{border:0;padding:0;margin:0;display:grid;gap:10px}legend{font:600 15px/1.4 'Space Grotesk',sans-serif;color:var(--ink);margin-bottom:8px}
.opt{display:flex;gap:12px;align-items:flex-start;padding:14px;border:1px solid var(--hairline);border-radius:12px;background:var(--surface);cursor:pointer}
.opt:has(input:checked){border-color:var(--verde)}.opt input{margin-top:4px;accent-color:var(--verde)}
.opt span{display:grid;gap:2px}.opt strong{color:var(--ink)}.opt small{color:var(--mute);font-size:13px}.opt em{font:500 13px/1.4 'JetBrains Mono',monospace;color:var(--verde);font-style:normal}
.check{display:flex;gap:10px;align-items:flex-start;font-size:14px}.check input{margin-top:4px;accent-color:var(--verde)}
.hp{position:absolute;left:-9999px}
button{justify-self:start;padding:13px 24px;border:0;border-radius:8px;background:var(--verde);color:#0a1622;font:600 15px/1 Inter,sans-serif;cursor:pointer}
button:disabled{opacity:.6;cursor:wait}
.err{color:var(--rojo);font-size:14px;margin:0}.muted{color:var(--mute);font-size:13px}
.done h1{color:var(--verde)}
</style></head><body><main>
<a class="brand" href="${esc(HOME_URL)}"><b>Deer</b>Systems</a>
<section class="card" id="form-card">
  <p class="eyebrow">${esc(nro)}</p>
  <h1>Aprobar la propuesta</h1>
  <p>${esc(title)}. Al aprobarla confirmas el alcance, la inversión y la forma de pago tal como aparecen en <a href="./">la propuesta</a>. Con eso preparamos el plan de trabajo y te contactamos para agendar el arranque.</p>
  <form id="f" novalidate>
    ${opts}
    <div class="row">
      <label class="f">Tu nombre<input type="text" name="name" autocomplete="name" required maxlength="160"></label>
      <label class="f">Tu correo<input type="email" name="email" autocomplete="email" required maxlength="200"></label>
    </div>
    <div class="row">
      <label class="f">Empresa<input type="text" name="company" autocomplete="organization" maxlength="160" value="${esc(company)}"></label>
      <label class="f">Teléfono (opcional)<input type="tel" name="phone" autocomplete="tel" maxlength="60"></label>
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
  f.addEventListener('submit',function(e){
    e.preventDefault();err.hidden=true;
    var d=new FormData(f),o={};d.forEach(function(v,k){o[k]=v;});o.accept=!!f.accept.checked;
    if(f.querySelector('input[name=option]')&&!o.option)return fail('Elige la opción que apruebas.');
    if(!String(o.name||'').trim())return fail('Escribe tu nombre.');
    if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(String(o.email||'').trim()))return fail('Escribe un correo válido.');
    if(!o.accept)return fail('Marca que aceptas la propuesta.');
    btn.disabled=true;btn.textContent='Enviando…';
    fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(o)})
      .then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||'No se pudo enviar.');});})
      .then(function(){document.getElementById('form-card').hidden=true;document.getElementById('done').hidden=false;window.scrollTo(0,0);})
      .catch(function(x){fail(x.message);btn.disabled=false;btn.textContent='Aprobar propuesta';});
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
  if (req.method === 'GET' || req.method === 'HEAD') {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'X-Frame-Options': 'DENY',
    });
    return void res.end(req.method === 'HEAD' ? undefined : page(proposal, data, options));
  }
  if (req.method !== 'POST') throw new HttpError(405, 'Método no permitido.');

  const body = await readJson(req, 16 * 1024);
  // Campo trampa: solo lo llenan los robots. Se responde como si todo fuera bien.
  if (str(body.website, 200)) return json(res, 200, { ok: true });
  const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '')
    .split(',')[0]
    .trim();
  const name = str(body.name, 160);
  const email = str(body.email, 200).toLowerCase();
  if (!name) throw new HttpError(400, 'Escribe tu nombre.');
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Escribe un correo válido.');
  if (body.accept !== true) throw new HttpError(400, 'Marca que aceptas la propuesta.');
  const option = options.length ? options.find((o) => o.id === str(body.option, 20)) : undefined;
  if (options.length && !option) throw new HttpError(400, 'Elige la opción que apruebas.');
  // Solo cuentan los envíos válidos: un error al llenar el formulario no bloquea al cliente.
  rateLimit(ip);

  // Doble clic o reenvío: si ya aprobó en las últimas 24 h y sigue abierta, no se repite.
  const dup = sqlite
    .prepare("SELECT id FROM proposal_approvals WHERE proposal_id = ? AND email = ? AND status IN ('generando', 'listo', 'error') AND created_at > ?")
    .get(proposal.id, email, new Date(Date.now() - 86_400_000).toISOString());
  if (dup) return json(res, 200, { ok: true });

  const t = now();
  const { lastInsertRowid } = sqlite
    .prepare(
      `INSERT INTO proposal_approvals (proposal_id, version, option_id, option_name, option_summary, name, email, company, phone, notes, ip, user_agent, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'generando', ?, ?)`,
    )
    .run(
      proposal.id,
      proposal.version,
      option?.id ?? '',
      option?.name ?? '',
      option?.summary ?? '',
      name,
      email,
      str(body.company, 160),
      str(body.phone, 60),
      str(body.notes, 2000),
      ip.slice(0, 64),
      String(req.headers['user-agent'] ?? '').slice(0, 300),
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
      option: a.option_name ? { name: a.option_name, summary: a.option_summary } : null,
      notes: a.notes ? `Comentarios del cliente al aprobar: ${a.notes}` : '',
    });
    draft.approvalNotes = a.notes;
    const exact = paymentsOf(await generatedData(approved), a.option_id);
    if (exact) draft.payments = exact;
    // Quien aprobó es el contacto del cliente: su correo es el del acceso al portal.
    draft.clientEmail = a.email;
    draft.contactName = a.name;
    draft.clientName = draft.clientName || a.company || a.name;
    draft.clientPhone = draft.clientPhone || a.phone;
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
  const existing = draft?.clientEmail ? db.getClientByEmail(draft.clientEmail) : undefined;
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
