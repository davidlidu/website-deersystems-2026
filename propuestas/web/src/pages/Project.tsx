import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  formatDate,
  navigate,
  PROJECT_STATUS,
  useApi,
  useLocation,
  type Me,
  type Progress,
  type ProjectDetail,
  type ProjectStatus,
  type Task,
  type TaskStatus,
  type TeamMember,
} from '../lib';
import { ErrorBox, Link, Loading, Markdown, PageHead, ProgressBar, useAction, useToast } from '../ui';
import { ActivityFeed } from './project/Activity';
import { FilesPanel } from './project/Files';
import { ProjectMeetings } from './project/Meetings';
import { NotesPanel } from './project/Notes';
import { TaskDrawer, type TaskDefaults } from './project/TaskDrawer';
import { PaymentsPanel } from './project/Payments';
import { TaskViews, VIEWS, type View } from './project/TaskViews';

type Tab = 'tareas' | 'reuniones' | 'avances' | 'notas' | 'archivos' | 'pagos' | 'bitacora' | 'alcance' | 'comercial';
const TABS: Tab[] = ['tareas', 'reuniones', 'avances', 'notas', 'archivos', 'pagos', 'bitacora', 'alcance', 'comercial'];

/** La vista elegida se recuerda en este navegador. */
function storedView(): View {
  try {
    const saved = localStorage.getItem('ds:view');
    // La antigua vista «Semana» ahora es el cronograma.
    const v = (saved === 'semana' ? 'cronograma' : saved) as View | null;
    return v && v in VIEWS ? v : 'lista';
  } catch {
    return 'lista';
  }
}

