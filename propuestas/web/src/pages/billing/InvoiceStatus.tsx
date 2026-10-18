import type { InvoiceSummary } from '../../lib';

/** Estado de una cuenta de cobro: Anulada, Pagada, Abono parcial o Pendiente. */
export function InvoiceStatus({ i }: { i: Pick<InvoiceSummary, 'status' | 'paid' | 'applied'> }) {
  if (i.status === 'anulada') return <span className="pill pill--bloqueada">Anulada</span>;
  if (i.paid) return <span className="pill pill--completada">Pagada</span>;
  if (i.applied > 0) return <span className="pill pill--en_progreso">Abono parcial</span>;
  return <span className="pill pill--pendiente">Pendiente</span>;
}
