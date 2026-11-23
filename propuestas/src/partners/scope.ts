import type { IncomingMessage, ServerResponse } from 'node:http';
import { AiError, completeJson } from '../ai.ts';
import { db as sqlite, getProposal } from '../db.ts';
import { HttpError, json, readJson } from '../http.ts';
import { combined, generatedData, optionsOf, shortName, type PublicOption } from './approvals.ts';
import type { Viewer } from './auth.ts';
import * as billing from './billing.ts';
import { actor, requireOwner, str, visibleProject } from './common.ts';
import * as db from './db.ts';
import { createPayments } from './payments.ts';
import { applyPlan, normalizeOps, placeMoves, preview, tasksForAi, weekdaysRule } from './planAdjust.ts';
import { DELIVERY_RULE } from './extract.ts';

/**
 * Retirar del alcance una opción o fase ya aprobada (el cliente pidió quitarla a mitad de camino):
 * en un solo paso se van sus tareas pendientes, sus pagos sin pagar, y la «opción aprobada» del proyecto
 * se recalcula («Opciones 1, 2, 3 y 4» en vez de «Propuesta completa (opciones 1 a 5)»). Lo terminado se queda,
 * todo queda registrado y la opción retirada vuelve a estar disponible para aprobarla después en la propuesta.
 */

interface PaymentRow {
  id: number;
  label: string;
  amount: number | null;
  currency: string;
  paid: number;
  invoice_id: string | null;
}

interface ChangeRow {
  id: number;
  option_id: string;
  option_name: string;
  amount: number | null;
  currency: string;
  reason: string;
  label_before: string;
  label_after: string;
  phases: string;
  tasks_removed: number;
  payments: string;
  created_at: string;
  created_by: string;
  kind: string;
  detail: string;
}

/** Cuándo se cobra un adicional: al aprobarlo (hoy), al entregarlo (la última tarea) o en una fecha. */
type PayWhen = 'aprobar' | 'entregar' | 'fecha';

