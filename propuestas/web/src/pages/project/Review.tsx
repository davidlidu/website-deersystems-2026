import { useEffect, useRef, useState } from 'react';
import { api, formatDate, type Me, type Progress, type Task } from '../../lib';
import { useAction, useToast } from '../../ui';

/**
 * Revisar una entrega del equipo. El cliente la aprueba o pide ajustes (con el pedido escrito); el equipo registra lo
 * que el cliente dijo por otro medio y puede reabrir una completada. Cada pedido de ajustes es una ronda, contada
 * contra las incluidas en el proyecto: si se pasa, se avisa (al cliente, que puede tener costo; al equipo, que lo confirme).
 */
export function ReviewBlock({ me, task, onDone }: { me: Me; task: Task; onDone: (task: Task, progress: Progress) => void }) {
  const staff = me.role !== 'client';
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');
  const { busy, run } = useAction();
  const toast = useToast();

  const included = task.revisionsIncluded;
  const next = task.revisionRound + 1;
  const nextExtra = included > 0 && next > included;
  const used = included > 0 ? `${Math.min(task.revisionRound, included)} de ${included} rondas de ajustes usadas` : `${task.revisionRound} ${task.revisionRound === 1 ? 'ronda' : 'rondas'} de ajustes`;
  const completed = task.status === 'completada';

  const send = (decision: 'approve' | 'changes') =>
    run(async () => {
      const r = await api<{ task: Task; progress: Progress }>('POST', `tasks/${task.id}/review`, { decision, note: note.trim() });
      toast(decision === 'approve' ? 'Entrega aprobada.' : `Ajustes enviados (ronda ${r.task.revisionRound}).`);
      setAsking(false);
      setNote('');
      onDone(r.task, r.progress);
    });

  return (
    <div className={`review${completed ? ' review--done' : ''}`}>
      <div className="review__head">
        <strong>{completed ? 'Entrega aprobada' : staff ? 'En revisión del cliente' : 'Lista para tu revisión'}</strong>
        <small>
          {completed && task.approvedBy ? `Aprobó ${task.approvedBy}${task.approvedAt ? ` el ${formatDate(task.approvedAt)}` : ''} · ` : ''}
          {used}
          {task.revisionRound > included && included > 0 ? ` (+${task.revisionRound - included} adicional${task.revisionRound - included === 1 ? '' : 'es'})` : ''}
        </small>
      </div>

      {!asking ? (
        <div className="actions actions--tight">
          {!completed && (
            <button className="btn btn--primary btn--sm" disabled={busy} onClick={() => send('approve')}>
              {staff ? 'El cliente aprobó' : 'Aprobar'}
            </button>
          )}
          <button className="btn btn--outline btn--sm" disabled={busy} onClick={() => setAsking(true)}>
            {completed ? 'Reabrir con ajustes' : staff ? 'El cliente pidió ajustes' : 'Pedir ajustes'}
          </button>
        </div>
      ) : (
        <>
          <label className="field">
            <span className="field__label">{staff ? 'Qué pidió ajustar el cliente' : 'Qué hay que ajustar'}</span>
            <textarea rows={4} value={note} maxLength={4000} autoFocus disabled={busy} placeholder="Sé concreto: qué cambiar, dónde y cómo debería quedar." onChange={(e) => setNote(e.target.value)} />
          </label>
          {nextExtra && (
            <p className="review__warn">
              {staff
                ? `Esta sería la ronda ${next} y el proyecto incluye ${included}: queda marcada como adicional. Confirma con el cliente si se cobra.`
                : `El proyecto incluye ${included} ${included === 1 ? 'ronda' : 'rondas'} de ajustes y esta sería la ${next}: puede tener un costo adicional.`}
            </p>
          )}
          <div className="actions actions--tight">
            <button className="btn btn--primary btn--sm" disabled={busy || note.trim().length < 5} onClick={() => send('changes')}>
              {busy ? 'Enviando…' : 'Enviar ajustes'}
            </button>
            <button className="btn btn--outline btn--sm" disabled={busy} onClick={() => setAsking(false)}>
              Cancelar
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** «◆ Entrega» en la lista de tareas: lo que el cliente revisa y aprueba (lo demás del equipo es operativo). */
export function DeliveryTag({ task }: { task: Pick<Task, 'clientDelivery'> }) {
  if (!task.clientDelivery) return null;
  return (
    <span className="delivery-tag" title="Entrega al cliente: la revisa y la aprueba o pide ajustes">
      ◆ Entrega
    </span>
  );
}

/** «↺ Ajuste 2» en la lista de tareas; en rojo y «adicional» cuando pasa de lo incluido. */
export function RoundTag({ task }: { task: Pick<Task, 'revisionRound' | 'revisionsIncluded'> }) {
  if (!task.revisionRound) return null;
  const extra = task.revisionsIncluded > 0 && task.revisionRound > task.revisionsIncluded;
  return (
    <span className={`round-tag${extra ? ' round-tag--extra' : ''}`} title={extra ? 'Pasa de las rondas de ajustes incluidas' : 'Rondas de ajustes pedidas'}>
      ↺ Ajuste {task.revisionRound}
      {extra ? ' · adicional' : ''}
    </span>
  );
}

interface DeliveryRow {
  id: number;
  title: string;
  phase: string;
  on: boolean;
  suggested: boolean | null;
}

/**
 * «Entregas al cliente»: marca qué tareas del equipo revisa y aprueba el cliente (con rondas de ajustes) y cuáles son
 * operativas. La IA puede proponerlo para un proyecto que ya existe; nada se guarda hasta que lo confirmas.
 */
export function DeliveriesButton({ projectId, tasks, onSaved }: { projectId: number; tasks: Task[]; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const count = tasks.filter((t) => t.clientDelivery).length;
  return (
    <>
      <button className="btn btn--outline btn--sm" onClick={() => setOpen(true)} title="Qué tareas revisa y aprueba el cliente">
        ◆ Entregas al cliente{count ? ` (${count})` : ''}
      </button>
      {open && <DeliveriesDialog projectId={projectId} tasks={tasks} onClose={() => setOpen(false)} onSaved={onSaved} />}
    </>
  );
}

function DeliveriesDialog({ projectId, tasks, onClose, onSaved }: { projectId: number; tasks: Task[]; onClose: () => void; onSaved: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => ref.current?.showModal(), []);
  const [rows, setRows] = useState<DeliveryRow[]>(() =>
    tasks.filter((t) => t.side === 'deersystems' && !t.isMeeting).map((t) => ({ id: t.id, title: t.title, phase: '', on: t.clientDelivery, suggested: null })),
  );
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useAction();
  const toast = useToast();
  const original = new Set(tasks.filter((t) => t.clientDelivery).map((t) => t.id));
  const changed = rows.filter((r) => r.on !== original.has(r.id)).length;

  const detect = () => {
    setThinking(true);
    setError(null);
    api<{ suggestions: { id: number; title: string; phase: string; suggested: boolean }[] }>('POST', `projects/${projectId}/deliveries/detect`)
      .then((r) => {
        const byId = new Map(r.suggestions.map((s) => [s.id, s]));
        setRows((rs) => rs.map((x) => (byId.has(x.id) ? { ...x, phase: byId.get(x.id)!.phase, on: byId.get(x.id)!.suggested, suggested: byId.get(x.id)!.suggested } : x)));
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setThinking(false));
  };

  const save = () =>
    run(async () => {
      const r = await api<{ changed: number; deliveries: number }>('PUT', `projects/${projectId}/deliveries`, { deliveries: rows.filter((x) => x.on).map((x) => x.id) });
      toast(`Listo: ${r.deliveries} ${r.deliveries === 1 ? 'entrega' : 'entregas'} al cliente.`);
      onSaved();
      ref.current?.close();
    });

  const locked = busy || thinking;
  return (
    <dialog ref={ref} className="modal" aria-labelledby="deliveries-title" onClose={onClose} onClick={(e) => e.target === e.currentTarget && !locked && ref.current?.close()}>
      <div className="modal__in">
        <header className="modal__head">
          <h2 id="deliveries-title">◆ Entregas al cliente</h2>
          <button className="icon-btn" onClick={() => ref.current?.close()} aria-label="Cerrar" disabled={locked}>
            ✕
          </button>
        </header>
        <p className="hint">
          Marca lo que el cliente revisa y aprueba: al pasar a «En revisión» le llega el aviso, puede aprobar o pedir ajustes y cuentan las rondas. Lo que no
          marques es operativo: lo cierra el equipo, sin aprobación del cliente.
        </p>
        <div className="actions actions--tight">
          <button className="btn btn--outline btn--sm btn--ai" disabled={locked || !rows.length} onClick={detect}>
            {thinking ? 'Pensando…' : '✦ Detectar con IA'}
          </button>
          <button className="btn btn--outline btn--sm" disabled={locked} onClick={() => setRows(rows.map((r) => ({ ...r, on: false })))}>
            Desmarcar todas
          </button>
        </div>
        {error && <p className="alert">{error}</p>}
        {!rows.length && <p className="hint">Este proyecto no tiene tareas del equipo.</p>}
        <div className="scope-group">
          {rows.map((r) => (
            <label key={r.id} className="scope-check">
              <input type="checkbox" checked={r.on} disabled={locked} onChange={(e) => setRows(rows.map((x) => (x.id === r.id ? { ...x, on: e.target.checked } : x)))} />
              <span>
                {r.title}
                {r.phase && <small> · {r.phase}</small>}
                {r.suggested !== null && <small> · la IA sugiere: {r.suggested ? 'entrega' : 'operativa'}</small>}
              </span>
            </label>
          ))}
        </div>
        <div className="actions actions--tight">
          <button className="btn btn--primary btn--sm" disabled={locked || !changed} onClick={save}>
            {busy ? 'Guardando…' : changed ? `Guardar (${changed} ${changed === 1 ? 'cambio' : 'cambios'})` : 'Sin cambios'}
          </button>
          <button className="btn btn--outline btn--sm" disabled={locked} onClick={() => ref.current?.close()}>
            Cancelar
          </button>
        </div>
      </div>
    </dialog>
  );
}
