import { useEffect, useRef, useState } from 'react';
import { api, docDate, formatDateTime, formatMoney, navigate, useApi, type InvoiceDetail, type Me } from '../../lib';
import { ErrorBox, Link, Loading, useAction, useToast } from '../../ui';
import { InvoiceDocument } from './InvoiceDocument';
import { downloadPdf, pdfBase64, pdfName } from './pdf';
import { ReceiptForm } from './ReceiptForm';

/** Una cuenta de cobro: el documento y, para ti, enviar, abonar, editar, anular. El cliente la ve y la descarga. */
export function InvoiceViewPage({ me, id }: { me: Me; id: number }) {
  const { data, error, loading, reload } = useApi<InvoiceDetail>(`invoices/${id}`);
  const online = useApi<{ enabled: boolean; hasPrivateKey: boolean; hasEventsSecret: boolean }>(me.role === 'owner' ? 'settings/online-payments' : null);
  const onlineReady = !!online.data?.enabled && online.data.hasPrivateKey && online.data.hasEventsSecret;
  const doc = useRef<HTMLDivElement>(null);
  const paper = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  // En pantallas angostas la hoja (794 px, como A4) se reduce para caber; el PDF siempre sale a tamaño completo.
  useEffect(() => {
    const el = paper.current;
    if (!el) return;
    const fit = () => {
      const cs = getComputedStyle(el);
      setZoom(Math.min(1, (el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) / 794));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [data]);
  /** El PDF se dibuja con la hoja a tamaño real. */
  const fullSize = async <T,>(fn: () => Promise<T>): Promise<T> => {
    const prev = zoom;
    if (prev === 1) return fn();
    setZoom(1);
    // Un respiro para que React pinte la hoja sin reducir (no requestAnimationFrame: se pausa con la pestaña oculta).
    await new Promise((r) => setTimeout(r, 60));
    try {
      return await fn();
    } finally {
      setZoom(prev);
    }
  };
  const [paying, setPaying] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const { busy, run } = useAction();
  const toast = useToast();
  const owner = me.role === 'owner';

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const inv = data!;
  const fileName = pdfName(inv.number, inv.client.name);
  const voided = inv.status === 'anulada';

  const download = async () => {
    setPdfBusy(true);
    try {
      await fullSize(() => downloadPdf(doc.current!, fileName));
    } catch (err) {
      toast(`No se pudo generar el PDF: ${(err as Error).message}`, true);
    } finally {
      setPdfBusy(false);
    }
  };

  const send = () => {
    const to = prompt('¿A qué correo la envío? Va con el PDF adjunto.', inv.client.email ?? '');
    if (!to) return;
    run(async () => {
      const pdf = await fullSize(() => pdfBase64(doc.current!));
      const r = await api<InvoiceDetail & { sentTo: string }>('POST', `invoices/${inv.id}/send`, { to, pdf });
      toast(`Enviada a ${r.sentTo}.`);
      await reload();
    });
  };

  const toggleOnline = (enabled: boolean) => {
    if (enabled && !confirm('¿Activar el pago en línea para esta cuenta de cobro? Wompi cobra comisión por cada pago (≈2,65 % + $700 + IVA). Se crea un link de un solo uso por el saldo.')) return;
    run(async () => {
      const r = await api<{ link: string | null }>('POST', `invoices/${inv.id}/online`, { enabled });
      toast(r.link ? 'Link de pago creado: el cliente lo ve en el portal y en el correo.' : 'Pago en línea desactivado.');
      await reload();
    });
  };

  const setStatus = (status: 'anulada' | 'emitida') => {
    if (status === 'anulada' && !confirm(`¿Anular la cuenta de cobro ${inv.number}? Deja de contar en el saldo del cliente; el número queda usado.`)) return;
    run(async () => {
      await api('PATCH', `invoices/${inv.id}`, { status });
      toast(status === 'anulada' ? 'Cuenta de cobro anulada.' : 'Cuenta de cobro reactivada.');
      await reload();
    });
  };

  const remove = () => {
    if (!confirm(`¿Borrar la cuenta de cobro ${inv.number}? No se puede deshacer.`)) return;
    run(async () => {
      await api('DELETE', `invoices/${inv.id}`);
      toast('Cuenta de cobro borrada.');
      navigate('/facturacion');
    });
  };

  return (
    <>
      <div className="crumbs">
        {owner ? (
          <>
            <Link to="/facturacion">Facturación</Link> / <Link to={`/clientes/${inv.clientId}`}>{inv.clientName}</Link> / {inv.number}
          </>
        ) : inv.projectId ? (
          <Link to={`/proyectos/${inv.projectId}?tab=pagos`}>Volver al proyecto</Link>
        ) : (
          <Link to="/">Mis proyectos</Link>
        )}
      </div>

      <div className="cc-toolbar">
        <div className="cc-toolbar__state">
          {voided ? <span className="pill pill--bloqueada">Anulada</span> : inv.paid ? <span className="pill pill--completada">Pagada</span> : null}
          {owner && inv.sentAt && <span className="hint">Enviada el {formatDateTime(inv.sentAt)}</span>}
          {owner && inv.imported && <span className="hint">Importada de SmartBilling</span>}
          {inv.projectName && (
            <span className="hint">
              Proyecto: <Link to={`/proyectos/${inv.projectId}`}>{inv.projectName}</Link>
            </span>
          )}
        </div>
        <div className="actions actions--tight">
          {!owner && inv.payUrl && !inv.paid && (
            <a className="btn btn--primary btn--sm" href={inv.payUrl} target="_blank" rel="noopener">
              Pagar en línea
            </a>
          )}
          <button className="btn btn--primary btn--sm" disabled={pdfBusy} onClick={download}>
            {pdfBusy ? 'Generando PDF…' : 'Descargar PDF'}
          </button>
          {owner && !voided && (
            <>
              <button className="btn btn--outline btn--sm" disabled={busy} onClick={send}>
                {busy ? 'Enviando…' : 'Enviar al cliente'}
              </button>
              <button className="btn btn--outline btn--sm" onClick={() => setPaying(!paying)}>
                Registrar abono
              </button>
              <Link className="btn btn--outline btn--sm" to={`/cuentas-de-cobro/${inv.id}/editar`}>
                Editar
              </Link>
            </>
          )}
          {owner && (
            <button className="btn btn--outline btn--sm btn--danger" disabled={busy} onClick={() => setStatus(voided ? 'emitida' : 'anulada')}>
              {voided ? 'Reactivar' : 'Anular'}
            </button>
          )}
          {owner && inv.applied === 0 && (
            <button className="btn btn--outline btn--sm btn--danger" disabled={busy} onClick={remove} title="Solo si no tiene abonos aplicados">
              Borrar
            </button>
          )}
        </div>
      </div>

      {owner && onlineReady && !voided && !inv.paid && (
        <div className="online-pay">
          {inv.payUrl ? (
            <>
              <span>
                Pago en línea activo:{' '}
                <a href={inv.payUrl} target="_blank" rel="noopener">
                  {inv.payUrl}
                </a>
              </span>
              <button className="linklike" disabled={busy} onClick={() => toggleOnline(false)}>
                Desactivar
              </button>
            </>
          ) : (
            <>
              <span className="hint">¿El cliente pidió pagar con PSE o tarjeta?</span>
              <button className="btn btn--outline btn--sm" disabled={busy} onClick={() => toggleOnline(true)}>
                Activar pago en línea (Wompi)
              </button>
            </>
          )}
        </div>
      )}

      {paying && (
        <ReceiptForm
          clientId={inv.clientId}
          invoiceId={inv.id}
          onCancel={() => setPaying(false)}
          onDone={() => {
            setPaying(false);
            reload();
          }}
        />
      )}

      <div className="cc-paper" ref={paper}>
        <div style={{ zoom }}>
          <InvoiceDocument ref={doc} invoice={inv} profile={inv.profile} />
        </div>
      </div>

      {inv.receipts.length > 0 && (
        <section className="section">
          <div className="section__head">
            <h2>Abonos aplicados</h2>
            <span className="mono">
              {formatMoney(inv.applied)} de {formatMoney(inv.totalCop)}
            </span>
          </div>
          <div className="table card">
            {inv.receipts.map((r) => (
              <div key={r.id} className="table__row pay-client">
                <span>{docDate(r.date)}</span>
                <span className="mono">{formatMoney(r.amountCop)}</span>
                <span>{r.method}</span>
                <span>{owner && r.sync === 'error' ? <span className="sync sync--error">⚠ Sin registrar en el Gestor</span> : null}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