interface AdditionTask {
  title: string;
  description: string;
  side: 'deersystems' | 'cliente';
  clientDelivery: boolean;
  startDate: string | null;
  dueDate: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const day = (v: unknown) => (typeof v === 'string' && DATE_RE.test(v) ? v : null);
const todayBogota = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
const isWeekend = (d: string) => [0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay());
const round2 = (n: number) => Math.round(n * 100) / 100;
const pct = (n: number) => String(n).replace('.', ',');

function normalizeTasks(raw: unknown): AdditionTask[] {
  return ((Array.isArray(raw) ? raw : []) as Record<string, unknown>[])
    .slice(0, 30)
    .map((t) => {
      let start = day(t?.startDate);
      let due = day(t?.dueDate);
      if (start && due && start > due) [start, due] = [due, start];
      return {
        title: str(t?.title, 200).trim(),
        description: str(t?.description, 4000),
        side: t?.side === 'cliente' ? ('cliente' as const) : ('deersystems' as const),
        clientDelivery: t?.side !== 'cliente' && t?.clientDelivery === true,
        startDate: start,
        dueDate: due ?? start,
      };
    })
    .filter((t) => t.title);
}

/** Valor del adicional: base menos el descuento (p. ej. 50 USD − 15 % = 42,50 USD). */
function priceOf(body: Record<string, unknown>) {
  const base = round2(Number(body.amount) || 0);
  const discount = round2(Number(body.discountPercent) || 0);
  if (!Number.isFinite(base) || base < 0) throw new HttpError(400, 'El valor del adicional no es válido.');
  if (discount < 0 || discount >= 100) throw new HttpError(400, 'El descuento va entre 0 y 99 %.');
  const currency = String(body.currency).toUpperCase() === 'USD' ? ('USD' as const) : ('COP' as const);
  return { base, discount, total: round2(base * (1 - discount / 100)), currency };
}

const money = (n: number, currency: string) => {
  const digits = currency === 'USD' ? 2 : 0;
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
};

/** La IA arma las tareas del adicional a partir de lo que pidió el cliente, sin tocar el resto del plan. */
async function suggestAddition(project: db.Project, p: { name: string; request: string; allowWeekends: boolean }) {
  const today = todayBogota();
  const weekday = new Date().toLocaleDateString('es-CO', { weekday: 'long', timeZone: 'America/Bogota' });
  const { data, completion } = await completeJson<Record<string, unknown>>({
    profile: 'propuestas',
    purpose: 'adicional al alcance',
    system: `Eres el asistente de operaciones de DeerSystems. Conviertes una solicitud adicional de un cliente en las tareas de una fase nueva del proyecto.
Responde SOLO con un objeto JSON válido, en español, sin comentarios ni texto adicional.`,
    prompt: `Hoy es ${today} (${weekday}). Proyecto: "${project.name}". Entrega estimada del proyecto: ${project.end_date ?? 'sin fecha'}.
Fases actuales (no se tocan): ${JSON.stringify(db.listPhases(project.id).map((ph) => ph.name))}

ADICIONAL: "${p.name}"
SOLICITUD (tal como se acordó con el cliente):
"""
${p.request}
"""

Devuelve:
{
  "tasks": [{ "title": "...", "description": "qué se hace y cómo se sabe que está listo", "side": "deersystems | cliente", "clientDelivery": true, "startDate": "YYYY-MM-DD", "dueDate": "YYYY-MM-DD" }],
  "notes": ["aviso corto si algo no cuadra (p. ej. una fecha imposible)"]
}

Reglas:
- Solo las tareas de este adicional, entre 2 y 10, en orden. No cambies ni repitas tareas del resto del proyecto.
- "side" es "cliente" para lo que debe entregar o hacer el cliente (enlaces, contenidos, accesos, aprobaciones, pagos); lo demás es "deersystems".
- Respeta los plazos que diga la solicitud (p. ej. "publicar antes del lunes", "necesito hoy los enlaces"). Si dice que otra entrega no se mueve, ninguna tarea va después de esa fecha.
- Incluye una tarea final de publicación o entrega del adicional.
- ${DELIVERY_RULE}
- ${weekdaysRule(p.allowWeekends)}
- No incluyas precios ni valores en las tareas.`,
    maxOutputTokens: 4096,
  });
  const tasks = normalizeTasks(data.tasks);
  if (!tasks.length) throw new AiError(`El modelo ${completion.model} no devolvió tareas. Vuelve a intentarlo o agrégalas a mano.`);
  const notes = (Array.isArray(data.notes) ? data.notes : [])
    .map((n) => str(n, 300))
    .filter(Boolean)
    .slice(0, 5);
  if (!p.allowWeekends && tasks.some((t) => (t.startDate && isWeekend(t.startDate)) || (t.dueDate && isWeekend(t.dueDate))))
    notes.push('Alguna fecha cae en fin de semana: cámbiala o marca «Permitir fin de semana».');
  return { tasks, notes, ai: { provider: completion.provider, model: completion.model, costUsd: completion.costUsd, latencyMs: completion.latencyMs } };
}

/**
 * Ajustar el alcance con IA: «el blog queda en 3 artículos y se quita la integración con Stripe». La IA reescribe el texto
 * del alcance aprobado cambiando solo lo pedido y propone lo que eso implica en las tareas. No guarda nada: se revisa y
 * se aplica aparte. Lo que tiene valor (un adicional o un retiro con su pago) sigue por «Agregar adicional» / «Retirar».
 */
async function suggestAdjust(project: db.Project, p: { instruction: string; allowWeekends: boolean; withPlan: boolean }) {
  const today = todayBogota();
  const weekday = new Date().toLocaleDateString('es-CO', { weekday: 'long', timeZone: 'America/Bogota' });
  const { data, completion } = await completeJson<Record<string, unknown>>({
    profile: 'propuestas',
    purpose: 'ajuste del alcance del proyecto',
    system: `Eres el asistente de operaciones de DeerSystems. Ajustas el alcance aprobado de un proyecto en marcha según lo acordado con el cliente${p.withPlan ? ', y el plan de tareas en consecuencia' : ''}.
Responde SOLO con un objeto JSON válido, en español, sin comentarios ni texto adicional.`,
    prompt: `Hoy es ${today} (${weekday}). Proyecto: "${project.name}". Entrega estimada: ${project.end_date ?? 'sin fecha'}.
Opción aprobada: ${project.approved_option || 'sin dato'}.${project.approval_notes ? `\nAjustes acordados al aprobar: ${project.approval_notes}` : ''}

ALCANCE APROBADO ACTUAL (Markdown):
"""
${project.scope || '(vacío)'}
"""
${
  p.withPlan
    ? `
FASES: ${JSON.stringify(db.listPhases(project.id).map((ph) => ph.name))}
TAREAS ACTUALES (JSON; kind "reunion" = reunión con el cliente):
${JSON.stringify(tasksForAi(project.id))}
`
    : ''
}
LO QUE CAMBIA EN EL ALCANCE:
"""
${p.instruction}
"""

Devuelve:
{
  "scope": "el alcance completo ya ajustado, en Markdown",
  "changes": ["cambio hecho, en una frase corta", "..."],
  "notes": ["aviso corto, solo si hace falta"]${
    p.withPlan
      ? `,
  "updates": [{ "id": 12, "title": "...", "description": "...", "side": "deersystems | cliente", "phase": "nombre exacto de una fase", "startDate": "YYYY-MM-DD", "dueDate": "YYYY-MM-DD" }],
  "creates": [{ "phase": "nombre de una fase (existente o nueva)", "title": "...", "description": "...", "side": "deersystems | cliente", "kind": "tarea", "startDate": "YYYY-MM-DD", "dueDate": "YYYY-MM-DD" }],
  "deletes": [34]`
      : ''
  }
}

Reglas del alcance:
- Cambia SOLO lo que pide la instrucción. Todo lo demás queda igual, palabra por palabra, con el mismo formato Markdown (títulos, listas, negritas, orden).
- Si se quita algo, sácalo del texto (no lo tachees ni dejes "retirado"). Si se agrega, ponlo donde encaja según la estructura.
- Si el alcance está vacío, redacta uno corto y claro con lo que dice la instrucción.
- No pongas precios ni valores en el alcance. Si el cambio tiene costo o descuento, dilo en "notes": eso se registra con «Agregar adicional» o «Retirar del alcance».${
    p.withPlan
      ? `

Reglas del plan:
- Propón solo los cambios de tareas que sean consecuencia directa del ajuste: tareas nuevas para lo que se agrega, eliminar las pendientes de lo que se quita, y cambiar título, descripción o fechas de lo que se modifica. Si el plan no cambia, deja las listas vacías.
- En "updates" pon el "id" y SOLO los campos que cambian. No toques tareas con status "completada" ni reuniones.
- ${weekdaysRule(p.allowWeekends)}
- No incluyas precios ni valores en tareas.`
      : ''
  }
- "changes": entre 1 y 8 frases sobre lo que cambiaste${p.withPlan ? ' (en el alcance y en el plan)' : ''}. Si la instrucción no se puede aplicar, devuelve el alcance igual y explícalo en "changes".`,
    maxOutputTokens: 16384,
  });
  const scope = typeof data.scope === 'string' ? data.scope.trim().slice(0, 30_000) : '';
  if (!scope) throw new AiError(`El modelo ${completion.model} no devolvió el alcance. Vuelve a intentarlo.`);
  const list = (v: unknown, n: number) =>
    (Array.isArray(v) ? v : [])
      .map((x) => str(x, 300))
      .filter(Boolean)
      .slice(0, n);
  const { ops, skipped } = p.withPlan ? normalizeOps(project.id, data) : { ops: { updates: [], creates: [], deletes: [] }, skipped: [] };
  // Las reuniones no se tocan desde aquí (para moverlas está «Ajustar con IA» del plan).
  const isMeeting = (id: number) => db.getTask(id)?.kind === 'reunion';
  ops.updates = ops.updates.filter((u) => !isMeeting(u.id));
  ops.deletes = ops.deletes.filter((id) => !isMeeting(id));
  ops.creates = ops.creates.filter((c) => c.kind !== 'reunion');
  const notes = await placeMoves(ops);
  const warnings = [...skipped, ...list(data.notes, 5)];
  if (!p.allowWeekends && [...ops.updates, ...ops.creates].some((t) => (t.startDate && isWeekend(t.startDate)) || (t.dueDate && isWeekend(t.dueDate))))
    warnings.push('Alguna fecha del plan cae en fin de semana: marca «Permitir fin de semana» o vuelve a proponer.');
  return {
    scopeBefore: project.scope,
    scope,
    changes: list(data.changes, 8),
    warnings,
    plan: { ops, preview: preview(project.id, ops, notes) },
    ai: { provider: completion.provider, model: completion.model, costUsd: completion.costUsd, latencyMs: completion.latencyMs },
  };
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^(opcion|fase|etapa|modulo)\s+\w+\s*[·:.\-–—]\s*/, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const STOP = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'e', 'en', 'para', 'con', 'a', 'al', 'por', 'un', 'una']);
const words = (s: string) => new Set(norm(s).split(' ').filter((w) => w.length > 2 && !STOP.has(w)));

