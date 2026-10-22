import type { ReactNode } from 'react';
import { docDate, formatDateTime, formatMoney, type Receipt } from '../../lib';
import { Link } from '../../ui';

/**
 * Detalle de un abono (al abrirlo en una lista): notas del pago arriba, los datos en columnas y, abajo,
 * cómo quedó en el Gestor financiero, con el botón para editarlo (lo que se cambie se actualiza allá).
 */
export function ReceiptDetail({ r, onEdit, onUngroup }: { r: Receipt; onEdit?: () => void; onUngroup?: (ref: string) => void }) {
  const off = r.sendToFinance === false && r.sync !== 'error';
  const status = off ? (
    <span className="sync sync--off">No se envía al Gestor</span>
  ) : r.sync === 'ok' ? (
    <span className="sync sync--ok">✓ Registrado{r.syncedAt ? ` · ${formatDateTime(r.syncedAt)}` : ''}</span>
  ) : r.sync === 'error' ? (
    <span className="sync sync--error">⚠ {r.syncError ?? 'No se pudo registrar'}</span>
  ) : (
    <span className="hint">Aún sin registrar</span>
  );

  const facts: [string, ReactNode][] = [
    ['Fecha', docDate(r.date)],
    ['Medio', r.method || '—'],
    [
      'Monto',
      r.currency === 'USD' ? (
        <>
          {formatMoney(r.amountCop)}
          <small>
            {formatMoney(r.amount, 'USD')} × TRM {r.trm?.toLocaleString('es-CO') ?? '—'}
          </small>
        </>
      ) : (
        formatMoney(r.amountCop)
      ),
    ],
    [
      'Aplicado a',
      <>
        {r.invoiceNumber ? <Link to={`/cuentas-de-cobro/${r.invoiceId}`}>Cuenta de cobro {r.invoiceNumber}</Link> : 'La cuenta del cliente'}
        {r.paymentId && <small>Cuota del plan de pagos</small>}
      </>,
    ],
    ['Origen', r.imported ? 'Importado de SmartBilling' : r.createdAt ? `Registrado ${formatDateTime(r.createdAt)}` : 'Partners'],
    ...(r.proofUrl
      ? ([
          [
            'Comprobante',
            <a href={r.proofUrl} target="_blank" rel="noopener noreferrer">
              Ver comprobante
            </a>,
          ],
        ] as [string, ReactNode][])
      : []),
  ];

  return (
    <div className="rc-detail">
      <div className="rc-detail__notes">
        <span className="rc-detail__label">Notas · detalle del pago</span>
        {r.notes ? <p className="pre">{r.notes}</p> : <p className="hint">Sin notas.</p>}
      </div>

      <dl className="rc-detail__facts">
        {facts.map(([k, v]) => (
          <div key={k}>
            <dt className="rc-detail__label">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>

      {r.group && (
        <div className="rc-detail__group">
          <span className="rc-detail__label">
            Entrada unida en el Gestor · {formatMoney(r.group.total)}
            {r.group.date ? ` · ${docDate(r.group.date)}` : ''}
          </span>
          <ul>
            {r.group.members.map((m) => (
              <li key={m.id} className={m.self ? 'is-self' : ''}>
                <span className="mono">{docDate(m.date)}</span>
                <span>{m.label}</span>
                <span className="mono">{formatMoney(m.amountCop)}</span>
              </li>
            ))}
          </ul>
          {onUngroup && (
            <button className="btn btn--outline btn--xs" onClick={() => onUngroup(r.group!.ref)}>
              Separar la entrada
            </button>
          )}
        </div>
      )}

      <div className="rc-detail__gestor">
        <div>
          <span className="rc-detail__label">Gestor financiero</span>
          {status}
          {!off && r.financeDescription && (
            <p className="rc-detail__desc">
              <span>Descripción:</span> {r.financeDescription}
            </p>
          )}
        </div>
        {onEdit ? (
          <button className="btn btn--outline btn--sm" onClick={onEdit}>
            ✎ Editar abono
          </button>
        ) : (
          r.paymentId && <span className="hint">Se edita desde la pestaña Pagos del proyecto.</span>
        )}
      </div>
    </div>
  );
}
