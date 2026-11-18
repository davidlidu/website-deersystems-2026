import { useMemo, useState } from 'react';
import { addDays, addMonths, dayLabel, formatDate, isOverdue, monthGrid, navigate, startOfMonth, STATUS, today, useApi, type Me, type ProjectSummary, type Task } from '../lib';
import { Empty, ErrorBox, Link, Loading, PageHead } from '../ui';

/**
 * Calendario general: lo que hay que entregar en todos los proyectos, en un solo lugar. Por mes (cada proyecto con
 * su color) o como agenda (atrasado, esta semana, las siguientes). Al hacer clic se abre la tarea en su proyecto.
 */

type Delivery = Task & { projectId: number };
interface Data {
  projects: (ProjectSummary & { phases: { id: number; name: string }[] })[];
  tasks: Delivery[];
}

/** Colores que se distinguen bien en el tema oscuro, uno por proyecto. */
const COLORS = ['#7ed957', '#38bdf8', '#fb8500', '#c084fc', '#f472b6', '#facc15', '#2dd4bf', '#f87171', '#a3e635', '#60a5fa'];

const dayOf = (t: Task) => t.dueDate ?? t.startDate;
/** Lunes de la semana de una fecha. */
const monday = (iso: string) => addDays(iso, -((new Date(`${iso}T12:00:00`).getDay() + 6) % 7));

export function CalendarPage({ me }: { me: Me }) {
  const [all, setAll] = useState(false);
  const { data, error, loading } = useApi<Data>(`deliveries${all ? '?all=1' : ''}`);
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

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} />;
  if (!data) return null;

  const overdue = tasks.filter(isOverdue).length;
  const week = monday(today());
  const thisWeek = tasks.filter((t) => {
    const d = dayOf(t);
    return d && d >= today() && d < addDays(week, 7);
  }).length;

  const open = (t: Delivery) => navigate(`/proyectos/${t.projectId}?tab=plan&tarea=${t.id}`);
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
      <PageHead
        eyebrow={me.role === 'client' ? 'Tus proyectos' : 'Todos los proyectos'}
        title={
          <>
            Calendario de <span className="grad">entregas</span>
          </>
        }
      >
        <p>Qué se entrega y cuándo en cada proyecto. Haz clic en una entrega para abrirla en su proyecto.</p>
      </PageHead>

      <div className="gcal-stats">
        <div className={`gcal-stat${overdue ? ' is-bad' : ''}`}>
          <strong>{overdue}</strong>
          <span>atrasadas</span>
        </div>
        <div className="gcal-stat">
          <strong>{thisWeek}</strong>
          <span>para esta semana</span>
        </div>
        <div className="gcal-stat">
          <strong>{data.projects.length}</strong>
          <span>{all ? 'proyectos' : 'proyectos en curso'}</span>
        </div>
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
        <div className="gcal-legend">
          {data.projects.map((p) => (
            <button key={p.id} className="gcal-legend__item" onClick={() => setProject(p.id)} title="Ver solo este proyecto">
              <span className="gcal-dot" style={{ background: color.get(p.id) }} />
              {me.role === 'client' ? p.name : `${p.clientName} · ${p.name}`}
            </button>
          ))}
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
        <MonthGrid month={month} setMonth={setMonth} tasks={tasks} chip={chip} />
      ) : (
        <Agenda tasks={tasks} chip={chip} projects={projects} color={color} />
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
