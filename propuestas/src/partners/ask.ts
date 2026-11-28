import type { IncomingMessage, ServerResponse } from 'node:http';
import { AiError, complete } from '../ai.ts';
import { db as sqlite } from '../db.ts';
import { HttpError, json, readJson } from '../http.ts';
import type { Viewer } from './auth.ts';
import { projectPlan, statement } from './billing.ts';
import { requireOwner, str } from './common.ts';
import * as db from './db.ts';
import { clientFormsText } from './forms.ts';

/**
 * «Pregúntale a la IA» sobre un cliente (solo el administrador). Arma el contexto con todo lo guardado en su espacio
 * (proyectos y tareas, reuniones con resúmenes, acuerdos y extractos de transcripción, formularios, avances,
 * bitácora y pagos) y le pide a la IA que responda solo con eso, citando de dónde sale cada dato.
 */

const TZ = 'America/Bogota';
const fecha = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ }) : 'sin fecha';
const cut = (s: string | null | undefined, n: number) => {
  const t = (s ?? '').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};
const parse = <T>(s: string | null, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};
const money = (n: number, c = 'COP') => (c === 'USD' ? `US$${n.toLocaleString('es-CO')}` : `$${Math.round(n).toLocaleString('es-CO')}`);

interface MeetingRow {
  id: number;
  project_id: number | null;
  title: string;
  start_at: string;
  status: string;
  tentative: number;
  summary: string;
  agreements: string;
  transcript: string | null;
  meet_url: string | null;
}

/** El contexto del cliente en texto, de lo más reciente a lo más antiguo, recortado a un tamaño razonable. */
export function clientContext(clientId: number, owner: Viewer): string {
  const c = db.getClient(clientId);
  if (!c) throw new HttpError(404, 'El cliente no existe.');
  const out: string[] = [];
  const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ });
  out.push(`HOY: ${today}`);
  out.push(`# CLIENTE: ${c.name}`, `Contacto: ${c.contact_name || '—'} · ${c.email || 'sin correo'} · ${c.phone || 'sin teléfono'}${c.city ? ` · ${c.city}` : ''}`);

  // Proyectos y tareas
  const projects = db.listProjects(clientId);
  for (const p of projects) {
    const tasks = db.listTasks(p.id);
    const open = tasks.filter((t) => t.status !== 'completada');
    const done = tasks.filter((t) => t.status === 'completada').sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''));
    out.push(
      '',
      `## PROYECTO: ${p.name} [${p.status}] · ${fecha(p.start_date)} → ${fecha(p.end_date)} · ${done.length}/${tasks.length} tareas completadas`,
      ...(p.approved_option ? [`Opción aprobada: ${p.approved_option}`] : []),
      ...(p.approval_notes ? [`Notas de la aprobación: ${cut(p.approval_notes, 600)}`] : []),
      `Alcance (extracto): ${cut(p.scope, 1200) || '—'}`,
      `Tareas pendientes (${open.length}):`,
      ...open
        .slice(0, 40)
        .map((t) => `- [${t.status}] ${t.title} · le toca a ${t.side === 'cliente' ? `el cliente${t.client_assignee ? ` (${t.client_assignee})` : ''}` : 'DeerSystems'} · entrega ${fecha(t.due_date)}`),
      `Últimas completadas:`,
      ...done.slice(0, 8).map((t) => `- ${t.title} · ${fecha(t.completed_at)}`),
    );
  }

  // Reuniones: las próximas y las últimas, con resumen, acuerdos y extracto de la transcripción de las más recientes.
  const meetings = sqlite
    .prepare("SELECT id, project_id, title, start_at, status, tentative, summary, agreements, transcript, meet_url FROM meetings WHERE client_id = ? AND status != 'descartada' ORDER BY start_at DESC LIMIT 40")
    .all(clientId) as unknown as MeetingRow[];
  const now = Date.now();
  const upcoming = meetings.filter((m) => Date.parse(m.start_at) > now).reverse();
  const past = meetings.filter((m) => Date.parse(m.start_at) <= now);
  out.push('', `## PRÓXIMAS REUNIONES (${upcoming.length})`);
  for (const m of upcoming.slice(0, 8)) out.push(`- ${fecha(m.start_at)} · ${m.title}${m.tentative ? ' · POR CONFIRMAR con el cliente' : ''}`);
  out.push('', `## REUNIONES PASADAS (${past.length}), de la más reciente a la más antigua`);
  past.slice(0, 12).forEach((m, i) => {
    const agreements = parse<string[]>(m.agreements, []);
    out.push(
      '',
      `### Reunión «${m.title}» · ${fecha(m.start_at)} · estado: ${m.status}`,
      ...(m.summary ? [`Resumen: ${cut(m.summary, i < 3 ? 2500 : 800)}`] : []),
      ...(agreements.length ? [`Acuerdos: ${agreements.map((a) => `«${cut(a, 300)}»`).join('; ')}`] : []),
      // De las 2 más recientes, también un extracto de la transcripción (el final suele traer cierres y pendientes).
      ...(i < 2 && m.transcript ? [`Transcripción (extracto): ${cut(m.transcript.length > 6000 ? `${m.transcript.slice(0, 2500)} […] ${m.transcript.slice(-3500)}` : m.transcript, 6200)}`] : []),
    );
  });

  // Formularios y onboardings
  const forms = clientFormsText(clientId);
  if (forms.length) {
    out.push('', `## FORMULARIOS Y ONBOARDINGS (${forms.length})`);
    for (const f of forms.slice(0, 6)) out.push('', `Estado: ${f.status}${f.submittedAt ? ` · enviado ${fecha(f.submittedAt)}` : ''}`, cut(f.text, 3500));
  }

  // Avances publicados y bitácora reciente
  const ids = projects.map((p) => p.id);
  if (ids.length) {
    const marks = ids.map(() => '?').join(',');
    const updates = sqlite
      .prepare(`SELECT project_id, body, created_at FROM notes WHERE project_id IN (${marks}) AND kind = 'avance' ORDER BY created_at DESC LIMIT 6`)
      .all(...ids) as { project_id: number; body: string; created_at: string }[];
    if (updates.length) {
      out.push('', '## AVANCES PUBLICADOS (más recientes)');
      for (const u of updates) out.push(`- ${fecha(u.created_at)} · ${projects.find((p) => p.id === u.project_id)?.name}: ${cut(u.body.replace(/\s+/g, ' '), 700)}`);
    }
    const activity = sqlite
      .prepare(`SELECT project_id, actor_name, type, data, created_at FROM activity WHERE project_id IN (${marks}) ORDER BY id DESC LIMIT 25`)
      .all(...ids) as { project_id: number; actor_name: string; type: string; data: string; created_at: string }[];
    if (activity.length) {
      out.push('', '## BITÁCORA RECIENTE');
      for (const a of activity) {
        const d = parse<Record<string, unknown>>(a.data, {});
        const detail = Object.values(d)
          .filter((x) => typeof x === 'string' || typeof x === 'number')
          .slice(0, 3)
          .join(' · ');
        out.push(`- ${fecha(a.created_at)} · ${a.actor_name} · ${a.type}${detail ? ` · ${cut(detail, 160)}` : ''}`);
      }
    }
  }

  // Pagos
  const plan = projectPlan(clientId, owner);
  const st = statement(clientId);
  out.push(
    '',
    '## PAGOS',
    `Plan de pagos de los proyectos: total ${money(plan.total)} · pagado ${money(plan.paid)} · pendiente ${money(plan.pending)}${plan.usdWithoutTrm ? ` · más ${money(plan.usdWithoutTrm, 'USD')} sin TRM` : ''}`,
    `Cuentas de cobro: facturado ${money(st.totals.invoiced)} · abonado ${money(st.totals.paid)}`,
    ...plan.upcoming.map((u) => `- Pendiente: ${u.label} (${u.projectName}) · ${money(u.amount, u.currency)} · ${fecha(u.dueDate)}`),
  );

  // Tope de tamaño: lo más reciente va primero en cada sección, así que se recorta el final.
  const text = out.join('\n');
  return text.length > 90_000 ? `${text.slice(0, 90_000)}\n[…contexto recortado…]` : text;
}

