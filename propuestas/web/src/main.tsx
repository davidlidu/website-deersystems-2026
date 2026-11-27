import { Component, lazy, StrictMode, Suspense, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Bell } from './Bell';
import { PendingMeetingsBar } from './PendingMeetings';
import { registerServiceWorker } from './Push';
import { Tour, tourPostponed } from './Tour';
import { PreviewBanner, ViewAsButton } from './ViewAs';
import { api, loadChunk, match, navigate, useLocation, type Me } from './lib';
import { HomePage } from './pages/Home';
import { ForgotPage, LoginPage, ResetPage } from './pages/Login';

// Carga diferida: cada pantalla se descarga solo cuando se abre (la app inicial pesa mucho menos).
const AccountPage = lazy(() => loadChunk(() => import('./pages/Account')).then((m) => ({ default: m.AccountPage })));
const ApprovePage = lazy(() => loadChunk(() => import('./pages/Approve')).then((m) => ({ default: m.ApprovePage })));
const BillingPage = lazy(() => loadChunk(() => import('./pages/billing/Billing')).then((m) => ({ default: m.BillingPage })));
const InvoiceFormPage = lazy(() => loadChunk(() => import('./pages/billing/InvoiceForm')).then((m) => ({ default: m.InvoiceFormPage })));
const InvoiceViewPage = lazy(() => loadChunk(() => import('./pages/billing/InvoiceView')).then((m) => ({ default: m.InvoiceViewPage })));
const ClientPage = lazy(() => loadChunk(() => import('./pages/Client')).then((m) => ({ default: m.ClientPage })));
const ProjectPage = lazy(() => loadChunk(() => import('./pages/Project')).then((m) => ({ default: m.ProjectPage })));
const MeetingsPage = lazy(() => loadChunk(() => import('./pages/Meetings')).then((m) => ({ default: m.MeetingsPage })));
const MeetingReviewPage = lazy(() => loadChunk(() => import('./pages/Meetings')).then((m) => ({ default: m.MeetingReviewPage })));
const ProposalsPage = lazy(() => loadChunk(() => import('./pages/Proposals')).then((m) => ({ default: m.ProposalsPage })));
const CalendarPage = lazy(() => loadChunk(() => import('./pages/Calendar')).then((m) => ({ default: m.CalendarPage })));
const PendingMeetingsPage = lazy(() => loadChunk(() => import('./pages/PendingMeetings')).then((m) => ({ default: m.PendingMeetingsPage })));
const FormsPage = lazy(() => loadChunk(() => import('./pages/Forms')).then((m) => ({ default: m.FormsPage })));
const FormFillPage = lazy(() => loadChunk(() => import('./pages/FormFill')).then((m) => ({ default: m.FormFillPage })));
const MailPage = lazy(() => loadChunk(() => import('./pages/Mail')).then((m) => ({ default: m.MailPage })));
const SettingsPage = lazy(() => loadChunk(() => import('./pages/Settings')).then((m) => ({ default: m.SettingsPage })));

/**
 * Si una pantalla falla al dibujarse, se muestra el error con «Reintentar» en lugar de dejar toda la app en blanco.
 * Se reinicia al cambiar de dirección (key = ruta).
 */
class PageBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error('Error en la pantalla:', error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return <ErrorBox message={this.state.error.message || 'Algo falló al abrir esta pantalla.'} onRetry={() => location.reload()} />;
  }
}

