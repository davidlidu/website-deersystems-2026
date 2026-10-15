import { useState, type FormEvent } from 'react';
import { api, formatDateTime, useApi, type TeamMember } from '../lib';
import { Empty, ErrorBox, Loading, PageHead, SecretBox, useAction, useToast } from '../ui';

type Secret = { who: string; password: string; mailed: boolean; error?: string };
type MailResult = { sent: boolean; error?: string };

export function TeamPage() {
  const { data, error, loading, reload } = useApi<TeamMember[]>('team');
  const [secret, setSecret] = useState<Secret | null>(null);
  const { busy, run } = useAction();
  const toast = useToast();

  const add = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    run(async () => {
      const r = await api<{ password: string; mail: MailResult }>('POST', 'team', { name: fd.get('name'), email: fd.get('email') });
      setSecret({ who: String(fd.get('email')), password: r.password, mailed: r.mail.sent, error: r.mail.error });
      form.reset();
      await reload();
    });
  };

  const regenerate = (m: TeamMember) => {
    if (!confirm(`¿Generar una contraseña nueva para ${m.name}? La actual deja de funcionar.`)) return;
    run(async () => {
      const r = await api<{ password: string; mail: MailResult }>('POST', `team/${m.id}/password`);
      setSecret({ who: m.email, password: r.password, mailed: r.mail.sent, error: r.mail.error });
    });
  };

  const toggle = (m: TeamMember) =>
    run(async () => {
      await api('PATCH', `team/${m.id}`, { active: !m.active });
      toast(m.active ? `${m.name} ya no puede entrar.` : `${m.name} puede entrar de nuevo.`);
      await reload();
    });

  const remove = (m: TeamMember) => {
    if (!confirm(`¿Eliminar a ${m.name}? Sus tareas quedan sin responsable.`)) return;
    run(async () => {
      await api('DELETE', `team/${m.id}`);
      await reload();
    });
  };

  return (
    <>
      <PageHead eyebrow="Equipo" title={<>Tu <span className="grad">equipo</span></>}>
        <p>
          Entran con correo y contraseña. Ven clientes, proyectos, tareas y notas internas, pero <strong>nunca precios</strong> ni la
          propuesta original.
        </p>
      </PageHead>

      <form className="card form-section" onSubmit={add}>
        <h2>Agregar persona</h2>
        <div className="form-grid">
          <label className="field">
            <span className="field__label">Nombre</span>
            <span className="input">
              <input name="name" required maxLength={160} />
            </span>
          </label>
          <label className="field">
            <span className="field__label">Correo (puede ser personal)</span>
            <span className="input">
              <input name="email" type="email" required />
            </span>
          </label>
        </div>
        <button className="btn btn--primary" disabled={busy}>
          Crear acceso y enviar contraseña
        </button>
      </form>

      {secret && (
        <SecretBox
          label={`Contraseña de ${secret.who}`}
          value={secret.password}
          note={secret.mailed ? 'Ya se envió por correo. Solo se muestra esta vez.' : `El correo no salió (${secret.error}). Compártela por otro medio.`}
        />
      )}

      <section className="section">
        <div className="section__head">
          <h2>Personas</h2>
          <span className="mono">{data?.length ?? 0}</span>
        </div>
        {loading ? (
          <Loading />
        ) : error ? (
          <ErrorBox message={error} onRetry={reload} />
        ) : data!.length ? (
          <div className="list">
            {data!.map((m) => (
              <article key={m.id} className={`item card${m.active ? '' : ' is-paused'}`}>
                <div>
                  <div className="item__title">
                    {m.name}
                    {!m.active && <span className="tag tag--pausado">Sin acceso</span>}
                  </div>
                  <div className="item__meta">
                    <span>{m.email}</span>
                    <span>Último ingreso: {m.lastLoginAt ? formatDateTime(m.lastLoginAt) : 'nunca'}</span>
                  </div>
                </div>
                <div className="item__actions">
                  <button className="btn btn--outline btn--sm" disabled={busy} onClick={() => regenerate(m)}>
                    Nueva contraseña
                  </button>
                  <button className="btn btn--outline btn--sm" disabled={busy} onClick={() => toggle(m)}>
                    {m.active ? 'Desactivar' : 'Activar'}
                  </button>
                  <button className="btn btn--outline btn--sm btn--danger" disabled={busy} onClick={() => remove(m)}>
                    Eliminar
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty>Todavía no has agregado a nadie.</Empty>
        )}
      </section>
    </>
  );
}
