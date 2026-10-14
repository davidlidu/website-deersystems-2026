import { useState } from 'react';
import { formatDateTime, useApi } from '../lib';
import { Empty, ErrorBox, Link, Loading, PageHead } from '../ui';

export interface ProposalRow {
  id: number;
  slug: string;
  title: string;
  url: string;
  active: boolean;
  views: number;
  updatedAt: string;
  projects: { id: number; name: string; clientId: number; approvedOption: string }[];
}

export function ProposalsPage() {
  const { data, error, loading, reload } = useApi<ProposalRow[]>('proposals');
  const [showApproved, setShowApproved] = useState(false);
  const { data: me } = useApi<{ proposalsUrl?: string }>('me');

  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const rows = data!.filter((p) => showApproved || !p.projects.length);

  return (
    <>
      <PageHead eyebrow="Propuestas" title={<>¿Te aprobaron una <span className="grad">propuesta</span>?</>}>
        <p>
          Elige la propuesta y la IA arma el plan de trabajo: alcance, fases, tareas de cada parte y fechas. Tú lo revisas antes de crear el
          proyecto. Las propuestas se publican en el{' '}
          <a href={me?.proposalsUrl} target="_blank" rel="noopener">
            panel de propuestas
          </a>
          .
        </p>
      </PageHead>
      <section className="section">
        <div className="section__head">
          <h2>{showApproved ? 'Todas' : 'Pendientes de aprobar'}</h2>
          <label className="check">
            <input type="checkbox" checked={showApproved} onChange={(e) => setShowApproved(e.target.checked)} /> Mostrar ya aprobadas
          </label>
        </div>
        {rows.length ? (
          <div className="list">
            {rows.map((p) => (
              <article key={p.id} className="item card">
                <div>
                  <div className="item__title">
                    {p.title || p.slug}
                    {!p.active && <span className="tag tag--pausado">Pausada</span>}
                    {p.projects.length > 0 && (
                      <span className="tag tag--activo">
                        Aprobada
                        {[...new Set(p.projects.map((pr) => pr.approvedOption).filter(Boolean))].map((o) => ` · ${o}`)}
                      </span>
                    )}
                  </div>
                  <a className="item__url" href={p.url} target="_blank" rel="noopener">
                    {p.url.replace(/^https?:\/\//, '')}
                  </a>
                  <div className="item__meta">
                    <span>Actualizada {formatDateTime(p.updatedAt)}</span>
                    <span>{p.views ? `${p.views} aperturas` : 'Sin abrir'}</span>
                  </div>
                  {p.projects.map((pr) => (
                    <Link key={pr.id} className="item__project" to={`/proyectos/${pr.id}`}>
                      → {pr.name}
                      {pr.approvedOption && ` (${pr.approvedOption})`}
                    </Link>
                  ))}
                </div>
                <div className="item__actions">
                  <Link className={`btn btn--sm ${p.projects.length ? 'btn--outline' : 'btn--primary'}`} to={`/propuestas/${p.id}/aprobar`}>
                    {p.projects.length ? 'Aprobar de nuevo' : 'Propuesta aprobada'}
                  </Link>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty>{showApproved ? 'No hay propuestas publicadas.' : 'No hay propuestas pendientes. Todas están aprobadas.'}</Empty>
        )}
      </section>
    </>
  );
}
