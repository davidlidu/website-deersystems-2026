import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
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
import { UpdatesPanel } from './project/Updates';

/** Cinco pestañas: Avances (la principal), Plan de trabajo, Documentación, Alcance y propuesta, Pagos. */
type Tab = 'avances' | 'plan' | 'documentacion' | 'alcance' | 'pagos';
type PlanView = 'tareas' | 'reuniones' | 'cronograma';
type DocsView = 'archivos' | 'notas';
type DocsFilter = 'all' | 'shared' | 'internal';
interface Place {
  tab: Tab;
  plan?: PlanView;
  docs?: DocsView;
  log?: boolean;
}

/** Enlaces de notificaciones y correos (?tab=…), incluidos los nombres de antes de agrupar las pestañas. */
const PLACES: Record<string, Place> = {
  avances: { tab: 'avances' },
  bitacora: { tab: 'avances', log: true },
  plan: { tab: 'plan', plan: 'tareas' },
  tareas: { tab: 'plan', plan: 'tareas' },
  reuniones: { tab: 'plan', plan: 'reuniones' },
  cronograma: { tab: 'plan', plan: 'cronograma' },
  documentacion: { tab: 'documentacion' },
  archivos: { tab: 'documentacion', docs: 'archivos' },
  notas: { tab: 'documentacion', docs: 'notas' },
  alcance: { tab: 'alcance' },
  comercial: { tab: 'alcance' },
  pagos: { tab: 'pagos' },
};

/** Las vistas de la lista de tareas (el cronograma tiene su propio interruptor). */
const TASK_VIEWS: View[] = (Object.keys(VIEWS) as View[]).filter((v) => v !== 'cronograma');

/** La vista elegida se recuerda en este navegador. */
function storedView(): View {
  try {
    const saved = localStorage.getItem('ds:view') as View | null;
    return saved && TASK_VIEWS.includes(saved) ? saved : 'lista';
  } catch {
    return 'lista';
  }
}

const svg = (d: string) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const TAB_ICON: Record<Tab, ReactNode> = {
  avances: svg('M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2.1-.1-2.9a2.2 2.2 0 0 0-2.9-.1zM12 15l-3-3a22 22 0 0 1 2-3.9A12.9 12.9 0 0 1 22 2c0 2.7-.8 7.5-6 11a22.4 22.4 0 0 1-4 2zM9 12H4s.6-3 2-4c1.6-1.1 5 0 5 0M12 15v5s3-.6 4-2c1.1-1.6 0-5 0-5'),
  plan: svg('M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01'),
  documentacion: svg('M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z'),
  alcance: svg('M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2zM14 2v6h6M16 13H8M16 17H8M10 9H8'),
  pagos: svg('M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2zM2 10h20M6 15h4'),
};

function Segmented<T extends string>({ value, options, onChange, label, tour }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string; tour?: string }) {
  return (
    <div className="segmented" role="tablist" aria-label={label} data-tour={tour}>
      {options.map(([k, text]) => (
        <button key={k} role="tab" aria-selected={value === k} className={value === k ? 'is-active' : ''} onClick={() => onChange(k)}>
          {text}
        </button>
      ))}
    </div>
  );
}

