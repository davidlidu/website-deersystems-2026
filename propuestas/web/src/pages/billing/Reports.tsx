import { useMemo, useState } from 'react';
import { docDate, formatMoney, today, useApi, type InvoiceSummary } from '../../lib';
import { ErrorBox, Link, Loading } from '../../ui';

interface ReportData {
  invoices: InvoiceSummary[];
  receipts: { id: number; clientId: number; date: string; amountCop: number }[];
  clients: { id: number; name: string; docNumber: string; city: string; phone: string }[];
}

const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
// Los años y meses salen de la fecha tal cual (AAAA-MM-DD), sin pasar por zonas horarias.
const yearOf = (d: string) => Number(d.slice(0, 4));
const monthOf = (d: string) => Number(d.slice(5, 7)) - 1;

const PERIODS = [
  ['day', 'Hoy'],
  ['week', 'Última semana'],
  ['month', 'Último mes'],
  ['3months', 'Últimos 3 meses'],
  ['6months', 'Últimos 6 meses'],
  ['year', 'Último año'],
  ['custom', 'Personalizado'],
] as const;
type Period = (typeof PERIODS)[number][0];

/** Mismos períodos que el exportador de SmartBilling. */
function rangeOf(p: Period, from: string, to: string) {
  if (p === 'custom') return { from, to };
  const end = today();
  const d = new Date(`${end}T12:00:00`);
  if (p === 'week') d.setDate(d.getDate() - 6);
  if (p === 'month') d.setMonth(d.getMonth() - 1);
  if (p === '3months') d.setMonth(d.getMonth() - 3);
  if (p === '6months') d.setMonth(d.getMonth() - 6);
  if (p === 'year') d.setFullYear(d.getFullYear() - 1);
  return { from: d.toLocaleDateString('en-CA'), to: end };
}

