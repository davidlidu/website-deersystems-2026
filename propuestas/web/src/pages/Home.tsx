import { useMemo, useState } from 'react';
import { docDate, formatDate, formatDateTime, formatMoney, PROJECT_STATUS, useApi, type Me, type ProjectSummary, type Statement } from '../lib';
import { Empty, ErrorBox, Link, Loading, PageHead, ProgressBar } from '../ui';
import { InvoiceStatus } from './billing/InvoiceStatus';

/** Clientes agrupa dos vistas para el administrador: clientes y proyectos, y reuniones. */
export function ClientsTabs({ active }: { active: 'clientes' | 'reuniones' }) {
  return (
    <div className="tabs subtabs" role="tablist" data-tour="clients-tabs">
      <Link to="/" role="tab" aria-selected={active === 'clientes'} className={active === 'clientes' ? 'is-active' : ''}>
        Clientes y proyectos
      </Link>
      <Link to="/reuniones" role="tab" aria-selected={active === 'reuniones'} className={active === 'reuniones' ? 'is-active' : ''}>
        Reuniones
      </Link>
    </div>
  );
}

export function ProjectCard({ p, showClient }: { p: ProjectSummary; showClient?: boolean }) {
  return (
    <Link to={`/proyectos/${p.id}`} className={`project card is-${p.status}`}>
      <div className="project__top">
        <div>
          {showClient && <span className="project__client">{p.clientName}</span>}
          <h3 className="project__name">{p.name}</h3>
          {p.approvedOption && <span className="project__option">{p.approvedOption}</span>}
        </div>
        <span className={`tag tag--${p.status}`}>{PROJECT_STATUS[p.status]}</span>
      </div>
      <ProgressBar progress={p.progress} />
      <div className="project__meta">
        <span>
          {p.progress.done}/{p.progress.total} tareas
        </span>
        {(p.startDate || p.endDate) && (
          <span>
            {formatDate(p.startDate)} → {formatDate(p.endDate)}
          </span>
        )}
      </div>
    </Link>
  );
}

/** Para el cliente: sus cuentas de cobro (de todos sus proyectos), lo abonado, su saldo y cómo pagar. */
function MyAccount({ clientId }: { clientId: number }) {
  const { data } = useApi<Statement>(`clients/${clientId}/statement`);
  if (!data || (!data.invoices.length && !data.receipts.length)) return null;
  const { totals, invoices, howToPay } = data;
  return (
    <section className="section">
      <div className="section__head">
        <h2>Mi estado de cuenta</h2>
      </div>
      <div className="kpis">
        <div className="kpi card">
          <small>Facturado</small>
          <strong>{formatMoney(totals.invoiced)}</strong>
        </div>
        <div className="kpi card">
          <small>Pagado</small>
          <strong>{formatMoney(totals.paid)}</strong>
        </div>
        <div className="kpi card">
          <small>{totals.balance < 0 ? 'Saldo a tu favor' : 'Saldo por pagar'}</small>
          <strong>{formatMoney(Math.abs(totals.balance))}</strong>
        </div>
      </div>
      {invoices.length > 0 && (
        <div className="table card">
          {invoices.map((i) => (
            <Link key={i.id} to={`/cuentas-de-cobro/${i.id}`} className="table__row pay-client">
              <span>
                <strong>Cuenta de cobro {i.number}</strong>
                {i.projectName && <small>{i.projectName}</small>}
              </span>
              <span className="mono">{docDate(i.date)}</span>
              <span className="mono">{formatMoney(i.currency === 'USD' ? i.total : i.totalCop, i.currency)}</span>
              <span>
                <InvoiceStatus i={i} />
              </span>
            </Link>
          ))}
        </div>
      )}
      {howToPay && (howToPay.bankInfo || howToPay.qr) && totals.balance > 0 && (
        <section className="card how-to-pay" style={{ marginTop: 12 }}>
          <div>
            <h3 className="subhead">Cómo pagar</h3>
            {howToPay.bankInfo && <p className="pre">{howToPay.bankInfo}</p>}
          </div>
          {howToPay.qr && <img src={howToPay.qr} alt="Código QR para pagar" />}
        </section>
      )}
    </section>
  );
}