/** ¿Este nombre (fase o pago) corresponde a la opción? Por nombre corto contenido o por palabras en común. */
function matches(text: string, o: PublicOption): boolean {
  const t = norm(text);
  const short = norm(shortName(o));
  if (!short) return false;
  if (t.includes(short) || (t.length > 3 && short.includes(t))) return true;
  // «Fase 5» / «Opción 5» explícitos con el mismo número.
  const num = /^(?:fase|etapa|modulo|opcion)\s+(\w+)\b/.exec(text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''));
  if (num && num[1] === o.id.toLowerCase()) return true;
  const a = words(text);
  const b = words(shortName(o));
  if (!a.size || !b.size) return false;
  const common = [...b].filter((w) => a.has(w)).length;
  return common / b.size >= 0.6;
}

/** Ids de las opciones aprobadas que siguen vigentes en el proyecto (lo convertido, menos lo retirado). */
function activeOptionIds(projectId: number): string[] {
  const approved = (
    sqlite.prepare("SELECT option_id FROM proposal_approvals WHERE project_id = ? AND status = 'convertida' AND option_id != '' ORDER BY id").all(projectId) as {
      option_id: string;
    }[]
  ).flatMap((r) => r.option_id.split(','));
  const removed = new Set(
    (sqlite.prepare("SELECT option_id FROM scope_changes WHERE project_id = ? AND option_id != ''").all(projectId) as { option_id: string }[]).flatMap((r) =>
      r.option_id.split(','),
    ),
  );
  return [...new Set(approved)].filter((id) => !removed.has(id));
}

