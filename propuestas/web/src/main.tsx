import { lazy, StrictMode, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Bell } from './Bell';
import { Tour, tourPostponed } from './Tour';
import { api, match, navigate, useLocation, type Me } from './lib';
import { HomePage } from './pages/Home';
import { ForgotPage, LoginPage, ResetPage } from './pages/Login';

// Carga diferida: cada pantalla se descarga solo cuando se abre (la app inicial pesa mucho menos).
const AccountPage = lazy(() => import('./pages/Account').then((m) => ({ default: m.AccountPage })));
const ApprovePage = lazy(() => import('./pages/Approve').then((m) => ({ default: m.ApprovePage })));
const BillingPage = lazy(() => import('./pages/billing/Billing').then((m) => ({ default: m.BillingPage })));
const InvoiceFormPage = lazy(() => import('./pages/billing/InvoiceForm').then((m) => ({ default: m.InvoiceFormPage })));
const InvoiceViewPage = lazy(() => import('./pages/billing/InvoiceView').then((m) => ({ default: m.InvoiceViewPage })));
const ClientPage = lazy(() => import('./pages/Client').then((m) => ({ default: m.ClientPage })));
const ProjectPage = lazy(() => import('./pages/Project').then((m) => ({ default: m.ProjectPage })));
const MeetingsPage = lazy(() => import('./pages/Meetings').then((m) => ({ default: m.MeetingsPage })));
const MeetingReviewPage = lazy(() => import('./pages/Meetings').then((m) => ({ default: m.MeetingReviewPage })));
const ProposalsPage = lazy(() => import('./pages/Proposals').then((m) => ({ default: m.ProposalsPage })));
const SettingsPage = lazy(() => import('./pages/Settings').then((m) => ({ default: m.SettingsPage })));

/** /equipo ahora vive en Configuración. */
function GoTo({ to }: { to: string }) {
  useEffect(() => navigate(to, true), [to]);
  return null;
}
import { ErrorBox, Link, Loading, ToastProvider } from './ui';
import './styles.css';

const PUBLIC_PATHS = ['/login', '/recuperar', '/restablecer'];

function Wordmark() {
  return (
    <Link className="wordmark" to="/">
      <img src="/favicon.svg" alt="" />
      <span>
        <span className="grad">Deer</span>Systems <span className="wordmark__sub">Partners</span>
      </span>
    </Link>
  );
}