function ClientHome({ me }: { me: Me }) {
  const { data, error, loading, reload } = useApi<ProjectSummary[]>('projects');
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const current = data!.filter((p) => p.status !== 'finalizado');
  const history = data!.filter((p) => p.status === 'finalizado');
  return (
    <>
      <PageHead eyebrow={me.client?.name ?? 'Tu espacio'} title={<>Hola, <span className="grad">{me.name.split(' ')[0] || 'bienvenido'}</span></>}>
        <p>Aquí ves el avance de tus proyectos con DeerSystems, las tareas de cada parte y el historial.</p>
      </PageHead>
      <section className="section" data-tour="projects">
        <div className="section__head">
          <h2>En curso</h2>
          <span className="mono">{current.length}</span>
        </div>
        {current.length ? (
          <div className="grid">{current.map((p) => <ProjectCard key={p.id} p={p} />)}</div>
        ) : (
          <Empty>No tienes proyectos en curso.</Empty>
        )}
      </section>
      {me.client && <MyAccount clientId={me.client.id} />}
      {history.length > 0 && (
        <section className="section">
          <div className="section__head">
            <h2>Historial</h2>
            <span className="mono">{history.length}</span>
          </div>
          <div className="grid">{history.map((p) => <ProjectCard key={p.id} p={p} />)}</div>
        </section>
      )}
    </>
  );
}

interface ClientRow {
  id: number;
  name: string;
  contact_name: string;
  email: string | null;
  projects: number;
  active_projects: number;
  last_login_at: string | null;
  account_active: number | null;
}

function StaffHome({ me }: { me: Me }) {
  const clients = useApi<ClientRow[]>('clients');
  const projects = useApi<ProjectSummary[]>('projects');
  const [filter, setFilter] = useState('');
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (clients.data ?? []).filter((c) => !q || `${c.name} ${c.contact_name} ${c.email ?? ''}`.toLowerCase().includes(q));
  }, [clients.data, filter]);

  if (clients.loading || projects.loading) return <Loading />;
  if (clients.error || projects.error) return <ErrorBox message={(clients.error ?? projects.error)!} onRetry={clients.reload} />;
  const active = projects.data!.filter((p) => p.status === 'activo');

  return (
    <>
      {me.role === 'owner' && <ClientsTabs active="clientes" />}
      <PageHead eyebrow="Clientes" title={<>Proyectos <span className="grad">en marcha</span></>}>
        <p>
          {me.role === 'owner' ? (
            <>
              Cuando un cliente aprueba una propuesta, márcala como aprobada en <Link to="/propuestas">Propuestas</Link> y aparece aquí.
            </>
          ) : (
            'Clientes y proyectos activos de DeerSystems.'
          )}
        </p>
      </PageHead>

      <section className="section" data-tour="projects">
        <div className="section__head">
          <h2>Activos</h2>
          <span className="mono">{active.length}</span>
        </div>
        {active.length ? (
          <div className="grid">{active.map((p) => <ProjectCard key={p.id} p={p} showClient />)}</div>
        ) : (
          <Empty>No hay proyectos activos.</Empty>
        )}
      </section>

      <section className="section">
        <div className="section__head">
          <h2>Todos los clientes</h2>
          <span className="input input--search">
            <input placeholder="Buscar cliente…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </span>
        </div>
        {shown.length ? (
          <div className="table card">
            <div className="table__row table__row--head">
              <span>Cliente</span>
              <span>Proyectos</span>
              <span>Último ingreso</span>
            </div>
            {shown.map((c) => (
              <Link key={c.id} to={`/clientes/${c.id}`} className="table__row">
                <span>
                  <strong>{c.name}</strong>
                  <small>{[c.contact_name, c.email ?? 'Solo facturación'].filter(Boolean).join(' · ')}</small>
                </span>
                <span className="mono">
                  {c.active_projects} activos · {c.projects} total
                </span>
                <span className="mono">{c.account_active === 0 ? 'Acceso desactivado' : c.last_login_at ? formatDateTime(c.last_login_at) : 'Nunca'}</span>
              </Link>
            ))}
          </div>
        ) : (
          <Empty>{filter ? 'Ningún cliente coincide.' : 'Todavía no hay clientes.'}</Empty>
        )}
      </section>
    </>
  );
}

export function HomePage({ me }: { me: Me }) {
  return me.role === 'client' ? <ClientHome me={me} /> : <StaffHome me={me} />;
}