async function context(project: db.Project) {
  const proposal = project.proposal_id ? getProposal(project.proposal_id) : null;
  const data = proposal ? await generatedData(proposal) : null;
  const all = optionsOf(data);
  const currency = data?.meta?.aprobacion?.moneda === 'USD' ? 'USD' : 'COP';
  const activeIds = activeOptionIds(project.id);
  const active = all.filter((o) => activeIds.includes(o.id));
  const phases = db.listPhases(project.id).map((ph) => {
    const c = sqlite
      .prepare("SELECT COUNT(*) AS total, COALESCE(SUM(status = 'completada'), 0) AS done, COALESCE(SUM(kind = 'reunion' AND status != 'completada'), 0) AS meetings FROM tasks WHERE phase_id = ?")
      .get(ph.id) as { total: number; done: number; meetings: number };
    return { id: ph.id, name: ph.name, pending: c.total - c.done, done: c.done, meetings: c.meetings };
  });
  const payments = (sqlite.prepare('SELECT id, label, amount, currency, paid, invoice_id FROM payments WHERE project_id = ? ORDER BY position, id').all(project.id) as unknown as PaymentRow[]).map(
    (p) => ({ id: p.id, label: p.label, amount: p.amount, currency: p.currency, paid: !!p.paid, invoiced: !!p.invoice_id || !!billing.receiptForPayment(p.id) }),
  );
  return { all, active, currency, phases, payments };
}

/** La etiqueta de lo aprobado sin las opciones retiradas («Opciones 1, 2, 3 y 4 · …»). */
function labelFor(all: PublicOption[], remaining: PublicOption[], fallback: string): string {
  if (!remaining.length) return fallback;
  return combined(remaining, all).name;
}

