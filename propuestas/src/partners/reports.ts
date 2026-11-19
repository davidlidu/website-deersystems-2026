import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AiError, complete } from '../ai.ts';
import { PARTNERS_URL } from '../config.ts';
import { db as sqlite } from '../db.ts';
import * as google from '../google.ts';
import { HttpError, json, readJson } from '../http.ts';
import { projectReport } from '../mail.ts';
import type { Viewer } from './auth.ts';
import { actor, requireStaff, str, visibleProject } from './common.ts';
import * as db from './db.ts';
import { notify } from './notify.ts';
import { updateRecipients } from './updates.ts';

/**
 * Informes del proyecto: parciales (lo hecho en un periodo) y de cierre (todo el proyecto, lo entregado, lo que queda
 * y los siguientes pasos). La IA los redacta con los datos del portal y con lo que le indiques («información a tener
 * en cuenta»); quedan como borrador para editarlos, y al publicarlos el cliente los ve en el portal y, si quieres,
 * le llegan completos por correo. Publicar el informe de cierre puede dejar el proyecto como finalizado.
 */

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS project_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'parcial',
    title TEXT NOT NULL DEFAULT '',
    period_from TEXT,
    period_to TEXT,
    context TEXT NOT NULL DEFAULT '',
    include_payments INTEGER NOT NULL DEFAULT 0,
    body TEXT NOT NULL DEFAULT '',
    ai INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'borrador',
    published_at TEXT,
    emailed_at TEXT,
    emailed_to TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS project_reports_project ON project_reports(project_id, id);
