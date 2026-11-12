import { useEffect, useRef, useState } from 'react';
import { api, formatDateTime, type ProjectSummary } from '../lib';
import { SecretBox, useAction, useToast } from '../ui';

/**
 * Personas del cliente que entran al portal: la cuenta principal (ve todo) y las demás, p. ej. los ejecutivos de una
 * agencia, cada uno con todos los proyectos del cliente o solo los que lleva, y con o sin pagos y cuentas de cobro.
 */

export interface ClientAccount {
  id: number;
  name: string;
  email: string;
  active: boolean;
  lastLoginAt: string | null;
  primary: boolean;
  allProjects: boolean;
  billing: boolean;
  projectIds: number[];
}

type Secret = { who: string; password: string; mailed: boolean; error?: string };

export function ClientPeople({
  clientId,
  accounts,
  projects,
  onChange,
}: {
  clientId: number;
  accounts: ClientAccount[];
  projects: ProjectSummary[];
  onChange: () => void;
}) {
  const [editing, setEditing] = useState<ClientAccount | 'new' | null>(null);
  const [secret, setSecret] = useState<Secret | null>(null);
  const { busy, run } = useAction();
  const toast = useToast();
  const names = new Map(projects.map((p) => [p.id, p.name]));

  const password = (a: ClientAccount) => {
    if (!confirm(`¿Generar una contraseña nueva para ${a.email}?\n\nLa actual deja de funcionar y se le envía la nueva por correo.`)) return;
    run(async () => {
      const r = await api<{ password: string; mail: { sent: boolean; error?: string } }>('POST', `client-accounts/${a.id}/password`);
      setSecret({ who: a.name || a.email, password: r.password, mailed: r.mail.sent, error: r.mail.error });
      toast(r.mail.sent ? 'Contraseña nueva enviada por correo.' : 'Contraseña generada, pero el correo no salió.', !r.mail.sent);
    });
  };
  const toggle = (a: ClientAccount) =>
    run(async () => {
      await api('PATCH', `client-accounts/${a.id}`, { active: !a.active });
      toast(a.active ? 'Acceso desactivado.' : 'Acceso activado.');
      onChange();
    });
  const makePrimary = (a: ClientAccount) => {
    if (
      !confirm(
        `¿Hacer a ${a.name || a.email} la persona principal del cliente?\n\nSerá el contacto del cliente: a su correo le llegan las cuentas de cobro y queda primero en la lista. Su acceso no cambia; ajústalo con «Editar acceso» si hace falta.`,
      )
    )
      return;
    run(async () => {
      await api('POST', `client-accounts/${a.id}/primary`);
      toast(`${a.name || a.email} es ahora la persona principal.`);
      onChange();
    });
  };
  const remove = (a: ClientAccount) => {
    if (!confirm(`¿Quitarle el acceso a ${a.name || a.email}?\n\nYa no podrá entrar al portal. Sus comentarios y archivos se conservan.`)) return;
    run(async () => {
      await api('DELETE', `client-accounts/${a.id}`);
      toast('Acceso eliminado.');
      onChange();
    });
  };

  return (
    <section className="section">
      <div className="section__head">
        <h2>Personas con acceso</h2>
        <button className="btn btn--outline btn--sm" onClick={() => setEditing('new')}>
          + Agregar persona
        </button>
      </div>
      <p className="hint">
        Útil para agencias con un ejecutivo por proyecto: cada persona entra con su correo y solo ve los proyectos que le asignes. Los avisos, avances y
        reuniones de un proyecto les llegan a quienes lo ven. La persona principal es el contacto del cliente (le llegan las cuentas de cobro).
      </p>
      {secret && (
        <SecretBox
          label={`Contraseña de ${secret.who}`}
          value={secret.password}
          note={
            secret.mailed
              ? 'Ya se le envió por correo. Solo se muestra esta vez.'
              : `No se envió: ${(secret.error ?? '').replace(/\.$/, '')}. Compártela por otro medio.`
          }
        />
      )}
      <ul className="people card">
        {accounts.map((a) => (
          <li key={a.id} className={`people__item${a.active ? '' : ' is-off'}`}>
            <div className="people__who">
              <strong>
                {a.name || a.email}
                {a.primary && <span className="tag tag--info">Principal</span>}
                {!a.active && <span className="tag">Desactivado</span>}
              </strong>
              <small>{a.email}</small>
              <small>Último ingreso: {a.lastLoginAt ? formatDateTime(a.lastLoginAt) : 'nunca'}</small>
            </div>
            <div className="people__access">
              <span>{a.allProjects ? 'Todos los proyectos' : a.projectIds.map((id) => names.get(id) ?? `Proyecto ${id}`).join(' · ')}</span>
              <small>{a.billing ? 'Ve pagos y cuentas de cobro' : 'Sin pagos ni cuentas de cobro'}</small>
            </div>
            <div className="actions actions--tight people__actions">
              {!a.primary && a.active && (
                <button className="btn btn--outline btn--xs" disabled={busy} onClick={() => makePrimary(a)}>
                  Hacer principal
                </button>
              )}
              <button className="btn btn--outline btn--xs" disabled={busy} onClick={() => setEditing(a)}>
                Editar acceso
              </button>
              <button className="btn btn--outline btn--xs" disabled={busy} onClick={() => password(a)}>
                Contraseña nueva
              </button>
              {!a.primary && (
                <button className="btn btn--outline btn--xs" disabled={busy} onClick={() => toggle(a)}>
                  {a.active ? 'Desactivar' : 'Activar'}
                </button>
              )}
              {!a.primary && (
                <button className="btn btn--outline btn--xs btn--danger" disabled={busy} onClick={() => remove(a)}>
                  Quitar
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {editing && (
        <PersonDialog
          clientId={clientId}
          account={editing === 'new' ? null : editing}
          projects={projects}
          onClose={() => setEditing(null)}
          onSaved={(s) => {
            setEditing(null);
            if (s) setSecret(s);
            onChange();
          }}
        />
      )}
    </section>
  );
}

function PersonDialog({
  clientId,
  account,
  projects,
  onClose,
  onSaved,
}: {
  clientId: number;
  account: ClientAccount | null;
  projects: ProjectSummary[];
  onClose: () => void;
  onSaved: (secret: Secret | null) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => ref.current?.showModal(), []);
  const [f, setF] = useState({
    name: account?.name ?? '',
    email: account?.email ?? '',
    allProjects: account ? account.allProjects : projects.length < 2,
    projectIds: account?.projectIds ?? [],
    billing: account?.billing ?? false,
    notify: true,
  });
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const { busy, run } = useAction();
  const toast = useToast();
  const ready = f.name.trim() && (account || f.email.trim()) && (f.allProjects || f.projectIds.length > 0);

  const save = () =>
    run(async () => {
      if (account) {
        await api('PATCH', `client-accounts/${account.id}`, { name: f.name, allProjects: f.allProjects, projectIds: f.projectIds, billing: f.billing });
        toast('Acceso actualizado.');
        onSaved(null);
      } else {
        const r = await api<{ password: string; mail: { sent: boolean; error?: string } }>('POST', `clients/${clientId}/accounts`, f);
        toast(r.mail.sent ? 'Acceso creado y enviado por correo.' : 'Acceso creado.', f.notify && !r.mail.sent);
        onSaved({ who: f.name, password: r.password, mailed: r.mail.sent, error: f.notify ? r.mail.error : 'elegiste no enviarla' });
      }
    });

  return (
    <dialog ref={ref} className="modal modal--sm" aria-labelledby="person-title" onClose={onClose} onClick={(e) => e.target === e.currentTarget && ref.current?.close()}>
      <form
        className="modal__in"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) save();
        }}
      >
        <header className="modal__head">
          <h2 id="person-title">{account ? `Acceso de ${account.name || account.email}` : 'Agregar persona'}</h2>
          <button type="button" className="icon-btn" onClick={() => ref.current?.close()} aria-label="Cerrar">
            ✕
          </button>
        </header>
        <label className="field">
          <span className="field__label">Nombre</span>
          <span className="input">
            <input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="P. ej. Luisa Agudelo, ejecutiva de cuenta" required autoFocus />
          </span>
        </label>
        {!account && (
          <label className="field">
            <span className="field__label">Correo con el que entra</span>
            <span className="input">
              <input type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} placeholder="persona@agencia.com" required />
            </span>
          </label>
        )}
        <fieldset className="field people__scope">
          <legend className="field__label">Qué proyectos ve</legend>
          <label className="radio">
            <input type="radio" checked={f.allProjects} onChange={() => set({ allProjects: true })} /> Todos los proyectos del cliente (también los nuevos)
          </label>
          <label className="radio">
            <input type="radio" checked={!f.allProjects} onChange={() => set({ allProjects: false })} /> Solo estos:
          </label>
          {!f.allProjects && (
            <div className="people__projects">
              {projects.length ? (
                projects.map((p) => (
                  <label key={p.id} className="check">
                    <input
                      type="checkbox"
                      checked={f.projectIds.includes(p.id)}
                      onChange={(e) => set({ projectIds: e.target.checked ? [...f.projectIds, p.id] : f.projectIds.filter((x) => x !== p.id) })}
                    />
                    <span>
                      {p.name}
                      {p.status !== 'activo' && <small> · {p.status}</small>}
                    </span>
                  </label>
                ))
              ) : (
                <small className="hint">Este cliente aún no tiene proyectos.</small>
              )}
            </div>
          )}
        </fieldset>
        <label className="auto-switch auto-switch--left">
          <span className="switch">
            <input type="checkbox" role="switch" checked={f.billing} onChange={(e) => set({ billing: e.target.checked })} />
            <span className="switch__track" aria-hidden="true" />
          </span>
          <span>Ve pagos, precios y cuentas de cobro del cliente</span>
        </label>
        {!account && (
          <label className="auto-switch auto-switch--left">
            <span className="switch">
              <input type="checkbox" role="switch" checked={f.notify} onChange={(e) => set({ notify: e.target.checked })} />
              <span className="switch__track" aria-hidden="true" />
            </span>
            <span>Enviarle su contraseña por correo</span>
          </label>
        )}
        <div className="actions actions--tight">
          <button className="btn btn--primary btn--sm" disabled={busy || !ready}>
            {account ? 'Guardar' : 'Crear acceso'}
          </button>
          <button type="button" className="btn btn--outline btn--sm" onClick={() => ref.current?.close()}>
            Cancelar
          </button>
        </div>
      </form>
    </dialog>
  );
}
