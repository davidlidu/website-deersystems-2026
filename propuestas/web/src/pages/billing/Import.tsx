import { useRef, useState } from 'react';
import { api, formatMoney } from '../../lib';
import { Link, useAction, useToast } from '../../ui';

interface Preview {
  id: string;
  source: string;
  totals: {
    clients: number;
    invoices: number;
    items: number;
    payments: number;
    invoiced: number;
    paid: number;
    alreadyImported: { invoices: number; payments: number };
  };
  clients: {
    sbId: string;
    name: string;
    docNumber: string;
    city: string;
    invoices: number;
    invoiced: number;
    payments: number;
    paid: number;
    suggestion: { clientId: number; how: 'importado' | 'documento' | 'nombre' | 'parecido' } | null;
  }[];
  portalClients: { id: number; name: string; docNumber: string; email: string | null }[];
  problems: string[];
  profile: { name: string; nit: string; current: boolean } | null;
}

interface Result {
  created: { clients: number; linked: number; invoices: number; receipts: number; skipped: number; refreshed: number };
  ok: boolean;
  nextNumber: string;
  reconciliation: {
    sbId: string;
    name: string;
    clientId: number | null;
    sb: { invoiced: number; paid: number; balance: number };
    portal: { invoiced: number; paid: number; balance: number };
    ok: boolean;
  }[];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const HOW = { importado: 'ya importado', documento: 'mismo NIT/CC', nombre: 'mismo nombre', parecido: 'nombre parecido: revisa' };

/** Migración desde SmartBilling: leer → revisar coincidencias → importar → cuadre. */
export function ImportTab() {
  const [url, setUrl] = useState('https://api.facturador.lidutech.net/api');
  const [token, setToken] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [matches, setMatches] = useState<Record<string, string>>({});
  const [profile, setProfile] = useState(true);
  const [refreshItems, setRefreshItems] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const { busy, run } = useAction();
  const toast = useToast();

  const load = (p: Preview) => {
    setPreview(p);
    setResult(null);
    setMatches(Object.fromEntries(p.clients.map((c) => [c.sbId, c.suggestion ? String(c.suggestion.clientId) : 'new'])));
    setProfile(!!p.profile && !p.profile.current);
  };

  const read = () => run(async () => load(await api<Preview>('POST', 'import/smartbilling/preview', { url, token })));

  const upload = (f: File) =>
    run(async () => {
      const res = await fetch('/api/import/smartbilling/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: await f.text() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
      load(data as Preview);
    });

  const apply = () => {
    const p = preview!;
    const fresh = p.clients.filter((c) => matches[c.sbId] === 'new').length;
    if (!confirm(`¿Importar ${p.totals.invoices} cuentas de cobro y ${p.totals.payments} abonos? Se crean ${fresh} clientes nuevos y se unen ${p.clients.length - fresh} a clientes que ya existen.`)) return;
    run(async () => {
      const r = await api<Result>('POST', 'import/smartbilling/apply', { id: p.id, matches: Object.fromEntries(Object.entries(matches).map(([k, v]) => [k, v === 'new' ? 'new' : Number(v)])), profile, refreshItems });
      setResult(r);
      toast(r.ok ? 'Importación completa: todo cuadra.' : 'Importado, pero hay diferencias: revisa el cuadre.', !r.ok);
    });
  };

  return (
    <section className="section section--flush import">
      <div className="card form-section">
        <h2>1. Leer los datos de SmartBilling</h2>
        <p className="hint">
          Se leen clientes, cuentas de cobro con sus ítems, pagos y tu perfil de remitente. Nada se guarda hasta que confirmes, y repetir la importación no
          duplica nada.
        </p>
        <div className="form-grid">
          <label className="field">
            <span className="field__label">URL de la API</span>
            <span className="input">
              <input value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} />
            </span>
          </label>
          <label className="field">
            <span className="field__label">Token (si ya protegiste la API)</span>
            <span className="input">
              <input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
            </span>
          </label>
        </div>
        <div className="actions actions--tight">
          <button className="btn btn--primary btn--sm" disabled={busy} onClick={read}>
            {busy && !preview ? 'Leyendo…' : 'Leer datos'}
          </button>
          <button className="btn btn--outline btn--sm" disabled={busy} onClick={() => file.current?.click()}>
            O subir un JSON exportado
          </button>
          <input
            ref={file}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      {preview && !result && (
        <>
          <div className="card form-section">
            <h2>2. Revisa</h2>
            <div className="kpis">
              {(
                [
                  ['Clientes', preview.totals.clients],
                  ['Cuentas de cobro', `${preview.totals.invoices} (${preview.totals.items} ítems)`],
                  ['Facturado', formatMoney(preview.totals.invoiced)],
                  ['Pagos', `${preview.totals.payments} · ${formatMoney(preview.totals.paid)}`],
                ] as [string, string | number][]
              ).map(([k, v]) => (
                <div key={k} className="kpi card">
                  <small>{k}</small>
                  <strong>{v}</strong>
                </div>
              ))}
            </div>
            {(preview.totals.alreadyImported.invoices > 0 || preview.totals.alreadyImported.payments > 0) && (
              <p className="callout">
                Ya se importaron antes {preview.totals.alreadyImported.invoices} cuentas de cobro y {preview.totals.alreadyImported.payments} pagos: esos se saltan.
              </p>
            )}
            {preview.problems.length > 0 && (
              <ul className="alert-list">
                {preview.problems.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            )}
            <h3 className="subhead">Clientes</h3>
            <p className="hint">
              Elige si cada cliente de SmartBilling es uno que ya tienes aquí o uno nuevo. Los nuevos quedan solo para facturación, sin acceso al portal; se lo das
              cuando quieras desde su ficha.
            </p>
            <div className="table card">
              <div className="table__row table__row--head import-row">
                <span>En SmartBilling</span>
                <span>Movimientos</span>
                <span>Aquí será</span>
              </div>
              {preview.clients.map((c) => (
                <div key={c.sbId} className={`table__row import-row${c.suggestion?.how === 'parecido' ? ' is-doubt' : ''}`}>
                  <span>
                    <strong>{c.name}</strong>
                    <small>
                      {[c.docNumber, c.city].filter(Boolean).join(' · ')}
                      {c.suggestion && ` · ${HOW[c.suggestion.how]}`}
                    </small>
                  </span>
                  <span className="mono">
                    {c.invoices} CC · {formatMoney(c.invoiced)}
                    <small>
                      {c.payments} pagos · {formatMoney(c.paid)}
                    </small>
                  </span>
                  <span className="input">
                    <select value={matches[c.sbId]} onChange={(e) => setMatches({ ...matches, [c.sbId]: e.target.value })} disabled={c.suggestion?.how === 'importado'}>
                      <option value="new">Cliente nuevo</option>
                      {preview.portalClients.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                          {p.email ? ` · ${p.email}` : ''}
                        </option>
                      ))}
                    </select>
                  </span>
                </div>
              ))}
            </div>
            {preview.totals.alreadyImported.invoices > 0 && (
              <label className="check">
                <input type="checkbox" checked={refreshItems} onChange={(e) => setRefreshItems(e.target.checked)} />
                Volver a traer los ítems de las {preview.totals.alreadyImported.invoices} cuentas de cobro ya importadas (recupera tablas y formato; no cambia
                totales ni abonos)
              </label>
            )}
            {preview.profile && (
              <label className="check">
                <input type="checkbox" checked={profile} onChange={(e) => setProfile(e.target.checked)} />
                Usar el perfil de remitente de SmartBilling ({preview.profile.name}
                {preview.profile.nit ? ` · ${preview.profile.nit}` : ''}): datos, cuenta bancaria, logo y firma
                {preview.profile.current ? '. Reemplaza el que ya tienes' : ''}
              </label>
            )}
          </div>
          <div className="card form-section confirm">
            <h2>3. Importar</h2>
            <p className="hint">
              Los totales en pesos de cada cuenta de cobro, los pagos y sus referencias en el Gestor financiero quedan tal cual: los reportes y el Gestor no cambian. Los
              pagos siguen ligados al cliente, como en SmartBilling.
            </p>
            <button className="btn btn--primary" disabled={busy} onClick={apply}>
              {busy ? 'Importando…' : 'Importar'}
            </button>
          </div>
        </>
      )}

      {result && (
        <div className="card form-section">
          <h2>{result.ok ? '✓ Importación completa: todo cuadra' : '⚠ Importado con diferencias'}</h2>
          <p>
            {plural(result.created.clients, 'cliente nuevo', 'clientes nuevos')}, {plural(result.created.linked, 'unido', 'unidos')} a clientes existentes,{' '}
            {plural(result.created.invoices, 'cuenta de cobro', 'cuentas de cobro')} y {plural(result.created.receipts, 'abono', 'abonos')}{result.created.refreshed ? ` · ${plural(result.created.refreshed, 'cuenta de cobro con ítems actualizados', 'cuentas de cobro con ítems actualizados')}` : ''}
            {result.created.skipped ? ` (${result.created.skipped} ya estaban o se saltaron)` : ''}. La próxima cuenta de cobro será la{' '}
            <strong>{result.nextNumber}</strong>.
          </p>
          <div className="table card">
            <div className="table__row table__row--head recon-row">
              <span>Cliente</span>
              <span>SmartBilling (facturado · pagado · saldo)</span>
              <span>Partners</span>
              <span />
            </div>
            {result.reconciliation.map((r) => (
              <div key={r.sbId} className="table__row recon-row">
                <span>{r.clientId ? <Link to={`/clientes/${r.clientId}`}>{r.name}</Link> : r.name}</span>
                <span className="mono">
                  {formatMoney(r.sb.invoiced)} · {formatMoney(r.sb.paid)} · {formatMoney(r.sb.balance)}
                </span>
                <span className="mono">
                  {formatMoney(r.portal.invoiced)} · {formatMoney(r.portal.paid)} · {formatMoney(r.portal.balance)}
                </span>
                <span>{r.ok ? <span className="sync sync--ok">✓</span> : <span className="sync sync--error">⚠</span>}</span>
              </div>
            ))}
          </div>
          <h3 className="subhead">Para terminar el cambio</h3>
          <ol className="steps">
            <li>
              En Dokploy, quita <code>GESTOR_API_URL</code> y <code>GESTOR_SERVICE_KEY</code> del backend de SmartBilling: así no vuelve a escribir en el Gestor.
            </li>
            <li>Deja SmartBilling en solo lectura uno o dos meses, por si necesitas comparar; luego apágalo (guarda antes un respaldo de su base).</li>
            <li>
              Desde ahora, las cuentas de cobro y los abonos se registran aquí, en <Link to="/facturacion">Facturación</Link>.
            </li>
          </ol>
        </div>
      )}
    </section>
  );
}
