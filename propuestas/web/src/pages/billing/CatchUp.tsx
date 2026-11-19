import { Fragment, useState } from 'react';
import { api, docDate, formatDateTime, formatMoney, useApi, type InvoiceSummary } from '../../lib';
import { Link, useAction, useToast } from '../../ui';
import { InvoiceStatus } from './InvoiceStatus';

/**
 * Modo «Poner al día»: para registrar pagos viejos (cuentas de cobro que ya se pagaron) sin que el ingreso se cuente
 * otra vez en el Gestor financiero. Se enciende mientras pones la cartera al día y se apaga al terminar.
 */
export interface CatchUp {
  enabled: boolean;
  since: string | null;
}

export const useCatchUp = () => useApi<CatchUp>('billing/catch-up');

/** El interruptor, en Configuración → Finanzas. */
export function CatchUpSwitch() {
  const { data, setData } = useCatchUp();
  const { busy, run } = useAction();
  const toast = useToast();
  const on = !!data?.enabled;
  const set = (enabled: boolean) =>
    run(async () => {
      setData(await api<CatchUp>('PUT', 'billing/catch-up', { enabled }));
      toast(enabled ? 'Modo «Poner al día» encendido: los abonos no van al Gestor.' : 'Modo «Poner al día» apagado: todo vuelve a la normalidad.');
    });
  return (
    <section className={`card form-section narrow-col catchup${on ? ' is-on' : ''}`} style={{ marginTop: 16 }}>
      <div className="form-section__head">
        <h2>Poner la cartera al día</h2>
        <label className="switch">
          <input type="checkbox" role="switch" checked={on} disabled={busy || !data} aria-label="Modo poner al día" onChange={(e) => set(e.target.checked)} />
          <span className="switch__track" />
        </label>
      </div>
      <p className="hint">
        Enciéndelo mientras marcas como pagadas cuentas de cobro viejas. Los abonos que registres (y las cuotas que marques pagadas) dejan la cuenta de cobro y el
        saldo del cliente al día, pero <strong>no se envían al Gestor financiero</strong>, porque ese ingreso ya está contado allá. Quedan marcados como
        «Puesta al día». Cuando termines, apágalo: los abonos nuevos vuelven a ir al Gestor como siempre.
      </p>
      {on && (
        <p className="callout callout--warn">
          Encendido{data?.since ? ` desde ${formatDateTime(data.since)}` : ''}. En el estado de cuenta de cada cliente aparece «Marcar pagada» en las cuentas
          pendientes. <Link to="/facturacion">Ir a facturación</Link>
        </p>
      )}
    </section>
  );
}

/** Aviso en facturación mientras el modo está encendido. */
export function CatchUpBanner({ mode }: { mode: CatchUp | null }) {
  if (!mode?.enabled) return null;
  return (
    <p className="callout callout--warn catchup-banner">
      <strong>Modo «Poner al día» encendido:</strong> los abonos que registres solo ponen al día las cuentas de cobro; no van al Gestor financiero.{' '}
      <Link to="/configuracion?tab=finanzas">Apagarlo</Link>
    </p>
  );
}

/**
 * Cuentas de cobro en «Poner al día»: marcas varias y las dejas pagadas de una vez, o abres una para registrarle un
 * abono parcial. Nada de esto va al Gestor ni suma a lo abonado.
 */
