import { useEffect, useRef, useState } from 'react';
import { api, docDate, formatDateTime, formatMoney, navigate, useApi, type InvoiceDetail, type Me } from '../../lib';
import { ErrorBox, Link, Loading, useAction, useToast } from '../../ui';
import { InvoiceStatus } from './InvoiceStatus';
import { InvoiceDocument } from './InvoiceDocument';
import { downloadPdf, pdfBase64, pdfName } from './pdf';
import { ReceiptForm } from './ReceiptForm';
import { pickFromDrive } from '../../picker';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface SendExtras {
  driveFiles: { id: string; name: string }[];
  files: { name: string; data: string; size: number }[];
}

const MAX_ATTACH = 15 * 1024 * 1024;
const readAsDataUrl = (f: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error(`No se pudo leer «${f.name}».`));
    r.readAsDataURL(f);
  });
const sizeLabel = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * A quién se envía: uno o varios correos (coma, punto y coma o espacio), y una copia para ti si quieres.
 * Archivos adicionales: de Drive van como enlace (no se cargan a la app); del computador, como adjunto que no se guarda aquí.
 */
function SendDialog({ initial, me, busy, onSend, onClose }: { initial: string; me: string; busy: boolean; onSend: (to: string, extras: SendExtras) => void; onClose: () => void }) {
  const [text, setText] = useState(initial);
  const [copy, setCopy] = useState(false);
  const [driveFiles, setDriveFiles] = useState<SendExtras['driveFiles']>([]);
  const [files, setFiles] = useState<SendExtras['files']>([]);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  const picking = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.showModal(), []);
  const list = [...new Set([...text.toLowerCase().split(/[\s,;]+/).filter(Boolean), ...(copy ? [me.toLowerCase()] : [])])];
  const bad = list.filter((e) => !EMAIL.test(e));
  const attached = files.reduce((n, f) => n + f.size, 0);

  const fromDrive = async () => {
    setError(null);
    // El selector de Google queda debajo de un diálogo modal: se cierra un momento y vuelve a abrirse.
    picking.current = true;
    ref.current?.close();
    try {
      const picked = await pickFromDrive();
      setDriveFiles((cur) => [...cur, ...picked.filter((p) => !cur.some((c) => c.id === p.id))].slice(0, 10));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      ref.current?.showModal();
      picking.current = false;
    }
  };

  const addLocal = async (list: FileList) => {
    setError(null);
    const next = [...files];
    for (const f of [...list]) {
      if (attached + next.slice(files.length).reduce((n, x) => n + x.size, 0) + f.size > MAX_ATTACH) {
        setError(`«${f.name}» supera el límite de 15 MB en adjuntos: compártelo mejor desde Drive.`);
        break;
      }
      next.push({ name: f.name, size: f.size, data: await readAsDataUrl(f) });
    }
    setFiles(next.slice(0, 5));
  };

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="send-title"
      onClose={() => !picking.current && onClose()}
      onClick={(e) => e.target === e.currentTarget && ref.current?.close()}
    >
      <div className="modal__in">
        <header className="modal__head">
          <h2 id="send-title">Enviar la cuenta de cobro</h2>
          <button className="icon-btn" onClick={() => ref.current?.close()} aria-label="Cerrar">
            ✕
          </button>
        </header>
        <label className="field">
          <span className="field__label">Para (uno o varios correos, separados por coma)</span>
          <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="cliente@empresa.com, contabilidad@empresa.com" autoFocus />
        </label>
        <div className="send-to__list" aria-live="polite">
          {list.map((e) => (
            <span key={e} className={`send-to__chip${EMAIL.test(e) ? '' : ' is-bad'}`}>
              {e}
            </span>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} />
          Enviarme una copia ({me})
        </label>

        <div className="send-extra">
          <div className="send-extra__head">
            <span className="field__label">Archivos adicionales (opcional)</span>
            <span className="actions actions--tight">
              <button type="button" className="btn btn--outline btn--xs" onClick={fromDrive} disabled={busy}>
                + Desde Drive (enlace)
              </button>
              <button type="button" className="btn btn--outline btn--xs" onClick={() => input.current?.click()} disabled={busy}>
                + Adjuntar del computador
              </button>
            </span>
            <input
              ref={input}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) void addLocal(e.target.files);
                e.target.value = '';
              }}
            />
          </div>
          {driveFiles.length + files.length > 0 ? (
            <ul className="send-extra__list">
              {driveFiles.map((f) => (
                <li key={f.id}>
                  <span className="send-extra__kind send-extra__kind--drive">Drive</span>
                  <span className="send-extra__name">{f.name}</span>
                  <small>enlace</small>
                  <button type="button" className="icon-btn" aria-label={`Quitar ${f.name}`} onClick={() => setDriveFiles(driveFiles.filter((x) => x.id !== f.id))}>
                    ✕
                  </button>
                </li>
              ))}
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`}>
                  <span className="send-extra__kind">Adjunto</span>
                  <span className="send-extra__name">{f.name}</span>
                  <small>{sizeLabel(f.size)}</small>
                  <button type="button" className="icon-btn" aria-label={`Quitar ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint">
              Lo de Drive va como enlace en el correo (se comparte para que el cliente lo abra con el enlace) y no se carga a la app. Lo del computador va adjunto,
              hasta 15 MB, y tampoco se guarda aquí.
            </p>
          )}
        </div>

        <p className="hint">Va con el PDF adjunto, tus datos de pago y el QR{' '}(y el botón de pago en línea si lo activaste).</p>
        <div className="actions actions--tight">
          <button
            className="btn btn--primary btn--sm"
            disabled={busy || !list.length || bad.length > 0 || list.length > 10}
            onClick={() => onSend(list.join(', '), { driveFiles, files })}
          >
            {busy ? 'Enviando…' : `Enviar a ${list.length} ${list.length === 1 ? 'destinatario' : 'destinatarios'}`}
          </button>
          <button className="btn btn--outline btn--sm" disabled={busy} onClick={() => ref.current?.close()}>
            Cancelar
          </button>
        </div>
        {bad.length > 0 && <p className="alert">Revisa: {bad.join(', ')}</p>}
        {error && <p className="alert">{error}</p>}
      </div>
    </dialog>
  );
}

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
  const [sending, setSending] = useState(false);
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

  const send = (to: string, extras: SendExtras) =>
    run(async () => {
      const pdf = await fullSize(() => pdfBase64(doc.current!));
      const r = await api<InvoiceDetail & { sentTo: string }>('POST', `invoices/${inv.id}/send`, {
        to,
        pdf,
        driveFiles: extras.driveFiles.map((f) => f.id),
        files: extras.files.map((f) => ({ name: f.name, data: f.data })),
      });
      setSending(false);
      const n = extras.driveFiles.length + extras.files.length;
      toast(`Enviada a ${r.sentTo}${n ? ` con ${n} ${n === 1 ? 'archivo adicional' : 'archivos adicionales'}` : ''}.`);
      await reload();
    });

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
          <InvoiceStatus i={inv} />
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
              <button className="btn btn--outline btn--sm" disabled={busy} onClick={() => setSending(true)}>
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

      {sending && (
        <SendDialog
          initial={[inv.client.email].filter(Boolean).join(', ')}
          me={me.email}
          busy={busy}
          onSend={send}
          onClose={() => setSending(false)}
        />
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