function Nav({ me, path }: { me: Me; path: string }) {
  const items: [string, string][] =
    me.role === 'client'
      ? [['/', 'Mis proyectos']]
      : [
          ['/', 'Clientes'],
          ...(me.role === 'owner'
            ? ([
                ['/propuestas', 'Propuestas'],
                ['/facturacion', 'Facturación'],
                ['/configuracion', 'Configuración'],
              ] as [string, string][])
            : []),
        ];
  return (
    <nav className="nav" aria-label="Principal">
      {items.map(([to, label]) => {
        // Clientes agrupa también las reuniones; Facturación, las cuentas de cobro.
        const active =
          to === '/'
            ? path === '/' || path.startsWith('/clientes') || path.startsWith('/proyectos') || path.startsWith('/reuniones')
            : to === '/facturacion'
              ? path.startsWith('/facturacion') || path.startsWith('/cuentas-de-cobro')
              : path.startsWith(to);
        return (
          <Link key={to} to={to} data-tour={`nav-${to}`} className={`nav__link${active ? ' is-active' : ''}`} aria-current={active ? 'page' : undefined}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function Shell({ me, children, path, onTour }: { me: Me; children: React.ReactNode; path: string; onTour: () => void }) {
  const logout = async () => {
    await api('POST', '/auth/logout').catch(() => {});
    location.href = '/login';
  };
  const roleLabel = { owner: 'Administrador', team: 'Equipo', client: me.client?.name ?? 'Cliente' }[me.role];
  return (
    <>
      <header className="topbar">
        <div className="topbar__in">
          <Wordmark />
          <Nav me={me} path={path} />
          <div className="topbar__user">
            <button className="help-btn" data-tour="help" onClick={onTour} title="Ver el recorrido guiado" aria-label="Ver el recorrido guiado">
              ?
            </button>
            <Bell />
            <span className="topbar__who">
              <span>{me.name || me.email}</span>
              <span className="mono">{roleLabel}</span>
            </span>
            {me.role !== 'owner' && (
              <Link className="btn btn--outline btn--sm" to="/cuenta" data-tour="account">
                Mi cuenta
              </Link>
            )}
            <button className="btn btn--outline btn--sm" onClick={logout}>
              Salir
            </button>
          </div>
        </div>
      </header>
      <main className="page">{children}</main>
    </>
  );
}

function Routes({ me, path }: { me: Me; path: string }) {
  let m: Record<string, string> | null;
  if (path === '/') return <HomePage me={me} />;
  if ((m = match('/proyectos/:id', path))) return <ProjectPage me={me} id={Number(m.id)} />;
  if (path === '/cuenta' && me.role !== 'owner') return <AccountPage me={me} />;
  // La cuenta de cobro la ven tú y el cliente (las suyas); el servidor no se la entrega al equipo.
  if (me.role !== 'team' && (m = match('/cuentas-de-cobro/:id', path))) return <InvoiceViewPage me={me} id={Number(m.id)} />;
  if (me.role !== 'client') {
    if ((m = match('/clientes/:id', path))) return <ClientPage me={me} id={Number(m.id)} />;
  }
  if (me.role === 'owner') {
    if (path === '/propuestas') return <ProposalsPage />;
    if ((m = match('/propuestas/:id/aprobar', path))) return <ApprovePage proposalId={Number(m.id)} />;
    if (path === '/reuniones') return <MeetingsPage />;
    if ((m = match('/reuniones/:id', path))) return <MeetingReviewPage id={Number(m.id)} />;
    if (path === '/facturacion') return <BillingPage />;
    if (path === '/facturacion/nueva') return <InvoiceFormPage />;
    if ((m = match('/cuentas-de-cobro/:id/editar', path))) return <InvoiceFormPage id={Number(m.id)} />;
    if (path === '/equipo') return <GoTo to="/configuracion?tab=equipo" />;
    if (path === '/configuracion') return <SettingsPage />;
  }
  return (
    <div className="page__head">
      <p className="eyebrow">404</p>
      <h1>Esta página no existe</h1>
      <p>
        <Link to="/">Volver al inicio</Link>
      </p>
    </div>
  );
}

function App() {
  const { path } = useLocation();
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [tour, setTour] = useState(false);

  // Al iniciar sesión: si no lo ha terminado ni lo pospuso en esta sesión, se abre el tour (en el inicio).
  useEffect(() => {
    if (me && !me.tourDone && !tourPostponed()) {
      if (location.pathname !== '/') navigate('/', true);
      setTour(true);
    }
  }, [me?.email]); // eslint-disable-line react-hooks/exhaustive-deps
  const [error, setError] = useState<string | null>(null);
  const isPublic = PUBLIC_PATHS.includes(path);

  useEffect(() => {
    if (isPublic) return;
    api<Me>('GET', 'me')
      .then(setMe)
      .catch((err) => {
        if (err.status === 401) {
          setMe(null);
          navigate('/login', true);
        } else setError(err.message);
      });
  }, [isPublic]);

  if (path === '/login') return <LoginPage onLogin={(m) => setMe(m)} />;
  if (path === '/recuperar') return <ForgotPage />;
  if (path === '/restablecer') return <ResetPage />;
  if (error) {
    return (
      <main className="center">
        <ErrorBox message={error} onRetry={() => location.reload()} />
      </main>
    );
  }
  if (!me) return <Loading />;
  return (
    <Shell
      me={me}
      path={path}
      onTour={() => {
        navigate('/');
        setTour(true);
      }}
    >
      <Suspense fallback={<Loading />}>
        <Routes me={me} path={path} />
      </Suspense>
      {tour && (
        <Tour
          me={me}
          onClose={(done) => {
            setTour(false);
            if (done) setMe({ ...me, tourDone: true });
          }}
        />
      )}
    </Shell>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);
