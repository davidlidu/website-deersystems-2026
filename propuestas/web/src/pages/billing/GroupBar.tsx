import { useState } from 'react';
import { api, formatMoney, today, type Receipt } from '../../lib';
import { useAction, useToast } from '../../ui';

export interface Selectable {
  receiptId: number;
  clientId: number | null;
  date: string;
  amountCop: number;
  sendToFinance: boolean;
}

/**
 * Barra que aparece al elegir varios pagos: los une en una sola entrada del Gestor financiero
 * (un ingreso por la suma). En Partners cada abono sigue igual: su cuota, su cuenta de cobro y el saldo.
 */
export function GroupBar({ items, onDone, onClear }: { items: Selectable[]; onDone: (receipts: Receipt[]) => void; onClear: () => void }) {
  // Por defecto, la fecha del pago más reciente de la selección (hasta que la cambies).
  const latest = items.map((i) => i.date.slice(0, 10)).filter(Boolean).sort().at(-1) ?? today();
  const [picked, setDate] = useState<string | null>(null);
  const date = picked ?? latest;
  const [description, setDescription] = useState('');
  const { busy, run } = useAction();
  const toast = useToast();
  const total = items.reduce((n, i) => n + i.amountCop, 0);
  const clients = new Set(items.map((i) => i.clientId));
  const problem =
    items.length < 2
      ? 'Elige al menos dos pagos.'
      : clients.size > 1
        ? 'Solo se unen pagos del mismo cliente.'
        : items.some((i) => !i.sendToFinance)
          ? 'Hay pagos que no se envían al Gestor: quítalos de la selección.'
          : null;

  const group = () =>
    run(async () => {
      const r = await api<{ receipts: Receipt[] }>('POST', 'receipts/group', { ids: items.map((i) => i.receiptId), date, description });
      const failed = r.receipts.find((x) => x.sync === 'error');
      if (failed) toast(`Se unieron, pero el Gestor respondió: ${failed.syncError}`, true);
      else toast(`Listo: ${r.receipts.length} pagos quedaron como una sola entrada de ${formatMoney(total)} en el Gestor.`);
      onDone(r.receipts);
    });

  return (
    <div className="group-bar card" role="region" aria-label="Unir pagos seleccionados">
      <div className="group-bar__sum">
        <strong>
          {items.length} {items.length === 1 ? 'pago seleccionado' : 'pagos seleccionados'}
        </strong>
        <span className="mono">{formatMoney(total)}</span>
      </div>
      {items.length >= 2 && !problem && (
        <div className="group-bar__fields">
          <label className="field">
            <span className="field__label">Fecha de la entrada</span>
            <span className="input">
              <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
            </span>
          </label>
          <label className="field">
            <span className="field__label">Descripción en el Gestor (opcional)</span>
            <span className="input">
              <input value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} placeholder="Vacía: se arma con lo de cada pago" />
            </span>
          </label>
        </div>
      )}
      {problem && items.length > 0 && <p className="hint">{problem}</p>}
      <div className="actions actions--tight">
        <button className="btn btn--primary btn--sm" disabled={busy || !!problem} onClick={group}>
          {busy ? 'Uniendo…' : 'Unir en una sola entrada del Gestor'}
        </button>
        <button className="btn btn--outline btn--sm" disabled={busy} onClick={onClear}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

/** Separa una entrada unida: cada pago vuelve a ser su propio ingreso en el Gestor. */
export function useUngroup(onDone: () => void) {
  const { busy, run } = useAction();
  const toast = useToast();
  const ungroup = (ref: string) => {
    if (!confirm('¿Separar esta entrada? En el Gestor se borra el ingreso unido y cada pago vuelve a ser su propio ingreso.')) return;
    run(async () => {
      await api('POST', 'receipts/ungroup', { ref });
      toast('Entrada separada: cada pago es de nuevo su propio ingreso.');
      onDone();
    });
  };
  return { busy, ungroup };
}
