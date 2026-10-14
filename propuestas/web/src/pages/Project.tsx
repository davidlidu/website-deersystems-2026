import { useState } from 'react';
import {
  api,
  CLIENT_STATUSES,
  formatDate,
  isOverdue,
  PROJECT_STATUS,
  STATUS,
  STATUSES,
  useApi,
  type Me,
  type Progress,
  type ProjectDetail,
  type ProjectStatus,
  type Task,
  type TaskStatus,
} from '../lib';
import { ErrorBox, Link, Loading, Markdown, PageHead, ProgressBar, StatusPill, useAction, useToast } from '../ui';

function TaskRow({ task, me, onStatus }: { task: Task; me: Me; onStatus: (t: Task, s: TaskStatus) => void }) {
  const [open, setOpen] = useState(false);
  const options = me.role === 'client' ? CLIENT_STATUSES : STATUSES;
  const who = task.side === 'cliente' ? 'Cliente' : (task.assigneeName ?? 'DeerSystems');
  return (
    <li className={`task is-${task.status}${isOverdue(task) ? ' is-overdue' : ''}`}>
      <div className="task__main">
        <button className="task__title" onClick={() => setOpen(!open)} aria-expanded={open}>
          {task.title}
        </button>
        <div className="task__meta">
          <span className={`side side--${task.side}`}>{who}</span>
          {task.dueDate && <span className="mono">{isOverdue(task) ? 'Vencida · ' : 'Entrega · '}{formatDate(task.dueDate, false)}</span>}
        </div>
        {open && task.description && <p className="task__desc">{task.description}</p>}
      </div>
      {task.canChangeStatus ? (
        <select
          className={`pill pill--${task.status} pill--select`}
          value={task.status}
          aria-label={`Estado de ${task.title}`}
          onChange={(e) => onStatus(task, e.target.value as TaskStatus)}
        >
          {/* Si el estado actual no está entre las opciones del cliente, igual se muestra. */}
          {[...new Set([task.status, ...options])].map((s) => (
            <option key={s} value={s}>
              {STATUS[s]}
            </option>
          ))}
        </select>
      ) : (
        <StatusPill status={task.status} />
      )}
    </li>
  );
}

