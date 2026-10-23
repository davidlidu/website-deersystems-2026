import { useEffect, useState } from 'react';
import {
  api,
  docDate,
  draftBody,
  emptyDraft,
  formatDate,
  formatMoney,
  money,
  navigate,
  today,
  useApi,
  type Currency,
  type InvoiceSummary,
  type Me,
  type Payment,
  type PaymentDraft,
  type Statement,
} from '../../lib';
import { Empty, ErrorBox, Link, Loading, MoneyInput, useAction, useToast } from '../../ui';
import { GroupBar, useUngroup } from '../billing/GroupBar';
import { InvoiceStatus } from '../billing/InvoiceStatus';

interface PaymentsResponse {
  payments: Payment[];
  finance?: boolean;
}

type Draft = PaymentDraft;

/** Totales por moneda: total, pagado y pendiente. */
function Totals({ payments }: { payments: Payment[] }) {
  const currencies = [...new Set(payments.map((p) => p.currency))];
  return (
    <div className="pay-totals">
      {currencies.map((c) => {
        const list = payments.filter((p) => p.currency === c);
        const total = list.reduce((n, p) => n + p.amount, 0);
        const paid = list.filter((p) => p.paid).reduce((n, p) => n + p.amount, 0);
        return (
          <div key={c} className="pay-totals__row">
            <span>
              <small>Total</small>
              {money(total, c)}
            </span>
            <span>
              <small>Pagado</small>
              {money(paid, c)}
            </span>
            <span>
              <small>Pendiente</small>
              {money(total - paid, c)}
            </span>
            <div className="pay-totals__bar" aria-hidden="true">
              <span style={{ width: `${total ? Math.round((paid / total) * 100) : 0}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StatusPill({ p }: { p: Payment }) {
  if (p.paid) return <span className="pill pill--completada">Pagado el {formatDate(p.paidAt)}</span>;
  if (p.dueDate && p.dueDate < today()) return <span className="pill pill--bloqueada">Vencido</span>;
  return <span className="pill pill--pendiente">Pendiente</span>;
}

/** Al marcar como pagado: fecha y, si es en USD, TRM y pesos recibidos (lo que entra al Gestor). */
function MarkPaid({ p, onDone, onCancel }: { p: Payment; onDone: (p: Payment) => void; onCancel: () => void }) {
  const [date, setDate] = useState(today());
  const [trm, setTrm] = useState('');
  const [cop, setCop] = useState('');
  const [copTouched, setCopTouched] = useState(false);
  const { busy, run } = useAction();
  const usd = p.currency === 'USD';

  useEffect(() => {
    if (!usd) return;
    api<{ trm: number | null }>('GET', `trm?date=${date}`)
      .then((r) => {
        if (!r.trm) return;
        setTrm(String(r.trm));
        if (!copTouched) setCop(String(Math.round(p.amount * r.trm)));
      })
      .catch(() => {});
  }, [date, usd, p.amount, copTouched]);

  const submit = () =>
    run(async () => {
      onDone(await api<Payment>('POST', `payments/${p.id}/paid`, { paid: true, paidAt: date, ...(usd ? { trm: Number(trm) || null, amountCop: Number(cop) || null } : {}) }));
    });

  return (
    <div className="pay-mark">
      <label className="field">
        <span className="field__label">Fecha del pago</span>
        <span className="input">
          <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
        </span>
      </label>
      {usd && (
        <>
          <label className="field">
            <span className="field__label">TRM</span>
            <span className="input">
              <MoneyInput
                value={trm}
                onChange={(v) => {
                  setTrm(v);
                  if (!copTouched && Number(v)) setCop(String(Math.round(p.amount * Number(v))));
                }}
              />
            </span>
          </label>
          <label className="field">
            <span className="field__label">Pesos recibidos (COP)</span>
            <span className="input">
              <MoneyInput
                value={cop}
                onChange={(v) => {
                  setCop(v);
                  setCopTouched(true);
                }}
              />
            </span>
          </label>
        </>
      )}
      <div className="actions actions--tight">
        <button className="btn btn--primary btn--sm" disabled={busy} onClick={submit}>
          {busy ? 'Registrando…' : 'Registrar pago'}
        </button>
        <button className="btn btn--outline btn--sm" disabled={busy} onClick={onCancel}>
          Cancelar
        </button>
      </div>
      <p className="hint">
        Se registra como ingreso en tu Gestor financiero
        {usd ? ' en pesos (el Gestor lleva todo en COP); la TRM es la oficial del día y puedes ajustar lo que realmente recibiste' : ''}.
      </p>
    </div>
  );
}

/** Fila editable (administrador): los cambios se guardan al salir del campo. */
function PaymentRow({
  p,
  finance,
  newInvoiceUrl,
  invoices,
  onChange,
  onRemove,
  onUngroup,
}: {
  p: Payment;
  finance: boolean;
  onUngroup: (ref: string) => void;
  newInvoiceUrl: string;
  /** Cuentas de cobro del cliente (no anuladas) para asociar a la cuota. */
  invoices: InvoiceSummary[];
  onChange: (p: Payment) => void;
  onRemove: (p: Payment) => void;
}) {
  const [d, setD] = useState<Draft>({ label: p.label, percent: p.percent?.toString() ?? '', amount: String(p.amount), currency: p.currency, dueDate: p.dueDate ?? '' });
  const [marking, setMarking] = useState(false);
  const { busy, run } = useAction();
  const toast = useToast();

  const save = (patch: Partial<Draft>) => {
    const next = { ...d, ...patch };
    setD(next);
    const body = { label: next.label, percent: next.percent ? Number(next.percent) : null, amount: Number(next.amount), currency: next.currency, dueDate: next.dueDate || null };
    if (body.label === p.label && body.percent === p.percent && body.amount === p.amount && body.currency === p.currency && body.dueDate === p.dueDate) return;
    run(async () => {
      try {
        const u = await api<Payment>('PATCH', `payments/${p.id}`, body);
        onChange(u);
        if (u.sync === 'error') toast(`Guardado, pero no se actualizó en el Gestor: ${u.syncError}`, true);
      } catch (err) {
        setD({ label: p.label, percent: p.percent?.toString() ?? '', amount: String(p.amount), currency: p.currency, dueDate: p.dueDate ?? '' });
        throw err;
      }
    });
  };

  /** Asociar la cuota a una cuenta de cobro ya hecha (o quitarla). Si está pagada, su abono pasa a esa cuenta. */
  const link = (value: string) => {
    if (value === 'nueva') return navigate(newInvoiceUrl);
    run(async () => {
      const u = await api<Payment>('PATCH', `payments/${p.id}`, { invoiceId: Number(value) || null });
      onChange(u);
      toast(u.invoiceId ? `Asociada a la cuenta de cobro ${u.invoiceNumber}.` : 'Cuota sin cuenta de cobro.');
    });
  };

  const unpay = () => {
    if (!confirm(`¿Desmarcar «${p.label}» como pagado?${p.sync ? ' Se borra el ingreso de tu Gestor financiero.' : ''}`)) return;
    run(async () => onChange(await api<Payment>('POST', `payments/${p.id}/paid`, { paid: false })));
  };

  return (
    <div className={`pay-row${p.paid ? ' is-paid' : ''}`}>
      <div className="pay-row__fields">
        <label className="check check--chip pay-row__check" title={p.paid ? 'Desmarcar' : 'Marcar como pagado'}>
          <input type="checkbox" checked={p.paid || marking} disabled={busy} onChange={() => (p.paid ? unpay() : setMarking(!marking))} />
          Pagado
        </label>
        <span className="input pay-row__label">
          <input value={d.label} placeholder="Tipo de abono" aria-label="Tipo de abono" onChange={(e) => setD({ ...d, label: e.target.value })} onBlur={() => save({})} />
        </span>
        <span className="input pay-row__pct">
          <input inputMode="decimal" value={d.percent} placeholder="%" aria-label="Porcentaje" onChange={(e) => setD({ ...d, percent: e.target.value })} onBlur={() => save({})} />
        </span>
        <span className="input pay-row__amount">
          <MoneyInput value={d.amount} aria-label="Monto" onChange={(amount) => setD({ ...d, amount })} onBlur={() => save({})} />
        </span>
        <span className="input">
          <select value={d.currency} aria-label="Moneda" onChange={(e) => save({ currency: e.target.value as Currency })}>
            <option value="COP">COP</option>
            <option value="USD">USD</option>
          </select>
        </span>
        <span className="input">
          <input type="date" value={d.dueDate} aria-label="Fecha de pago" onChange={(e) => save({ dueDate: e.target.value })} />
        </span>
        <button className="icon-btn icon-btn--danger" disabled={busy} onClick={() => onRemove(p)} aria-label={`Quitar ${p.label}`} title="Quitar">
          ✕
        </button>
      </div>
      <div className="pay-row__status">
        <StatusPill p={p} />
        <span className="pay-row__invoice">
          <span className="input input--chip">
            <select value={p.invoiceId ?? ''} disabled={busy} onChange={(e) => link(e.target.value)} aria-label="Cuenta de cobro de esta cuota">
              <option value="">Sin cuenta de cobro</option>
              {invoices.map((i) => (
                <option key={i.id} value={i.id}>
                  CC {i.number} · {formatMoney(i.totalCop)} · {docDate(i.date)}
                </option>
              ))}
              <option value="nueva">+ Generar cuenta de cobro nueva…</option>
            </select>
          </span>
          {p.invoiceId && (
            <Link to={`/cuentas-de-cobro/${p.invoiceId}`} className="hint">
              Ver
            </Link>
          )}
        </span>
        {p.paid && p.currency === 'USD' && p.amountCop ? (
          <span className="hint">
            Recibido {money(p.amountCop, 'COP')}
            {p.trm ? ` · TRM ${p.trm.toLocaleString('es-CO')}` : ''}
          </span>
        ) : null}
        {p.paid && p.sync === 'ok' && (
          <span className="sync sync--ok">
            ✓ En el Gestor financiero
            {p.financeGroup && (
              <>
                {' '}
                <small className="tag tag--group">Entrada unida</small>{' '}
                <button className="linklike" disabled={busy} onClick={() => onUngroup(p.financeGroup!)}>
                  Separar
                </button>
              </>
            )}
          </span>
        )}
        {p.paid && p.sync === 'error' && (
          <span className="sync sync--error" title={p.syncError ?? ''}>
            ⚠ No se registró en el Gestor: {p.syncError}{' '}
            <button className="linklike" disabled={busy} onClick={() => run(async () => onChange(await api<Payment>('POST', `payments/${p.id}/sync`)))}>
              Reintentar
            </button>
          </span>
        )}
        {p.paid && !p.sync && !finance && (
          <span className="hint">
            Sin registrar en el Gestor: conéctalo en <Link to="/configuracion">Configuración</Link> y pulsa{' '}
            <button className="linklike" disabled={busy} onClick={() => run(async () => onChange(await api<Payment>('POST', `payments/${p.id}/sync`)))}>
              Registrar
            </button>
            .
          </span>
        )}
      </div>
      {marking && !p.paid && (
        <MarkPaid
          p={p}
          onCancel={() => setMarking(false)}
          onDone={(u) => {
            setMarking(false);
            onChange(u);
            if (u.sync === 'error') toast(`Pago marcado, pero no se registró en el Gestor: ${u.syncError}`, true);
            else if (u.sync === 'ok') toast('Pago registrado en tu Gestor financiero.');
          }}
        />
      )}
    </div>
  );
}

/** Lista para revisar lo que sugiere la IA antes de agregarlo. */
function Suggested({ projectId, items, onAdded, onCancel }: { projectId: number; items: Draft[]; onAdded: (list: Payment[]) => void; onCancel: () => void }) {
  const [list, setList] = useState(items);
  const { busy, run } = useAction();
  const setAt = (i: number, patch: Partial<Draft>) => setList((l) => l.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  return (
    <section className="card form-section">
      <h2>Pagos según la propuesta</h2>
      <p className="hint">Revisa y ajusta antes de agregarlos.</p>
      {list.map((d, i) => (
        <DraftRow key={i} d={d} onChange={(patch) => setAt(i, patch)} onRemove={() => setList((l) => l.filter((_, k) => k !== i))} />
      ))}
      <div className="actions actions--tight">
        <button
          className="btn btn--primary btn--sm"
          disabled={busy || !list.length}
          onClick={() =>
            run(async () => {
              const r = await api<PaymentsResponse>('POST', `projects/${projectId}/payments`, { payments: list.map(draftBody) });
              onAdded(r.payments);
            })
          }
        >
          Agregar {list.length} {list.length === 1 ? 'pago' : 'pagos'}
        </button>
        <button className="btn btn--outline btn--sm" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </section>
  );
}

/** Fila de un pago aún sin guardar (sugerencias de la IA y aprobación de la propuesta). */
export function DraftRow({ d, onChange, onRemove }: { d: Draft; onChange: (patch: Partial<Draft>) => void; onRemove: () => void }) {
  return (
    <div className="pay-row__fields pay-draft">
      <span className="input pay-row__label">
        <input value={d.label} placeholder="Tipo de abono (Anticipo, Segundo pago…)" aria-label="Tipo de abono" onChange={(e) => onChange({ label: e.target.value })} />
      </span>
      <span className="input pay-row__pct">
        <input inputMode="decimal" value={d.percent} placeholder="%" aria-label="Porcentaje" onChange={(e) => onChange({ percent: e.target.value })} />
      </span>
      <span className="input pay-row__amount">
        <MoneyInput value={d.amount} placeholder="Monto" aria-label="Monto" onChange={(amount) => onChange({ amount })} />
      </span>
      <span className="input">
        <select value={d.currency} aria-label="Moneda" onChange={(e) => onChange({ currency: e.target.value as Currency })}>
          <option value="COP">COP</option>
          <option value="USD">USD</option>
        </select>
      </span>
      <span className="input">
        <input type="date" value={d.dueDate} aria-label="Fecha de pago" onChange={(e) => onChange({ dueDate: e.target.value })} />
      </span>
      <button className="icon-btn icon-btn--danger" onClick={onRemove} aria-label="Quitar pago" title="Quitar">
        ✕
      </button>
    </div>
  );
}

/** Pestaña Pagos: seguimiento de los pagos pactados. Tú los editas y marcas; el cliente los ve. */
/** Lo que vale una cuota en pesos (para repartir un pago conjunto en proporción). */
const copValue = (p: Payment, trm: number) => (p.currency === 'USD' ? p.amount * trm : p.amount);

/**
 * Pago conjunto: varias cuotas que el cliente pagó en una sola transferencia.
 * - Pendientes: escribes el total recibido, se reparte entre ellas (en proporción a lo que vale cada una) y quedan pagadas.
 * - Ya pagadas: se unen como antes.
 * En los dos casos, al Gestor financiero va un solo ingreso por el total.
 */
function JointPayment({
  projectId,
  clientId,
  payments,
  selected,
  onSelect,
  onDone,
}: {
  projectId: number;
  clientId: number;
  payments: Payment[];
  selected: Set<number>;
  onSelect: (s: Set<number>) => void;
  onDone: (list?: Payment[]) => void;
}) {
  const [date, setDate] = useState(today());
  const [trm, setTrm] = useState('');
  const [total, setTotal] = useState('');
  const [description, setDescription] = useState('');
  const { busy, run } = useAction();
  const toast = useToast();
  const chosen = payments.filter((p) => selected.has(p.id));
  const pending = chosen.filter((p) => !p.paid);
  const paid = chosen.filter((p) => p.paid);
  const mixed = pending.length > 0 && paid.length > 0;
  const usd = pending.some((p) => p.currency === 'USD');

  // TRM oficial del día del pago (se puede corregir).
  useEffect(() => {
    if (!usd) return;
    api<{ trm: number | null }>('GET', `trm?date=${date}`)
      .then((r) => r.trm && setTrm(String(r.trm)))
      .catch(() => {});
  }, [usd, date]);

  const rate = Number(trm) || 0;
  const expected = pending.reduce((n, p) => n + copValue(p, rate), 0);
  const received = Number(total) > 0 ? Number(total) : Math.round(expected);
  // El mismo reparto que hace el servidor: en proporción, y el último se lleva el ajuste del redondeo.
  let left = received;
  const shares = pending.map((p, i) => {
    if (i === pending.length - 1) return left;
    const share = expected ? Math.round((received * copValue(p, rate)) / expected) : 0;
    left -= share;
    return share;
  });

  const toggle = (id: number, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    onSelect(next);
  };

  const register = () =>
    run(async () => {
      const r = await api<{ payments: Payment[]; total: number }>('POST', `projects/${projectId}/payments/together`, {
        ids: pending.map((p) => p.id),
        paidAt: date,
        trm: usd ? rate || null : null,
        totalCop: received,
        description,
      });
      const failed = r.payments.find((p) => selected.has(p.id) && p.sync === 'error');
      if (failed) toast(`Pago registrado, pero el Gestor respondió: ${failed.syncError}`, true);
      else toast(`${pending.length} cuotas pagadas con ${formatMoney(r.total)}: un solo ingreso en tu Gestor financiero.`);
      onDone(r.payments);
    });

  return (
    <section className="card form-section merge-pays">
      <h2>Pago conjunto</h2>
      <p className="hint">
        Para cuotas que el cliente pagó en una sola transferencia. Elige las <strong>pendientes</strong> y escribe el total recibido: se reparte entre ellas y
        quedan pagadas. O elige cuotas <strong>ya pagadas</strong> para unirlas. Al Gestor financiero va un solo ingreso por el total.
      </p>
      <ul className="merge-pays__list">
        {payments.map((p) => (
          <li key={p.id} className={selected.has(p.id) ? 'is-on' : ''}>
            <label className="check">
              <input type="checkbox" checked={selected.has(p.id)} disabled={p.paid && !p.receiptId} onChange={(e) => toggle(p.id, e.target.checked)} />
              <span>
                <strong>{p.label}</strong> · {p.paid ? `pagada el ${formatDate(p.paidAt)}` : `pendiente${p.dueDate ? ` · ${formatDate(p.dueDate)}` : ''}`}
                {p.financeGroup && (
                  <small className="tag tag--group" title="Ya está en una entrada unida: esa entrada se suma a la nueva, con todos sus pagos">
                    Ya unida
                  </small>
                )}
              </span>
            </label>
            <span className="mono">
              {p.paid ? formatMoney(p.amountCopReceived ?? p.amountCop ?? p.amount) : money(p.amount, p.currency)}
              {!p.paid && selected.has(p.id) && pending.length > 1 && !mixed && (
                <small className="merge-pays__share">→ {formatMoney(shares[pending.indexOf(p)] ?? 0)}</small>
              )}
            </span>
          </li>
        ))}
      </ul>

      {mixed && <p className="alert">Elige solo cuotas pendientes (para registrar el pago) o solo cuotas pagadas (para unirlas).</p>}

      {!mixed && pending.length > 0 && (
        <div className="group-bar card">
          <div className="group-bar__sum">
            <strong>
              {pending.length} {pending.length === 1 ? 'cuota' : 'cuotas'} · valen {formatMoney(Math.round(expected))}
            </strong>
            <span className="mono">{formatMoney(received)}</span>
          </div>
          <div className="joint-fields">
            <label className="field">
              <span className="field__label">Fecha del pago</span>
              <span className="input">
                <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
              </span>
            </label>
            {usd && (
              <label className="field">
                <span className="field__label">TRM</span>
                <span className="input">
                  <MoneyInput value={trm} onChange={setTrm} />
                </span>
              </label>
            )}
            <label className="field">
              <span className="field__label">Total recibido (COP)</span>
              <span className="input">
                <MoneyInput value={total} onChange={setTotal} placeholder={Math.round(expected) ? Math.round(expected).toLocaleString('es-CO') : ''} />
              </span>
            </label>
            <label className="field joint-fields__desc">
              <span className="field__label">Descripción en el Gestor (opcional)</span>
              <span className="input">
                <input value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} placeholder="Vacía: se arma con las cuotas" />
              </span>
            </label>
          </div>
          {pending.length < 2 ? (
            <p className="hint">Elige al menos dos cuotas. Para una sola, márcala «Pagado» en su fila.</p>
          ) : (
            <p className="hint">
              El total se reparte en proporción a lo que vale cada cuota (→ en la lista). Si recibiste menos o más por la TRM o comisiones, escribe lo que de
              verdad llegó.
            </p>
          )}
          <div className="actions actions--tight">
            <button className="btn btn--primary btn--sm" disabled={busy || pending.length < 2 || !(received > 0) || (usd && !rate)} onClick={register}>
              {busy ? 'Registrando…' : `Registrar pago de ${formatMoney(received)}`}
            </button>
            <button className="btn btn--outline btn--sm" disabled={busy} onClick={() => onSelect(new Set())}>
              Limpiar
            </button>
          </div>
        </div>
      )}

      {!mixed && paid.length > 0 && (
        <GroupBar
          items={paid.map((p) => ({ receiptId: p.receiptId!, clientId, date: p.paidAt ?? '', amountCop: p.amountCopReceived ?? p.amountCop ?? p.amount, sendToFinance: true }))}
          onClear={() => onSelect(new Set())}
          onDone={() => onDone()}
        />
      )}
    </section>
  );
}

export function PaymentsPanel({ me, projectId, clientId }: { me: Me; projectId: number; clientId: number }) {
  const { data, error, loading, reload, setData } = useApi<PaymentsResponse>(`projects/${projectId}/payments`);
  const clientInvoices = useApi<InvoiceSummary[]>(me.role === 'owner' ? `invoices?clientId=${clientId}` : null);
  const [suggested, setSuggested] = useState<Draft[] | null>(null);
  const [adding, setAdding] = useState<Draft | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [merging, setMerging] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const { busy, run } = useAction();
  const toast = useToast();
  const owner = me.role === 'owner';
  const { ungroup } = useUngroup(() => reload());

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const { payments, finance = false } = data!;
  const setPayments = (list: Payment[]) => setData({ ...data!, payments: list });

  const suggest = () => {
    setSuggesting(true);
    api<{ payments: { label: string; percent: number | null; amount: number; currency: Currency; dueDate: string | null }[] }>('POST', `projects/${projectId}/payments/suggest`)
      .then((r) => {
        if (!r.payments.length) return toast('La propuesta no trae valores ni forma de pago claros. Agrégalos a mano.', true);
        setSuggested(r.payments.map((p) => ({ label: p.label, percent: p.percent?.toString() ?? '', amount: String(p.amount), currency: p.currency, dueDate: p.dueDate ?? '' })));
      })
      .catch((err) => toast(err.message, true))
      .finally(() => setSuggesting(false));
  };

  const remove = (p: Payment) => {
    if (!confirm(`¿Quitar «${p.label}»?${p.sync ? ' También se borra el ingreso de tu Gestor financiero.' : ''}`)) return;
    run(async () => {
      await api('DELETE', `payments/${p.id}`);
      setPayments(payments.filter((x) => x.id !== p.id));
    });
  };

  return (
    <div className="stack">
      {owner && (
        <div className="toolbar">
          <div className="actions actions--tight">
            <button className="btn btn--primary btn--sm" onClick={() => setAdding(adding ? null : emptyDraft(payments[0]?.currency))}>
              {adding ? 'Cerrar' : '+ Pago'}
            </button>
            <button className="btn btn--outline btn--sm" disabled={suggesting} onClick={suggest}>
              {suggesting ? 'Leyendo la propuesta…' : 'Sugerir desde la propuesta (IA)'}
            </button>
          </div>
          {payments.length >= 2 && (
            <button
              className={`btn btn--outline btn--sm${merging ? ' is-active' : ''}`}
              onClick={() => {
                setMerging(!merging);
                setSelected(new Set());
              }}
            >
              {merging ? 'Cerrar' : 'Pago conjunto'}
            </button>
          )}
          <span className={`sync ${finance ? 'sync--ok' : 'sync--off'}`}>
            {finance ? '● Gestor financiero conectado' : <Link to="/configuracion">○ Conecta tu Gestor financiero</Link>}
          </span>
        </div>
      )}

      {merging && (
        <JointPayment
          projectId={projectId}
          clientId={clientId}
          payments={payments}
          selected={selected}
          onSelect={setSelected}
          onDone={(list) => {
            if (list) setPayments(list);
            else reload();
            setMerging(false);
            setSelected(new Set());
          }}
        />
      )}

      {suggested && (
        <Suggested
          projectId={projectId}
          items={suggested}
          onCancel={() => setSuggested(null)}
          onAdded={(list) => {
            setPayments(list);
            setSuggested(null);
            toast('Pagos agregados.');
          }}
        />
      )}

      {adding && (
        <section className="card form-section">
          <h2>Nuevo pago</h2>
          <DraftRow d={adding} onChange={(patch) => setAdding({ ...adding, ...patch })} onRemove={() => setAdding(null)} />
          <div className="actions actions--tight">
            <button
              className="btn btn--primary btn--sm"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const r = await api<PaymentsResponse>('POST', `projects/${projectId}/payments`, draftBody(adding));
                  setPayments(r.payments);
                  setAdding(null);
                })
              }
            >
              Agregar
            </button>
          </div>
        </section>
      )}

      {payments.length ? (
        <>
          <Totals payments={payments} />
          {owner ? (
            <div className="pay-list card">
              <div className="pay-head" aria-hidden="true">
                <span className="pay-head__check" />
                <span className="pay-row__label">Tipo de abono</span>
                <span className="pay-row__pct">%</span>
                <span className="pay-row__amount">Monto</span>
                <span className="pay-head__cur">Moneda</span>
                <span className="pay-head__date">Fecha de pago</span>
              </div>
              {payments.map((p) => (
                <PaymentRow
                  key={p.id}
                  p={p}
                  finance={finance}
                  newInvoiceUrl={`/facturacion/nueva?cliente=${clientId}&proyecto=${projectId}&cuota=${p.id}`}
                  invoices={(clientInvoices.data ?? []).filter((i) => i.status !== 'anulada')}
                  onChange={(u) => setPayments(payments.map((x) => (x.id === u.id ? u : x)))}
                  onRemove={remove}
                  onUngroup={ungroup}
                />
              ))}
            </div>
          ) : (
            <div className="table card">
              {payments.map((p) => (
                <div key={p.id} className="table__row pay-client">
                  <span>
                    <strong>{p.label}</strong>
                    {p.percent ? <small className="hint"> {p.percent}% del total</small> : null}
                  </span>
                  <span className="mono">{money(p.amount, p.currency)}</span>
                  <span className="mono">{formatDate(p.dueDate)}</span>
                  <span>
                    <StatusPill p={p} />
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <Empty>{owner ? 'Aún no hay pagos. Sugiérelos desde la propuesta o agrégalos a mano.' : 'Aún no hay pagos registrados en este proyecto.'}</Empty>
      )}

      <ProjectInvoices me={me} projectId={projectId} clientId={clientId} />
    </div>
  );
}

/** Cuentas de cobro del proyecto y, para el cliente, cómo pagar. */
function ProjectInvoices({ me, projectId, clientId }: { me: Me; projectId: number; clientId: number }) {
  const invoices = useApi<InvoiceSummary[]>(`invoices?projectId=${projectId}`);
  const statement = useApi<Statement>(me.role === 'client' ? `clients/${clientId}/statement` : null);
  const pay = statement.data?.howToPay;
  const list = invoices.data ?? [];
  return (
    <>
      <section>
        <div className="section__head">
          <h3 className="subhead">Cuentas de cobro</h3>
          {me.role === 'owner' && (
            <Link className="btn btn--outline btn--sm" to={`/facturacion/nueva?cliente=${clientId}&proyecto=${projectId}`}>
              + Cuenta de cobro
            </Link>
          )}
        </div>
        {list.length ? (
          <div className="table card">
            {list.map((i) => (
              <Link key={i.id} to={`/cuentas-de-cobro/${i.id}`} className={`table__row pay-client${i.status === 'anulada' ? ' is-void' : ''}`}>
                <span className="mono">
                  <strong>{i.number}</strong>
                </span>
                <span className="mono">{docDate(i.date)}</span>
                <span className="mono">
                  {formatMoney(i.currency === 'USD' ? i.total : i.totalCop, i.currency)}
                  {i.currency === 'USD' && <small>{formatMoney(i.totalCop)}</small>}
                </span>
                <span>
                  <InvoiceStatus i={i} />
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <Empty>{me.role === 'owner' ? 'Sin cuentas de cobro: genérala desde una cuota o crea una.' : 'Aún no hay cuentas de cobro de este proyecto.'}</Empty>
        )}
      </section>
      {pay && (pay.bankInfo || pay.qr) && (
        <section className="card how-to-pay">
          <div>
            <h3 className="subhead">Cómo pagar</h3>
            {pay.bankInfo && <p className="pre">{pay.bankInfo}</p>}
            <p className="hint">Cuando pagues, envíanos el comprobante respondiendo el correo de la cuenta de cobro.</p>
          </div>
          {pay.qr && <img src={pay.qr} alt="Código QR para pagar" />}
        </section>
      )}
    </>
  );
}