`);

type Kind = 'parcial' | 'final';

interface Report {
  id: number;
  project_id: number;
  kind: Kind;
  title: string;
  period_from: string | null;
  period_to: string | null;
  context: string;
  include_payments: number;
  body: string;
  ai: number;
  status: 'borrador' | 'publicado';
  published_at: string | null;
  emailed_at: string | null;
  emailed_to: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

const TZ = 'America/Bogota';
const now = () => new Date().toISOString();
const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
const today = () => dayOf(now());
const dateEs = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const label = (s: string) => s.replace(/[[\]()]/g, ' ').replace(/\s+/g, ' ').trim();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s);
const money = (n: number, currency: string) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: currency === 'USD' ? 'USD' : 'COP', maximumFractionDigits: currency === 'USD' ? 2 : 0 }).format(n || 0);

const getReport = (id: number) => sqlite.prepare('SELECT * FROM project_reports WHERE id = ?').get(id) as unknown as Report | undefined;
const listReports = (projectId: number) => sqlite.prepare('SELECT * FROM project_reports WHERE project_id = ? ORDER BY id DESC').all(projectId) as unknown as Report[];

function view(r: Report) {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    from: r.period_from,
    to: r.period_to,
    context: r.context,
    includePayments: !!r.include_payments,
    body: r.body,
    ai: !!r.ai,
    status: r.status,
    publishedAt: r.published_at,
    emailedAt: r.emailed_at,
    emailedTo: r.emailed_to,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const staffOnly = (v: Viewer) => v.kind !== 'client';

/** Un informe que esta persona puede ver: el cliente solo los publicados. */
function visibleReport(id: number, v: Viewer): { report: Report; project: db.Project } {
  const report = getReport(id);
  if (!report) throw new HttpError(404, 'El informe no existe.');
  const project = visibleProject(report.project_id, v);
  if (report.status !== 'publicado' && !staffOnly(v)) throw new HttpError(404, 'El informe no existe.');
  return { report, project };
}

// ───────── Los datos del informe ─────────

interface Facts {
  project: db.Project;
  clientName: string;
  from: string;
  to: string;
  kind: Kind;
  progress: db.Progress;
  phases: { name: string; total: number; done: number; doneInPeriod: string[]; pending: string[] }[];
  noPhase: { doneInPeriod: string[]; pending: string[] };
  review: string[];
  updates: { date: string; body: string }[];
  meetings: { title: string; date: string; summary: string; agreements: string[] }[];
  files: string[];
  scopeChanges: string[];
  payments: { total: number; paid: number; currency: string; pending: string[] } | null;
}

function facts(project: db.Project, kind: Kind, from: string, to: string, withPayments: boolean): Facts {
  const inPeriod = (iso: string | null) => !!iso && dayOf(iso) >= from && dayOf(iso) <= to;
  const tasks = db.listTasks(project.id).filter((t) => t.kind !== 'reunion');
  const STATUS: Record<string, string> = { pendiente: 'pendiente', en_progreso: 'en progreso', en_revision: 'en revisión del cliente', bloqueada: 'bloqueada' };
  const pendingOf = (list: db.Task[]) =>
    list
      .filter((t) => t.status !== 'completada')
      .map((t) => `${label(t.title)} (${STATUS[t.status] ?? t.status}${t.side === 'cliente' ? ', a cargo del cliente' : ''}${t.due_date ? `, para el ${dateEs(t.due_date)}` : ''})`);
  const doneOf = (list: db.Task[]) => list.filter((t) => t.status === 'completada' && inPeriod(t.completed_at)).map((t) => label(t.title));
  const phases = db.listPhases(project.id).map((ph) => {
    const list = tasks.filter((t) => t.phase_id === ph.id);
    return { name: label(ph.name), total: list.length, done: list.filter((t) => t.status === 'completada').length, doneInPeriod: doneOf(list), pending: pendingOf(list) };
  });
  const loose = tasks.filter((t) => !t.phase_id);

  const updates = db
    .listNotes(project.id, { internal: false, kind: 'avance' })
    .filter((n) => n.visibility === 'shared' && inPeriod(n.created_at))
    .slice(-30)
    .map((n) => ({ date: dateEs(dayOf(n.created_at)), body: clip(n.body.replace(/\s+/g, ' '), 700) }));

  const meetings = (
    sqlite
      .prepare("SELECT title, start_at, summary, agreements FROM meetings WHERE project_id = ? AND status = 'aprobada' ORDER BY start_at")
      .all(project.id) as { title: string; start_at: string; summary: string; agreements: string }[]
  )
    .filter((m) => inPeriod(m.start_at))
    .map((m) => {
      let agreements: string[] = [];
      try {
        agreements = (JSON.parse(m.agreements) as unknown[]).map(String).slice(0, 12);
      } catch {
        /* sin acuerdos */
      }
      return { title: label(m.title), date: dateEs(dayOf(m.start_at)), summary: clip(m.summary.replace(/\s+/g, ' '), 900), agreements };
    });

  const files = db
    .listActivity(project.id, { internal: false, limit: 1000 })
    .filter((a) => a.type === 'file_added' && inPeriod(a.created_at))
    .map((a) => label(String((JSON.parse(a.data) as { name?: string }).name ?? '')))
    .filter(Boolean);

  const scopeChanges = (
    sqlite.prepare('SELECT option_name, reason, created_at FROM scope_changes WHERE project_id = ? ORDER BY id').all(project.id) as {
      option_name: string;
      reason: string;
      created_at: string;
    }[]
  )
    .filter((s) => inPeriod(s.created_at))
    .map((s) => `${dateEs(dayOf(s.created_at))}: se retiró ${s.option_name}${s.reason ? ` (${s.reason})` : ''}`);

  let payments: Facts['payments'] = null;
  if (withPayments) {
    const rows = sqlite.prepare('SELECT label, amount, currency, paid, due_date FROM payments WHERE project_id = ? ORDER BY position, id').all(project.id) as {
      label: string;
      amount: number | null;
      currency: string;
      paid: number;
      due_date: string | null;
    }[];
    if (rows.length) {
      const currency = rows[0].currency;
      payments = {
        currency,
        total: rows.reduce((s, r) => s + (r.amount ?? 0), 0),
        paid: rows.filter((r) => r.paid).reduce((s, r) => s + (r.amount ?? 0), 0),
        pending: rows.filter((r) => !r.paid).map((r) => `${label(r.label)}: ${money(r.amount ?? 0, r.currency)}${r.due_date ? ` (vence el ${dateEs(r.due_date)})` : ''}`),
      };
    }
  }

  return {
    project,
    clientName: db.getClient(project.client_id)?.name ?? '',
    from,
    to,
    kind,
    progress: db.progressOf(project.id),
    phases,
    noPhase: { doneInPeriod: doneOf(loose), pending: pendingOf(loose) },
    review: tasks.filter((t) => t.status === 'en_revision').map((t) => label(t.title)),
    updates,
    meetings,
    files,
    scopeChanges,
    payments,
  };
}

const pct = (p: db.Progress) => (p.total ? Math.round((p.done / p.total) * 100) : 0);
const bullets = (items: string[], empty = '- (ninguna)') => (items.length ? items.map((i) => `- ${i}`).join('\n') : empty);

/** Los datos del informe como texto, para la IA. */
function factsText(f: Facts): string {
  const p = f.project;
  return `Proyecto: ${p.name}