const SYSTEM = `Eres el asistente interno de DeerSystems (agencia colombiana de software, automatización e IA). Le respondes a David, el dueño, preguntas sobre UN cliente usando SOLO el contexto que te entrego (proyectos, tareas, reuniones con resúmenes y transcripciones, formularios, avances, bitácora y pagos).
Reglas:
- Responde en español, directo y breve: primero la respuesta, luego el detalle en viñetas si hace falta.
- Cita de dónde sale cada dato entre corchetes, p. ej. [Reunión «Kickoff» · 12 nov 2026], [Formulario «Onboarding»], [Tarea], [Pagos].
- Si algo no está en el contexto, dilo: «No está registrado». No inventes fechas, valores ni acuerdos.
- Fechas en formato «12 de noviembre». Valores en pesos con puntos de miles.
- Si te piden el estado del cliente: avance de cada proyecto, qué le toca a cada parte, lo último hablado, próxima reunión y pagos pendientes.`;

export async function handleAsk(route: string, id: number, req: IncomingMessage, res: ServerResponse, v: Viewer): Promise<boolean> {
  if (route !== 'POST clients/:id/ask') return false;
  requireOwner(v);
  const body = await readJson(req, 100_000);
  const question = str(body.question, 1500);
  if (question.length < 3) throw new HttpError(400, 'Escribe tu pregunta.');
  // Las preguntas anteriores de esta conversación, para que entienda «¿y de eso qué falta?».
  const history = (Array.isArray(body.history) ? body.history : [])
    .slice(-4)
    .map((h) => (h && typeof h === 'object' ? (h as Record<string, unknown>) : {}))
    .map((h) => `P: ${str(h.q, 1500)}\nR: ${cut(str(h.a, 4000), 2500)}`)
    .join('\n\n');
  const context = clientContext(id, v);
  try {
    const r = await complete({
      profile: 'reuniones',
      purpose: 'cliente',
      system: SYSTEM,
      prompt: `CONTEXTO DEL CLIENTE\n"""\n${context}\n"""\n${history ? `\nCONVERSACIÓN ANTERIOR\n${history}\n` : ''}\nPREGUNTA: ${question}`,
      maxOutputTokens: 2000,
    });
    json(res, 200, { answer: r.text.trim(), ai: { provider: r.provider, model: r.model, costUsd: r.costUsd, latencyMs: r.latencyMs }, contextChars: context.length });
  } catch (err) {
    if (err instanceof AiError) throw new HttpError(502, err.message);
    throw err;
  }
  return true;
}