export function ProjectPage({ me, id }: { me: Me; id: number }) {
  const { data, error, loading, reload, setData } = useApi<ProjectDetail>(`projects/${id}`);
  const staff = me.role !== 'client';
  const team = useApi<TeamMember[]>(staff ? 'team' : null);
  const [tab, setTab] = useState<Tab>('tareas');
  const [view, setView] = useState<View>(storedView);
  const [sideFilter, setSideFilter] = useState<'todas' | 'deersystems' | 'cliente'>('todas');
  const [assignee, setAssignee] = useState<number | 'todos'>('todos');
  const [hideDone, setHideDone] = useState(false);
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState<{ taskId: number | null; defaults?: TaskDefaults } | null>(null);
  const toast = useToast();
  const { run } = useAction();
  const { query } = useLocation();

  // Enlaces de las notificaciones: ?tarea=12 abre esa tarea; ?tab=avances abre esa pestaña.
  const taskParam = Number(query.get('tarea')) || null;
  const tabParam = query.get('tab') as Tab | null;
  useEffect(() => {
    if (!taskParam && !tabParam) return;
    if (taskParam) {
      setTab('tareas');
      setDrawer({ taskId: taskParam });
    } else if (tabParam && TABS.includes(tabParam)) setTab(tabParam);
    navigate(`/proyectos/${id}`, true);
  }, [taskParam, tabParam, id]);

  const tasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.tasks ?? []).filter(
      (t) =>
        (sideFilter === 'todas' || t.side === sideFilter) &&
        (assignee === 'todos' || t.assigneeId === assignee) &&
        (!hideDone || t.status !== 'completada') &&
        (!q || `${t.title} ${t.description}`.toLowerCase().includes(q)),
    );
  }, [data, sideFilter, assignee, hideDone, search]);

  const patchTask = useCallback(
    (task: Task, progress?: Progress) => {
      if (!data) return;
      const exists = data.tasks.some((t) => t.id === task.id);
      setData({
        ...data,
        progress: progress ?? data.progress,
        tasks: exists ? data.tasks.map((t) => (t.id === task.id ? task : t)) : [...data.tasks, task],
      });
    },
    [data, setData],
  );

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const p = data!;

  const setStatus = (task: Task, status: TaskStatus) => {
    const prev = p;
    // Optimista: se ve al instante y se revierte si el servidor lo rechaza.
    setData({ ...p, tasks: p.tasks.map((t) => (t.id === task.id ? { ...t, status } : t)) });
    run(async () => {
      try {
        const r = await api<{ task: Task; progress: Progress }>('PATCH', `tasks/${task.id}`, { status });
        setData({ ...p, progress: r.progress, tasks: p.tasks.map((t) => (t.id === task.id ? r.task : t)) });
      } catch (err) {
        setData(prev);
        throw err;
      }
    });
  };

  const moveTask = (task: Task, patch: { dueDate: string; startDate: string | null }) => {
    const prev = p;
    setData({ ...p, tasks: p.tasks.map((t) => (t.id === task.id ? { ...t, ...patch } : t)) });
    run(async () => {
      try {
        const r = await api<{ task: Task; progress: Progress }>('PATCH', `tasks/${task.id}`, patch);
        patchTask(r.task, r.progress);
        toast(`«${task.title}» ahora se entrega el ${formatDate(patch.dueDate)}.`);
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

  const chooseView = (v: View) => {
    setView(v);
    try {
      localStorage.setItem('ds:view', v);
    } catch {
      /* sin almacenamiento: la vista se olvida al recargar */
    }
  };

  // Lo que ya mandó a revisión no cuenta: está en manos de DeerSystems.
  const mine = p.tasks.filter((t) => t.side === 'cliente' && t.status !== 'completada' && t.status !== 'en_revision').length;
  const hasCommercial = me.role !== 'team' && (p.pricing || p.proposalUrl);
  const openTask = drawer?.taskId ? p.tasks.find((t) => t.id === drawer.taskId) : null;

  const tabs: [Tab, string][] = [
    ['tareas', 'Tareas'],
    ['reuniones', 'Reuniones'],
    ['avances', 'Avances'],
    ['notas', 'Notas'],
    ['archivos', 'Archivos'],
    // Los pagos son valores: los ves tú y el cliente, nunca el equipo.
    ...(me.role !== 'team' ? ([['pagos', 'Pagos']] as [Tab, string][]) : []),
    ['bitacora', 'Bitácora'],
    ['alcance', 'Alcance aprobado'],
    ...(hasCommercial ? ([['comercial', 'Propuesta y valores']] as [Tab, string][]) : []),
  ];

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
      <PageHead
        eyebrow={`${p.clientName} · aprobado el ${formatDate(p.approvedAt)}${p.approvedOption ? ` · ${p.approvedOption}` : ''}`}
        title={p.name}
      >
        <div className="project-head" data-tour="project-head">
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
          <p className="callout" data-tour="project-callout">
            Tienes <strong>{mine}</strong> {mine === 1 ? 'tarea pendiente' : 'tareas pendientes'} de tu lado. Cuando la termines, márcala{' '}
            <em>En revisión</em> y nosotros la cerramos.
          </p>
        )}
      </PageHead>

      <div className="tabs" role="tablist" data-tour="project-tabs">
        {tabs.map(([t, label]) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'is-active' : ''} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'tareas' && (
        <section className="section section--flush">
          <div className="toolbar">
            <div className="segmented" role="tablist" aria-label="Vista" data-tour="project-views">
              {(Object.keys(VIEWS) as View[]).map((v) => (
                <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'is-active' : ''} onClick={() => chooseView(v)}>
                  {VIEWS[v]}
                </button>
              ))}
            </div>
            {staff && (
              <button className="btn btn--primary btn--sm" onClick={() => setDrawer({ taskId: null, defaults: {} })}>
                + Nueva tarea
              </button>
            )}
          </div>
          <div className="filters" data-tour="project-filters">
            {(['todas', 'deersystems', 'cliente'] as const).map((f) => (
              <button key={f} className={`chip${sideFilter === f ? ' is-active' : ''}`} onClick={() => setSideFilter(f)}>
                {{ todas: 'Todas', deersystems: 'DeerSystems', cliente: me.role === 'client' ? 'Mías' : 'Cliente' }[f]}
              </button>
            ))}
            {staff && (team.data?.length ?? 0) > 0 && (
              <span className="input input--chip">
                <select
                  value={assignee}
                  aria-label="Responsable"
                  onChange={(e) => setAssignee(e.target.value === 'todos' ? 'todos' : Number(e.target.value))}
                >
                  <option value="todos">Todos los responsables</option>
                  {team.data!.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </span>
            )}
            <label className="check check--chip">
              <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} /> Ocultar completadas
            </label>
            <span className="input input--search input--chip">
              <input placeholder="Buscar tarea…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </span>
          </div>
          <div data-tour="project-tasks">
            <TaskViews
              view={view}
              me={me}
              project={p}
              tasks={tasks}
              onOpen={(t) => setDrawer({ taskId: t.id })}
              onNew={(defaults) => setDrawer({ taskId: null, defaults })}
              onStatus={setStatus}
              onMove={moveTask}
              onPhasesChange={reload}
            />
          </div>
        </section>
      )}

      {tab === 'reuniones' && (
        <section className="section section--flush narrow-col">
          <ProjectMeetings me={me} project={p} onOpenTask={(t) => setDrawer({ taskId: t.id })} />
        </section>
      )}

      {tab === 'avances' && (
        <section className="section section--flush narrow-col">
          <NotesPanel me={me} projectId={p.id} kind="avance" />
        </section>
      )}

      {tab === 'notas' && (
        <section className="section section--flush narrow-col">
          <NotesPanel me={me} projectId={p.id} />
        </section>
      )}

      {tab === 'archivos' && (
        <section className="section section--flush narrow-col">
          <FilesPanel me={me} projectId={p.id} onChange={() => reload()} />
        </section>
      )}

      {tab === 'bitacora' && (
        <section className="section section--flush narrow-col">
          <ActivityFeed projectId={p.id} />
        </section>
      )}

      {tab === 'alcance' && (
        <section className="section section--flush">
          <div className="card prose">
            {(p.approvedOption || p.approvalNotes) && (
              <div className="approved-option">
                {p.approvedOption && (
                  <span>
                    <small>Opción aprobada</small>
                    {p.approvedOption}
                  </span>
                )}
                {p.approvalNotes && (
                  <span>
                    <small>Ajustes acordados</small>
                    {p.approvalNotes}
                  </span>
                )}
              </div>
            )}
            {p.scope ? <Markdown text={p.scope} /> : <p>Sin alcance registrado.</p>}
          </div>
        </section>
      )}

      {tab === 'pagos' && me.role !== 'team' && (
        <section className="section section--flush">
          <PaymentsPanel me={me} projectId={p.id} clientId={p.clientId} />
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

      {drawer && (drawer.taskId === null || openTask) && (
        <TaskDrawer
          key={drawer.taskId ?? 'new'}
          me={me}
          project={p}
          team={team.data ?? []}
          task={openTask ?? null}
          defaults={drawer.defaults}
          onClose={() => setDrawer(null)}
          onSaved={(task, progress) => patchTask(task, progress)}
          onDeleted={(taskId, progress) => setData({ ...p, progress, tasks: p.tasks.filter((t) => t.id !== taskId) })}
          onStatus={setStatus}
        />
      )}
    </>
  );
}