Cliente: ${f.clientName}
Opción aprobada: ${p.approved_option || '—'}
Aprobado el: ${dateEs(dayOf(p.approved_at))}${p.start_date ? ` · Inicio: ${dateEs(p.start_date)}` : ''}${p.end_date ? ` · Entrega estimada: ${dateEs(p.end_date)}` : ''}
Periodo del informe: del ${dateEs(f.from)} al ${dateEs(f.to)}
Avance total: ${pct(f.progress)} % (${f.progress.done} de ${f.progress.total} tareas)

Alcance aprobado (resumen):
${clip(p.scope || '—', 3000)}

Fases (tareas terminadas / total):
${f.phases
  .map(
    (ph) => `### ${ph.name} — ${ph.done}/${ph.total}
Terminado en el periodo:
${bullets(ph.doneInPeriod)}
Pendiente:
${bullets(ph.pending)}`,
  )
  .join('\n\n') || '(sin fases)'}
${f.noPhase.doneInPeriod.length || f.noPhase.pending.length ? `\nOtras tareas (sin fase):\nTerminado en el periodo:\n${bullets(f.noPhase.doneInPeriod)}\nPendiente:\n${bullets(f.noPhase.pending)}` : ''}

Esperando revisión del cliente:
${bullets(f.review)}

Reuniones del periodo (resúmenes aprobados):
${f.meetings.map((m) => `- ${m.title} (${m.date}): ${m.summary}${m.agreements.length ? `\n  Acuerdos: ${m.agreements.join('; ')}` : ''}`).join('\n') || '- (ninguna)'}

Avances publicados en el periodo:
${f.updates.map((u) => `- ${u.date}: ${u.body}`).join('\n') || '- (ninguno)'}

Archivos y entregables compartidos en el periodo:
${bullets(f.files, '- (ninguno)')}

