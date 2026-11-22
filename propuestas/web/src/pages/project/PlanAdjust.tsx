import { useEffect, useRef, useState } from 'react';
import { api, formatDate, usd } from '../../lib';
import { useAction, useToast } from '../../ui';

/**
 * «Ajustar con IA» en el plan de trabajo de un proyecto en marcha: le dices qué cambiar («reprograma las reuniones con
 * el cliente a partir del 1 de diciembre») y la IA propone los cambios. Los revisas aquí y solo se guardan al aplicarlos.
 */

type Side = 'deersystems' | 'cliente';
interface Snapshot {
  title: string;
  startDate: string | null;
  dueDate: string | null;
  time: string | null;
  phase: string;
  side: Side;
}
interface Suggestion {
  ops: unknown;
  preview: {
    updates: { id: number; title: string; kind: 'tarea' | 'reunion'; calendar: boolean; before: Snapshot; after: Snapshot; descriptionChanged: boolean; note: string | null; clash: boolean }[];
    creates: { title: string; phase: string; kind: 'tarea' | 'reunion'; side: Side; startDate: string | null; dueDate: string | null }[];
    deletes: { id: number; title: string; kind: 'tarea' | 'reunion' }[];
  };
  changes: string[];
  warnings: string[];
  ai: { model: string; costUsd: number; latencyMs: number };
}
interface Applied {
  applied: number;
  errors: string[];
  calendarMoved: number;
}

const EXAMPLES = [
  'Reprograma las reuniones con el cliente a partir del próximo lunes',
  'Corre una semana todo lo pendiente',
  'Las reuniones de avance a las 3 p. m.',
  'Agrega una tarea para que el cliente entregue los accesos esta semana',
];

const SIDE = { deersystems: 'DeerSystems', cliente: 'Cliente' };

/** «20 nov» o «18 – 22 nov»; con hora para las reuniones agendadas. */
function when(s: Pick<Snapshot, 'startDate' | 'dueDate' | 'time'>): string {
  const { startDate: a, dueDate: b } = s;
  const days = !a && !b ? 'sin fecha' : !a || !b || a === b ? formatDate(b ?? a, false) : `${formatDate(a, false)} – ${formatDate(b, false)}`;
  return s.time ? `${days}, ${s.time}` : days;
}

function diff(b: Snapshot, a: Snapshot): string[] {
  const out: string[] = [];
  if (when(b) !== when(a)) out.push(`${when(b)} → ${when(a)}`);
  if (b.title !== a.title) out.push(`nombre: «${a.title}»`);
  if (b.phase !== a.phase) out.push(`fase: ${b.phase || 'sin fase'} → ${a.phase || 'sin fase'}`);
  if (b.side !== a.side) out.push(`a cargo de ${SIDE[a.side]}`);
  return out;
}

export function PlanAdjustButton({ projectId, onApplied }: { projectId: number; onApplied: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn btn--outline btn--sm btn--ai" onClick={() => setOpen(true)} title="Pídele a la IA cambios al plan: fechas, reuniones, tareas">
        ✦ Ajustar con IA
      </button>
      {open && <PlanAdjustDialog projectId={projectId} onClose={() => setOpen(false)} onApplied={onApplied} />}
    </>
  );
}

