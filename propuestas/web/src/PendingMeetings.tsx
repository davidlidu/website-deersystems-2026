import { useCallback, useEffect, useState } from 'react';
import { api, PENDING_MEETINGS_EVENT, type Me, type Meeting } from './lib';
import { Link } from './ui';

/** «vie, 27 de nov, 9:00 a. m.» en hora de Colombia (la misma que se confirma). */
const short = (iso: string) =>
  new Date(iso).toLocaleString('es-CO', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota' });

/** Cada cuánto se revisa si hay reuniones nuevas por confirmar mientras la pestaña está abierta. */
const REFRESH_MS = 3 * 60_000;

/**
 * Aviso resaltado en la cabecera.
 * - Cliente: las reuniones reservadas que debe confirmar (o para las que propuso otro horario).
 * - Administrador: las reservas en las que el cliente propuso otro día y hora.
 */
export function PendingMeetingsBar({ me, path }: { me: Me; path: string }) {
  const [items, setItems] = useState<Meeting[]>([]);
  const enabled = me.role !== 'team';

  const load = useCallback(() => {
    if (!enabled) return;
    api<{ items: Meeting[] }>('GET', 'meetings/pending')
      .then((r) => setItems(r.items))
      .catch(() => {});
  }, [enabled]);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    const onFocus = () => document.visibilityState === 'visible' && load();
    window.addEventListener(PENDING_MEETINGS_EVENT, load);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(PENDING_MEETINGS_EVENT, load);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [load]);

  if (!enabled || !items.length) return null;

  if (me.role === 'owner') {
    return (
      <Collapsible
        title={items.length === 1 ? 'Un cliente propuso otro horario' : `${items.length} reuniones con otro horario propuesto por el cliente`}
        links={items.map((m) => ({
          id: m.id,
          to: `/reuniones/${m.id}`,
          label: `${m.clientName ?? m.projectName} · ${short(m.clientProposal?.startAt ?? m.startAt)}`,
          sent: false,
        }))}
      />
    );
  }

  // En la página de confirmar ya está todo: el aviso sobra.
  if (path === '/reuniones-por-confirmar') return null;
  const n = items.filter((m) => !m.clientProposal).length;
  return (
    <Collapsible
      title={n === 0 ? 'Propusiste otro horario: DeerSystems te confirmará' : n === 1 ? 'Tienes una reunión por confirmar' : `Tienes ${n} reuniones por confirmar`}
      hint="Confirma el día y la hora, o propón otro horario."
      links={items.map((m) => ({ id: m.id, to: `/reuniones-por-confirmar?reunion=${m.id}`, label: `${short(m.startAt)} · ${m.title}`, sent: !!m.clientProposal }))}
      cta={{ to: '/reuniones-por-confirmar', label: n ? 'Confirmar reuniones' : 'Ver reuniones' }}
    />
  );
}

const OPEN_KEY = 'ds:pending-bar-open';

/**
 * El aviso empieza comprimido (una línea delgada, sin ruido); con un clic se expande y muestra cada reunión.
 * Si la persona lo deja abierto, se recuerda mientras dure la sesión del navegador.
 */
function Collapsible({
  title,
  hint,
  links,
  cta,
}: {
  title: string;
  hint?: string;
  links: { id: number; to: string; label: string; sent: boolean }[];
  cta?: { to: string; label: string };
}) {
  const [open, setOpen] = useState(() => {
    try {
      return sessionStorage.getItem(OPEN_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggle = () => {
    setOpen(!open);
    try {
      sessionStorage.setItem(OPEN_KEY, open ? '0' : '1');
    } catch {
      /* sin almacenamiento: solo no se recuerda */
    }
  };
  return (
    <div className={`pending-bar${open ? ' is-open' : ''}`} role="status">
      <div className="pending-bar__in">
        <button type="button" className="pending-bar__toggle" aria-expanded={open} onClick={toggle}>
          <span className="pending-bar__dot" aria-hidden="true" />
          <strong>{title}</strong>
          <span className="pending-bar__more">{open ? 'Ocultar' : 'Ver'}</span>
          <svg className="pending-bar__chev" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        {open && (
          <div className="pending-bar__body">
            {hint && <small className="pending-bar__hint">{hint}</small>}
            <span className="pending-bar__chips">
              {links.map((l) => (
                <Link key={l.id} className={`pending-bar__chip${l.sent ? ' is-sent' : ''}`} to={l.to}>
                  {l.label}
                </Link>
              ))}
            </span>
            {cta && (
              <Link className="btn btn--primary btn--sm pending-bar__cta" to={cta.to}>
                {cta.label}
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