export async function handleScope(route: string, id: number, req: IncomingMessage, res: ServerResponse, v: Viewer): Promise<boolean> {
  switch (route) {
    // Lo que se puede retirar, con sugerencias: para cada opción vigente, sus fases y pagos sin pagar.
    case 'GET projects/:id/scope': {
      requireOwner(v);
      const project = visibleProject(id, v);
      const c = await context(project);
      const history = (sqlite.prepare('SELECT * FROM scope_changes WHERE project_id = ? ORDER BY id DESC').all(project.id) as unknown as ChangeRow[]).map((h) => ({
        id: h.id,
        optionName: h.option_name,
        amount: h.amount,
        currency: h.currency,
        reason: h.reason,
        labelBefore: h.label_before,
        labelAfter: h.label_after,
        phases: JSON.parse(h.phases) as string[],
        tasksRemoved: h.tasks_removed,
        payments: JSON.parse(h.payments) as string[],
        createdAt: h.created_at,
        kind: h.kind === 'adicional' || h.kind === 'ajuste' ? h.kind : 'retiro',
        detail: JSON.parse(h.detail || '{}') as Record<string, unknown>,
      }));
      json(res, 200, {
        approvedOption: project.approved_option,
        currency: c.currency,
        options: c.active.map((o) => {
          const remaining = c.active.filter((x) => x.id !== o.id);
          return {
            id: o.id,
            name: o.name,
            amount: o.amount,
            price: o.price,
            phaseIds: c.phases.filter((ph) => matches(ph.name, o)).map((ph) => ph.id),
            paymentIds: c.payments.filter((p) => !p.paid && !p.invoiced && matches(p.label, o)).map((p) => p.id),
            labelAfter: labelFor(c.all, remaining, project.approved_option),
          };
        }),
        phases: c.phases,
        payments: c.payments,
        history,
      });
      return true;
    }

    case 'POST projects/:id/scope/remove': {
      requireOwner(v);
      const project = visibleProject(id, v);
      const body = await readJson(req);
      const c = await context(project);
      const optionIds = (Array.isArray(body.optionIds) ? body.optionIds : []).map(String).filter((x) => c.active.some((o) => o.id === x));
      const phaseIds = new Set((Array.isArray(body.phaseIds) ? body.phaseIds : []).map(Number));
      const paymentIds = new Set((Array.isArray(body.paymentIds) ? body.paymentIds : []).map(Number));
      const phases = c.phases.filter((ph) => phaseIds.has(ph.id));
      const payments = c.payments.filter((p) => paymentIds.has(p.id));
      if (phases.length !== phaseIds.size || payments.length !== paymentIds.size) throw new HttpError(400, 'Alguna fase o pago ya no es de este proyecto. Recarga e intenta de nuevo.');
      const locked = payments.find((p) => p.paid || p.invoiced);
      if (locked) throw new HttpError(409, `«${locked.label}» ya está pagado o tiene abono: no se puede quitar desde aquí.`);
      if (!optionIds.length && !phases.length && !payments.length) throw new HttpError(400, 'Elige qué retirar: una opción, alguna fase o algún pago.');

      const removedOpts = c.active.filter((o) => optionIds.includes(o.id));
      const remaining = c.active.filter((o) => !optionIds.includes(o.id));
      const label = (str(body.label, 400) || (removedOpts.length ? labelFor(c.all, remaining, project.approved_option) : project.approved_option)).slice(0, 400);
      const reason = str(body.reason, 1000);
      const optionName = removedOpts.length ? removedOpts.map((o) => o.name).join(', ') : phases.map((p) => p.name).join(', ');
      // Lo que se deja de cobrar: el valor de la opción en la propuesta o, si no lo hay, la suma de los pagos quitados.
      const optAmount = removedOpts.reduce((s, o) => s + (o.amount ?? 0), 0);
      const payAmount = payments.reduce((s, p) => s + (p.amount ?? 0), 0);
      const amount = optAmount || payAmount || null;
      const currency = payments[0]?.currency ?? c.currency;

      // Los recibos de pagos sin pagar no deberían existir, pero si hay alguno se quita antes (como en «Eliminar pago»).
      for (const p of payments) {
        const receipt = billing.receiptForPayment(p.id);
        if (receipt) await billing.deleteReceipt(receipt);
      }

      const result = db.transaction(() => {
        let tasksRemoved = 0;
        let meetingsRemoved = 0;
        const phasesDeleted: string[] = [];
        for (const ph of phases) {
          const pending = sqlite.prepare("SELECT id, kind FROM tasks WHERE phase_id = ? AND status != 'completada'").all(ph.id) as { id: number; kind: string }[];
          for (const t of pending) {
            db.deleteTask(t.id);
            if (t.kind === 'reunion') meetingsRemoved++;
            else tasksRemoved++;
          }
          // Si tenía trabajo terminado, la fase se queda con eso (es historia del proyecto); si no, se va.
          if (!ph.done) {
            db.deletePhase(ph.id);
            phasesDeleted.push(ph.name);
          }
        }
        const del = sqlite.prepare('DELETE FROM payments WHERE id = ? AND paid = 0');
        for (const p of payments) del.run(p.id);

        const when = new Date().toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Bogota' });
        const money = amount ? ` (−${new Intl.NumberFormat('es-CO', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount)})` : '';
        const note = `**Ajuste de alcance · ${when}:** se retiró ${optionName}${money}.${reason ? ` ${reason}` : ''}`;
        db.updateProject(project.id, {
          approved_option: label,
          pricing: project.pricing.trim() ? `${project.pricing.trim()}\n\n${note}` : note,
        });
        sqlite
          .prepare(
            `INSERT INTO scope_changes (project_id, option_id, option_name, amount, currency, reason, label_before, label_after, phases, tasks_removed, payments, created_at, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            project.id,
            removedOpts.map((o) => o.id).join(','),
            optionName.slice(0, 400),
            amount,
            currency,
            reason,
            project.approved_option,
            label,
            JSON.stringify(phases.map((p) => p.name)),
            tasksRemoved + meetingsRemoved,
            JSON.stringify(payments.map((p) => p.label)),
            new Date().toISOString(),
            v.email,
          );
        const a = actor(v);
        db.logActivity({
          projectId: project.id,
          actorKind: a.kind,
          actorName: a.name,
          type: 'scope_removed',
          data: { option: optionName, tasks: tasksRemoved, meetings: meetingsRemoved, payments: payments.length, amount, currency },
        });
        // Aviso al cliente en las notas del proyecto (lo ve en su portal), si así se pidió.
        if (body.notify === true) {
          db.createNote({
            project_id: project.id,
            task_id: null,
            kind: 'nota',
            visibility: 'shared',
            author_kind: 'owner',
            author_id: null,
            author_name: a.name,
            body: `Ajustamos el alcance del proyecto: se retiró ${optionName}${money}. Lo aprobado queda como «${label}».${reason ? `\n\n${reason}` : ''}`,
          });
        }
        return { tasksRemoved, meetingsRemoved, phasesDeleted };
      });

      json(res, 200, { ok: true, approvedOption: label, ...result, payments: payments.length, amount, currency });
      return true;
    }

    // Ajuste del alcance con IA: propone el texto nuevo y los cambios del plan (no guarda nada).
    case 'POST projects/:id/scope/adjust/suggest': {
      requireOwner(v);
      const project = visibleProject(id, v);
      const body = await readJson(req, 64 * 1024);
      const instruction = str(body.instruction, 4000).trim();
      if (instruction.length < 5) throw new HttpError(400, 'Escribe qué cambia en el alcance.');
      try {
        json(res, 200, await suggestAdjust(project, { instruction, allowWeekends: body.allowWeekends === true, withPlan: body.withPlan !== false }));
      } catch (err) {
        if (err instanceof AiError) throw new HttpError(502, err.message);
        throw err;
      }
      return true;
    }

    // Ajuste del alcance: guarda el texto revisado, aplica los cambios del plan que se dejaron y lo registra.
    case 'POST projects/:id/scope/adjust': {
      requireOwner(v);
      const project = visibleProject(id, v);
      const body = await readJson(req, 256 * 1024);
      const instruction = str(body.instruction, 4000).trim();
      const scope = typeof body.scope === 'string' ? body.scope.trim().slice(0, 30_000) : '';
      if (!scope) throw new HttpError(400, 'El alcance no puede quedar vacío.');
      const changes = (Array.isArray(body.changes) ? body.changes : [])
        .map((c) => str(c, 300))
        .filter(Boolean)
        .slice(0, 8);
      const scopeChanged = scope !== project.scope.trim();
      const raw = (body.ops ?? {}) as Record<string, unknown>;
      // Las reuniones no se tocan desde aquí, aunque lleguen en lo que se envía.
      const isMeeting = (id: unknown) => db.getTask(Number(id))?.kind === 'reunion';
      const ops = {
        updates: (Array.isArray(raw.updates) ? raw.updates : []).filter((u) => !isMeeting((u as { id?: unknown })?.id)),
        creates: (Array.isArray(raw.creates) ? raw.creates : []).filter((c) => (c as { kind?: unknown })?.kind !== 'reunion'),
        deletes: (Array.isArray(raw.deletes) ? raw.deletes : []).filter((d) => !isMeeting(d)),
      };
      const hasOps = ops.updates.length + ops.creates.length + ops.deletes.length > 0;
      if (!scopeChanged && !hasOps) throw new HttpError(400, 'No hay cambios para aplicar.');

      if (scopeChanged) db.updateProject(project.id, { scope });
      const plan = hasOps ? await applyPlan(project, ops, instruction, v, false) : { applied: 0, errors: [] as string[], calendarMoved: 0 };
      const summary = changes.length ? changes.join(' ') : instruction;
      sqlite
        .prepare(
          `INSERT INTO scope_changes (project_id, option_id, option_name, amount, currency, reason, label_before, label_after, phases, tasks_removed, payments, created_at, created_by, kind, detail)
           VALUES (?, '', ?, NULL, '', ?, ?, ?, '[]', ?, '[]', ?, ?, 'ajuste', ?)`,
        )
        .run(
          project.id,
          (changes[0] ?? instruction).slice(0, 400),
          instruction.slice(0, 1000),
          project.approved_option,
          project.approved_option,
          plan.applied,
          new Date().toISOString(),
          v.email,
          JSON.stringify({ changes, scopeChanged }),
        );
      const a = actor(v);
      db.logActivity({
        projectId: project.id,
        actorKind: a.kind,
        actorName: a.name,
        type: 'scope_adjusted',
        data: { summary: summary.slice(0, 300), tasks: plan.applied, scope: scopeChanged },
      });
      if (body.notify === true) {
        db.createNote({
          project_id: project.id,
          task_id: null,
          kind: 'nota',
          visibility: 'shared',
          author_kind: 'owner',
          author_id: null,
          author_name: a.name,
          body: `Actualizamos el alcance del proyecto${changes.length ? ':\n\n' + changes.map((c) => `- ${c}`).join('\n') : '.'}${plan.applied ? `\n\nEl plan de trabajo se ajustó en consecuencia (${plan.applied} ${plan.applied === 1 ? 'cambio' : 'cambios'}).` : ''}`,
        });
      }
      json(res, 200, { ok: true, scopeChanged, ...plan });
      return true;
    }

    // Adicional: la IA propone las tareas de la fase nueva (no guarda nada).
    case 'POST projects/:id/scope/add/suggest': {
      requireOwner(v);
      const project = visibleProject(id, v);
      const body = await readJson(req, 64 * 1024);
      const name = str(body.name, 160).trim();
      const request = str(body.request, 6000).trim();
      if (!name) throw new HttpError(400, 'Ponle un nombre al adicional.');
      if (request.length < 10) throw new HttpError(400, 'Pega la solicitud del cliente para que la IA arme las tareas.');
      try {
        json(res, 200, await suggestAddition(project, { name, request, allowWeekends: body.allowWeekends === true }));
      } catch (err) {
        if (err instanceof AiError) throw new HttpError(502, err.message);
        throw err;
      }
      return true;
    }

    // Adicional: en un paso, su fase con tareas, su pago (con descuento) y el registro en el historial de alcance.
    case 'POST projects/:id/scope/add': {
      requireOwner(v);
      const project = visibleProject(id, v);
      const body = await readJson(req, 128 * 1024);
      const name = str(body.name, 160).trim();
      if (!name) throw new HttpError(400, 'Ponle un nombre al adicional.');
      const request = str(body.request, 6000).trim();
      const tasks = normalizeTasks(body.tasks);
      if (!tasks.length) throw new HttpError(400, 'El adicional necesita al menos una tarea.');
      const allowWeekends = body.allowWeekends === true;
      if (!allowWeekends) {
        const w = tasks.find((t) => (t.startDate && isWeekend(t.startDate)) || (t.dueDate && isWeekend(t.dueDate)));
        if (w) throw new HttpError(400, `«${w.title}» cae en fin de semana. Cambia la fecha o marca «Permitir fin de semana».`);
      }
      const price = priceOf(body);
      const payWhen: PayWhen = body.payWhen === 'entregar' || body.payWhen === 'fecha' ? body.payWhen : 'aprobar';
      const lastDue =
        tasks
          .map((t) => t.dueDate)
          .filter((d): d is string => !!d)
          .sort()
          .pop() ?? null;
      const payDate = payWhen === 'aprobar' ? todayBogota() : payWhen === 'entregar' ? lastDue : day(body.payDate);
      if (price.total > 0 && payWhen === 'fecha' && !payDate) throw new HttpError(400, 'Elige la fecha del pago.');
      const phaseName = (str(body.phaseName, 120).trim() || `Adicional: ${name}`).slice(0, 120);
      const payLabel = `Adicional: ${name}${price.discount ? ` (−${pct(price.discount)} %)` : ''}`.slice(0, 160);
      const reason = str(body.reason, 1000).trim();
      const value =
        price.total > 0
          ? price.discount
            ? ` por ${money(price.total, price.currency)} (${money(price.base, price.currency)} menos ${pct(price.discount)} % de descuento)`
            : ` por ${money(price.total, price.currency)}`
          : ' sin costo';
      const payText = price.total > 0 ? (payWhen === 'aprobar' ? ', que se paga al aprobar' : payWhen === 'entregar' ? ', que se paga al entregar' : `, que se paga el ${payDate}`) : '';

      const result = db.transaction(() => {
        const phase = db.createPhase(project.id, phaseName, db.nextPhasePosition(project.id));
        let position = db.nextTaskPosition(project.id);
        for (const t of tasks) {
          db.createTask({
            projectId: project.id,
            phaseId: phase.id,
            title: t.title,
            description: t.description,
            side: t.side,
            assigneeId: null,
            startDate: t.startDate,
            dueDate: t.dueDate,
            position: position++,
            source: 'manual',
            kind: 'tarea',
            clientDelivery: t.clientDelivery,
          });
        }
        if (price.total > 0) createPayments(project.id, [{ label: payLabel, percent: null, amount: price.total, currency: price.currency, dueDate: payDate }]);
        const when = new Date().toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Bogota' });
        const note = `**Adicional · ${when}:** se agregó ${name}${value}${payText}.${reason ? ` ${reason}` : ''}`;
        db.updateProject(project.id, {
          pricing: project.pricing.trim() ? `${project.pricing.trim()}\n\n${note}` : note,
          // La entrega estimada solo se corre si el adicional termina después.
          ...(lastDue && (!project.end_date || lastDue > project.end_date) ? { end_date: lastDue } : {}),
        });
        sqlite
          .prepare(
            `INSERT INTO scope_changes (project_id, option_id, option_name, amount, currency, reason, label_before, label_after, phases, tasks_removed, payments, created_at, created_by, kind, detail)
             VALUES (?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'adicional', ?)`,
          )
          .run(
            project.id,
            name,
            price.total || null,
            price.currency,
            reason || request.slice(0, 1000),
            project.approved_option,
            project.approved_option,
            JSON.stringify([phaseName]),
            tasks.length,
            JSON.stringify(price.total > 0 ? [payLabel] : []),
            new Date().toISOString(),
            v.email,
            JSON.stringify({ base: price.base, discountPercent: price.discount, payWhen, payDate: price.total > 0 ? payDate : null, allowWeekends }),
          );
        const a = actor(v);
        db.logActivity({
          projectId: project.id,
          actorKind: a.kind,
          actorName: a.name,
          type: 'scope_added',
          data: { option: name, tasks: tasks.length, amount: price.total || null, currency: price.currency },
        });
        if (body.notify === true) {
          db.createNote({
            project_id: project.id,
            task_id: null,
            kind: 'nota',
            visibility: 'shared',
            author_kind: 'owner',
            author_id: null,
            author_name: a.name,
            body: `Agregamos al proyecto el adicional «${name}»${value}${payText}. Sus tareas están en la fase «${phaseName}».${reason ? `\n\n${reason}` : ''}`,
          });
        }
        return { phaseId: phase.id };
      });

      json(res, 200, { ok: true, ...result, tasks: tasks.length, total: price.total, currency: price.currency, payDate: price.total > 0 ? payDate : null });
      return true;
    }
  }
  return false;
}