/** CSV como el de SmartBilling: período, cantidad, una fila por cuenta de cobro y el total. */
function exportCsv(list: InvoiceSummary[], range: { from: string; to: string }, hint: string) {
  const cell = (v: string | number) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const total = list.reduce((n, i) => n + i.totalCop, 0);
  const lines = [
    `Período,${cell(`${range.from || '—'} a ${range.to || '—'}`)}`,
    `Cuentas de cobro,${list.length}`,
    '',
    ['Cuenta de cobro #', 'Cliente', 'Fecha', 'Total'].map(cell).join(','),
    ...list.map((i) => [i.number, i.clientName, docDate(i.date), i.totalCop].map(cell).join(',')),
    '',
    `${cell('Total general')},,,${cell(total)}`,
  ];
  const blob = new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `cuentas-de-cobro-${hint}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Reportes: las mismas cifras que SmartBilling (facturado, pagado, saldo, por mes y por cliente). */
export function ReportsTab() {
  const { data, error, loading, reload } = useApi<ReportData>('billing/report');
  const [year, setYear] = useState(Number(today().slice(0, 4)));
  const [clientId, setClientId] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [period, setPeriod] = useState<Period>('month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const r = useMemo(() => {
    if (!data) return null;
    const inv = clientId ? data.invoices.filter((i) => i.clientId === clientId) : data.invoices;
    const pay = clientId ? data.receipts.filter((p) => p.clientId === clientId) : data.receipts;
    const invYear = inv.filter((i) => yearOf(i.date) === year);
    const payYear = pay.filter((p) => yearOf(p.date) === year);
    const billed = Array(12).fill(0) as number[];
    const paid = Array(12).fill(0) as number[];
    const count = Array(12).fill(0) as number[];
    invYear.forEach((i) => {
      billed[monthOf(i.date)] += i.totalCop;
      count[monthOf(i.date)]++;
    });
    payYear.forEach((p) => (paid[monthOf(p.date)] += p.amountCop));
    // Los mejores clientes, como en SmartBilling: siempre sobre todo lo facturado, sin filtro.
    const byClient = new Map<number, number>();
    data.invoices.forEach((i) => byClient.set(i.clientId, (byClient.get(i.clientId) ?? 0) + i.totalCop));
    const top = [...byClient.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const totalBilled = inv.reduce((n, i) => n + i.totalCop, 0);
    const totalPaid = pay.reduce((n, p) => n + p.amountCop, 0);
    const years = [...new Set(data.invoices.map((i) => yearOf(i.date)))].sort((a, b) => b - a);
    if (!years.includes(year)) years.unshift(year);
    return {
      billed,
      paid,
      count,
      top,
      years,
      totalBilled,
      totalPaid,
      pending: Math.max(0, totalBilled - totalPaid),
      billedYear: invYear.reduce((n, i) => n + i.totalCop, 0),
      paidYear: payYear.reduce((n, p) => n + p.amountCop, 0),
      max: Math.max(...billed, ...paid, 1),
    };
  }, [data, clientId, year]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const d = data!;
  const x = r!;
  const client = d.clients.find((c) => c.id === clientId);
  const name = (id: number) => d.clients.find((c) => c.id === id)?.name ?? '—';
  const range = rangeOf(period, from, to);
  const toExport = d.invoices
    .filter((i) => (!range.from || i.date >= range.from) && (!range.to || i.date <= range.to) && (!clientId || i.clientId === clientId))
    .sort((a, b) => a.date.localeCompare(b.date));

  return (
    <section className="section section--flush report">
      <div className="toolbar">
        <div className="filters">
          <span className="input input--chip">
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Año">
              {x.years.map((y) => (
                <option key={y}>{y}</option>
              ))}
            </select>
          </span>
          <span className="input input--chip">
            <select value={clientId} onChange={(e) => setClientId(Number(e.target.value))} aria-label="Cliente">
              <option value={0}>Todos los clientes</option>
              {d.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </span>
        </div>
        <button className="btn btn--outline btn--sm" onClick={() => setExporting(!exporting)}>
          Exportar
        </button>
      </div>

      {exporting && (
        <div className="card form-section">
          <h2>Exportar cuentas de cobro (CSV)</h2>
          <div className="filters">
            {PERIODS.map(([k, label]) => (
              <button key={k} className={`chip${period === k ? ' is-active' : ''}`} onClick={() => setPeriod(k)}>
                {label}
              </button>
            ))}
          </div>
          {period === 'custom' && (
            <div className="form-grid">
              <label className="field">
                <span className="field__label">Desde</span>
                <span className="input">
                  <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                </span>
              </label>
              <label className="field">
                <span className="field__label">Hasta</span>
                <span className="input">
                  <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                </span>
              </label>
            </div>
          )}
          <p className="hint">
            {toExport.length} cuentas de cobro · {formatMoney(toExport.reduce((n, i) => n + i.totalCop, 0))}
            {client ? ` · ${client.name}` : ''}
          </p>
          <button
            className="btn btn--primary btn--sm"
            disabled={!toExport.length || (period === 'custom' && (!from || !to))}
            onClick={() => exportCsv(toExport, range, `${PERIODS.find((p) => p[0] === period)![1]}${client ? `-${client.name}` : ''}`.replace(/\s+/g, '-'))}
          >
            Descargar CSV
          </button>
        </div>
      )}

      {client && (
        <p className="hint">
          {client.docNumber && `NIT/CC: ${client.docNumber} · `}
          {client.city && `Ciudad: ${client.city} · `}
          {client.phone && `Teléfono: ${client.phone} · `}
          <Link to={`/clientes/${client.id}`}>Ver ficha</Link>
        </p>
      )}

      <div className="kpis">
        <div className="kpi card">
          <small>Facturado total</small>
          <strong>{formatMoney(x.totalBilled)}</strong>
          <span>
            {year}: {formatMoney(x.billedYear)}
          </span>
        </div>
        <div className="kpi card">
          <small>Total pagado</small>
          <strong>{formatMoney(x.totalPaid)}</strong>
          <span>
            {year}: {formatMoney(x.paidYear)}
          </span>
        </div>
        <div className="kpi card">
          <small>Saldo pendiente</small>
          <strong>{formatMoney(x.pending)}</strong>
          <span>por cobrar</span>
        </div>
        <div className="kpi card">
          <small>{clientId ? 'Cliente' : 'Clientes'}</small>
          <strong>{clientId ? 1 : d.clients.length}</strong>
          <span>{client ? client.name : 'registrados'}</span>
        </div>
      </div>

      <div className="card chart">
        <div className="chart__head">
          <h3>Facturado y pagado por mes · {year}</h3>
          <span className="chart__legend">
            <i className="sw sw--billed" /> Facturado <i className="sw sw--paid" /> Pagado
          </span>
        </div>
        <div className="bars" role="img" aria-label={`Facturado y pagado por mes en ${year}. Los valores están en la tabla de abajo.`}>
          {MONTHS.map((m, i) => (
            <div
              key={m}
              className={`bars__month${hover === i ? ' is-hover' : ''}`}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              tabIndex={0}
            >
              <div className="bars__plot">
                <span className="bars__bar bars__bar--billed" style={{ height: `${(x.billed[i] / x.max) * 100}%` }} />
                <span className="bars__bar bars__bar--paid" style={{ height: `${(x.paid[i] / x.max) * 100}%` }} />
              </div>
              <span className="bars__label">{m}</span>
              {hover === i && (
                <div className="bars__tip" role="tooltip">
                  <strong>
                    {m} {year}
                  </strong>
                  <span>
                    <i className="sw sw--billed" /> Facturado {formatMoney(x.billed[i])}
                  </span>
                  <span>
                    <i className="sw sw--paid" /> Pagado {formatMoney(x.paid[i])}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="report__grid">
        <div className="card chart">
          <div className="chart__head">
            <h3>Mejores clientes</h3>
            <span className="hint">Por lo facturado, histórico</span>
          </div>
          {x.top.length ? (
            <ol className="hbars">
              {x.top.map(([id, total]) => (
                <li key={id}>
                  <button className="linklike" onClick={() => setClientId(id)} title="Filtrar por este cliente">
                    {name(id)}
                  </button>
                  <span className="hbars__track">
                    <span style={{ width: `${(total / x.top[0][1]) * 100}%` }} />
                  </span>
                  <span className="mono">{formatMoney(total)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="hint">Sin datos.</p>
          )}
        </div>

        <div className="card chart">
          <div className="chart__head">
            <h3>Detalle mensual · {year}</h3>
          </div>
          <div className="table report__table">
            <div className="table__row table__row--head">
              <span>Mes</span>
              <span>Cuentas</span>
              <span>Facturado</span>
              <span>Pagado</span>
              <span>Pendiente</span>
            </div>
            {MONTHS.map((m, i) =>
              x.count[i] || x.paid[i] ? (
                <div key={m} className="table__row">
                  <span>{m}</span>
                  <span className="mono">{x.count[i]}</span>
                  <span className="mono">{formatMoney(x.billed[i])}</span>
                  <span className="mono">{formatMoney(x.paid[i])}</span>
                  <span className="mono">{formatMoney(Math.max(0, x.billed[i] - x.paid[i]))}</span>
                </div>
              ) : null,
            )}
            <div className="table__row table__row--total">
              <span>Total</span>
              <span className="mono">{x.count.reduce((a, b) => a + b, 0)}</span>
              <span className="mono">{formatMoney(x.billedYear)}</span>
              <span className="mono">{formatMoney(x.paidYear)}</span>
              <span className="mono">{formatMoney(Math.max(0, x.billedYear - x.paidYear))}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
