import { useEffect, useMemo, useState } from 'react';
import {
  addDays,
  api,
  formatMoney,
  formatTrm,
  hasText,
  navigate,
  today,
  useApi,
  useLocation,
  type BillingProfile,
  type Currency,
  type InvoiceDetail,
  type Payment,
  type ProjectSummary,
} from '../../lib';
import { ErrorBox, Link, Loading, PageHead, useAction, useToast } from '../../ui';
import { Choice } from './Choice';
import { RichText } from './RichText';

interface ClientOption {
  id: number;
  name: string;
  doc_number?: string;
  email: string | null;
}

interface Item {
  key: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
}

const key = () => Math.random().toString(36).slice(2);
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const emptyItem = (): Item => ({ key: key(), description: '', quantity: '1', unit: 'UND', unitPrice: '' });
const UNITS = ['UND', 'Servicio', 'Hora', 'Mes', 'Proyecto', 'Licencia'];

/** Cliente nuevo solo de facturación (sin acceso al portal), desde el mismo formulario. */
function QuickClient({ onCreated, onCancel }: { onCreated: (c: ClientOption) => void; onCancel: () => void }) {
  const [f, setF] = useState({ name: '', docType: 'NIT', docNumber: '', city: '', address: '', phone: '', email: '' });
  const { busy, run } = useAction();
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  return (
    <div className="quick-client">
      <div className="form-grid">
        {(
          [
            ['name', 'Nombre o razón social'],
            ['docNumber', 'NIT / CC'],
            ['city', 'Ciudad'],
            ['address', 'Dirección'],
            ['phone', 'Teléfono'],
            ['email', 'Correo (opcional)'],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="field">
            <span className="field__label">{label}</span>
            <span className="input">
              {k === 'docNumber' ? (
                <>
                  <select value={f.docType} onChange={(e) => set({ docType: e.target.value })} aria-label="Tipo de documento" className="input__prefix">
                    {['NIT', 'CC', 'CE', 'Pasaporte'].map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                  <input value={f.docNumber} onChange={(e) => set({ docNumber: e.target.value })} />
                </>
              ) : (
                <input value={f[k]} onChange={(e) => set({ [k]: e.target.value })} type={k === 'email' ? 'email' : 'text'} />
              )}
            </span>
          </label>
        ))}
      </div>
      <div className="actions actions--tight">
        <button
          className="btn btn--primary btn--sm"
          disabled={busy || !f.name.trim()}
          onClick={() => run(async () => onCreated(await api<ClientOption>('POST', 'clients', f)))}
        >
          Crear cliente
        </button>
        <button className="btn btn--outline btn--sm" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

/** Crear o editar una cuenta de cobro. Desde una cuota del plan de pagos llega ya armada. */
export function InvoiceFormPage({ id }: { id?: number }) {
  const { query } = useLocation();
  const profile = useApi<BillingProfile>('billing/profile');
  const clients = useApi<ClientOption[]>('clients');
  const existing = useApi<InvoiceDetail>(id ? `invoices/${id}` : null);
  const nextNumber = useApi<{ number: string }>(id ? null : 'invoices/next-number');
  const [ready, setReady] = useState(false);
  const [clientId, setClientId] = useState(Number(query.get('cliente')) || 0);
  const [projectId, setProjectId] = useState(Number(query.get('proyecto')) || 0);
  const paymentId = Number(query.get('cuota')) || null;
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ number: '', date: today(), dueDate: '', currency: 'COP' as Currency, exchangeRate: '', notes: '' });
  const [items, setItems] = useState<Item[]>([emptyItem()]);
  const projects = useApi<{ projects: ProjectSummary[] }>(clientId ? `clients/${clientId}` : null);
  const { busy, run } = useAction();
  const toast = useToast();
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));

  // Valores iniciales: la cuenta de cobro que se edita, o una nueva (número siguiente, notas por defecto, cuota).
  useEffect(() => {
    if (ready || !profile.data) return;
    if (id) {
      const e = existing.data;
      if (!e) return;
      setClientId(e.clientId);
      setProjectId(e.projectId ?? 0);
      setF({ number: e.number, date: e.date, dueDate: e.dueDate ?? '', currency: e.currency, exchangeRate: e.exchangeRate ? String(e.exchangeRate) : '', notes: e.notes });
      setItems(e.items.map((it) => ({ key: key(), description: it.description, quantity: String(it.quantity), unit: it.unit, unitPrice: String(it.unitPrice) })));
      setReady(true);
      return;
    }
    if (!nextNumber.data) return;
    const p = profile.data;
    setF((x) => ({ ...x, number: nextNumber.data!.number, notes: p.defaultNotes, dueDate: p.defaultDueDays ? addDays(x.date, p.defaultDueDays) : '' }));
    const projectQ = Number(query.get('proyecto'));
    if (paymentId && projectQ) {
      api<{ payments: Payment[] }>('GET', `projects/${projectQ}/payments`)
        .then(async ({ payments }) => {
          const cuota = payments.find((x) => x.id === paymentId);
          if (!cuota) return;
          const proj = await api<{ name: string }>('GET', `projects/${projectQ}`);
          setItems([
            {
              key: key(),
              description: `<p><strong>${esc(proj.name)}</strong></p><p>${esc(cuota.label)}${cuota.percent ? ` (${cuota.percent}%)` : ''}</p>`,
              quantity: '1',
              unit: 'Servicio',
              unitPrice: String(cuota.amount),
            },
          ]);
          setF((x) => ({ ...x, currency: cuota.currency, dueDate: cuota.dueDate ?? x.dueDate }));
        })
        .catch(() => {});
    }
    setReady(true);
  }, [ready, id, existing.data, nextNumber.data, profile.data, paymentId, query]);

  // TRM oficial de la fecha (se puede corregir).
  useEffect(() => {
    if (f.currency !== 'USD' || f.exchangeRate || !ready) return;
    api<{ trm: number | null }>('GET', `trm?date=${f.date}`)
      .then((r) => r.trm && set({ exchangeRate: String(r.trm) }))
      .catch(() => {});
  }, [f.currency, f.date, f.exchangeRate, ready]);

  const total = useMemo(() => items.reduce((n, it) => n + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0), 0), [items]);
  const totalCop = f.currency === 'USD' ? Math.round(total * (Number(f.exchangeRate) || 0)) : total;

  if (profile.error || clients.error || existing.error) return <ErrorBox message={(profile.error ?? clients.error ?? existing.error)!} />;
  if (!ready) return <Loading />;

  const setItem = (k: string, patch: Partial<Item>) => setItems((list) => list.map((it) => (it.key === k ? { ...it, ...patch } : it)));
  const clientList = clients.data ?? [];
  const client = clientList.find((c) => c.id === clientId);

  const save = () => {
    if (!clientId) return toast('Elige el cliente.', true);
    if (items.some((it) => !hasText(it.description))) return toast('Cada ítem necesita una descripción.', true);
    run(async () => {
      const body = {
        clientId,
        projectId: projectId || null,
        paymentId,
        number: f.number,
        date: f.date,
        dueDate: f.dueDate || null,
        currency: f.currency,
        exchangeRate: f.currency === 'USD' ? Number(f.exchangeRate) : null,
        notes: f.notes,
        items: items.map((it) => ({ description: it.description, quantity: Number(it.quantity), unit: it.unit, unitPrice: Number(it.unitPrice) || 0 })),
      };
      const saved = await api<InvoiceDetail>(id ? 'PUT' : 'POST', id ? `invoices/${id}` : 'invoices', body);
      toast(id ? 'Cuenta de cobro actualizada.' : `Cuenta de cobro ${saved.number} creada.`);
      navigate(`/cuentas-de-cobro/${saved.id}`);
    });
  };

  return (
    <>
      <div className="crumbs">
        <Link to="/facturacion">Facturación</Link> / {id ? `Cuenta de cobro ${f.number}` : 'Nueva cuenta de cobro'}
      </div>
      <PageHead eyebrow="Facturación" title={id ? `Editar cuenta de cobro ${f.number}` : 'Nueva cuenta de cobro'}>
        {!profile.data!.name && (
          <p className="callout">
            Completa tus datos de emisor (nombre, documento, datos bancarios, firma) en <Link to="/configuracion?tab=finanzas">Configuración → Finanzas</Link>.
          </p>
        )}
      </PageHead>

      <div className="page-stack">
      <section className="card form-section">
        <h2>Cliente</h2>
        <div className="form-grid">
          <label className="field">
            <span className="field__label">Cliente</span>
            <span className="input">
              <select
                value={clientId}
                onChange={(e) => {
                  setClientId(Number(e.target.value));
                  setProjectId(0);
                }}
              >
                <option value={0}>Elige el cliente…</option>
                {clientList.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.doc_number ? ` · ${c.doc_number}` : ''}
                  </option>
                ))}
              </select>
            </span>
          </label>
          <label className="field">
            <span className="field__label">Proyecto (opcional)</span>
            <span className="input">
              <select value={projectId} onChange={(e) => setProjectId(Number(e.target.value))} disabled={!clientId}>
                <option value={0}>Sin proyecto</option>
                {(projects.data?.projects ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </span>
          </label>
        </div>
        {!adding ? (
          <button className="linklike" onClick={() => setAdding(true)}>
            + Cliente nuevo (solo facturación)
          </button>
        ) : (
          <QuickClient
            onCancel={() => setAdding(false)}
            onCreated={(c) => {
              clients.setData([...clientList, c]);
              setClientId(c.id);
              setAdding(false);
              toast('Cliente creado.');
            }}
          />
        )}
        {client && (
          <p className="hint">
            Los datos que salen en la cuenta de cobro (NIT/CC, dirección, ciudad) se editan en la <Link to={`/clientes/${client.id}`}>ficha del cliente</Link>.
          </p>
        )}
      </section>

      <section className="card form-section">
        <h2>Datos</h2>
        <div className="form-grid">
          <label className="field">
            <span className="field__label">Número</span>
            <span className="input">
              <input value={f.number} onChange={(e) => set({ number: e.target.value })} />
            </span>
          </label>
          <label className="field">
            <span className="field__label">Fecha</span>
            <span className="input">
              <input type="date" value={f.date} onChange={(e) => set({ date: e.target.value, ...(f.currency === 'USD' && !id ? { exchangeRate: '' } : {}) })} />
            </span>
          </label>
          <label className="field">
            <span className="field__label">Fecha límite de pago (opcional)</span>
            <span className="input">
              <input type="date" value={f.dueDate} min={f.date} onChange={(e) => set({ dueDate: e.target.value })} />
            </span>
          </label>
          <label className="field">
            <span className="field__label">Moneda</span>
            <span className="input">
              <select value={f.currency} onChange={(e) => set({ currency: e.target.value as Currency, exchangeRate: '' })}>
                <option value="COP">COP (pesos)</option>
                <option value="USD">USD (dólares)</option>
              </select>
            </span>
          </label>
          {f.currency === 'USD' && (
            <label className="field">
              <span className="field__label">TRM del día (COP por 1 USD)</span>
              <span className="input">
                <input inputMode="decimal" value={f.exchangeRate} onChange={(e) => set({ exchangeRate: e.target.value })} />
              </span>
            </label>
          )}
        </div>
      </section>

      <section className="card form-section">
        <div className="form-section__head">
          <h2>Ítems</h2>
          <span className="mono">{items.length}</span>
        </div>
        <div className="cc-items">
          <div className="cc-items__head" aria-hidden="true">
            <span>Descripción</span>
            <span>Cantidad</span>
            <span>Unidad</span>
            <span>Vr. unitario ({f.currency})</span>
            <span>Vr. total</span>
            <span />
          </div>
          {items.map((it, i) => (
            <div key={it.key} className="cc-items__row">
              <RichText label={`Descripción del ítem ${i + 1}`} value={it.description} onChange={(html) => setItem(it.key, { description: html })} placeholder="Qué se cobra" />
              <span className="input">
                <input inputMode="decimal" value={it.quantity} onChange={(e) => setItem(it.key, { quantity: e.target.value })} aria-label="Cantidad" />
              </span>
              <Choice label="Unidad" value={it.unit} options={UNITS} onChange={(unit) => setItem(it.key, { unit })} />
              <span className="input">
                <input inputMode="decimal" value={it.unitPrice} onChange={(e) => setItem(it.key, { unitPrice: e.target.value })} aria-label="Valor unitario" />
              </span>
              <span className="mono cc-items__sum">{formatMoney((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0), f.currency)}</span>
              <button className="icon-btn icon-btn--danger" disabled={items.length === 1} onClick={() => setItems((l) => l.filter((x) => x.key !== it.key))} aria-label="Quitar ítem" title="Quitar">
                ✕
              </button>
            </div>
          ))}
        </div>
        <button className="btn btn--outline btn--sm" onClick={() => setItems((l) => [...l, emptyItem()])}>
          + Ítem
        </button>
        <div className="cc-form-total">
          <span>
            <small>Valor total{f.currency === 'USD' ? ' USD' : ''}</small>
            {formatMoney(total, f.currency)}
          </span>
          {f.currency === 'USD' && (
            <span>
              <small>Equivalente COP (TRM {formatTrm(Number(f.exchangeRate))})</small>
              {formatMoney(totalCop)}
            </span>
          )}
        </div>
      </section>

      <section className="card form-section">
        <h2>Notas</h2>
        <label className="field">
          <span className="field__label">Se imprimen debajo del total (condiciones, aclaraciones)</span>
          <textarea rows={4} value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
        </label>
        <p className="hint">La forma de pago (datos bancarios y QR) sale sola, desde Configuración → Finanzas.</p>
      </section>

      <section className="card form-section confirm">
        <div className="actions actions--tight">
          <button className="btn btn--primary" disabled={busy} onClick={save}>
            {busy ? 'Guardando…' : id ? 'Guardar cambios' : 'Crear cuenta de cobro'}
          </button>
          <Link className="btn btn--outline" to={id ? `/cuentas-de-cobro/${id}` : '/facturacion'}>
            Cancelar
          </Link>
        </div>
      </section>
      </div>
    </>
  );
}