Cambios de alcance:
${bullets(f.scopeChanges, '- (ninguno)')}
${
  f.payments
    ? `\nPagos: total ${money(f.payments.total, f.payments.currency)}, pagado ${money(f.payments.paid, f.payments.currency)}, saldo ${money(f.payments.total - f.payments.paid, f.payments.currency)}.\nPagos pendientes:\n${bullets(f.payments.pending, '- (ninguno)')}`
    : ''
}`;
}

/** El informe sin IA: los mismos datos, ordenados. */
function template(f: Facts, context: string): string {
  const final = f.kind === 'final';
  const out: string[] = [];
  out.push(
    final
      ? `Les compartimos el informe de cierre de **${f.project.name}**. Aquí está todo lo que se construyó, lo que se entregó y los siguientes pasos.`
      : `Les compartimos el informe de avance de **${f.project.name}** del ${dateEs(f.from)} al ${dateEs(f.to)}.`,
  );
  out.push('', '## Resumen', '', `El proyecto va en **${pct(f.progress)} %** (${f.progress.done} de ${f.progress.total} tareas).`);
  const done = f.phases.filter((ph) => ph.doneInPeriod.length);
  if (done.length || f.noPhase.doneInPeriod.length) {
    out.push('', final ? '## Lo que se entregó' : '## Lo que se hizo en el periodo');
    for (const ph of done) out.push('', `**${ph.name}** (${ph.done} de ${ph.total})`, '', ...ph.doneInPeriod.map((t) => `- ${t}`));
    if (f.noPhase.doneInPeriod.length) out.push('', '**Otras tareas**', '', ...f.noPhase.doneInPeriod.map((t) => `- ${t}`));
  }
  if (f.meetings.length) out.push('', '## Reuniones', '', ...f.meetings.map((m) => `- **${m.title}** (${m.date})${m.agreements.length ? `: ${m.agreements.join('; ')}` : ''}`));
  if (f.files.length) out.push('', '## Entregables compartidos', '', ...f.files.map((n) => `- ${n}`));
  if (f.scopeChanges.length) out.push('', '## Cambios de alcance', '', ...f.scopeChanges.map((s) => `- ${s}`));
  const pending = [...f.phases.flatMap((ph) => ph.pending.map((t) => `${t} — ${ph.name}`)), ...f.noPhase.pending];
  if (pending.length) out.push('', final ? '## Pendientes al cierre' : '## Lo que sigue', '', ...pending.slice(0, 25).map((t) => `- ${t}`));
  if (f.payments)
    out.push(
      '',
      '## Estado de pagos',
      '',
      `- Total: ${money(f.payments.total, f.payments.currency)}`,
      `- Pagado: ${money(f.payments.paid, f.payments.currency)}`,
      `- Saldo: ${money(f.payments.total - f.payments.paid, f.payments.currency)}`,
    );
  if (context.trim()) out.push('', '## Notas', '', context.trim());
  out.push('', final ? 'Gracias por confiar en DeerSystems. Quedamos atentos a sus comentarios.' : 'Quedamos atentos a sus comentarios.');
  return out.join('\n');
}

const SYSTEM = `Eres el asistente de DeerSystems, una empresa colombiana de software, automatización e IA.
Redactas informes formales que DeerSystems le entrega a su cliente sobre su proyecto: claros, concretos y profesionales.
Escribe en español, en segunda persona del plural. Responde SOLO con el informe en Markdown, sin explicaciones ni bloques de código.`;

function instructions(kind: Kind, hasPayments: boolean): string {
  if (kind === 'final') {
    return `Escribe el INFORME DE CIERRE del proyecto con estas secciones (títulos con ##, deja una línea en blanco después de cada título):
## Resumen ejecutivo — 3 a 5 frases: qué se buscaba, qué se logró y el estado final (porcentaje).
## Alcance y objetivos — lo aprobado, y los cambios de alcance si los hubo.
## Lo que se entregó — por fase, con viñetas concretas (usa las tareas terminadas y los archivos compartidos).
## Reuniones y acuerdos clave — solo si hubo.
## Pendientes y recomendaciones — lo que quedó pendiente (aclara si depende del cliente) y recomendaciones para sacarle provecho.
${hasPayments ? '## Estado de pagos — total, pagado y saldo, con los pagos pendientes.\n' : ''}## Garantía, soporte y siguientes pasos — usa SOLO lo que diga la información adicional; si no dice nada, una frase invitando a escribirnos para soporte o nuevas fases.
Cierra con un agradecimiento breve. Máximo 900 palabras.`;
  }
  return `Escribe un INFORME PARCIAL del periodo con estas secciones (títulos con ##, deja una línea en blanco después de cada título):
## Resumen del periodo — 2 a 4 frases y el porcentaje de avance.
## Lo que se hizo — por fase, con viñetas concretas.
## Reuniones y acuerdos — solo si hubo.
## Pendiente de su parte — solo si hay tareas a cargo del cliente o en su revisión.
## Lo que sigue — próximos pasos con base en lo pendiente.
${hasPayments ? '## Estado de pagos — total, pagado y saldo.\n' : ''}Cierra con "Quedamos atentos a sus comentarios." Máximo 600 palabras.`;
}

async function aiBody(f: Facts, context: string): Promise<string> {
  const completion = await complete({
    profile: 'reuniones', // datos del cliente: solo proveedores privados
    purpose: f.kind === 'final' ? 'informe de cierre' : 'informe parcial',
    system: SYSTEM,
    maxOutputTokens: 12_000,
    prompt: `${factsText(f)}

Información adicional que DeerSystems quiere que tengas en cuenta (tiene prioridad sobre lo demás; úsala, no la copies literal si no hace falta):
${context.trim() || '(ninguna)'}

${instructions(f.kind, !!f.payments)}
Reglas: usa solo los datos de arriba y la información adicional; no inventes fechas, valores, entregables ni compromisos. Sin emojis. Viñetas cortas.`,
  });
  const text = completion.text.trim().replace(/^```(?:markdown|md)?\s*/i, '').replace(/```$/, '').trim();
  if (!text) throw new AiError('La IA no devolvió texto.');
  if (completion.truncated) throw new AiError('la respuesta llegó incompleta');
  return text.slice(0, 40_000);
}

async function generate(project: db.Project, r: Pick<Report, 'kind' | 'period_from' | 'period_to' | 'context' | 'include_payments'>) {
  const from = r.period_from ?? dayOf(project.approved_at);
  const to = r.period_to ?? today();
  const f = facts(project, r.kind, from, to, !!r.include_payments);
  try {
    return { body: await aiBody(f, r.context), ai: true, warning: null as string | null };
  } catch (err) {
    return { body: template(f, r.context), ai: false, warning: `La IA no respondió (${(err as Error).message}); se armó con los datos del proyecto.` };
  }
}

/** Desde cuándo va el siguiente informe parcial: el día después del último, o la aprobación del proyecto. */
function defaultFrom(project: db.Project): string {
  const last = sqlite.prepare("SELECT period_to FROM project_reports WHERE project_id = ? AND kind = 'parcial' AND period_to IS NOT NULL ORDER BY period_to DESC LIMIT 1").get(project.id) as
    | { period_to: string }
    | undefined;
  if (!last) return dayOf(project.approved_at);
  const d = new Date(`${last.period_to}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  const next = d.toISOString().slice(0, 10);
  return next > today() ? today() : next;
}

const defaultTitle = (project: db.Project, kind: Kind, from: string, to: string) =>
  kind === 'final' ? `Informe de cierre · ${project.name}` : `Informe de avance · ${dateEs(from)} al ${dateEs(to)}`;

function reportMail(project: db.Project, r: Report, to: string) {
  return projectReport({ to, projectName: project.name, kind: r.kind, title: r.title, body: r.body, url: `${PARTNERS_URL}/proyectos/${project.id}?tab=informes&informe=${r.id}` });
}

async function emailReport(project: db.Project, r: Report): Promise<string[]> {
  const to = updateRecipients(project);
  if (!to.length) throw new HttpError(409, 'Elige al menos a una persona (o agrega un correo) para enviarle el informe.');
  if (!google.connectionStatus().connected) throw new HttpError(409, 'Conecta Google en Configuración para enviar correos.');
  try {
    await google.sendMail(reportMail(project, r, to.join(', ')));
  } catch (err) {
    throw err instanceof google.GoogleError ? new HttpError(502, err.message) : err;
  }
  sqlite.prepare('UPDATE project_reports SET emailed_at = ?, emailed_to = ? WHERE id = ?').run(now(), to.join(', '), r.id);
  return to;
}

// ───────── Página para imprimir o guardar como PDF ─────────

// El logo horizontal de la marca, incrustado: la página del informe no carga nada de fuera.
const LOGO = (() => {
  try {
    return `data:image/png;base64,${readFileSync(new URL('../../public/brand/deersystems-horizontal.png', import.meta.url)).toString('base64')}`;
  } catch {
    return null;
  }
})();

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function mdToHtml(md: string): string {
  const inline = (s: string) =>
    esc(s)
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  const out: string[] = [];
  let list: { tag: 'ul' | 'ol'; items: string[] } | null = null;
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(`<p>${para.map(inline).join(' ')}</p>`);
    para = [];
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`);
    list = null;
  };
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    const ul = /^[-*•]\s+(.*)$/.exec(line);
    const ol = /^\d+[.)]\s+(.*)$/.exec(line);
    if (!line) flush();
    else if (h) {
      flush();
      const n = Math.max(2, Math.min(h[1].length, 4));
      out.push(`<h${n}>${inline(h[2])}</h${n}>`);
    } else if (ul || ol) {
      if (para.length) (out.push(`<p>${para.map(inline).join(' ')}</p>`), (para = []));
      const tag = ul ? 'ul' : 'ol';
      if (list && list.tag !== tag) flush();
      list ??= { tag, items: [] };
      list.items.push((ul ?? ol)![1]);
    } else {
      if (list) flush();
      para.push(line);
    }
  }
  flush();
  return out.join('\n');
}

function printPage(project: db.Project, r: Report): string {
  const final = r.kind === 'final';
  const period = r.period_from && r.period_to ? `Del ${dateEs(r.period_from)} al ${dateEs(r.period_to)}` : '';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(r.title || project.name)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  body { margin: 0; background: #eef2f5; color: #1c2a33; font: 400 14px/1.65 Inter, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; }
  .sheet { max-width: 780px; margin: 24px auto; padding: 48px 56px; background: #fff; border-radius: 8px; box-shadow: 0 8px 30px rgba(0,0,0,.08); }
  header { border-bottom: 3px solid #7ED957; padding-bottom: 18px; margin-bottom: 26px; }
  .brand { font: 700 13px/1 Montserrat, Arial, sans-serif; letter-spacing: .08em; color: #051923; }
  .logo { display: block; width: 210px; height: auto; }
  .eyebrow { margin-top: 18px; font: 500 11px/1.4 Menlo, monospace; letter-spacing: .14em; text-transform: uppercase; color: #5b6b78; }
  h1 { margin: 6px 0 4px; font: 700 26px/1.25 Montserrat, Arial, sans-serif; color: #051923; }
  .meta { color: #5b6b78; font-size: 13px; }
  h2 { margin: 28px 0 10px; font: 700 18px/1.3 Montserrat, Arial, sans-serif; color: #051923; }
  h3, h4 { margin: 20px 0 8px; font: 600 15px/1.4 Montserrat, Arial, sans-serif; color: #051923; }
  ul, ol { padding-left: 22px; } li { margin: 0 0 5px; }
  a { color: #0077a8; }
  footer { margin-top: 36px; padding-top: 14px; border-top: 1px solid #dde4ea; color: #7a8995; font-size: 12px; }
  .bar { max-width: 780px; margin: 16px auto 0; text-align: right; }
  .bar button { font: 600 13px Inter, Arial, sans-serif; padding: 9px 16px; border: 0; border-radius: 6px; background: #051923; color: #fff; cursor: pointer; }
  @media print { body { background: #fff; } .sheet { margin: 0; padding: 0; box-shadow: none; max-width: none; } .bar { display: none; } }
</style></head><body>
<div class="bar"><button onclick="print()">Guardar como PDF / Imprimir</button></div>
<main class="sheet">
  <header>
    ${LOGO ? `<img class="logo" src="${LOGO}" alt="DeerSystems">` : '<div class="brand">DeerSystems</div>'}
    <div class="eyebrow">${esc(project.name)} · ${final ? 'Informe de cierre' : 'Informe parcial'}</div>
    <h1>${esc(r.title || (final ? 'Informe de cierre' : 'Informe de avance'))}</h1>
    <div class="meta">${esc(period)}${r.published_at ? `${period ? ' · ' : ''}Publicado el ${esc(dateEs(dayOf(r.published_at)))}` : ' · Borrador'}</div>
  </header>
  ${mdToHtml(r.body)}
  <footer>DeerSystems · deersystems.net · Informe generado en DeerSystems Partners</footer>
</main></body></html>`;
}

// ───────── Rutas ─────────

const kindOf = (raw: unknown): Kind => (raw === 'final' ? 'final' : 'parcial');
const optDay = (raw: unknown) => (typeof raw === 'string' && DAY_RE.test(raw) ? raw : null);

export async function handleReports(route: string, id: number, req: IncomingMessage, res: ServerResponse, v: Viewer): Promise<boolean> {
  switch (route) {
    case 'GET projects/:id/reports': {
      const project = visibleProject(id, v);
      const staff = staffOnly(v);
      const list = listReports(project.id).filter((r) => staff || r.status === 'publicado');
      json(res, 200, {
        reports: list.map(view),
        // Para el formulario: desde dónde va el siguiente parcial.
        defaults: staff ? { from: defaultFrom(project), to: today(), status: project.status } : null,
      });
      return true;
    }

    // Crea el informe como borrador, ya redactado por la IA con los datos del proyecto y la información adicional.
    case 'POST projects/:id/reports': {
      requireStaff(v);
      const project = visibleProject(id, v);
      const body = await readJson(req, 64 * 1024);
      const kind = kindOf(body.kind);
      const from = kind === 'final' ? (optDay(body.from) ?? dayOf(project.approved_at)) : (optDay(body.from) ?? defaultFrom(project));
      const to = optDay(body.to) ?? today();
      if (from > to) throw new HttpError(400, 'La fecha inicial va después de la final.');
      const context = String(body.context ?? '').slice(0, 8000);
      // Los valores solo los ve el dueño: nadie del equipo puede meterlos en un informe.
      const includePayments = v.kind === 'owner' && body.includePayments === true ? 1 : 0;
      const g = await generate(project, { kind, period_from: from, period_to: to, context, include_payments: includePayments });
      const t = now();
      const { lastInsertRowid } = sqlite
        .prepare(
          `INSERT INTO project_reports (project_id, kind, title, period_from, period_to, context, include_payments, body, ai, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(project.id, kind, str(body.title, 200) || defaultTitle(project, kind, from, to), from, to, context, includePayments, g.body, g.ai ? 1 : 0, v.email, t, t);
      json(res, 201, { report: view(getReport(Number(lastInsertRowid))!), warning: g.warning });
      return true;
    }

    case 'PATCH reports/:id': {
      requireStaff(v);
      const { report } = visibleReport(id, v);
      const body = await readJson(req, 128 * 1024);
      const title = body.title === undefined ? report.title : str(body.title, 200);
      const text = typeof body.body === 'string' ? body.body.slice(0, 40_000) : report.body;
      const context = typeof body.context === 'string' ? body.context.slice(0, 8000) : report.context;
      const from = body.from === undefined ? report.period_from : optDay(body.from);
      const to = body.to === undefined ? report.period_to : optDay(body.to);
      const includePayments = body.includePayments === undefined ? report.include_payments : v.kind === 'owner' && body.includePayments === true ? 1 : 0;
      sqlite
        .prepare('UPDATE project_reports SET title = ?, body = ?, context = ?, period_from = ?, period_to = ?, include_payments = ?, updated_at = ? WHERE id = ?')
        .run(title, text, context, from, to, includePayments, now(), report.id);
      json(res, 200, view(getReport(report.id)!));
      return true;
    }

    // Vuelve a redactarlo con los datos de hoy y la información adicional guardada (reemplaza el texto).
    case 'POST reports/:id/regenerate': {
      requireStaff(v);
      const { report, project } = visibleReport(id, v);
      const g = await generate(project, report);
      sqlite.prepare('UPDATE project_reports SET body = ?, ai = ?, updated_at = ? WHERE id = ?').run(g.body, g.ai ? 1 : 0, now(), report.id);
      json(res, 200, { report: view(getReport(report.id)!), warning: g.warning });
      return true;
    }

    // Publica: el cliente lo ve en el portal; por correo si se pide; el de cierre puede finalizar el proyecto.
    case 'POST reports/:id/publish': {
      requireStaff(v);
      const { report, project } = visibleReport(id, v);
      const body = await readJson(req);
      if (!report.body.trim()) throw new HttpError(400, 'El informe está vacío.');
      if (body.email === true) {
        if (!updateRecipients(project).length) throw new HttpError(409, 'Elige al menos a una persona (o agrega un correo) para enviarle el informe.');
        if (!google.connectionStatus().connected) throw new HttpError(409, 'Conecta Google en Configuración para enviar correos.');
      }
      const first = report.status !== 'publicado';
      sqlite.prepare("UPDATE project_reports SET status = 'publicado', published_at = COALESCE(published_at, ?), updated_at = ? WHERE id = ?").run(now(), now(), report.id);
      const published = getReport(report.id)!;
      const a = actor(v);
      if (first) {
        db.logActivity({ projectId: project.id, actorKind: a.kind, actorName: a.name, type: 'report_published', data: { title: published.title, kind: published.kind } });
        notify('staff_update', {
          actor: v,
          projectId: project.id,
          title: `${published.kind === 'final' ? 'Informe de cierre' : 'Nuevo informe'} de ${project.name}`,
          body: published.title,
          path: `/proyectos/${project.id}?tab=informes&informe=${published.id}`,
          skipEmail: true,
        });
      }
      let closed = false;
      if (body.close === true && published.kind === 'final' && project.status !== 'finalizado') {
        db.updateProject(project.id, { status: 'finalizado' });
        db.logActivity({ projectId: project.id, actorKind: a.kind, actorName: a.name, type: 'project_status', data: { from: project.status, to: 'finalizado' } });
        closed = true;
      }
      let emailed: string[] = [];
      let emailError: string | null = null;
      if (body.email === true) {
        try {
          emailed = await emailReport(project, published);
        } catch (err) {
          emailError = (err as Error).message;
        }
      }
      json(res, 200, { report: view(getReport(report.id)!), closed, emailed, emailError });
      return true;
    }

    case 'POST reports/:id/email': {
      requireStaff(v);
      const { report, project } = visibleReport(id, v);
      if (report.status !== 'publicado') throw new HttpError(400, 'Publícalo antes de enviarlo por correo.');
      const to = await emailReport(project, report);
      json(res, 200, { report: view(getReport(report.id)!), emailed: to });
      return true;
    }

    case 'POST reports/:id/mail-preview': {
      requireStaff(v);
      const { report, project } = visibleReport(id, v);
      const body = await readJson(req, 128 * 1024);
      const draft = { ...report, title: typeof body.title === 'string' ? body.title : report.title, body: typeof body.body === 'string' ? body.body : report.body };
      const m = reportMail(project, draft, updateRecipients(project).join(', ') || 'cliente@empresa.com');
      json(res, 200, { subject: m.subject, to: m.to, html: m.html });
      return true;
    }

    case 'DELETE reports/:id': {
      requireStaff(v);
      const { report } = visibleReport(id, v);
      sqlite.prepare('DELETE FROM project_reports WHERE id = ?').run(report.id);
      json(res, 200, { ok: true });
      return true;
    }

    // Versión para imprimir o guardar como PDF (con la sesión del portal).
    case 'GET reports/:id/print': {
      const { report, project } = visibleReport(id, v);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:" });
      res.end(printPage(project, report));
      return true;
    }
  }
  return false;
}
