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
      <div className="pending-bar" role="status">
        <div className="pending-bar__in">
          <span className="pending-bar__icon" aria-hidden="true">
            🗓
          </span>
          <span className="pending-bar__text">
            <strong>{items.length === 1 ? 'Un cliente propuso otro horario' : `${items.length} reuniones con otro horario propuesto por el cliente`}</strong>
          </span>
          <span className="pending-bar__chips">
            {items.slice(0, 3).map((m) => (
              <Link key={m.id} className="pending-bar__chip" to={`/reuniones/${m.id}`}>
                {m.clientName ?? m.projectName} · {m.clientProposal ? short(m.clientProposal.startAt) : short(m.startAt)}
              </Link>
            ))}
          </span>
        </div>
      </div>
    );
  }

  // En la página de confirmar ya está todo: el aviso sobra.
  if (path === '/reuniones-por-confirmar') return null;
  const waiting = items.filter((m) => !m.clientProposal);
  const n = waiting.length;
  return (
    <div className="pending-bar" role="status">
      <div className="pending-bar__in">
        <span className="pending-bar__icon" aria-hidden="true">
          🗓
        </span>
        <span className="pending-bar__text">
          <strong>
            {n === 0
              ? 'Propusiste otro horario: DeerSystems te confirmará'
              : n === 1
                ? 'Tienes una reunión por confirmar'
                : `Tienes ${n} reuniones por confirmar`}
          </strong>
          <small>Confirma el día y la hora, o propón otro horario.</small>
        </span>
        <span className="pending-bar__chips">
          {items.slice(0, 3).map((m) => (
            <Link key={m.id} className={`pending-bar__chip${m.clientProposal ? ' is-sent' : ''}`} to={`/reuniones-por-confirmar?reunion=${m.id}`}>
              {short(m.startAt)} · {m.title}
            </Link>
          ))}
        </span>
        <Link className="btn btn--primary btn--sm pending-bar__cta" to="/reuniones-por-confirmar">
          {n ? 'Confirmar reuniones' : 'Ver reuniones'}
        </Link>
      </div>
    </div>
  );
}
