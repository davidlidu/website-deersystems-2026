import { Fragment, useState } from 'react';
import { api, docDate, formatDateTime, formatMoney, useApi, type Me, type ProjectSummary, type Receipt, type Statement } from '../lib';
import { Empty, ErrorBox, Link, Loading, PageHead, SecretBox, useAction, useToast } from '../ui';
import { InvoiceStatus } from './billing/InvoiceStatus';
import { useUngroup } from './billing/GroupBar';
import { ReceiptDetail } from './billing/ReceiptDetail';
import { ReceiptForm } from './billing/ReceiptForm';
import { ProjectCard } from './Home';

interface ClientDetail {
  id: number;
  name: string;
  contact_name: string;
  email: string | null;
  phone: string;
  created_at: string;
  doc_type: string;
  doc_number: string;
  city: string;
  address: string;
  sb_id: string | null;
  account: { email: string; active: boolean; lastLoginAt: string | null } | null;
  projects: ProjectSummary[];
}

/** Datos que salen en la cuenta de cobro, editables por el administrador. */
function BillingData({ c, onSaved }: { c: ClientDetail; onSaved: () => void }) {
  const [f, setF] = useState({
    name: c.name,
    contactName: c.contact_name,
    docType: c.doc_type || 'NIT',
    docNumber: c.doc_number,
    city: c.city,
    address: c.address,
    phone: c.phone,
    email: c.email ?? '',
  });
  const { busy, run } = useAction();
  const toast = useToast();
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  return (
    <section className="card form-section" style={{ marginTop: 24 }}>
      <h2>Datos de facturación</h2>
      <div className="form-grid">
        <label className="field">
          <span className="field__label">Nombre o razón social</span>
          <span className="input">
            <input value={f.name} onChange={(e) => set({ name: e.target.value })} />
          </span>
        </label>
        <label className="field">
          <span className="field__label">Documento</span>
          <span className="doc-field">
            <span className="input">
              <select value={f.docType} onChange={(e) => set({ docType: e.target.value })} aria-label="Tipo de documento">
                {['NIT', 'CC', 'CE', 'Pasaporte'].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </span>
            <span className="input">
              <input value={f.docNumber} onChange={(e) => set({ docNumber: e.target.value })} aria-label="Número de documento" placeholder="Número" />
            </span>
          </span>
        </label>
        {(
          [
            ['contactName', 'Contacto'],
            ['city', 'Ciudad'],
            ['address', 'Dirección'],
            ['phone', 'Teléfono'],
            ['email', 'Correo de contacto'],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="field">
            <span className="field__label">{label}</span>
            <span className="input">
              <input value={f[k]} type={k === 'email' ? 'email' : 'text'} onChange={(e) => set({ [k]: e.target.value })} />
            </span>
          </label>
        ))}
      </div>
      <button
        className="btn btn--primary btn--sm"
        disabled={busy}
        onClick={() =>
          run(async () => {
            await api('PATCH', `clients/${c.id}`, f);
            toast('Datos guardados.');
            onSaved();
          })
        }
      >
        Guardar
      </button>
    </section>
  );
}

/** Estado de cuenta: cuentas de cobro, abonos y saldo (como el reporte por cliente de SmartBilling). */
function ClientStatement({ clientId }: { clientId: number }) {
  const { data, error, loading, reload } = useApi<Statement>(`clients/${clientId}/statement`);
  const [paying, setPaying] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [editing, setEditing] = useState<Receipt | null>(null);
  const { ungroup } = useUngroup(() => reload());
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const s = data!;
  return (
    <section className="section">
      <div className="section__head">
        <h2>Estado de cuenta</h2>
        <div className="actions actions--tight">
          <Link className="btn btn--primary btn--sm" to={`/facturacion/nueva?cliente=${clientId}`}>
            + Cuenta de cobro
          </Link>
          <button className="btn btn--outline btn--sm" onClick={() => setPaying(!paying)}>
            {paying ? 'Cerrar' : '+ Abono'}
          </button>
        </div>
      </div>
      <div className="kpis">
        <div className="kpi card">
          <small>Facturado</small>
          <strong>{formatMoney(s.totals.invoiced)}</strong>
        </div>
        <div className="kpi card">
          <small>Abonado</small>
          <strong>{formatMoney(s.totals.paid)}</strong>
        </div>
        <div className="kpi card">
          <small>{s.totals.balance < 0 ? 'Saldo a favor del cliente' : 'Saldo pendiente'}</small>
          <strong>{formatMoney(Math.abs(s.totals.balance))}</strong>
        </div>
      </div>
      {editing && (
        <ReceiptForm
          key={editing.id}
          receipt={editing}
          onCancel={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
      {paying && (
        <ReceiptForm
          clientId={clientId}
          onCancel={() => setPaying(false)}
          onDone={() => {
            setPaying(false);
            reload();
          }}
        />
      )}
      <div className="statement">
        <div>
          <h3 className="subhead">Cuentas de cobro</h3>
          {s.invoices.length ? (
            <div className="table card">
              {s.invoices.map((i) => (
                <Link key={i.id} to={`/cuentas-de-cobro/${i.id}`} className={`table__row pay-client${i.status === 'anulada' ? ' is-void' : ''}`}>
                  <span className="mono">
                    <strong>{i.number}</strong>
                  </span>
                  <span className="mono">{docDate(i.date)}</span>
                  <span className="mono">{formatMoney(i.totalCop)}</span>
                  <span>
                    <InvoiceStatus i={i} />
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <Empty>Sin cuentas de cobro.</Empty>
          )}
        </div>
        <div>
          <h3 className="subhead">Abonos</h3>
          {s.receipts.length ? (
            <div className="table card">
              {s.receipts.map((r) => (
                <Fragment key={r.id}>
                  <button
                    type="button"
                    className={`table__row pay-client is-clickable${openId === r.id ? ' is-open' : ''}`}
                    aria-expanded={openId === r.id}
                    title="Ver detalle del pago"
                    onClick={() => setOpenId(openId === r.id ? null : r.id)}
                  >
                    <span className="mono">{docDate(r.date)}</span>
                    <span className="mono">{formatMoney(r.amountCop)}</span>
                    <span>{r.method}</span>
                    <span>
                      {r.invoiceNumber ? <small>CC {r.invoiceNumber}</small> : null}
                      {r.sendToFinance === false && <small className="sync sync--off">No se envía</small>}
                    </span>
                  </button>
                  {openId === r.id && (
                    <ReceiptDetail
                      r={r}
                      onUngroup={ungroup}
                      onEdit={
                        r.paymentId
                          ? undefined
                          : () => {
                              setPaying(false);
                              setEditing(r);
                              setTimeout(() => document.querySelector('.receipt-form')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
                            }
                      }
                    />
                  )}
                </Fragment>
              ))}
            </div>
          ) : (
            <Empty>Sin abonos.</Empty>
          )}
        </div>
      </div>
    </section>
  );
}

export function ClientPage({ me, id }: { me: Me; id: number }) {
  const { data, error, loading, reload } = useApi<ClientDetail>(`clients/${id}`);
  const [secret, setSecret] = useState<{ password: string; mailed: boolean; error?: string } | null>(null);
  const { busy, run } = useAction();
  const toast = useToast();

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const c = data!;
  const owner = me.role === 'owner';

  const resetPassword = () => {
    if (!confirm(`¿Generar una contraseña nueva para ${c.email}?\n\nLa actual deja de funcionar y se le envía la nueva por correo.`)) return;
    run(async () => {
      const r = await api<{ password: string; mail: { sent: boolean; error?: string } }>('POST', `clients/${c.id}/password`);
      setSecret({ password: r.password, mailed: r.mail.sent, error: r.mail.error });
      toast(r.mail.sent ? 'Contraseña nueva enviada por correo.' : 'Contraseña generada, pero el correo no salió.', !r.mail.sent);
    });
  };

  const giveAccess = () => {
    const email = prompt('¿Con qué correo va a entrar? Le llega su contraseña por correo.', c.email ?? '');
    if (!email) return;
    run(async () => {
      const r = await api<{ password: string; mail: { sent: boolean; error?: string } }>('POST', `clients/${c.id}/access`, { email });
      setSecret({ password: r.password, mailed: r.mail.sent, error: r.mail.error });
      toast(r.mail.sent ? 'Acceso creado y enviado por correo.' : 'Acceso creado, pero el correo no salió.', !r.mail.sent);
      await reload();
    });
  };

  const toggleAccess = () =>
    run(async () => {
      await api('PATCH', `clients/${c.id}`, { active: !c.account!.active });
      toast(c.account!.active ? 'Acceso desactivado.' : 'Acceso activado.');
      await reload();
    });

  return (
    <>
      <div className="crumbs">
        <Link to="/">Clientes</Link> / {c.name}
      </div>
      <PageHead eyebrow="Cliente" title={c.name}>
        <div className="facts">
          {c.contact_name && (
            <span>
              <small>Contacto</small>
              {c.contact_name}
            </span>
          )}
          <span>
            <small>Correo</small>
            {c.email ?? 'Sin correo'}
          </span>
          {c.doc_number && (
            <span>
              <small>{c.doc_type || 'NIT/CC'}</small>
              {c.doc_number}
            </span>
          )}
          {c.phone && (
            <span>
              <small>Teléfono</small>
              {c.phone}
            </span>
          )}
          <span>
            <small>Último ingreso</small>
            {c.account?.lastLoginAt ? formatDateTime(c.account.lastLoginAt) : 'Nunca'}
          </span>
        </div>
        {owner && !c.account && (
          <div className="actions">
            <button className="btn btn--outline btn--sm" disabled={busy} onClick={giveAccess}>
              Dar acceso al portal
            </button>
            <span className="hint">Este cliente solo tiene facturación: aún no entra al portal.</span>
          </div>
        )}
        {owner && c.account && (
          <div className="actions">
            <button className="btn btn--outline btn--sm" disabled={busy} onClick={resetPassword}>
              Generar y enviar contraseña nueva
            </button>
            <button className="btn btn--outline btn--sm btn--danger" disabled={busy} onClick={toggleAccess}>
              {c.account.active ? 'Desactivar acceso' : 'Activar acceso'}
            </button>
          </div>
        )}
        {secret && (
          <SecretBox
            label="Contraseña nueva"
            value={secret.password}
            note={secret.mailed ? 'Ya se envió al cliente. Solo se muestra esta vez.' : `No se envió: ${secret.error}. Compártela por otro medio.`}
          />
        )}
      </PageHead>
      <section className="section">
        <div className="section__head">
          <h2>Proyectos</h2>
          <span className="mono">{c.projects.length}</span>
        </div>
        {c.projects.length ? (
          <div className="grid">{c.projects.map((p) => <ProjectCard key={p.id} p={p} />)}</div>
        ) : (
          <Empty>Este cliente no tiene proyectos.</Empty>
        )}
      </section>
      {owner && <ClientStatement clientId={c.id} />}
      {owner && <BillingData key={c.id} c={c} onSaved={reload} />}
    </>
  );
}
