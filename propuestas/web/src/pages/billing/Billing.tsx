import { Fragment, useMemo, useState } from 'react';
import { api, docDate, emptyRange, formatMoney, inRange, navigate, useApi, useLocation, type DateRange, type InvoiceSummary, type Receipt } from '../../lib';
import { Empty, ErrorBox, Link, Loading, PageHead, useAction, useToast } from '../../ui';
import { InvoiceStatus } from './InvoiceStatus';
import { DateFilter } from './DateFilter';
import { ImportTab } from './Import';
import { GroupBar, useUngroup } from './GroupBar';
import { ReceiptDetail } from './ReceiptDetail';
import { ReceiptForm } from './ReceiptForm';
import { ReportsTab } from './Reports';

const TABS = { cuentas: 'Cuentas de cobro', abonos: 'Abonos', reportes: 'Reportes', importar: 'Importar de SmartBilling' } as const;
type Tab = keyof typeof TABS;

function InvoicesTab() {
  const { data, error, loading, reload } = useApi<InvoiceSummary[]>('invoices');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'todas' | 'emitida' | 'pagada' | 'anulada'>('todas');
  const [range, setRange] = useState<DateRange>(emptyRange);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data ?? []).filter(
      (i) =>
        inRange(i.date, range) &&
        (!s || `${i.number} ${i.clientName} ${i.projectName ?? ''}`.toLowerCase().includes(s)) &&
        (status === 'todas' || (status === 'anulada' ? i.status === 'anulada' : status === 'pagada' ? i.paid : i.status === 'emitida' && !i.paid)),
    );
  }, [data, q, status, range]);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  return (
    <section className="section section--flush">
      <div className="toolbar">
        <div className="filters">
          {(['todas', 'emitida', 'pagada', 'anulada'] as const).map((s) => (
            <button key={s} className={`chip${status === s ? ' is-active' : ''}`} onClick={() => setStatus(s)}>
              {{ todas: 'Todas', emitida: 'Pendientes', pagada: 'Pagadas', anulada: 'Anuladas' }[s]}
            </button>
          ))}
          <span className="input input--search input--chip">
            <input placeholder="Buscar número, cliente o proyecto…" value={q} onChange={(e) => setQ(e.target.value)} />
          </span>
          <DateFilter value={range} onChange={setRange} />
        </div>
        <Link className="btn btn--primary btn--sm" to="/facturacion/nueva">
          + Nueva cuenta de cobro
        </Link>
      </div>
      {shown.length > 0 && (
        <p className="list-total">
          {shown.length} {shown.length === 1 ? 'cuenta de cobro' : 'cuentas de cobro'} ·{' '}
          <strong>{formatMoney(shown.filter((i) => i.status !== 'anulada').reduce((n, i) => n + i.totalCop, 0))}</strong>
          {shown.some((i) => i.status === 'anulada') ? ' (sin anuladas)' : ''}
        </p>
      )}
      {shown.length ? (
        <div className="table card">
          <div className="table__row table__row--head cc-row">
            <span>Número</span>
            <span>Cliente</span>
            <span>Fecha</span>
            <span>Total</span>
            <span>Estado</span>
          </div>
          {shown.map((i) => (
            <Link key={i.id} to={`/cuentas-de-cobro/${i.id}`} className={`table__row cc-row${i.status === 'anulada' ? ' is-void' : ''}`}>
              <span className="mono">
                <strong>{i.number}</strong>
              </span>
              <span>
                {i.clientName}
                {i.projectName && <small>{i.projectName}</small>}
              </span>
              <span className="mono">{docDate(i.date)}</span>
              <span className="mono">
                {formatMoney(i.totalCop)}
                {i.currency === 'USD' && <small>{formatMoney(i.total, 'USD')}</small>}
              </span>
              <span className="cc-row__state">
                <InvoiceStatus i={i} />
                {i.sentAt && i.status !== 'anulada' && <small>Enviada</small>}
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <Empty>{q || status !== 'todas' || range.mode !== 'todas' ? 'Ninguna cuenta de cobro coincide.' : 'Todavía no hay cuentas de cobro. Crea una o impórtalas de SmartBilling.'}</Empty>
      )}
    </section>
  );
}

function ReceiptsTab() {
  const { data, error, loading, reload, setData } = useApi<Receipt[]>('receipts');
  const [editing, setEditing] = useState<Receipt | 'new' | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const { ungroup } = useUngroup(() => reload());
  const [q, setQ] = useState('');
  const [range, setRange] = useState<DateRange>(emptyRange);
  const { busy, run } = useAction();
  const toast = useToast();
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (data ?? []).filter(
      (r) => inRange(r.date, range) && (!s || `${r.clientName} ${r.method} ${r.notes ?? ''} ${r.invoiceNumber ?? ''}`.toLowerCase().includes(s)),
    );
  }, [data, q, range]);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const list = data!;

  const remove = (r: Receipt) => {
    if (!confirm(`¿Borrar el abono de ${formatMoney(r.amountCop)} del ${docDate(r.date)}? También se borra el ingreso de tu Gestor financiero.`)) return;
    run(async () => {
      await api('DELETE', `receipts/${r.id}`);
      setData(list.filter((x) => x.id !== r.id));
      toast('Abono borrado.');
    });
  };

  return (
    <section className="section section--flush">
      <div className="toolbar">
        <div className="filters">
          <span className="input input--search input--chip">
            <input placeholder="Buscar cliente, medio o nota…" value={q} onChange={(e) => setQ(e.target.value)} />
          </span>
          <DateFilter value={range} onChange={setRange} />
        </div>
        <button className="btn btn--primary btn--sm" onClick={() => setEditing(editing ? null : 'new')}>
          {editing === 'new' ? 'Cerrar' : '+ Registrar abono'}
        </button>
      </div>
      {editing && (
        <ReceiptForm
          receipt={editing === 'new' ? undefined : editing}
          onCancel={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
      {selected.size > 0 && (
        <GroupBar
          items={list
            .filter((r) => selected.has(r.id))
            .map((r) => ({ receiptId: r.id, clientId: r.clientId ?? null, date: r.date, amountCop: r.amountCop, sendToFinance: r.sendToFinance !== false }))}
          onClear={() => setSelected(new Set())}
          onDone={() => {
            setSelected(new Set());
            reload();
          }}
        />
      )}
      {shown.length > 0 && (
        <p className="list-total">
          {shown.length} {shown.length === 1 ? 'abono' : 'abonos'} · <strong>{formatMoney(shown.reduce((n, r) => n + r.amountCop, 0))}</strong>
        </p>
      )}
      {shown.length ? (
        <div className="table card">
          <div className="table__row table__row--head rc-row">
            <span>Fecha</span>
            <span>Cliente</span>
            <span>Monto</span>
            <span>Medio · aplicado a</span>
            <span>Gestor</span>
            <span />
          </div>
          {shown.map((r) => (
            <Fragment key={r.id}>
            <div
              className={`table__row rc-row is-clickable${openId === r.id ? ' is-open' : ''}`}
              onClick={(e) => {
                // Los botones y enlaces de la fila hacen lo suyo; el resto abre el detalle.
                if ((e.target as HTMLElement).closest('a, button, input')) return;
                setOpenId(openId === r.id ? null : r.id);
              }}
            >
              <span className="mono rc-row__date">
                <input
                  type="checkbox"
                  className="rc-row__select"
                  aria-label="Seleccionar para unir en el Gestor"
                  title="Seleccionar para unir varios pagos en una sola entrada del Gestor"
                  checked={selected.has(r.id)}
                  onChange={(e) => {
                    const next = new Set(selected);
                    if (e.target.checked) next.add(r.id);
                    else next.delete(r.id);
                    setSelected(next);
                  }}
                />
                {docDate(r.date)}
              </span>
              <span>
                <Link to={`/clientes/${r.clientId}`}>{r.clientName}</Link>
                {r.notes && <small className="rc-row__notes">{r.notes}</small>}
              </span>
              <span className="mono">
                {formatMoney(r.amountCop)}
                {r.currency === 'USD' && <small>{formatMoney(r.amount, 'USD')}</small>}
              </span>
              <span>
                {r.method || '—'}
                {r.invoiceNumber && (
                  <small>
                    <Link to={`/cuentas-de-cobro/${r.invoiceId}`}>CC {r.invoiceNumber}</Link>
                  </small>
                )}
                {r.paymentId && <small>Cuota del plan de pagos</small>}
              </span>
              <span>
                {r.sendToFinance === false && r.sync !== 'error' ? (
                  <span className="sync sync--off" title="Este abono no se envía al Gestor financiero">No se envía</span>
                ) : r.sync === 'ok' ? (
                  <span className="sync sync--ok" title={r.group ? `Entrada unida de ${r.group.members.length} pagos` : undefined}>
                    ✓{r.group && <small className="tag tag--group">Unida</small>}
                  </span>
                ) : (
                  <button
                    className="linklike sync sync--error"
                    title={r.syncError ?? 'Sin registrar'}
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        const u = await api<Receipt>('POST', `receipts/${r.id}/sync`);
                        setData(list.map((x) => (x.id === u.id ? u : x)));
                        toast(u.sync === 'ok' ? 'Registrado en el Gestor.' : `No se pudo: ${u.syncError}`, u.sync !== 'ok');
                      })
                    }
                  >
                    ⚠ Reintentar
                  </button>
                )}
              </span>
              <span className="rc-row__actions">
                {!r.paymentId && (
                  <>
                    <button className="icon-btn" onClick={() => setEditing(r)} aria-label="Editar abono" title="Editar">
                      ✎
                    </button>
                    <button className="icon-btn icon-btn--danger" disabled={busy} onClick={() => remove(r)} aria-label="Borrar abono" title="Borrar">
                      ✕
                    </button>
                  </>
                )}
                <button
                  className="icon-btn rc-row__toggle"
                  aria-expanded={openId === r.id}
                  aria-label={openId === r.id ? 'Cerrar detalle' : 'Ver detalle del pago'}
                  title={openId === r.id ? 'Cerrar detalle' : 'Ver detalle del pago'}
                  onClick={() => setOpenId(openId === r.id ? null : r.id)}
                >
                  ▾
                </button>
              </span>
            </div>
            {openId === r.id && <ReceiptDetail r={r} onUngroup={ungroup} onEdit={r.paymentId ? undefined : () => { setEditing(r); setTimeout(() => document.querySelector('.receipt-form')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50); }} />}
            </Fragment>
          ))}
        </div>
      ) : (
        <Empty>{q || range.mode !== 'todas' ? 'Ningún abono coincide.' : 'Todavía no hay abonos.'}</Empty>
      )}
    </section>
  );
}

/** Facturación: cuentas de cobro, abonos, reportes e importación (solo administrador). */
export function BillingPage() {
  const { query } = useLocation();
  const t = query.get('tab') as Tab | null;
  const tab: Tab = t && t in TABS ? t : 'cuentas';
  return (
    <>
      <PageHead eyebrow="Facturación" title={<>Cuentas de cobro <span className="grad">y abonos</span></>}>
        <p>Lo que antes vivía en SmartBilling. Cada abono queda como ingreso en tu Gestor financiero.</p>
      </PageHead>
      <div className="tabs" role="tablist">
        {(Object.keys(TABS) as Tab[]).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'is-active' : ''} onClick={() => navigate(`/facturacion?tab=${k}`, true)}>
            {TABS[k]}
          </button>
        ))}
      </div>
      {tab === 'cuentas' && <InvoicesTab />}
      {tab === 'abonos' && <ReceiptsTab />}
      {tab === 'reportes' && <ReportsTab />}
      {tab === 'importar' && <ImportTab />}
    </>
  );
}
