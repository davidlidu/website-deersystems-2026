import { useCallback, useEffect, useRef, useState } from 'react';
import { api, navigate, timeAgo, type AppNotification } from './lib';
import { playSpaceBeep, setSoundEnabled, soundEnabled } from './sound';

const POLL_MS = 60_000;

/** Campana del encabezado: novedades de los proyectos (comentarios del cliente, avances, tareas nuevas…). */
export function Bell() {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [sound, setSound] = useState(soundEnabled);
  const box = useRef<HTMLDivElement>(null);
  // Último aviso conocido: si llega uno más nuevo, suena. En la primera carga no suena.
  const lastSeen = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ unread: number; items: AppNotification[] }>('GET', 'notifications');
      const newest = r.items[0]?.id ?? 0;
      if (lastSeen.current !== null && newest > lastSeen.current && r.items.some((n) => !n.read && n.id > lastSeen.current!)) {
        playSpaceBeep();
      }
      lastSeen.current = Math.max(lastSeen.current ?? 0, newest);
      setUnread(r.unread);
      setItems(r.items);
    } catch {
      /* sin conexión: se reintenta en el próximo ciclo */
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => document.visibilityState === 'visible' && load(), POLL_MS);
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const markRead = async (ids?: number[]) => {
    const r = await api<{ unread: number }>('POST', 'notifications/read', ids ? { ids } : {});
    setUnread(r.unread);
    setItems((list) => list?.map((n) => (!ids || ids.includes(n.id) ? { ...n, read: true } : n)) ?? null);
  };

  const openItem = (n: AppNotification) => {
    if (!n.read) markRead([n.id]).catch(() => {});
    setOpen(false);
    navigate(n.link);
  };

  return (
    <div className="bell" ref={box} data-tour="bell">
      <button
        className={`bell__button${unread ? ' has-unread' : ''}`}
        aria-label={unread ? `Notificaciones: ${unread} sin leer` : 'Notificaciones'}
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          if (!open) load();
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && <span className="bell__count">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div
          className="bell__panel"
          role="dialog"
          aria-label="Notificaciones"
          // En móvil el panel va fijo a lo ancho: justo debajo de la campana, sea cual sea el alto del encabezado.
          style={window.innerWidth <= 860 ? { top: (box.current?.getBoundingClientRect().bottom ?? 56) + 8 } : undefined}
        >
          <div className="bell__head">
            <strong>Notificaciones</strong>
            <span className="bell__tools">
              <button
                className="bell__sound"
                aria-pressed={sound}
                title={sound ? 'Silenciar el sonido de los avisos' : 'Activar el sonido de los avisos'}
                onClick={() => {
                  setSound(!sound);
                  setSoundEnabled(!sound);
                  if (!sound) setTimeout(playSpaceBeep, 50);
                }}
              >
                {sound ? '🔊' : '🔇'}
              </button>
              {unread > 0 && <button onClick={() => markRead()}>Marcar todo como leído</button>}
            </span>
          </div>
          {items === null ? (
            <p className="bell__empty">Cargando…</p>
          ) : items.length ? (
            <ul className="bell__list">
              {items.map((n) => (
                <li key={n.id}>
                  <button className={`bell__item${n.read ? '' : ' is-unread'}`} onClick={() => openItem(n)}>
                    <span className="bell__title">{n.title}</span>
                    {n.body && <span className="bell__body">{n.body}</span>}
                    <time dateTime={n.createdAt}>{timeAgo(n.createdAt)}</time>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="bell__empty">No tienes notificaciones.</p>
          )}
        </div>
      )}
    </div>
  );
}