export function ProjectPage({ me, id }: { me: Me; id: number }) {
  const { data, error, loading, reload, setData } = useApi<ProjectDetail>(`projects/${id}`);
  const staff = me.role !== 'client';
  const team = useApi<TeamMember[]>(staff ? 'team' : null);
  const [tab, setTab] = useState<Tab>('avances');
  const [plan, setPlan] = useState<PlanView>('tareas');
  const [docs, setDocs] = useState<DocsView>('archivos');
  const [docsFilter, setDocsFilter] = useState<DocsFilter>('all');
  const [log, setLog] = useState(false);
  const [focusUpdate, setFocusUpdate] = useState<number | null>(null);
  const [view, setView] = useState<View>(storedView);
  const [sideFilter, setSideFilter] = useState<'todas' | 'deersystems' | 'cliente'>('todas');
  const [assignee, setAssignee] = useState<number | 'todos'>('todos');
  const [hideDone, setHideDone] = useState(false);
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState<{ taskId: number | null; defaults?: TaskDefaults } | null>(null);
  const toast = useToast();
  const { run } = useAction();
  const { query } = useLocation();

  const go = useCallback((place: Place) => {
    setTab(place.tab);
    if (place.plan) setPlan(place.plan);
    if (place.docs) setDocs(place.docs);
    if (place.tab === 'avances') setLog(!!place.log);
  }, []);

  // Enlaces de las notificaciones: ?tarea=12 abre esa tarea; ?tab=avances abre esa pestaña; &avance=5 resalta ese avance.
  const taskParam = Number(query.get('tarea')) || null;
  const tabParam = query.get('tab');
  const updateParam = Number(query.get('avance')) || null;
  useEffect(() => {
    if (!taskParam && !tabParam) return;
    if (taskParam) {
      go(PLACES.tareas);
      setDrawer({ taskId: taskParam });
    } else if (tabParam && PLACES[tabParam]) go(PLACES[tabParam]);
    if (updateParam) setFocusUpdate(updateParam);
    navigate(`/proyectos/${id}`, true);
  }, [taskParam, tabParam, updateParam, id, go]);

  // El recorrido guiado pide abrir una pestaña (p. ej. «tareas» para mostrar las vistas).
  useEffect(() => {
    const onTour = (e: Event) => {
      const place = PLACES[(e as CustomEvent<string>).detail];
      if (place) go(place);
    };
    window.addEventListener('ds:project-tab', onTour);
    return () => window.removeEventListener('ds:project-tab', onTour);
  }, [go]);

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
    ['avances', 'Avances'],
    ['plan', 'Plan de trabajo'],
    ['documentacion', 'Documentación'],
    ['alcance', hasCommercial ? 'Alcance y propuesta' : 'Alcance'],
    // Los pagos son valores: los ves tú y el cliente, nunca el equipo.
    ...(me.role !== 'team' ? ([['pagos', 'Pagos']] as [Tab, string][]) : []),
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
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'is-active' : ''} onClick={() => go({ tab: t, ...(t === 'avances' ? { log: false } : {}) })}>
            {TAB_ICON[t]}
            {label}
          </button>
        ))}
      </div>

      {tab === 'avances' && (
        <section className="section section--flush updates-col">
          {log ? (
            <>
              <div className="subhead-row">
                <button className="linklike" onClick={() => setLog(false)}>
                  ← Volver a los avances
                </button>
                <h2>Bitácora técnica</h2>
              </div>
              <ActivityFeed projectId={p.id} />
            </>
          ) : (
            <UpdatesPanel
              me={me}
              project={p}
              focusId={focusUpdate}
              onOpenLog={() => setLog(true)}
              onAutoChange={(autoUpdates) => setData({ ...p, autoUpdates })}
            />
          )}
        </section>
      )}

      {tab === 'plan' && (
        <section className="section section--flush">
          <div className="toolbar">
            <Segmented
              label="Plan de trabajo"
              tour="project-plan"
              value={plan}
              onChange={setPlan}
              options={[
                ['tareas', 'Tareas'],
                ['cronograma', 'Cronograma'],
                ['reuniones', 'Calendario de reuniones'],
              ]}
            />
            {staff && plan !== 'reuniones' && (
              <button className="btn btn--primary btn--sm" onClick={() => setDrawer({ taskId: null, defaults: {} })}>
                + Nueva tarea
              </button>
            )}
          </div>
          {plan === 'reuniones' ? (
            <div className="narrow-col">
              <ProjectMeetings me={me} project={p} onOpenTask={(t) => setDrawer({ taskId: t.id })} onTasksChange={reload} />
            </div>
          ) : (
            <>
              <div className="filters" data-tour="project-filters">
                {plan === 'tareas' && (
                  <div className="segmented segmented--sm" role="tablist" aria-label="Vista" data-tour="project-views">
                    {TASK_VIEWS.map((v) => (
                      <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'is-active' : ''} onClick={() => chooseView(v)}>
                        {VIEWS[v]}
                      </button>
                    ))}
                  </div>
                )}
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
                  view={plan === 'cronograma' ? 'cronograma' : view}
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
            </>
          )}
        </section>
      )}

      {tab === 'documentacion' && (
        <section className="section section--flush narrow-col">
          <div className="toolbar">
            <Segmented
              label="Documentación"
              value={docs}
              onChange={setDocs}
              options={[
                ['archivos', 'Archivos'],
                ['notas', 'Notas'],
              ]}
            />
            {staff && (
              <div className="filters filters--inline" role="group" aria-label="Quién lo ve">
                {(
                  [
                    ['all', 'Todo'],
                    ['shared', 'Compartido con el cliente'],
                    ['internal', 'Interno'],
                  ] as [DocsFilter, string][]
                ).map(([f, text]) => (
                  <button key={f} className={`chip${docsFilter === f ? ' is-active' : ''}${f === 'internal' ? ' chip--internal' : ''}`} onClick={() => setDocsFilter(f)}>
                    {text}
                  </button>
                ))}
              </div>
            )}
          </div>
          {docs === 'archivos' ? (
            <FilesPanel key={docsFilter} me={me} projectId={p.id} onChange={() => reload()} filter={staff ? docsFilter : 'all'} />
          ) : (
            <NotesPanel key={docsFilter} me={me} projectId={p.id} filter={staff ? docsFilter : 'all'} rich />
          )}
        </section>
      )}

      {tab === 'alcance' && (
        <section className="section section--flush scope-page">
          <div className="card prose">
            <h2 className="scope-page__title">Alcance aprobado</h2>
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
          {hasCommercial && (
            <div className="card prose">
              <div className="scope-page__head">
                <h2 className="scope-page__title">Propuesta y valores</h2>
                {p.proposalUrl && (
                  <a className="btn btn--outline btn--sm" href={p.proposalUrl} target="_blank" rel="noopener">
                    Ver la propuesta original
                  </a>
                )}
              </div>
              {p.pricing ? <Markdown text={p.pricing} /> : <p>Sin condiciones comerciales registradas.</p>}
            </div>
          )}
        </section>
      )}

      {tab === 'pagos' && me.role !== 'team' && (
        <section className="section section--flush">
          <PaymentsPanel me={me} projectId={p.id} clientId={p.clientId} />
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
