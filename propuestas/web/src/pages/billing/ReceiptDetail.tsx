import { formatDateTime, formatMoney, type Receipt } from '../../lib';
import { Link } from '../../ui';

/** Detalle de un abono (al abrirlo en una lista): notas del pago, conversión, a qué se aplicó y su estado en el Gestor. */
export function ReceiptDetail({ r }: { r: Receipt }) {
  const gestor =
    r.sendToFinance === false && r.sync !== 'error' ? (
      <span className="sync sync--off">No se envía al Gestor</span>
    ) : r.sync === 'ok' ? (
      <>
        <span className="sync sync--ok">✓ Registrado{r.syncedAt ? ` el ${formatDateTime(r.syncedAt)}` : ''}</span>
        {r.financeDescription && <small>{r.financeDescription}</small>}
      </>
    ) : r.sync === 'error' ? (
      <span className="sync sync--error">⚠ {r.syncError ?? 'No se pudo registrar'}</span>
    ) : (
      <span className="hint">Aún sin registrar</span>
    );

  return (
    <div className="rc-detail">
      <div className="rc-detail__notes">
        <small>Notas · detalle del pago</small>
        {r.notes ? <p className="pre">{r.notes}</p> : <p className="hint">Sin notas.</p>}
      </div>
      <dl className="rc-detail__facts">
        <div>
          <dt>Medio</dt>
          <dd>{r.method || '—'}</dd>
        </div>
        <div>
          <dt>Monto</dt>
          <dd className="mono">
            {r.currency === 'USD' ? `${formatMoney(r.amount, 'USD')} × TRM ${r.trm?.toLocaleString('es-CO') ?? '—'} = ${formatMoney(r.amountCop)}` : formatMoney(r.amountCop)}
          </dd>
        </div>
        <div>
          <dt>Aplicado a</dt>
          <dd>
            {r.invoiceNumber ? <Link to={`/cuentas-de-cobro/${r.invoiceId}`}>Cuenta de cobro {r.invoiceNumber}</Link> : 'La cuenta del cliente'}
            {r.paymentId && <small>Cuota del plan de pagos</small>}
          </dd>
        </div>
        {r.proofUrl && (
          <div>
            <dt>Comprobante</dt>
            <dd>
              <a href={r.proofUrl} target="_blank" rel="noopener noreferrer">
                Ver comprobante
              </a>
            </dd>
          </div>
        )}
        <div>
          <dt>Gestor financiero</dt>
          <dd>{gestor}</dd>
        </div>
        {(r.imported || r.createdAt) && (
          <div>
            <dt>Origen</dt>
            <dd>{r.imported ? 'Importado de SmartBilling' : `Registrado el ${formatDateTime(r.createdAt!)}`}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}