export function CatchUpInvoices({ invoices, onDone }: { invoices: InvoiceSummary[]; onDone: () => void }) {
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [date, setDate] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [payDate, setPayDate] = useState('');
  const { busy, run } = useAction();
  const toast = useToast();
  const pending = (i: InvoiceSummary) => Math.max(0, Math.round((i.totalCop - (i.applied ?? 0)) * 100) / 100);
  const open_ = invoices.filter((i) => i.status !== 'anulada' && !i.paid);
  const selected = open_.filter((i) => picked.has(i.id));
  const allPicked = open_.length > 0 && selected.length === open_.length;
  const toggle = (id: number) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  const settleMany = () =>
    run(async () => {
      const r = await api<{ settled: number; errors: string[] }>('POST', 'invoices/settle', { ids: selected.map((i) => i.id), date: date || null });
      toast(
        r.errors.length ? `${r.settled} al día; ${r.errors.length} con error: ${r.errors.join(' · ')}` : `${r.settled} ${r.settled === 1 ? 'cuenta quedó' : 'cuentas quedaron'} al día.`,
        r.errors.length > 0,
      );
      setPicked(new Set());
      onDone();
    });
  const pay = (i: InvoiceSummary) =>
    run(async () => {
      await api('POST', `invoices/${i.id}/settle`, { amount: Number(amount), date: payDate || null });
      const full = Number(amount) >= pending(i) - 0.5;
      toast(full ? `Cuenta ${i.number} al día.` : `Abono de ${formatMoney(Number(amount))} a la cuenta ${i.number}.`);
      setOpen(null);
      onDone();
    });

  return (
    <>
      {open_.length > 0 && (
        <div className="catchup-bar">
          <label className="check">
            <input type="checkbox" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(open_.map((i) => i.id)))} />
            {selected.length ? `${selected.length} de ${open_.length} · ${formatMoney(selected.reduce((n, i) => n + pending(i), 0))}` : 'Seleccionar todas las pendientes'}
          </label>
          {selected.length > 0 && (
            <>
              <span className="input input--chip">
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Fecha del pago" title="Vacía: la fecha de cada cuenta de cobro" />
              </span>
              <button className="btn btn--primary btn--xs" disabled={busy} onClick={settleMany}>
                Marcar {selected.length === 1 ? 'pagada' : `${selected.length} pagadas`}
              </button>
            </>
          )}
        </div>
      )}
      <div className="table card">
        {invoices.map((i) => {
          const due = pending(i);
          const settleable = i.status !== 'anulada' && !i.paid;
          if (!settleable)
            return (
              <Link key={i.id} to={`/cuentas-de-cobro/${i.id}`} className={`table__row pay-client${i.status === 'anulada' ? ' is-void' : ''}`}>
                <span className="mono">
                  <strong>{i.number}</strong>
                </span>
                <span className="mono">{docDate(i.date)}</span>
                <span className="mono">{formatMoney(i.totalCop)}</span>
                <span>
                  <InvoiceStatus i={i} />
                </span>
              </Link>
            );
          return (
            <Fragment key={i.id}>
              <div className={`table__row pay-client pay-client--settle${picked.has(i.id) ? ' is-picked' : ''}`}>
                <label className="pay-client__pick">
                  <input type="checkbox" checked={picked.has(i.id)} onChange={() => toggle(i.id)} aria-label={`Seleccionar ${i.number}`} />
                  <Link to={`/cuentas-de-cobro/${i.id}`} className="mono">
                    <strong>{i.number}</strong>
                  </Link>
                </label>
                <span className="mono">{docDate(i.date)}</span>
                <span className="mono">
                  {formatMoney(i.totalCop)}
                  {due < i.totalCop - 0.5 && <small className="pay-client__due">faltan {formatMoney(due)}</small>}
                </span>
                <button
                  className="btn btn--outline btn--xs"
                  disabled={busy}
                  onClick={() => {
                    setOpen(open === i.id ? null : i.id);
                    setAmount(String(due));
                    setPayDate(i.date.slice(0, 10));
                  }}
                >
                  {open === i.id ? 'Cerrar' : 'Abonar'}
                </button>
              </div>
              {open === i.id && (
                <div className="catchup-pay">
                  <label className="field">
                    <span className="field__label">Monto (COP) · pendiente {formatMoney(due)}</span>
                    <span className="input">
                      <input type="number" min={1} max={due} step="any" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
                    </span>
                  </label>
                  <label className="field">
                    <span className="field__label">Fecha del pago</span>
                    <span className="input">
                      <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
                    </span>
                  </label>
                  <button className="btn btn--primary btn--sm" disabled={busy || !(Number(amount) > 0) || Number(amount) > due + 0.5} onClick={() => pay(i)}>
                    {Number(amount) >= due - 0.5 ? 'Marcar pagada' : 'Registrar abono'}
                  </button>
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
    </>
  );
}
