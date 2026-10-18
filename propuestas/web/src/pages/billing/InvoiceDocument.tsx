import { forwardRef, useState } from 'react';
import { docDate, formatMoney, formatTrm, type BillingProfile, type InvoiceDetail } from '../../lib';

/**
 * La cuenta de cobro tal como se imprime: el mismo orden que la de SmartBilling (logo y número, cliente, ítems,
 * total —y su equivalente en COP si es en USD—, notas, firma y pie con los datos del emisor), más la forma de pago.
 * Siempre en blanco, también con el tema oscuro: es un documento.
 */
export const InvoiceDocument = forwardRef<HTMLDivElement, { invoice: InvoiceDetail; profile: BillingProfile }>(function InvoiceDocument({ invoice, profile }, ref) {
  const [logoOk, setLogoOk] = useState(true);
  const usd = invoice.currency === 'USD';
  const c = invoice.client;
  const docLabel = c.docType || 'NIT/CC';
  return (
    <div ref={ref} className={`cc-doc${invoice.status === 'anulada' ? ' is-void' : ''}`}>
      {invoice.status === 'anulada' && <div className="cc-doc__void">ANULADA</div>}
      <header className="cc-doc__head">
        <div>
          {profile.logo && logoOk ? (
            <img src={profile.logo} alt={profile.name} className="cc-doc__logo" onError={() => setLogoOk(false)} />
          ) : (
            <strong className="cc-doc__brand">{profile.name}</strong>
          )}
        </div>
        <div className="cc-doc__title">
          <h2>CUENTA DE COBRO</h2>
          <p className="cc-doc__number">{invoice.number}</p>
          <p>
            <strong>Fecha:</strong> {docDate(invoice.date)}
          </p>
          {invoice.dueDate && (
            <p>
              <strong>Fecha límite de pago:</strong> {docDate(invoice.dueDate)}
            </p>
          )}
        </div>
      </header>

      <section className="cc-doc__parties">
        <div>
          <h3>Cliente:</h3>
          <p className="cc-doc__strong">{c.name}</p>
          {c.docNumber && (
            <p>
              {docLabel}: {c.docNumber}
            </p>
          )}
          {c.address && <p>Dirección: {c.address}</p>}
          {c.phone && <p>Teléfono: {c.phone}</p>}
          {c.city && <p>Ciudad: {c.city}</p>}
        </div>
        <div>
          <h3>Debe a:</h3>
          <p className="cc-doc__strong">{profile.name}</p>
          {profile.docNumber && (
            <p>
              {profile.docType || 'CC'}: {profile.docNumber}
            </p>
          )}
          {profile.personType && <p>{profile.personType}</p>}
        </div>
      </section>

      <table className="cc-doc__items">
        <thead>
          <tr>
            <th className="c">Ítem</th>
            <th>Descripción</th>
            <th className="r">Cantidad</th>
            <th className="c">Unidad</th>
            <th className="r">Vr. Unitario</th>
            <th className="r">Vr. Total</th>
          </tr>
        </thead>
        <tbody>
          {invoice.items.map((it, i) => (
            <tr key={it.id ?? i}>
              <td className="c">{i + 1}</td>
              {/* HTML saneado en el servidor (lista blanca de etiquetas, sin atributos). */}
              <td className="cc-doc__desc" dangerouslySetInnerHTML={{ __html: it.description }} />
              <td className="r">{it.quantity.toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}</td>
              <td className="c">{it.unit}</td>
              <td className="r">{formatMoney(it.unitPrice, invoice.currency)}</td>
              <td className="r">{formatMoney(it.quantity * it.unitPrice, invoice.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="cc-doc__totals">
        <div className="cc-doc__total">
          <span>Valor total{usd ? ' USD' : ''}</span>
          <span>{formatMoney(invoice.total, invoice.currency)}</span>
        </div>
        {usd && (
          <>
            <div className="cc-doc__trm">
              <span>TRM ({docDate(invoice.date)})</span>
              <span>{formatTrm(invoice.exchangeRate)}</span>
            </div>
            <div className="cc-doc__total">
              <span>Equivalente COP</span>
              <span>{formatMoney(invoice.totalCop)}</span>
            </div>
          </>
        )}
      </div>

      {invoice.notes && <p className="cc-doc__notes">{invoice.notes}</p>}

      {(profile.bankInfo || profile.qr) && (
        <section className="cc-doc__pay">
          <div>
            <h3>Forma de pago</h3>
            {profile.bankInfo && <p className="cc-doc__notes">{profile.bankInfo}</p>}
          </div>
          {profile.qr && <img src={profile.qr} alt="Código QR para pagar" className="cc-doc__qr" />}
        </section>
      )}

      <section className="cc-doc__sign">
        {profile.signature ? <img src={profile.signature} alt="Firma" className="cc-doc__signature" /> : <div className="cc-doc__line" />}
        <p className="cc-doc__strong">{profile.signatureName || profile.name}</p>
        {profile.signatureDoc && <p>{profile.signatureDoc}</p>}
      </section>

      <footer className="cc-doc__foot">{[profile.name, profile.address, profile.phone && `Cel. ${profile.phone}`, profile.email].filter(Boolean).join(' - ')}</footer>
    </div>
  );
});
