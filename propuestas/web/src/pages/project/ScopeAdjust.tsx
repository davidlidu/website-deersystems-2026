import { useEffect, useRef, useState } from 'react';
import { api, formatDate, formatMoney, useApi, type Currency } from '../../lib';
import { ErrorBox, Loading, useAction, useToast } from '../../ui';

interface ScopeOption {
  id: string;
  name: string;
  amount: number | null;
  price: string;
  phaseIds: number[];
  paymentIds: number[];
  labelAfter: string;
}

interface ScopePhase {
  id: number;
  name: string;
  pending: number;
  done: number;
  meetings: number;
}

interface ScopePayment {
  id: number;
  label: string;
  amount: number | null;
  currency: Currency;
  paid: boolean;
  invoiced: boolean;
}

interface ScopeChange {
  id: number;
  optionName: string;
  amount: number | null;
  currency: Currency;
  reason: string;
  labelBefore: string;
  labelAfter: string;
  phases: string[];
  tasksRemoved: number;
  payments: string[];
  createdAt: string;
}

interface ScopeData {
  approvedOption: string;
  currency: Currency;
  options: ScopeOption[];
  phases: ScopePhase[];
  payments: ScopePayment[];
  history: ScopeChange[];
}

const toggle = <T,>(set: Set<T>, v: T, on: boolean) => {
  const next = new Set(set);
  if (on) next.add(v);
  else next.delete(v);
  return next;
};

/** Historial de lo retirado, debajo del alcance aprobado (solo lo ves tú). */
export function ScopeHistory({ projectId, version }: { projectId: number; version: number }) {
  const { data } = useApi<ScopeData>(`projects/${projectId}/scope?v=${version}`);
  if (!data?.history.length) return null;
  return (
    <div className="scope-history">
      <small>Cambios de alcance</small>
      {data.history.map((h) => (
        <div key={h.id} className="scope-history__item">
          <strong>
            Se retiró {h.optionName}
            {h.amount ? ` · −${formatMoney(h.amount, h.currency)}` : ''}
          </strong>
          <span>
            {formatDate(h.createdAt)} · {h.tasksRemoved === 1 ? '1 tarea' : `${h.tasksRemoved} tareas`}
            {h.payments.length ? ` · ${h.payments.length === 1 ? '1 pago' : `${h.payments.length} pagos`}` : ''}
            {h.labelBefore && h.labelBefore !== h.labelAfter ? ` · antes: «${h.labelBefore}»` : ''}
          </span>
          {h.reason && <span className="scope-history__reason">{h.reason}</span>}
        </div>
      ))}
    </div>
  );
}

/**
 * Retirar del alcance una opción o fase aprobada: eliges la opción y se marcan solas sus fases y pagos sin pagar
 * (puedes ajustar), ves qué va a pasar, y en un paso se quitan las tareas pendientes, los pagos y se corrige lo aprobado.
 */