/** /equipo ahora vive en Configuración. */
function GoTo({ to }: { to: string }) {
  useEffect(() => navigate(to, true), [to]);
  return null;
}
import { ErrorBox, Link, Loading, ToastProvider } from './ui';
import './styles.css';
import { reportVitals } from './vitals';

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
      ? [
          ['/', 'Mis proyectos'],
          ['/calendario', 'Calendario'],
        ]
      : [
          ['/', 'Clientes'],
          ['/calendario', 'Calendario'],
          ...(me.role === 'owner'
            ? ([
                ['/propuestas', 'Propuestas'],
                ['/facturacion', 'Facturación'],
                ['/correos', 'Correos'],
              ] as [string, string][])
            : []),
        ];
  return (
    <nav className="nav" aria-label="Principal">
      {items.map(([to, label]) => {
        // Clientes agrupa también las reuniones y los formularios; Facturación, las cuentas de cobro.
        const active =
          to === '/'
            ? path === '/' || path.startsWith('/clientes') || path.startsWith('/proyectos') || path.startsWith('/reuniones') || path.startsWith('/formularios')
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
            {me.role === 'owner' && <ViewAsButton />}
            {me.role === 'owner' && (
              <Link
                to="/configuracion"
                data-tour="nav-/configuracion"
                className={`help-btn gear-btn${path.startsWith('/configuracion') ? ' is-active' : ''}`}
                title="Configuración"
                aria-label="Configuración"
                aria-current={path.startsWith('/configuracion') ? 'page' : undefined}
              >
                <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </Link>
            )}
            <span className="topbar__who">
              <span>{me.name || me.email}</span>
              <span className="mono">{roleLabel}</span>
            </span>
            {me.role !== 'owner' && (
              <Link className="btn btn--outline btn--sm" to="/cuenta" data-tour="account">
                Mi cuenta
              </Link>
            )}
            {!me.preview && (
              <button className="btn btn--outline btn--sm" onClick={logout}>
                Salir
              </button>
            )}
          </div>
        </div>
        <PendingMeetingsBar me={me} path={path} />
      </header>
      {me.preview && <PreviewBanner me={me} />}
      <main className="page">{children}</main>
    </>
  );
}

function Routes({ me, path }: { me: Me; path: string }) {
  let m: Record<string, string> | null;
  if (path === '/') return <HomePage me={me} />;
  if (path === '/calendario') return <CalendarPage me={me} />;
  if ((m = match('/proyectos/:id', path))) return <ProjectPage me={me} id={Number(m.id)} />;
  if (path === '/cuenta' && me.role !== 'owner') return <AccountPage me={me} />;
  // La cuenta de cobro la ven tú y el cliente (las suyas); el servidor no se la entrega al equipo.
  if (me.role !== 'team' && (m = match('/cuentas-de-cobro/:id', path))) return <InvoiceViewPage me={me} id={Number(m.id)} />;
  if (path === '/reuniones-por-confirmar') return me.role === 'client' ? <PendingMeetingsPage me={me} /> : <GoTo to="/reuniones" />;
  if (me.role !== 'client') {
    if ((m = match('/clientes/:id', path))) return <ClientPage me={me} id={Number(m.id)} />;
  }
  if (me.role === 'owner') {
    if (path === '/propuestas') return <ProposalsPage />;
    if ((m = match('/propuestas/:id/aprobar', path))) return <ApprovePage proposalId={Number(m.id)} />;
    if (path === '/reuniones') return <MeetingsPage />;
    if ((m = match('/reuniones/:id', path))) return <MeetingReviewPage id={Number(m.id)} />;
    if (path === '/facturacion') return <BillingPage />;
    if (path === '/correos') return <MailPage />;
    if (path === '/formularios') return <FormsPage />;
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
  // /f/{token}: el formulario que el cliente llena con su enlace, sin iniciar sesión.
  const formToken = match('/f/:token', path)?.token;
  const isPublic = PUBLIC_PATHS.includes(path) || !!formToken;

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

  if (formToken) {
    return (
      <Suspense fallback={<Loading />}>
        <FormFillPage token={formToken} />
      </Suspense>
    );
  }
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
      <PageBoundary key={path}>
        <Suspense fallback={<Loading />}>
          <Routes me={me} path={path} />
        </Suspense>
      </PageBoundary>
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

reportVitals();
registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
);
