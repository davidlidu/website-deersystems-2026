import { useState } from 'react';
import { api, formatDateTime, useApi, type Me, type ProjectSummary } from '../lib';
import { Empty, ErrorBox, Link, Loading, PageHead, SecretBox, useAction, useToast } from '../ui';
import { ProjectCard } from './Home';

interface ClientDetail {
  id: number;
  name: string;
  contact_name: string;
  email: string;
  phone: string;
  created_at: string;
  account: { email: string; active: boolean; lastLoginAt: string | null } | null;
  projects: ProjectSummary[];
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
            {c.email}
          </span>
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
    </>
  );
}