export function ScopeRemoveDialog({ projectId, onDone, onClose }: { projectId: number; onDone: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { data, loading, error } = useApi<ScopeData>(`projects/${projectId}/scope`);
  const [opts, setOpts] = useState<Set<string>>(new Set());
  const [phases, setPhases] = useState<Set<number>>(new Set());
  const [pays, setPays] = useState<Set<number>>(new Set());
  const [label, setLabel] = useState('');
  const [labelTouched, setLabelTouched] = useState(false);
  const [reason, setReason] = useState('');
  const [notify, setNotify] = useState(false);
  const { busy, run } = useAction();
  const toast = useToast();

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  useEffect(() => {
    if (data && !labelTouched) setLabel(data.approvedOption);
  }, [data, labelTouched]);

  const pickOption = (o: ScopeOption, on: boolean) => {
    if (!data) return;
    const next = toggle(opts, o.id, on);
    setOpts(next);
    let ph = phases;
    let py = pays;
    for (const id of o.phaseIds) ph = toggle(ph, id, on);
    for (const id of o.paymentIds) py = toggle(py, id, on);
    setPhases(ph);
    setPays(py);
    // La etiqueta sugerida: lo aprobado sin las opciones marcadas (calculado en el servidor para una sola).
    if (!labelTouched) {
      const chosen = data.options.filter((x) => next.has(x.id));
      if (!chosen.length) setLabel(data.approvedOption);
      else if (chosen.length === 1) setLabel(chosen[0].labelAfter);
      else {
        const rest = data.options.filter((x) => !next.has(x.id)).map((x) => x.id);
        setLabel(rest.length ? `Opciones ${rest.length === 1 ? rest[0] : `${rest.slice(0, -1).join(', ')} y ${rest.at(-1)}`}` : data.approvedOption);
      }
    }
  };

  const selPhases = data?.phases.filter((p) => phases.has(p.id)) ?? [];
  const selPays = data?.payments.filter((p) => pays.has(p.id)) ?? [];
  const tasks = selPhases.reduce((s, p) => s + p.pending - p.meetings, 0);
  const meetings = selPhases.reduce((s, p) => s + p.meetings, 0);
  const kept = selPhases.filter((p) => p.done > 0);
  const payTotal = selPays.reduce((s, p) => s + (p.amount ?? 0), 0);
  const optTotal = data?.options.filter((o) => opts.has(o.id)).reduce((s, o) => s + (o.amount ?? 0), 0) ?? 0;
  const currency = selPays[0]?.currency ?? data?.currency ?? 'COP';
  const nothing = !opts.size && !phases.size && !pays.size;

  const submit = () =>
    run(async () => {
      const r = await api<{ approvedOption: string; tasksRemoved: number; meetingsRemoved: number; payments: number }>('POST', `projects/${projectId}/scope/remove`, {
        optionIds: [...opts],
        phaseIds: [...phases],
        paymentIds: [...pays],
        label: labelTouched ? label : '',
        reason,
        notify,
      });
      toast(`Alcance ajustado: ${r.tasksRemoved + r.meetingsRemoved} tareas y ${r.payments} pagos retirados. Ahora: «${r.approvedOption}».`);
      onDone();
      ref.current?.close();
    });

  return (
    <dialog
      ref={ref}
      className="modal modal--send"
      aria-labelledby="scope-remove-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) ref.current?.close();
      }}
    >
      <div className="modal__in">
        <header className="modal__head">
          <h2 id="scope-remove-title">Retirar del alcance</h2>
          <button className="icon-btn" onClick={() => ref.current?.close()} aria-label="Cerrar">
            ✕
          </button>
        </header>
        {loading && !data && <Loading />}
        {error && <ErrorBox message={error} />}
        {data && (
          <>
            <p className="hint">
              Para cuando el cliente pide quitar algo que ya aprobó. Lo terminado se queda; lo pendiente y los pagos sin pagar se van, y «opción aprobada» se
              corrige sola.
            </p>

            {data.options.length > 0 && (
              <fieldset className="scope-group">
                <legend className="field__label">Opción de la propuesta que se retira</legend>
                {data.options.map((o) => (
                  <label key={o.id} className="scope-check">
                    <input type="checkbox" checked={opts.has(o.id)} onChange={(e) => pickOption(o, e.target.checked)} />
                    <span>
                      {o.name}
                      {o.price || o.amount ? <small> · {o.price || formatMoney(o.amount!, data.currency)}</small> : null}
                    </span>
                  </label>
                ))}
              </fieldset>
            )}

            <fieldset className="scope-group">
              <legend className="field__label">Fases del plan</legend>
              {!data.phases.length && <small className="hint">El proyecto no tiene fases.</small>}
              {data.phases.map((ph) => (
                <label key={ph.id} className="scope-check">
                  <input type="checkbox" checked={phases.has(ph.id)} onChange={(e) => setPhases(toggle(phases, ph.id, e.target.checked))} />
                  <span>
                    {ph.name}
                    <small>
                      {' '}
                      · {ph.pending} pendientes{ph.done ? `, ${ph.done} terminadas (se quedan)` : ''}
                    </small>
                  </span>
                </label>
              ))}
            </fieldset>

            <fieldset className="scope-group">
              <legend className="field__label">Pagos</legend>
              {!data.payments.length && <small className="hint">El proyecto no tiene pagos.</small>}
              {data.payments.map((p) => {
                const locked = p.paid || p.invoiced;
                return (
                  <label key={p.id} className={`scope-check${locked ? ' is-locked' : ''}`} title={locked ? 'Ya pagado o con abono: no se puede quitar' : undefined}>
                    <input type="checkbox" disabled={locked} checked={pays.has(p.id)} onChange={(e) => setPays(toggle(pays, p.id, e.target.checked))} />
                    <span>
                      {p.label}
                      <small>
                        {' '}
                        · {p.amount != null ? formatMoney(p.amount, p.currency) : 'sin valor'}
                        {p.paid ? ' · pagado' : p.invoiced ? ' · con abono' : ''}
                      </small>
                    </span>
                  </label>
                );
              })}
            </fieldset>

            <label className="field">
              <span className="field__label">Lo aprobado quedará como</span>
              <span className="input">
                <input
                  value={label}
                  maxLength={400}
                  onChange={(e) => {
                    setLabel(e.target.value);
                    setLabelTouched(true);
                  }}
                />
              </span>
            </label>
            <label className="field">
              <span className="field__label">Motivo (queda en el historial)</span>
              <textarea rows={2} value={reason} maxLength={1000} placeholder="Ej.: el cliente decidió dejar la fase 5 para 2028." onChange={(e) => setReason(e.target.value)} />
            </label>
            <label className="scope-check">
              <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
              <span>Dejarle al cliente una nota en el proyecto con el ajuste</span>
            </label>

            {!nothing && (
              <div className="scope-summary">
                <strong>Qué va a pasar</strong>
                <ul>
                  {tasks > 0 && <li>Se eliminan {tasks === 1 ? '1 tarea pendiente' : `${tasks} tareas pendientes`}.</li>}
                  {meetings > 0 && (
                    <li>
                      Se quitan {meetings === 1 ? '1 reunión' : `${meetings} reuniones`} del plan (si alguna ya estaba en Google Calendar, cancélala en Reuniones).
                    </li>
                  )}
                  {kept.length > 0 && <li>{kept.map((p) => `«${p.name}»`).join(', ')} se queda solo con lo ya terminado.</li>}
                  {selPays.length > 0 && (
                    <li>
                      Se quitan {selPays.length === 1 ? '1 pago' : `${selPays.length} pagos`} por {formatMoney(payTotal, currency)}.
                    </li>
                  )}
                  {optTotal > 0 && payTotal > 0 && optTotal !== payTotal && (
                    <li className="scope-summary__warn">
                      La opción vale {formatMoney(optTotal, currency)} en la propuesta y los pagos marcados suman {formatMoney(payTotal, currency)}: revisa si falta o
                      sobra alguno.
                    </li>
                  )}
                  {opts.size > 0 && !selPays.length && <li className="scope-summary__warn">No marcaste pagos: los valores del proyecto no cambian.</li>}
                  <li>La opción aprobada pasa a «{label}» y el ajuste queda anotado en «Propuesta y valores».</li>
                  {opts.size > 0 && <li>Si el cliente la quiere después, puede volver a aprobarla desde la propuesta.</li>}
                </ul>
              </div>
            )}

            <div className="actions actions--tight">
              <button className="btn btn--primary btn--sm" disabled={busy || nothing} onClick={submit}>
                {busy ? 'Ajustando…' : 'Retirar del alcance'}
              </button>
              <button className="btn btn--outline btn--sm" disabled={busy} onClick={() => ref.current?.close()}>
                Cancelar
              </button>
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
