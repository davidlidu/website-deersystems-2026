import { useMemo, useState } from 'react';
import {
  addDays,
  addMonths,
  api,
  dayLabel,
  formatDate,
  isOverdue,
  monthGrid,
  startOfMonth,
  STATUS,
  today,
  useApi,
  type Me,
  type Progress,
  type ProjectDetail,
  type ProjectSummary,
  type Task,
  type TaskStatus,
  type TeamMember,
} from '../lib';
import { Empty, ErrorBox, Link, Loading, PageHead, useAction } from '../ui';
import { TaskDrawer } from './project/TaskDrawer';

/**
 * Calendario general: lo que hay que entregar en todos los proyectos, en un solo lugar. Por mes (cada proyecto con
 * su color) o como agenda (atrasado, esta semana, las siguientes). La tarea se abre aquí mismo en un panel, para revisar
 * varias de distintos proyectos sin salir del calendario.
 */

type Delivery = Task & { projectId: number };
interface Data {
  projects: (ProjectSummary & { phases: { id: number; name: string }[] })[];
  tasks: Delivery[];
}

/** Colores que se distinguen bien en el tema oscuro, uno por proyecto. */
const COLORS = ['#7ed957', '#38bdf8', '#fb8500', '#c084fc', '#f472b6', '#facc15', '#2dd4bf', '#f87171', '#a3e635', '#60a5fa'];

const dayOf = (t: Task) => t.dueDate ?? t.startDate;

type Focus = 'todo' | 'atrasadas' | 'hoy' | 'semana' | 'revision' | 'reuniones';
const FOCUS_LABEL: Record<Exclude<Focus, 'todo'>, string> = {
  atrasadas: 'las atrasadas',
  hoy: 'lo que vence hoy',
  semana: 'lo de esta semana',
  revision: 'lo que está en revisión del cliente',
  reuniones: 'las reuniones de esta semana',
};
/** Cuántos proyectos se muestran en la leyenda antes de «+N». */
const LEGEND_MAX = 5;
/** Lunes de la semana de una fecha. */
const monday = (iso: string) => addDays(iso, -((new Date(`${iso}T12:00:00`).getDay() + 6) % 7));

