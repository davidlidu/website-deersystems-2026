import { useEffect, useRef, useState } from 'react';
import { api, useApi, type Me } from './lib';
import { useAction, useToast } from './ui';

/**
 * «Ver como»: tú miras el portal con los permisos de una persona del equipo o del cliente, sin su contraseña.
 * Es de solo lectura (el servidor rechaza cualquier cambio) y se sale con «Salir de la vista».
 */

interface Option {
  id: number;
  name: string;
  email: string;
  role: 'team' | 'client';
  group: string;
  access: string;
}

/** Entra a ver como esa persona y recarga el portal con sus permisos. */
export async function viewAs(accountId: number) {
  await api('POST', 'view-as', { accountId });
  location.href = '/';
}

async function leave() {
  await api('DELETE', 'view-as').catch(() => {});
  location.href = '/';
}

function ViewAsDialog({ onClose, current }: { onClose: () => void; current?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    search.current?.focus();
  }, []);
  const list = useApi<Option[]>('view-as/options');
  const [q, setQ] = useState('');
  const { busy, run } = useAction();
  const needle = q.trim().toLowerCase();
  const shown = (list.data ?? []).filter((o) => !needle || `${o.name} ${o.email} ${o.group}`.toLowerCase().includes(needle));
  const groups = [...new Set(shown.map((o) => o.group))];

  return (
    <dialog ref={ref} className="modal modal--sm" aria-labelledby="viewas-title" onClose={onClose} onClick={(e) => e.target === e.currentTarget && ref.current?.close()}>
      <div className="modal__in">
        <header className="modal__head">
          <h2 id="viewas-title">Ver como</h2>
          <button type="button" className="icon-btn" onClick={() => ref.current?.close()} aria-label="Cerrar">
            ✕
          </button>
        </header>
        <p className="hint">
          Mira el portal con los permisos de una persona, sin su contraseña. Es solo lectura: no se guarda nada ni se le avisa.
        </p>
        <span className="input input--search viewas__find">
          <input ref={search} placeholder="Buscar persona, correo o cliente…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar persona" />
        </span>
        <div className="viewas__list">
          {list.loading && !list.data ? (
            <p className="hint">Cargando…</p>
          ) : groups.length ? (
            groups.map((g) => (
              <div key={g}>
                <small className="viewas__group">{g}</small>
                <ul>
                  {shown
                    .filter((o) => o.group === g)
                    .map((o) => (
                      <li key={o.id}>
                        <button type="button" className="viewas__item" disabled={busy || o.email === current} onClick={() => run(() => viewAs(o.id))}>
                          <span>
                            <strong>{o.name}</strong>
                            <small>{o.email}</small>
                          </span>
                          <small>{o.email === current ? 'Viendo ahora' : o.access}</small>
                        </button>
                      </li>
                    ))}
                </ul>
              </div>
            ))
          ) : (
            <p className="hint">{needle ? 'Nadie coincide.' : 'Aún no hay personas del equipo ni de los clientes con acceso.'}</p>
          )}
        </div>
      </div>
    </dialog>
  );
}

/** Botón de la barra (solo tú). */
export function ViewAsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="help-btn viewas-btn" onClick={() => setOpen(true)} title="Ver el portal como otra persona" aria-label="Ver como otra persona">
        <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>
      {open && <ViewAsDialog onClose={() => setOpen(false)} />}
    </>
  );
}

/** Franja fija mientras ves como otra persona. */
export function PreviewBanner({ me }: { me: Me }) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const who = me.role === 'team' ? 'Equipo' : (me.client?.name ?? 'Cliente');
  return (
    <div className="preview-banner" role="status">
      <span>
        👁 Estás viendo el portal como <strong>{me.name || me.email}</strong> <small>({who})</small> · solo lectura
      </span>
      <span className="actions actions--tight">
        <button className="btn btn--outline btn--xs" onClick={() => setOpen(true)}>
          Cambiar persona
        </button>
        <button className="btn btn--primary btn--xs" onClick={() => leave().catch((e: Error) => toast(e.message, true))}>
          Salir de la vista
        </button>
      </span>
      {open && <ViewAsDialog current={me.email} onClose={() => setOpen(false)} />}
    </div>
  );
}