export function ProjectPage({ me, id }: { me: Me; id: number }) {
  const { data, error, loading, reload, setData } = useApi<ProjectDetail>(`projects/${id}`);
  const [tab, setTab] = useState<'tareas' | 'alcance' | 'comercial'>('tareas');
  const [sideFilter, setSideFilter] = useState<'todas' | 'deersystems' | 'cliente'>('todas');
  const toast = useToast();
  const { run } = useAction();

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const p = data!;
  const staff = me.role !== 'client';

  const setStatus = (task: Task, status: TaskStatus) => {
    const prev = p;
    // Optimista: se ve al instante y se revierte si el servidor lo rechaza.
    setData({ ...p, tasks: p.tasks.map((t) => (t.id === task.id ? { ...t, status } : t)) });
    run(async () => {
      try {
        const { progress } = await api<{ progress: Progress }>('PATCH', `tasks/${task.id}`, { status });
        setData({ ...p, progress, tasks: p.tasks.map((t) => (t.id === task.id ? { ...t, status } : t)) });
      } catch (err) {
        setData(prev);
        throw err;
      }
    });
  };

  const setProjectStatus = (status: ProjectStatus) =>
    run(async () => {
      setData(await api<ProjectDetail>('PATCH', `projects/${p.id}`, { status }));
      toast(`Proyecto ${PROJECT_STATUS[status].toLowerCase()}.`);
    });

  const tasks = p.tasks.filter((t) => sideFilter === 'todas' || t.side === sideFilter);
  const byPhase = [
    ...p.phases.map((ph) => ({ ...ph, tasks: tasks.filter((t) => t.phaseId === ph.id) })),
    { id: 0, name: 'Sin fase', tasks: tasks.filter((t) => !t.phaseId || !p.phases.some((ph) => ph.id === t.phaseId)) },
  ].filter((ph) => ph.tasks.length);
  // Lo que ya mandó a revisión no cuenta: está en manos de DeerSystems.
  const mine = p.tasks.filter((t) => t.side === 'cliente' && t.status !== 'completada' && t.status !== 'en_revision').length;
  const hasCommercial = me.role !== 'team' && (p.pricing || p.proposalUrl);

  return (
    <>
      <div className="crumbs">
        {staff ? (
          <>
            <Link to="/">Clientes</Link> / <Link to={`/clientes/${p.clientId}`}>{p.clientName}</Link>
          </>
        ) : (
          <Link to="/">Mis proyectos</Link>
        )}
      </div>
      <PageHead eyebrow={`${p.clientName} · aprobado el ${formatDate(p.approvedAt)}`} title={p.name}>
        <div className="project-head">
          <ProgressBar progress={p.progress} size="lg" />
          <div className="project-head__facts">
            <span>
              <small>Avance</small>
              {p.progress.done} de {p.progress.total} tareas
            </span>
            <span>
              <small>Inicio</small>
              {formatDate(p.startDate)}
            </span>
            <span>
              <small>Entrega estimada</small>
              {formatDate(p.endDate)}
            </span>
            {staff ? (
              <label className="project-head__status">
                <small>Estado</small>
                <select value={p.status} onChange={(e) => setProjectStatus(e.target.value as ProjectStatus)}>
                  {Object.entries(PROJECT_STATUS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span>
                <small>Estado</small>
                {PROJECT_STATUS[p.status]}
              </span>
            )}
          </div>
        </div>
        {me.role === 'client' && mine > 0 && (
          <p className="callout">
            Tienes <strong>{mine}</strong> {mine === 1 ? 'tarea pendiente' : 'tareas pendientes'} de tu lado. Cuando la termines, márcala{' '}
            <em>En revisión</em> y nosotros la cerramos.
          </p>
        )}
      </PageHead>

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'tareas'} className={tab === 'tareas' ? 'is-active' : ''} onClick={() => setTab('tareas')}>
          Tareas
        </button>
        <button role="tab" aria-selected={tab === 'alcance'} className={tab === 'alcance' ? 'is-active' : ''} onClick={() => setTab('alcance')}>
          Alcance aprobado
        </button>
        {hasCommercial && (
          <button
            role="tab"
            aria-selected={tab === 'comercial'}
            className={tab === 'comercial' ? 'is-active' : ''}
            onClick={() => setTab('comercial')}
          >
            Propuesta y valores
          </button>
        )}
      </div>

      {tab === 'tareas' && (
        <section className="section section--flush">
          <div className="filters">
            {(['todas', 'deersystems', 'cliente'] as const).map((f) => (
              <button key={f} className={`chip${sideFilter === f ? ' is-active' : ''}`} onClick={() => setSideFilter(f)}>
                {{ todas: 'Todas', deersystems: 'DeerSystems', cliente: me.role === 'client' ? 'Mías' : 'Cliente' }[f]}
              </button>
            ))}
          </div>
          {byPhase.map((ph) => {
            const done = ph.tasks.filter((t) => t.status === 'completada').length;
            return (
              <div key={ph.id} className="phase">
                <div className="phase__head">
                  <h3>{ph.name}</h3>
                  <span className="mono">
                    {done}/{ph.tasks.length}
                  </span>
                </div>
                <ul className="tasks card">
                  {ph.tasks.map((t) => (
                    <TaskRow key={t.id} task={t} me={me} onStatus={setStatus} />
                  ))}
                </ul>
              </div>
            );
          })}
          {!byPhase.length && <p className="empty card">No hay tareas con este filtro.</p>}
        </section>
      )}

      {tab === 'alcance' && (
        <section className="section section--flush">
          <div className="card prose">{p.scope ? <Markdown text={p.scope} /> : <p>Sin alcance registrado.</p>}</div>
        </section>
      )}

      {tab === 'comercial' && hasCommercial && (
        <section className="section section--flush">
          <div className="card prose">
            {p.proposalUrl && (
              <p>
                <a className="btn btn--outline btn--sm" href={p.proposalUrl} target="_blank" rel="noopener">
                  Ver la propuesta original
                </a>
              </p>
            )}
            {p.pricing ? <Markdown text={p.pricing} /> : <p>Sin condiciones comerciales registradas.</p>}
          </div>
        </section>
      )}
    </>
  );
}