export function CalendarPage({ me }: { me: Me }) {
  const [all, setAll] = useState(false);
  const { data, error, loading, setData, reload } = useApi<Data>(`deliveries${all ? '?all=1' : ''}`);
  const team = useApi<TeamMember[]>(me.role !== 'client' ? 'team' : null);
  const [focus, setFocus] = useState<Focus>('todo');
  const [legendOpen, setLegendOpen] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const { run } = useAction();
  const [view, setView] = useState<'mes' | 'agenda'>(() => (window.matchMedia?.('(max-width: 720px)').matches ? 'agenda' : 'mes'));
  const [project, setProject] = useState<number | 'todos'>('todos');
  const [side, setSide] = useState<'todas' | 'deersystems' | 'cliente'>('todas');
  const [meetings, setMeetings] = useState(true);
  const [hideDone, setHideDone] = useState(true);
  const [month, setMonth] = useState(() => startOfMonth(today()));

  const color = useMemo(() => new Map((data?.projects ?? []).map((p, i) => [p.id, COLORS[i % COLORS.length]])), [data]);
  const projects = useMemo(() => new Map((data?.projects ?? []).map((p) => [p.id, p])), [data]);
  const tasks = useMemo(
    () =>
      (data?.tasks ?? []).filter(
        (t) =>
          (project === 'todos' || t.projectId === project) &&
          (side === 'todas' || t.side === side) &&
          (meetings || !t.isMeeting) &&
          (!hideDone || t.status !== 'completada'),
      ),
    [data, project, side, meetings, hideDone],
  );
  const week = monday(today());
  const inWeek = (t: Task) => {
    const d = dayOf(t);
    return !!d && d >= today() && d < addDays(week, 7) && t.status !== 'completada';
  };
  const isToday = (t: Task) => dayOf(t) === today() && t.status !== 'completada';
  const inReview = (t: Task) => t.status === 'en_revision';
  const FILTERS: Record<Focus, (t: Task) => boolean> = {
    todo: () => true,
    atrasadas: isOverdue,
    hoy: isToday,
    semana: inWeek,
    revision: inReview,
    reuniones: (t) => t.isMeeting && inWeek(t),
  };
  const shown = tasks.filter(FILTERS[focus]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  if (!data) return null;

  const overdue = tasks.filter(isOverdue).length;
  const thisWeek = tasks.filter(inWeek).length;
  const weekClient = tasks.filter((t) => inWeek(t) && t.side === 'cliente').length;
  const dueToday = tasks.filter(isToday).length;
  const review = tasks.filter(inReview).length;
  const weekMeetings = tasks.filter((t) => t.isMeeting && inWeek(t)).length;
  const pending = tasks.filter((t) => t.status !== 'completada' && !t.isMeeting).length;
  const totals = data.projects.reduce((s, p) => ({ done: s.done + p.progress.done, total: s.total + p.progress.total }), { done: 0, total: 0 });
  const avgProgress = totals.total ? Math.round((totals.done / totals.total) * 100) : 0;
  const stat = (f: Exclude<Focus, 'todo'>, n: number, label: string, sub: string, tone = '') => (
    <button
      className={`gcal-stat${tone ? ` is-${tone}` : ''}${focus === f ? ' is-active' : ''}`}
      aria-pressed={focus === f}
      onClick={() => setFocus(focus === f ? 'todo' : f)}
      title={`Ver solo ${FOCUS_LABEL[f]}`}
    >
      <strong>{n}</strong>
      <span>{label}</span>
      <small>{sub}</small>
    </button>
  );
  // Leyenda corta: el cliente (o el proyecto, para el cliente); el nombre completo va en el título.
  const legendName = (p: (typeof data.projects)[number]) => {
    if (me.role === 'client') return p.name;
    const same = data.projects.filter((x) => x.clientName === p.clientName).length > 1;
    return same ? `${p.clientName} · ${p.name}` : p.clientName || p.name;
  };
  const legend = legendOpen ? data.projects : data.projects.slice(0, LEGEND_MAX);
  // Lo más importante de la semana: lo atrasado primero, luego lo que vence antes; las entregas pesan más que las reuniones.
  const key = [...tasks.filter((t) => isOverdue(t) || inWeek(t))]
    .sort(
      (a, b) =>
        Number(isOverdue(b)) - Number(isOverdue(a)) ||
        Number(a.isMeeting) - Number(b.isMeeting) ||
        (dayOf(a) ?? '').localeCompare(dayOf(b) ?? ''),
    )
    .slice(0, 6);

  const open = (t: Delivery) => setOpenId(t.id);
  const openTask = openId ? data.tasks.find((t) => t.id === openId) : undefined;
  const openProject = openTask ? projects.get(openTask.projectId) : undefined;
  // El panel de la tarea trabaja con el proyecto: sus fases y su avance bastan para editarla aquí.
  const detail: ProjectDetail | null =
    openTask && openProject
      ? { ...openProject, scope: '', approvalNotes: '', revisionRounds: null, revisionsIncluded: openTask.revisionsIncluded, tasks: data.tasks.filter((t) => t.projectId === openProject.id) }
      : null;
  const patch = (task: Task, progress?: Progress) =>
    setData({
      ...data,
      projects: data.projects.map((p) => (p.id === openTask?.projectId && progress ? { ...p, progress } : p)),
      tasks: data.tasks.map((t) => (t.id === task.id ? { ...task, projectId: t.projectId } : t)),
    });
  const setStatus = (task: Task, status: TaskStatus) =>
    run(async () => {
      const r = await api<{ task: Task; progress: Progress }>('PATCH', `tasks/${task.id}`, { status });
      patch(r.task, r.progress);
    });
  const chip = (t: Delivery, withProject = true) => {
    const p = projects.get(t.projectId);
    return (
      <button
        key={t.id}
        className={`gcal-chip is-${t.status}${isOverdue(t) ? ' is-overdue' : ''}${t.isMeeting ? ' is-meeting' : ''}`}
        style={{ '--pc': color.get(t.projectId) } as React.CSSProperties}
        onClick={() => open(t)}
        title={`${p?.name ?? ''} · ${t.title}`}
      >
        <span className="gcal-chip__title">
          {t.isMeeting && '◷ '}
          {t.title}
        </span>
        {withProject && <span className="gcal-chip__project">{me.role === 'client' ? p?.name : p?.clientName || p?.name}</span>}
      </button>
    );
  };

  return (
    <>
      <div className="gcal-hero">
        <div>
          <PageHead
            eyebrow={me.role === 'client' ? 'Tus proyectos' : 'Todos los proyectos'}
            title={
              <>
                Calendario de <span className="grad">entregas</span>
              </>
            }
          >
            <p className="gcal-lead">Qué se entrega y cuándo en cada proyecto. Toca un indicador para filtrar, o una entrega para actualizarla aquí mismo.</p>
          </PageHead>

          <div className="gcal-stats" role="group" aria-label="Ver solo">
            {stat('atrasadas', overdue, 'Atrasadas', overdue ? `de ${pending} entregas pendientes` : 'todo al día', overdue ? 'bad' : 'good')}
            {stat('hoy', dueToday, 'Vencen hoy', dueToday ? 'para cerrar hoy' : 'nada para hoy', dueToday ? 'warn' : '')}
            {stat('semana', thisWeek, 'Esta semana', weekClient ? `${weekClient} a cargo del cliente` : 'todo de nuestro lado')}
            {stat('revision', review, 'En revisión', review ? 'esperando visto bueno del cliente' : 'nada esperando al cliente')}
            {stat('reuniones', weekMeetings, 'Reuniones', 'esta semana')}
            <div className="gcal-stat is-static">
              <strong>{data.projects.length}</strong>
              <span>{all ? 'Proyectos' : 'Proyectos en curso'}</span>
              <small>avance promedio {avgProgress} %</small>
              <span className="gcal-stat__bar" aria-hidden="true">
                <span style={{ width: `${avgProgress}%` }} />
              </span>
            </div>
          </div>
          {focus !== 'todo' && (
            <p className="hint">
              Viendo solo {FOCUS_LABEL[focus]} ·{' '}
              <button className="linklike" onClick={() => setFocus('todo')}>
                ver todo
              </button>
            </p>
          )}
        </div>

        <aside className="card gcal-top" aria-label="Lo más importante de esta semana">
          <p className="eyebrow">Lo más importante esta semana</p>
          {key.length ? (
            <ul>
              {key.map((t) => {
                const p = projects.get(t.projectId);
                const d = dayOf(t);
                return (
                  <li key={t.id} style={{ '--pc': color.get(t.projectId) } as React.CSSProperties}>
                    <button onClick={() => open(t)}>
                      <span className="gcal-top__title">
                        {t.isMeeting && '◷ '}
                        {t.title}
                      </span>
                      <span className="gcal-top__meta">
                        <span className="gcal-dot" />
                        {me.role === 'client' ? p?.name : p?.clientName || p?.name}
                      </span>
                    </button>
                    <span className={`gcal-top__when${isOverdue(t) ? ' is-late' : ''}`}>
                      {isOverdue(t) ? 'Atrasada' : d === today() ? 'Hoy' : d ? dayLabel(d, { weekday: 'short', day: 'numeric' }) : ''}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="hint">Nada atrasado ni pendiente para esta semana.</p>
          )}
        </aside>
      </div>

      <div className="filters filters--plan">
        <div className="viewswitch" role="tablist" aria-label="Ver como">
          {(
            [
              ['mes', 'Mes'],
              ['agenda', 'Agenda'],
            ] as const
          ).map(([v, l]) => (
            <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'is-active' : ''} onClick={() => setView(v)}>
              {l}
            </button>
          ))}
        </div>
        <span className="filters__sep" aria-hidden="true" />
        <span className="filters__label">Filtrar</span>
        <span className="input input--chip">
          <select value={project} aria-label="Proyecto" onChange={(e) => setProject(e.target.value === 'todos' ? 'todos' : Number(e.target.value))}>
            <option value="todos">Todos los proyectos</option>
            {data.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {me.role === 'client' ? p.name : `${p.clientName} · ${p.name}`}
              </option>
            ))}
          </select>
        </span>
        {(['todas', 'deersystems', 'cliente'] as const).map((f) => (
          <button key={f} className={`chip${side === f ? ' is-active' : ''}`} onClick={() => setSide(f)}>
            {{ todas: 'Todas', deersystems: 'DeerSystems', cliente: me.role === 'client' ? 'Mías' : 'Cliente' }[f]}
          </button>
        ))}
        <label className="check check--chip">
          <input type="checkbox" checked={meetings} onChange={(e) => setMeetings(e.target.checked)} /> Reuniones
        </label>
        <label className="check check--chip">
          <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} /> Ocultar completadas
        </label>
        <label className="check check--chip">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Incluir finalizados
        </label>
      </div>

      {project === 'todos' && data.projects.length > 1 && (
        <div className="gcal-legend" aria-label="Proyectos (clic para ver solo uno)">
          {legend.map((p) => (
            <button
              key={p.id}
              className="gcal-legend__item"
              onClick={() => setProject(p.id)}
              title={`${me.role === 'client' ? p.name : `${p.clientName} · ${p.name}`} — ver solo este proyecto`}
            >
              <span className="gcal-dot" style={{ background: color.get(p.id) }} />
              <span className="gcal-legend__name">{legendName(p)}</span>
            </button>
          ))}
          {data.projects.length > LEGEND_MAX && (
            <button className="gcal-legend__more" onClick={() => setLegendOpen(!legendOpen)}>
              {legendOpen ? 'Ver menos' : `+${data.projects.length - LEGEND_MAX}`}
            </button>
          )}
        </div>
      )}
      {project !== 'todos' && (
        <p className="hint">
          Viendo solo <strong>{projects.get(project)?.name}</strong> ·{' '}
          <button className="linklike" onClick={() => setProject('todos')}>
            ver todos
          </button>{' '}
          · <Link to={`/proyectos/${project}`}>abrir el proyecto</Link>
        </p>
      )}

      {!data.projects.length ? (
        <Empty>No hay proyectos en curso. Cuando haya proyectos activos, sus entregas aparecen aquí.</Empty>
      ) : view === 'mes' ? (
        <MonthGrid month={month} setMonth={setMonth} tasks={shown} chip={chip} />
      ) : (
        <Agenda tasks={shown} chip={chip} projects={projects} color={color} />
      )}

      {openTask && detail && (
        <TaskDrawer
          key={openTask.id}
          me={me}
          project={detail}
          team={team.data ?? []}
          task={openTask}
          onClose={() => setOpenId(null)}
          onSaved={(task, progress) => patch(task, progress)}
          onDeleted={(taskId, progress) => {
            setOpenId(null);
            setData({
              ...data,
              projects: data.projects.map((p) => (p.id === openTask.projectId ? { ...p, progress } : p)),
              tasks: data.tasks.filter((t) => t.id !== taskId),
            });
          }}
          onStatus={setStatus}
          onReload={reload}
          context={{
            label: me.role === 'client' ? detail.name : `${detail.clientName} · ${detail.name}`,
            href: `/proyectos/${detail.id}?tarea=${openTask.id}`,
          }}
        />
      )}
    </>
  );
}

function MonthGrid({
  month,
  setMonth,
  tasks,
  chip,
}: {
  month: string;
  setMonth: (m: string) => void;
  tasks: Delivery[];
  chip: (t: Delivery) => React.ReactNode;
}) {
  const byDay = useMemo(() => {
    const m = new Map<string, Delivery[]>();
    for (const t of tasks) {
      const d = dayOf(t);
      if (d) m.set(d, [...(m.get(d) ?? []), t]);
    }
    return m;
  }, [tasks]);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <div className="cal-nav">
        <button className="btn btn--outline btn--sm" onClick={() => setMonth(addMonths(month, -1))} aria-label="Mes anterior">
          ‹
        </button>
        <button className="btn btn--outline btn--sm" onClick={() => setMonth(startOfMonth(today()))}>
          Hoy
        </button>
        <button className="btn btn--outline btn--sm" onClick={() => setMonth(addMonths(month, 1))} aria-label="Mes siguiente">
          ›
        </button>
        <h3>{dayLabel(month, { month: 'long', year: 'numeric' })}</h3>
      </div>
      <div className="month gcal-month">
        {['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'].map((d) => (
          <span key={d} className="month__dow">
            {d}
          </span>
        ))}
        {monthGrid(month).map((d) => {
          const list = byDay.get(d) ?? [];
          const limit = open === d ? Infinity : 4;
          const weekend = [0, 6].includes(new Date(`${d}T12:00:00`).getDay());
          return (
            <div key={d} className={`day${d.slice(0, 7) !== month.slice(0, 7) ? ' is-muted' : ''}${d === today() ? ' is-today' : ''}${weekend ? ' is-weekend' : ''}`}>
              <div className="day__head">
                <span className="day__num">{Number(d.slice(8))}</span>
                {list.length > 0 && <span className="mono gcal-count">{list.length}</span>}
              </div>
              <div className="day__list">
                {list.slice(0, limit).map((t) => chip(t))}
                {list.length > limit && (
                  <button className="day__more" onClick={() => setOpen(d)}>
                    +{list.length - limit} más
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/** Agenda: atrasado primero, luego semana por semana (12 semanas) y lo que no tiene fecha. */
function Agenda({
  tasks,
  chip,
  projects,
  color,
}: {
  tasks: Delivery[];
  chip: (t: Delivery, withProject?: boolean) => React.ReactNode;
  projects: Map<number, ProjectSummary>;
  color: Map<number, string>;
}) {
  const t0 = today();
  const start = monday(t0);
  const sorted = [...tasks].sort((a, b) => (dayOf(a) ?? '9999').localeCompare(dayOf(b) ?? '9999'));
  const groups: { title: string; bad?: boolean; items: Delivery[] }[] = [];
  const late = sorted.filter(isOverdue);
  if (late.length) groups.push({ title: 'Atrasadas', bad: true, items: late });
  for (let w = 0; w < 12; w++) {
    const from = addDays(start, w * 7);
    const to = addDays(from, 7);
    const items = sorted.filter((t) => {
      const d = dayOf(t);
      return d && d >= from && d < to && !isOverdue(t) && (w > 0 || d >= t0 || t.status === 'completada');
    });
    if (!items.length) continue;
    groups.push({
      title: w === 0 ? 'Esta semana' : w === 1 ? 'La próxima semana' : `Semana del ${formatDate(from, false)}`,
      items,
    });
  }
  const later = sorted.filter((t) => {
    const d = dayOf(t);
    return d && d >= addDays(start, 84);
  });
  if (later.length) groups.push({ title: 'Más adelante', items: later });
  const undated = sorted.filter((t) => !dayOf(t));
  if (undated.length) groups.push({ title: 'Sin fecha', items: undated });

  if (!groups.length) return <Empty>Nada por entregar con estos filtros.</Empty>;
  return (
    <div className="gcal-agenda">
      {groups.map((g) => (
        <section key={g.title} className={`gcal-week${g.bad ? ' is-bad' : ''}`}>
          <h3>
            {g.title} <span className="mono">{g.items.length}</span>
          </h3>
          <ul>
            {g.items.map((t) => {
              const p = projects.get(t.projectId);
              const d = dayOf(t);
              return (
                <li key={t.id} style={{ '--pc': color.get(t.projectId) } as React.CSSProperties}>
                  <span className="gcal-agenda__date">{d ? dayLabel(d, { weekday: 'short', day: 'numeric', month: 'short' }) : '—'}</span>
                  <span className="gcal-agenda__project">
                    <span className="gcal-dot" />
                    {p?.clientName ? `${p.clientName} · ${p.name}` : p?.name}
                  </span>
                  {chip(t, false)}
                  <span className={`gcal-agenda__status is-${isOverdue(t) ? 'late' : t.status}`}>{isOverdue(t) ? 'Atrasada' : STATUS[t.status]}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
