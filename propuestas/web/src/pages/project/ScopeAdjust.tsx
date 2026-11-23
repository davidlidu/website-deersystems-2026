import { useEffect, useRef, useState } from 'react';
import { api, formatDate, formatMoney, useApi, type Currency } from '../../lib';
import { ErrorBox, Loading, MoneyInput, useAction, useToast } from '../../ui';

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
  kind: 'retiro' | 'adicional' | 'ajuste';
  detail: { base?: number; discountPercent?: number; payWhen?: string; payDate?: string | null; changes?: string[]; scopeChanged?: boolean };
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

/** Historial de cambios de alcance (retiros, adicionales y ajustes), debajo del alcance aprobado (solo lo ves tú). */
export function ScopeHistory({ projectId, version }: { projectId: number; version: number }) {
  const { data } = useApi<ScopeData>(`projects/${projectId}/scope?v=${version}`);
  if (!data?.history.length) return null;
  return (
    <div className="scope-history">
      <small>Cambios de alcance</small>
      {data.history.map((h) =>
        h.kind === 'ajuste' ? (
          <div key={h.id} className="scope-history__item">
            <strong>✦ Se ajustó el alcance</strong>
            <span>
              {formatDate(h.createdAt)}
              {h.detail.scopeChanged === false ? ' · texto sin cambios' : ''}
              {h.tasksRemoved ? ` · ${h.tasksRemoved === 1 ? '1 cambio' : `${h.tasksRemoved} cambios`} en el plan` : ''}
            </span>
            {h.detail.changes?.length ? (
              <ul className="scope-history__reason md-list">
                {h.detail.changes.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            ) : (
              h.reason && <span className="scope-history__reason">{h.reason}</span>
            )}
          </div>
        ) : h.kind === 'adicional' ? (
          <div key={h.id} className="scope-history__item">
            <strong>
              Se agregó {h.optionName}
              {h.amount ? ` · +${formatMoney(h.amount, h.currency)}` : ' · sin costo'}
            </strong>
            <span>
              {formatDate(h.createdAt)} · {h.tasksRemoved === 1 ? '1 tarea' : `${h.tasksRemoved} tareas`}
              {h.detail.discountPercent ? ` · ${h.detail.discountPercent} % de descuento sobre ${formatMoney(h.detail.base ?? 0, h.currency)}` : ''}
              {h.amount ? (h.detail.payWhen === 'aprobar' ? ' · se paga al aprobar' : h.detail.payWhen === 'entregar' ? ' · se paga al entregar' : h.detail.payDate ? ` · se paga el ${formatDate(h.detail.payDate, false)}` : '') : ''}
            </span>
            {h.reason && <span className="scope-history__reason">{h.reason.length > 220 ? `${h.reason.slice(0, 220)}…` : h.reason}</span>}
          </div>
        ) : (
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
        ),
      )}
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

type Side = 'deersystems' | 'cliente';
interface AddTask {
  key: number;
  title: string;
  description: string;
  side: Side;
  clientDelivery: boolean;
  startDate: string;
  dueDate: string;
}
type PayWhen = 'aprobar' | 'entregar' | 'fecha';

let taskKey = 0;
const blankTask = (): AddTask => ({ key: ++taskKey, title: '', description: '', side: 'deersystems', clientDelivery: false, startDate: '', dueDate: '' });
const isWeekend = (d: string) => !!d && [0, 6].includes(new Date(`${d}T12:00:00`).getDay());

/**
 * Agregar un adicional al alcance (lo contrario de retirar): pegas la solicitud acordada con el cliente, la IA arma
 * las tareas de una fase nueva (las revisas o escribes a mano), y en un paso quedan la fase, el pago con su descuento
 * y el registro en «Cambios de alcance». «Permitir fin de semana» es para las excepciones acordadas.
 */
export function ScopeAddDialog({ projectId, onDone, onClose }: { projectId: number; onDone: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  const [request, setRequest] = useState('');
  const [amount, setAmount] = useState('');
  const [discount, setDiscount] = useState('');
  const [currency, setCurrency] = useState<Currency>('USD');
  const [payWhen, setPayWhen] = useState<PayWhen>('aprobar');
  const [payDate, setPayDate] = useState('');
  const [weekends, setWeekends] = useState(false);
  const [notify, setNotify] = useState(true);
  const [tasks, setTasks] = useState<AddTask[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [proposed, setProposed] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useAction();
  const toast = useToast();

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const base = Number(amount) || 0;
  const pct = Math.min(Math.max(Number(discount.replace(',', '.')) || 0, 0), 99);
  const total = Math.round(base * (1 - pct / 100) * 100) / 100;
  const valid = tasks.filter((t) => t.title.trim());
  const weekendTask = !weekends ? valid.find((t) => isWeekend(t.startDate) || isWeekend(t.dueDate)) : undefined;
  const lastDue = valid.map((t) => t.dueDate).filter(Boolean).sort().pop();

  const patch = (key: number, p: Partial<AddTask>) => setTasks((ts) => ts.map((t) => (t.key === key ? { ...t, ...p } : t)));

  const ask = () => {
    if (!name.trim()) return setError('Ponle un nombre al adicional.');
    if (request.trim().length < 10) return setError('Pega la solicitud del cliente.');
    setThinking(true);
    setError(null);
    api<{ tasks: Omit<AddTask, 'key'>[]; notes: string[] }>('POST', `projects/${projectId}/scope/add/suggest`, { name: name.trim(), request: request.trim(), allowWeekends: weekends })
      .then((r) => {
        setTasks(r.tasks.map((t) => ({ ...t, startDate: t.startDate ?? '', dueDate: t.dueDate ?? '', key: ++taskKey })));
        setNotes(r.notes);
        setProposed(true);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setThinking(false));
  };

  const submit = () =>
    run(async () => {
      const r = await api<{ tasks: number; total: number; currency: Currency }>('POST', `projects/${projectId}/scope/add`, {
        name: name.trim(),
        request: request.trim(),
        amount: base,
        discountPercent: pct,
        currency,
        payWhen,
        payDate: payWhen === 'fecha' ? payDate : null,
        allowWeekends: weekends,
        notify,
        tasks: valid.map(({ key: _k, ...t }) => ({ ...t, startDate: t.startDate || null, dueDate: t.dueDate || null })),
      });
      toast(`Adicional agregado: ${r.tasks} ${r.tasks === 1 ? 'tarea' : 'tareas'}${r.total ? ` y un pago de ${formatMoney(r.total, r.currency)}` : ''}.`);
      onDone();
      ref.current?.close();
    });

  const locked = busy || thinking;

  return (
    <dialog
      ref={ref}
      className="modal modal--send"
      aria-labelledby="scope-add-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget && !locked) ref.current?.close();
      }}
    >
      <div className="modal__in">
        <header className="modal__head">
          <h2 id="scope-add-title">Agregar adicional</h2>
          <button className="icon-btn" onClick={() => ref.current?.close()} aria-label="Cerrar" disabled={locked}>
            ✕
          </button>
        </header>
        <p className="hint">
          Para lo que el cliente pide aparte de lo aprobado. Queda como una fase nueva con sus tareas, su pago y el registro en «Cambios de alcance». El resto
          del plan no se mueve.
        </p>

        <label className="field">
          <span className="field__label">Nombre del adicional</span>
          <span className="input">
            <input value={name} maxLength={160} disabled={locked} placeholder="Ej.: Onboarding del Sprint con videos" onChange={(e) => setName(e.target.value)} />
          </span>
        </label>
        <label className="field">
          <span className="field__label">Solicitud acordada (la IA arma las tareas con esto)</span>
          <textarea
            rows={5}
            value={request}
            maxLength={6000}
            disabled={locked}
            placeholder="Pega lo que acordaste con el cliente: qué incluye, plazos, qué necesitas de él."
            onChange={(e) => setRequest(e.target.value)}
          />
        </label>

        <div className="scope-add__money">
          <label className="field">
            <span className="field__label">Valor</span>
            <span className="input">
              <MoneyInput value={amount} placeholder="0" aria-label="Valor del adicional" disabled={locked} onChange={setAmount} />
            </span>
          </label>
          <label className="field">
            <span className="field__label">Moneda</span>
            <span className="input">
              <select value={currency} disabled={locked} onChange={(e) => setCurrency(e.target.value as Currency)}>
                <option value="USD">USD</option>
                <option value="COP">COP</option>
              </select>
            </span>
          </label>
          <label className="field">
            <span className="field__label">Descuento %</span>
            <span className="input">
              <input inputMode="decimal" value={discount} placeholder="0" disabled={locked} onChange={(e) => setDiscount(e.target.value)} />
            </span>
          </label>
          <label className="field">
            <span className="field__label">Se paga</span>
            <span className="input">
              <select value={payWhen} disabled={locked} onChange={(e) => setPayWhen(e.target.value as PayWhen)}>
                <option value="aprobar">Al aprobar (hoy)</option>
                <option value="entregar">Al entregar</option>
                <option value="fecha">En una fecha</option>
              </select>
            </span>
          </label>
          {payWhen === 'fecha' && (
            <label className="field">
              <span className="field__label">Fecha del pago</span>
              <span className="input">
                <input type="date" value={payDate} disabled={locked} onChange={(e) => setPayDate(e.target.value)} />
              </span>
            </label>
          )}
        </div>
        {base > 0 && (
          <p className="hint">
            Total: <strong>{formatMoney(total, currency)}</strong>
            {pct > 0 && ` (${formatMoney(base, currency)} menos ${String(pct).replace('.', ',')} %)`}
          </p>
        )}

        <label className="scope-check">
          <input type="checkbox" checked={weekends} disabled={locked} onChange={(e) => setWeekends(e.target.checked)} />
          <span>
            Permitir fin de semana <small>· excepción acordada: las tareas pueden caer en sábado o domingo</small>
          </span>
        </label>

        <fieldset className="scope-group">
          <legend className="field__label">Tareas del adicional</legend>
          <div className="actions actions--tight">
            <button className="btn btn--outline btn--sm btn--ai" disabled={locked || !name.trim() || request.trim().length < 10} onClick={ask}>
              {thinking ? 'Pensando…' : proposed ? '✦ Volver a proponer' : '✦ Armar tareas con IA'}
            </button>
            <button className="btn btn--outline btn--sm" disabled={locked} onClick={() => setTasks((ts) => [...ts, blankTask()])}>
              + Tarea a mano
            </button>
          </div>
          {thinking && (
            <p className="loading">
              <span className="loading__dot" /> La IA está armando las tareas…
            </p>
          )}
          {notes.map((n) => (
            <p key={n} className="hint">
              {n}
            </p>
          ))}
          {tasks.map((t) => (
            <div key={t.key} className={`scope-add__task${!weekends && (isWeekend(t.startDate) || isWeekend(t.dueDate)) ? ' is-weekend' : ''}`}>
              <span className="input scope-add__title">
                <input value={t.title} maxLength={200} placeholder="Tarea" aria-label="Tarea" disabled={locked} onChange={(e) => patch(t.key, { title: e.target.value })} />
              </span>
              <span className="input">
                <select value={t.side} aria-label="A cargo de" disabled={locked} onChange={(e) => patch(t.key, { side: e.target.value as Side, clientDelivery: false })}>
                  <option value="deersystems">DeerSystems</option>
                  <option value="cliente">Cliente</option>
                </select>
              </span>
              <label className="check check--chip" title="Entrega al cliente: la revisa y la aprueba o pide ajustes. Sin marcar, es operativa del equipo.">
                <input
                  type="checkbox"
                  checked={t.clientDelivery}
                  disabled={locked || t.side === 'cliente'}
                  onChange={(e) => patch(t.key, { clientDelivery: e.target.checked })}
                  aria-label="Entrega al cliente"
                />
                Entrega
              </label>
              <span className="input">
                <input type="date" value={t.startDate} aria-label="Inicio" disabled={locked} onChange={(e) => patch(t.key, { startDate: e.target.value })} />
              </span>
              <span className="input">
                <input type="date" value={t.dueDate} aria-label="Entrega" disabled={locked} onChange={(e) => patch(t.key, { dueDate: e.target.value })} />
              </span>
              <button className="icon-btn icon-btn--danger" disabled={locked} onClick={() => setTasks((ts) => ts.filter((x) => x.key !== t.key))} aria-label="Quitar tarea" title="Quitar">
                ✕
              </button>
              {t.description && <small className="scope-add__desc">{t.description}</small>}
            </div>
          ))}
        </fieldset>

        <label className="scope-check">
          <input type="checkbox" checked={notify} disabled={locked} onChange={(e) => setNotify(e.target.checked)} />
          <span>Dejarle al cliente una nota en el proyecto con el adicional</span>
        </label>

        {valid.length > 0 && (
          <div className="scope-summary scope-summary--add">
            <strong>Qué va a pasar</strong>
            <ul>
              <li>
                Se crea la fase «Adicional: {name.trim() || '…'}» con {valid.length === 1 ? '1 tarea' : `${valid.length} tareas`}
                {lastDue ? `; la última entrega es el ${formatDate(lastDue, false)}` : ''}.
              </li>
              {total > 0 ? (
                <li>
                  Se agrega un pago de {formatMoney(total, currency)}{' '}
                  {payWhen === 'aprobar' ? 'para hoy' : payWhen === 'entregar' ? (lastDue ? `para el ${formatDate(lastDue, false)}` : 'al entregar') : payDate ? `para el ${formatDate(payDate, false)}` : '(elige la fecha)'}.
                </li>
              ) : (
                <li>Sin pago: el adicional queda sin costo.</li>
              )}
              <li>Queda anotado en «Propuesta y valores» y en «Cambios de alcance». Las demás tareas y la entrega del proyecto no cambian (salvo que el adicional termine después).</li>
              {weekendTask && <li className="scope-summary__warn">«{weekendTask.title}» cae en fin de semana: cambia la fecha o marca «Permitir fin de semana».</li>}
            </ul>
          </div>
        )}
        {error && <p className="alert">{error}</p>}

        <div className="actions actions--tight">
          <button
            className="btn btn--primary btn--sm"
            disabled={locked || !name.trim() || !valid.length || !!weekendTask || (total > 0 && payWhen === 'fecha' && !payDate)}
            onClick={submit}
          >
            {busy ? 'Agregando…' : 'Agregar al alcance'}
          </button>
          <button className="btn btn--outline btn--sm" disabled={locked} onClick={() => ref.current?.close()}>
            Cancelar
          </button>
        </div>
      </div>
    </dialog>
  );
}
