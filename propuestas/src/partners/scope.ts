import type { IncomingMessage, ServerResponse } from 'node:http';
import { db as sqlite, getProposal } from '../db.ts';
import { HttpError, json, readJson } from '../http.ts';
import { combined, generatedData, optionsOf, shortName, type PublicOption } from './approvals.ts';
import type { Viewer } from './auth.ts';
import * as billing from './billing.ts';
import { actor, requireOwner, str, visibleProject } from './common.ts';
import * as db from './db.ts';

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
  }
  return false;
}
