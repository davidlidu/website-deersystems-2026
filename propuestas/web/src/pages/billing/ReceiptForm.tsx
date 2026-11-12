import { useEffect, useState } from 'react';
import { api, docDate, formatMoney, today, useApi, type Currency, type InvoiceSummary, type Receipt } from '../../lib';
import { MoneyInput, useAction, useToast } from '../../ui';
import { Choice } from './Choice';

const METHODS = ['Transferencia', 'QR', 'Nequi', 'Daviplata', 'PSE', 'Efectivo', 'Consignación'];

interface ClientOption {
  id: number;
  name: string;
}

/**
 * Registrar o editar un abono. Va al Gestor financiero como ingreso (en COP; en USD con la TRM).
 * Se puede aplicar a una cuenta de cobro del cliente o dejar solo en su cuenta, como en SmartBilling.
 */
export function ReceiptForm({
  clientId,
  invoiceId,
  receipt,
  onDone,
  onCancel,
}: {
  clientId?: number;
  invoiceId?: number;
  receipt?: Receipt;
  onDone: (r: Receipt) => void;
  onCancel: () => void;
}) {
  const clients = useApi<ClientOption[]>(clientId || receipt ? null : 'clients');
  const [client, setClient] = useState<number>(receipt?.clientId ?? clientId ?? 0);
  const invoices = useApi<InvoiceSummary[]>(client ? `invoices?clientId=${client}` : null);
  const [f, setF] = useState({
    date: receipt?.date ?? today(),
    currency: (receipt?.currency ?? 'COP') as Currency,
    amount: receipt ? String(receipt.amount) : '',
    trm: receipt?.trm ? String(receipt.trm) : '',
    amountCop: receipt ? String(receipt.amountCop) : '',
    method: receipt?.method ?? 'Transferencia',
    invoiceIds: receipt?.applications?.map((a) => a.invoiceId) ?? (receipt?.invoiceId ? [receipt.invoiceId] : invoiceId ? [invoiceId] : []),
    notes: receipt?.notes ?? '',
    sendToFinance: receipt?.sendToFinance ?? true,
    financeDescription: receipt?.financeDescription ?? '',
  });
  const [copTouched, setCopTouched] = useState(!!receipt);
  const { busy, run } = useAction();
  const toast = useToast();
  const usd = f.currency === 'USD';

  // En USD: TRM oficial de la fecha del abono (se puede corregir) y pesos = monto × TRM.
  useEffect(() => {
    if (!usd || receipt) return;
    api<{ trm: number | null }>('GET', `trm?date=${f.date}`)
      .then((r) => r.trm && setF((x) => ({ ...x, trm: String(r.trm) })))
      .catch(() => {});
  }, [usd, f.date, receipt]);
  useEffect(() => {
    if (usd && !copTouched && Number(f.trm) && Number(f.amount)) setF((x) => ({ ...x, amountCop: String(Math.round(Number(x.amount) * Number(x.trm))) }));
  }, [usd, f.trm, f.amount, copTouched]);

  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  // Lo que este abono ya tenía en cada cuenta de cobro: al editarlo, ese saldo vuelve a estar disponible.
  const mine = new Map((receipt?.applications ?? []).map((a) => [a.invoiceId, a.amountCop]));
  const pendingOf = (i: InvoiceSummary) => Math.max(0, i.totalCop - i.applied + (mine.get(i.id) ?? 0));
  const open = (invoices.data ?? [])
    .filter((i) => i.status !== 'anulada' && (pendingOf(i) > 0.5 || f.invoiceIds.includes(i.id)))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  const toggleInvoice = (id: number, on: boolean) => set({ invoiceIds: on ? [...f.invoiceIds, id] : f.invoiceIds.filter((x) => x !== id) });
  const plan = distribute(open.filter((i) => f.invoiceIds.includes(i.id)), usd ? Number(f.amountCop) : Number(f.amount), pendingOf);

  const submit = () =>
    run(async () => {
      const body = {
        clientId: client,
        date: f.date,
        currency: f.currency,
        amount: Number(f.amount),
        ...(usd ? { trm: Number(f.trm) || null, amountCop: Number(f.amountCop) || null } : {}),
        method: f.method,
        invoiceIds: f.invoiceIds,
        notes: f.notes,
        sendToFinance: f.sendToFinance,
        // Solo si la cambiaste: vacía vuelve a la descripción automática.
        ...(receipt && f.financeDescription !== (receipt.financeDescription ?? '') ? { financeDescription: f.financeDescription } : {}),
      };
      const r = await api<Receipt>(receipt ? 'PATCH' : 'POST', receipt ? `receipts/${receipt.id}` : 'receipts', body);
      if (r.sync === 'error') toast(`Abono guardado, pero falló el Gestor: ${r.syncError}`, true);
      else if (!f.sendToFinance) toast(receipt ? 'Abono actualizado (no se envía al Gestor).' : 'Abono registrado, sin enviarlo al Gestor.');
      else toast(receipt ? 'Abono actualizado, también en tu Gestor financiero.' : 'Abono registrado en tu Gestor financiero.');
      onDone(r);
    });

  return (
    <div className="card form-section receipt-form">
      <h2>{receipt ? 'Editar abono' : 'Registrar abono'}</h2>
      <div className="form-grid">
        {!clientId && !receipt && (
          <label className="field">
            <span className="field__label">Cliente</span>
            <span className="input">
              <select value={client} onChange={(e) => setClient(Number(e.target.value))}>
                <option value={0}>Elige el cliente…</option>
                {(clients.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </span>
          </label>
        )}
        <label className="field">
          <span className="field__label">Fecha</span>
          <span className="input">
            <input type="date" value={f.date} max={today()} onChange={(e) => set({ date: e.target.value })} />
          </span>
        </label>
        <label className="field">
          <span className="field__label">Monto</span>
          <span className="input input--money">
            <MoneyInput value={f.amount} onChange={(amount) => set({ amount })} placeholder="0" />
            <select value={f.currency} onChange={(e) => set({ currency: e.target.value as Currency })} aria-label="Moneda">
              <option value="COP">COP</option>
              <option value="USD">USD</option>
            </select>
          </span>
        </label>
        {usd && (
          <>
            <label className="field">
              <span className="field__label">TRM</span>
              <span className="input">
                <MoneyInput value={f.trm} onChange={(trm) => set({ trm })} />
              </span>
            </label>
            <label className="field">
              <span className="field__label">Pesos recibidos (COP)</span>
              <span className="input">
                <MoneyInput
                  value={f.amountCop}
                  onChange={(amountCop) => {
                    set({ amountCop });
                    setCopTouched(true);
                  }}
                />
              </span>
            </label>
          </>
        )}
        <label className="field">
          <span className="field__label">Medio de pago</span>
          <Choice label="Medio de pago" value={f.method} options={METHODS} onChange={(method) => set({ method })} />
        </label>
      </div>
      <fieldset className="field apply">
        <legend className="field__label">Aplicar a cuentas de cobro</legend>
        {!client ? (
          <small className="hint">Elige primero el cliente.</small>
        ) : !open.length ? (
          <small className="hint">El cliente no tiene cuentas de cobro pendientes: el abono queda en su cuenta.</small>
        ) : (
          <>
            <ul className="apply__list">
              {open.map((i) => {
                const p = plan.lines.get(i.id);
                return (
                  <li key={i.id}>
                    <label className="check apply__item">
                      <input type="checkbox" checked={f.invoiceIds.includes(i.id)} onChange={(e) => toggleInvoice(i.id, e.target.checked)} />
                      <span className="apply__what">
                        <strong>{i.number}</strong>
                        <small>
                          {docDate(i.date)}
                          {i.projectName ? ` · ${i.projectName}` : ''}
                        </small>
                      </span>
                      <span className="apply__due mono">
                        {formatMoney(pendingOf(i))}
                        <small>{pendingOf(i) < i.totalCop - 0.5 ? `pendiente de ${formatMoney(i.totalCop)}` : 'pendiente'}</small>
                      </span>
                      {p && (
                        <span className={`apply__take mono${p.rest > 0.5 ? ' is-partial' : ''}`}>
                          {p.take > 0 ? `− ${formatMoney(p.take)}` : 'No alcanza'}
                          <small>{p.take <= 0 ? 'queda igual' : p.rest > 0.5 ? `queda debiendo ${formatMoney(p.rest)}` : 'queda saldada'}</small>
                        </span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
            <small className="hint">
              {f.invoiceIds.length === 0
                ? 'Sin marcar ninguna, el abono queda en la cuenta del cliente.'
                : f.invoiceIds.length === 1
                  ? 'Todo el abono se aplica a esa cuenta de cobro.'
                  : 'Se cubren de la más antigua a la más reciente; la última recibe lo que alcance y le queda el saldo pendiente.'}
              {f.invoiceIds.length > 1 && plan.left > 0.5 && ` Sobran ${formatMoney(plan.left)}: quedan a favor en la cuenta del cliente.`}
            </small>
          </>
        )}
      </fieldset>
      <label className="field">
        <span className="field__label">Notas · detalle del pago</span>
        <textarea rows={3} maxLength={1000} value={f.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Anticipo, comprobante 123, banco de origen…" />
      </label>
      {receipt && f.sendToFinance && (
        <label className="field">
          <span className="field__label">Descripción en el Gestor</span>
          <span className="input">
            <input
              value={f.financeDescription}
              maxLength={300}
              onChange={(e) => set({ financeDescription: e.target.value })}
              placeholder="Vacía: se arma sola con el proyecto, la cuenta de cobro y las notas"
            />
          </span>
        </label>
      )}
      <label className="auto-switch auto-switch--left">
        <span className="switch">
          <input type="checkbox" role="switch" checked={f.sendToFinance} onChange={(e) => set({ sendToFinance: e.target.checked })} />
          <span className="switch__track" aria-hidden="true" />
        </span>
        <span>
          Enviar al Gestor financiero
          <small>
            {f.sendToFinance
              ? 'Queda como ingreso en tu Gestor.'
              : receipt?.sync === 'ok'
                ? 'Se quitará el ingreso que ya está en el Gestor.'
                : 'Solo queda en Partners: cuenta para el saldo del cliente, pero no como ingreso.'}
          </small>
        </span>
      </label>
      <div className="actions actions--tight">
        <button className="btn btn--primary btn--sm" disabled={busy || !client || !(Number(f.amount) > 0)} onClick={submit}>
          {busy ? 'Guardando…' : receipt ? 'Guardar' : 'Registrar abono'}
        </button>
        <button className="btn btn--outline btn--sm" disabled={busy} onClick={onCancel}>
          Cancelar
        </button>
      </div>
      {f.sendToFinance && (
        <p className="hint">
          {receipt ? 'Al guardar se actualiza el mismo ingreso en tu Gestor financiero (fecha, monto, medio y descripción)' : 'Se registra como ingreso en tu Gestor financiero'}
          {usd ? ', en pesos (el Gestor lleva todo en COP)' : ''}.
        </p>
      )}
    </div>
  );
}

/** El mismo reparto que hace el servidor: de la más antigua a la más reciente, cada una hasta su saldo. Con una sola, va todo a ella. */
function distribute(selected: InvoiceSummary[], amount: number, pendingOf: (i: InvoiceSummary) => number) {
  const lines = new Map<number, { take: number; rest: number }>();
  let left = amount > 0 ? amount : 0;
  if (selected.length === 1) {
    const due = pendingOf(selected[0]);
    lines.set(selected[0].id, { take: left, rest: Math.max(0, due - left) });
    return { lines, left: 0 };
  }
  for (const i of selected) {
    const due = pendingOf(i);
    const take = Math.min(left, due);
    lines.set(i.id, { take, rest: due - take });
    left -= take;
  }
  return { lines, left };
}