function PlanAdjustDialog({ projectId, onClose, onApplied }: { projectId: number; onClose: () => void; onApplied: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => ref.current?.showModal(), []);
  const [text, setText] = useState('');
  const [weekends, setWeekends] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [s, setS] = useState<Suggestion | null>(null);
  const [done, setDone] = useState<Applied | null>(null);
  const { busy, run } = useAction();
  const toast = useToast();

  const ask = () => {
    if (text.trim().length < 5) return setError('Escribe qué quieres ajustar.');
    setThinking(true);
    setError(null);
    setS(null);
    api<Suggestion>('POST', `projects/${projectId}/plan/adjust`, { instruction: text.trim(), allowWeekends: weekends })
      .then(setS)
      .catch((e: Error) => setError(e.message))
      .finally(() => setThinking(false));
  };
  const total = s ? s.preview.updates.length + s.preview.creates.length + s.preview.deletes.length : 0;
  const calendar = s?.preview.updates.filter((u) => u.calendar).length ?? 0;

  const apply = () =>
    run(async () => {
      const r = await api<Applied>('POST', `projects/${projectId}/plan/apply`, { instruction: text.trim(), ops: s!.ops });
      setDone(r);
      onApplied();
      toast(r.errors.length ? 'Plan ajustado, con avisos.' : 'Plan ajustado.', r.errors.length > 0);
      if (!r.errors.length) ref.current?.close();
    });

  return (
    <dialog ref={ref} className="modal" aria-labelledby="plan-adjust-title" onClose={onClose} onClick={(e) => e.target === e.currentTarget && !busy && ref.current?.close()}>
      <div className="modal__in">
        <header className="modal__head">
          <h2 id="plan-adjust-title">✦ Ajustar el plan con IA</h2>
          <button type="button" className="icon-btn" onClick={() => ref.current?.close()} aria-label="Cerrar" disabled={busy}>
            ✕
          </button>
        </header>
        {done ? (
          <>
            <p className="callout">
              Se aplicaron {done.applied} {done.applied === 1 ? 'cambio' : 'cambios'}
              {done.calendarMoved > 0 && `; ${done.calendarMoved} ${done.calendarMoved === 1 ? 'reunión se movió' : 'reuniones se movieron'} en Calendar y los invitados recibieron la actualización`}.
            </p>
            {done.errors.map((e) => (
              <p key={e} className="alert">
                {e}
              </p>
            ))}
            <div className="actions actions--tight">
              <button className="btn btn--primary btn--sm" onClick={() => ref.current?.close()}>
                Listo
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="hint">
              Dile qué cambiar de las tareas, fechas o reuniones. Te muestro los cambios antes de guardarlos; las reuniones agendadas se mueven también en tu
              Google Calendar.
            </p>
            <textarea
              rows={3}
              value={text}
              disabled={thinking || busy}
              autoFocus
              placeholder="Ej.: reprograma las reuniones con el cliente a partir del 1 de diciembre, los martes a las 10 a. m."
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ask();
              }}
            />
            <label className="scope-check" title="Para una excepción acordada: las tareas pueden caer en sábado o domingo. Las reuniones siguen de lunes a viernes.">
              <input type="checkbox" checked={weekends} disabled={thinking || busy} onChange={(e) => setWeekends(e.target.checked)} />
              <span>
                Permitir fin de semana <small>· excepción: las tareas pueden caer en sábado o domingo</small>
              </span>
            </label>
            <div className="adjust-plan__foot">
              <span className="adjust-plan__examples">
                {EXAMPLES.map((ex) => (
                  <button key={ex} className="chip" disabled={thinking || busy} onClick={() => setText(ex)}>
                    {ex}
                  </button>
                ))}
              </span>
              <button className="btn btn--primary btn--sm" onClick={ask} disabled={thinking || busy || !text.trim()}>
                {thinking ? 'Pensando…' : s ? 'Volver a proponer' : 'Proponer cambios'}
              </button>
            </div>
            {thinking && (
              <p className="loading">
                <span className="loading__dot" /> La IA está revisando el plan…
              </p>
            )}
            {error && <p className="alert">{error}</p>}
            {s && !thinking && (
              <div className="plan-adjust">
                {s.changes.length > 0 && (
                  <div className="adjust-plan__changes">
                    <strong>Lo que propone</strong>
                    <ul className="md-list">
                      {s.changes.map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {s.warnings.map((w) => (
                  <p key={w} className="hint">
                    {w}
                  </p>
                ))}
                {total === 0 ? (
                  <p className="hint">No hay cambios para aplicar. Prueba a decirlo de otra forma.</p>
                ) : (
                  <ul className="plan-adjust__list">
                    {s.preview.updates.map((u) => (
                      <li key={`u${u.id}`} className={u.clash ? 'is-clash' : undefined}>
                        <span className={`plan-adjust__tag plan-adjust__tag--${u.kind}`}>{u.kind === 'reunion' ? 'Reunión' : 'Tarea'}</span>
                        <span>
                          <strong>{u.title}</strong>
                          <small>
                            {diff(u.before, u.after).join(' · ') || (u.descriptionChanged ? 'descripción actualizada' : 'sin cambios visibles')}
                            {u.calendar && ' · se mueve en Calendar'}
                          </small>
                          {u.note && <small className="plan-adjust__note">{u.clash ? '⚠' : '↻'} {u.note}</small>}
                        </span>
                      </li>
                    ))}
                    {s.preview.creates.map((c, i) => (
                      <li key={`c${i}`}>
                        <span className="plan-adjust__tag plan-adjust__tag--new">Nueva</span>
                        <span>
                          <strong>{c.title}</strong>
                          <small>
                            {[c.phase || 'sin fase', when({ ...c, time: null }), SIDE[c.side], c.kind === 'reunion' ? 'reunión (solo en el cronograma)' : '']
                              .filter(Boolean)
                              .join(' · ')}
                          </small>
                        </span>
                      </li>
                    ))}
                    {s.preview.deletes.map((d) => (
                      <li key={`d${d.id}`}>
                        <span className="plan-adjust__tag plan-adjust__tag--del">Se elimina</span>
                        <span>
                          <strong>{d.title}</strong>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="hint mono">
                  {s.ai.model} · {(s.ai.latencyMs / 1000).toFixed(1)} s · {s.ai.costUsd ? usd(s.ai.costUsd) : 'sin costo'}
                </p>
                {total > 0 && (
                  <div className="actions actions--tight">
                    <button className="btn btn--primary btn--sm" onClick={apply} disabled={busy}>
                      {busy ? 'Aplicando…' : `Aplicar ${total} ${total === 1 ? 'cambio' : 'cambios'}`}
                    </button>
                    {calendar > 0 && (
                      <small className="hint">
                        {calendar} {calendar === 1 ? 'reunión agendada se moverá' : 'reuniones agendadas se moverán'} en Calendar y los invitados recibirán la
                        actualización.
                      </small>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </dialog>
  );
}
