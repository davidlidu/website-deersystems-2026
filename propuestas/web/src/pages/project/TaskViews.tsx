import { useMemo, useState, type DragEvent } from 'react';
import {
  addDays,
  addMonths,
  api,
  CLIENT_STATUSES,
  dayLabel,
  daysBetween,
  formatDate,
  isOverdue,
  monthGrid,
  startOfMonth,
  startOfWeek,
  STATUS,
  STATUSES,
  today,
  type Me,
  type ProjectDetail,
  type Task,
  type TaskStatus,
} from '../../lib';
import { StatusPill, useAction } from '../../ui';
import type { TaskDefaults } from './TaskDrawer';

export type View = 'lista' | 'tablero' | 'semana' | 'calendario';
export const VIEWS: Record<View, string> = { lista: 'Lista', tablero: 'Tablero', semana: 'Semana', calendario: 'Calendario' };

interface Props {
  me: Me;
  project: ProjectDetail;
  tasks: Task[];
  onOpen: (task: Task) => void;
  onNew: (defaults: TaskDefaults) => void;
  onStatus: (task: Task, status: TaskStatus) => void;
  onMove: (task: Task, patch: { dueDate: string; startDate: string | null }) => void;
  onPhasesChange: () => void;
}

// ───────── Piezas comunes ─────────

function Who({ task }: { task: Task }) {
  return <span className={`side side--${task.side}`}>{task.side === 'cliente' ? 'Cliente' : (task.assigneeName ?? 'DeerSystems')}</span>;
}

function StatusControl({ task, me, onStatus }: { task: Task; me: Me; onStatus: Props['onStatus'] }) {
  if (!task.canChangeStatus) return <StatusPill status={task.status} />;
  const options = me.role === 'client' ? CLIENT_STATUSES : STATUSES;
  return (
    <select
      className={`pill pill--${task.status} pill--select`}
      value={task.status}
      aria-label={`Estado de ${task.title}`}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onStatus(task, e.target.value as TaskStatus)}
    >
      {[...new Set([task.status, ...options])].map((s) => (
        <option key={s} value={s}>
          {STATUS[s]}
        </option>
      ))}
    </select>
  );
}

/** Tarjeta compacta para tablero, semana y calendario. */
function TaskChip({ task, onOpen, draggable }: { task: Task; onOpen: (t: Task) => void; draggable: boolean }) {
  return (
    <button
      className={`chip-task is-${task.status} side-${task.side}${isOverdue(task) ? ' is-overdue' : ''}`}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/task', String(task.id));
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={() => onOpen(task)}
      title={task.title}
    >
      <span className="chip-task__title">{task.title}</span>
      <span className="chip-task__meta">
        <Who task={task} />
        <span className="mono">
          {task.comments > 0 && `💬 ${task.comments}`} {task.files > 0 && `📎 ${task.files}`}
        </span>
      </span>
    </button>
  );
}

const dropTaskId = (e: DragEvent) => Number(e.dataTransfer.getData('text/task')) || null;

function useDropZone(onDrop: (taskId: number) => void, enabled = true) {
  const [over, setOver] = useState(false);
  return {
    over,
    props: enabled
      ? {
          onDragOver: (e: DragEvent) => {
            e.preventDefault();
            setOver(true);
          },
          onDragLeave: () => setOver(false),
          onDrop: (e: DragEvent) => {
            e.preventDefault();
            setOver(false);
            const id = dropTaskId(e);
            if (id) onDrop(id);
          },
        }
      : {},
  };
}

// ───────── Lista (por fase) ─────────

function PhaseHeader({ name, id, count, done, staff, onChanged, onNew }: {
  name: string;
  id: number;
  count: number;
  done: number;
  staff: boolean;
  onChanged: () => void;
  onNew: () => void;
}) {
  const { busy, run } = useAction();
  const rename = () => {
    const next = prompt('Nombre de la fase:', name);
    if (!next?.trim() || next === name) return;
    run(async () => {
      await api('PATCH', `phases/${id}`, { name: next });
      onChanged();
    });
  };
  const remove = () => {
    if (!confirm(`¿Eliminar la fase «${name}»? Sus tareas quedan en «Sin fase».`)) return;
    run(async () => {
      await api('DELETE', `phases/${id}`);
      onChanged();
    });
  };
  return (
    <div className="phase__head">
      <h3>{name}</h3>
      <span className="mono">
        {done}/{count}
      </span>
      {staff && id > 0 && (
        <span className="phase__tools">
          <button onClick={onNew} disabled={busy}>
            + Tarea
          </button>
          <button onClick={rename} disabled={busy}>
            Renombrar
          </button>
          <button onClick={remove} disabled={busy}>
            Eliminar
          </button>
        </span>
      )}
    </div>
  );
}

function ListView({ me, project, tasks, onOpen, onNew, onStatus, onPhasesChange }: Props) {
  const staff = me.role !== 'client';
  const { busy, run } = useAction();
  const groups = [
    ...project.phases.map((ph) => ({ id: ph.id, name: ph.name, tasks: tasks.filter((t) => t.phaseId === ph.id) })),
    { id: 0, name: 'Sin fase', tasks: tasks.filter((t) => !t.phaseId || !project.phases.some((ph) => ph.id === t.phaseId)) },
  ].filter((g) => g.tasks.length || (staff && g.id > 0));

  const addPhase = () => {
    const name = prompt('Nombre de la nueva fase:');
    if (!name?.trim()) return;
    run(async () => {
      await api('POST', `projects/${project.id}/phases`, { name });
      onPhasesChange();
    });
  };

  return (
    <>
      {groups.map((g) => (
        <div key={g.id} className="phase">
          <PhaseHeader
            id={g.id}
            name={g.name}
            count={g.tasks.length}
            done={g.tasks.filter((t) => t.status === 'completada').length}
            staff={staff}
            onChanged={onPhasesChange}
            onNew={() => onNew({ phaseId: g.id })}
          />
          {g.tasks.length ? (
            <ul className="tasks card">
              {g.tasks.map((t) => (
                <li key={t.id} className={`task is-${t.status}${isOverdue(t) ? ' is-overdue' : ''}`}>
                  <div className="task__main">
                    <button className="task__title" onClick={() => onOpen(t)}>
                      {t.title}
                    </button>
                    <div className="task__meta">
                      <Who task={t} />
                      {t.dueDate && (
                        <span className="mono">
                          {isOverdue(t) ? 'Vencida · ' : 'Entrega · '}
                          {formatDate(t.dueDate, false)}
                        </span>
                      )}
                      {t.comments > 0 && <span className="mono">💬 {t.comments}</span>}
                      {t.files > 0 && <span className="mono">📎 {t.files}</span>}
                    </div>
                  </div>
                  <StatusControl task={t} me={me} onStatus={onStatus} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty card">Fase sin tareas.</p>
          )}
        </div>
      ))}
      {!groups.length && <p className="empty card">No hay tareas con este filtro.</p>}
      {staff && (
        <button className="btn btn--outline btn--sm" onClick={addPhase} disabled={busy}>
          + Fase
        </button>
      )}
    </>
  );
}

// ───────── Tablero (columnas por estado, como en ClickUp) ─────────

function BoardColumn({ status, tasks, me, onOpen, onNew, onStatus, all }: {
  status: TaskStatus;
  tasks: Task[];
  all: Task[];
  me: Me;
  onOpen: Props['onOpen'];
  onNew: Props['onNew'];
  onStatus: Props['onStatus'];
}) {
  const client = me.role === 'client';
  const accepts = !client || CLIENT_STATUSES.includes(status);
  const drop = useDropZone((id) => {
    const task = all.find((t) => t.id === id);
    if (task && task.status !== status && task.canChangeStatus) onStatus(task, status);
  }, accepts);
  return (
    <section className={`board__col board__col--${status}${drop.over ? ' is-over' : ''}${accepts ? '' : ' is-locked'}`} {...drop.props}>
      <header className="board__head">
        <span className={`pill pill--${status}`}>{STATUS[status]}</span>
        <span className="mono">{tasks.length}</span>
      </header>
      <div className="board__list">
        {tasks.map((t) => (
          <TaskChip key={t.id} task={t} onOpen={onOpen} draggable={t.canChangeStatus} />
        ))}
      </div>
      {!client && (
        <button className="board__add" onClick={() => onNew({ status })}>
          + Tarea
        </button>
      )}
    </section>
  );
}

function BoardView(props: Props) {
  return (
    <div className="board">
      {STATUSES.map((s) => (
        <BoardColumn key={s} {...props} status={s} tasks={props.tasks.filter((t) => t.status === s)} all={props.tasks} />
      ))}
    </div>
  );
}

// ───────── Semana y calendario (por fecha de entrega) ─────────

/** Fecha con la que una tarea aparece en el calendario: la entrega o, si no tiene, el inicio. */
const dayOf = (t: Task) => t.dueDate ?? t.startDate;

function DayCell({ day, tasks, all, me, onOpen, onNew, onMove, muted, compact }: {
  day: string;
  tasks: Task[];
  all: Task[];
  me: Me;
  onOpen: Props['onOpen'];
  onNew: Props['onNew'];
  onMove: Props['onMove'];
  muted?: boolean;
  compact?: boolean;
}) {
  const staff = me.role !== 'client';
  const [expanded, setExpanded] = useState(false);
  const drop = useDropZone((id) => {
    const t = all.find((x) => x.id === id);
    if (!t || dayOf(t) === day) return;
    // Mover conserva la duración: el inicio se corre los mismos días que la entrega.
    const from = dayOf(t);
    const shift = from ? daysBetween(from, day) : 0;
    onMove(t, { dueDate: day, startDate: t.startDate && t.dueDate ? addDays(t.startDate, shift) : t.startDate });
  }, staff);
  const limit = compact && !expanded ? 3 : Infinity;
  const isToday = day === today();
  const weekend = [0, 6].includes(new Date(`${day}T12:00:00`).getDay());
  return (
    <div
      className={`day${muted ? ' is-muted' : ''}${isToday ? ' is-today' : ''}${weekend ? ' is-weekend' : ''}${drop.over ? ' is-over' : ''}`}
      {...drop.props}
    >
      <div className="day__head">
        <span className="day__num">{compact ? Number(day.slice(8)) : dayLabel(day, { weekday: 'short', day: 'numeric' })}</span>
        {staff && (
          <button className="day__add" onClick={() => onNew({ dueDate: day })} aria-label={`Nueva tarea para el ${formatDate(day)}`}>
            +
          </button>
        )}
      </div>
      <div className="day__list">
        {tasks.slice(0, limit).map((t) => (
          <TaskChip key={t.id} task={t} onOpen={onOpen} draggable={staff} />
        ))}
        {tasks.length > limit && (
          <button className="day__more" onClick={() => setExpanded(true)}>
            +{tasks.length - limit} más
          </button>
        )}
      </div>
    </div>
  );
}

function Unscheduled({ tasks, onOpen }: { tasks: Task[]; onOpen: Props['onOpen'] }) {
  if (!tasks.length) return null;
  return (
    <div className="unscheduled">
      <span className="field__label">Sin fecha ({tasks.length})</span>
      <div className="unscheduled__list">
        {tasks.map((t) => (
          <TaskChip key={t.id} task={t} onOpen={onOpen} draggable />
        ))}
      </div>
    </div>
  );
}

function CalendarNav({ label, onPrev, onNext, onToday }: { label: string; onPrev: () => void; onNext: () => void; onToday: () => void }) {
  return (
    <div className="cal-nav">
      <button className="btn btn--outline btn--sm" onClick={onPrev} aria-label="Anterior">
        ‹
      </button>
      <button className="btn btn--outline btn--sm" onClick={onToday}>
        Hoy
      </button>
      <button className="btn btn--outline btn--sm" onClick={onNext} aria-label="Siguiente">
        ›
      </button>
      <h3>{label}</h3>
    </div>
  );
}

function useByDay(tasks: Task[]) {
  return useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      const d = dayOf(t);
      if (!d) continue;
      map.set(d, [...(map.get(d) ?? []), t]);
    }
    return map;
  }, [tasks]);
}

/** Semana a la que conviene abrir: la actual si el proyecto está en curso; si no, la del inicio del proyecto. */
function initialDay(project: ProjectDetail): string {
  const t = today();
  if (project.startDate && t < project.startDate) return project.startDate;
  if (project.endDate && t > project.endDate) return project.endDate;
  return t;
}

function WeekView(props: Props) {
  const [week, setWeek] = useState(() => startOfWeek(initialDay(props.project)));
  const byDay = useByDay(props.tasks);
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const end = days[6];
  // Tareas que siguen en curso esta semana pero se entregan después.
  const ongoing = props.tasks.filter((t) => t.startDate && t.dueDate && t.startDate <= end && t.dueDate > end && t.status !== 'completada');
  return (
    <>
      <CalendarNav
        label={`${dayLabel(week, { day: 'numeric', month: 'short' })} – ${dayLabel(end, { day: 'numeric', month: 'short', year: 'numeric' })}`}
        onPrev={() => setWeek(addDays(week, -7))}
        onNext={() => setWeek(addDays(week, 7))}
        onToday={() => setWeek(startOfWeek(today()))}
      />
      {ongoing.length > 0 && (
        <div className="unscheduled">
          <span className="field__label">En curso esta semana, con entrega posterior</span>
          <div className="unscheduled__list">
            {ongoing.map((t) => (
              <TaskChip key={t.id} task={t} onOpen={props.onOpen} draggable={false} />
            ))}
          </div>
        </div>
      )}
      <div className="week">
        {days.map((d) => (
          <DayCell key={d} {...props} day={d} tasks={byDay.get(d) ?? []} all={props.tasks} />
        ))}
      </div>
      <Unscheduled tasks={props.tasks.filter((t) => !dayOf(t))} onOpen={props.onOpen} />
    </>
  );
}

function MonthView(props: Props) {
  const [month, setMonth] = useState(() => startOfMonth(initialDay(props.project)));
  const byDay = useByDay(props.tasks);
  const grid = monthGrid(month);
  return (
    <>
      <CalendarNav
        label={dayLabel(month, { month: 'long', year: 'numeric' })}
        onPrev={() => setMonth(addMonths(month, -1))}
        onNext={() => setMonth(addMonths(month, 1))}
        onToday={() => setMonth(startOfMonth(today()))}
      />
      <div className="month">
        {['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'].map((d) => (
          <span key={d} className="month__dow">
            {d}
          </span>
        ))}
        {grid.map((d) => (
          <DayCell key={d} {...props} day={d} tasks={byDay.get(d) ?? []} all={props.tasks} muted={d.slice(0, 7) !== month.slice(0, 7)} compact />
        ))}
      </div>
      <Unscheduled tasks={props.tasks.filter((t) => !dayOf(t))} onOpen={props.onOpen} />
    </>
  );
}

export function TaskViews({ view, ...props }: Props & { view: View }) {
  if (view === 'tablero') return <BoardView {...props} />;
  if (view === 'semana') return <WeekView {...props} />;
  if (view === 'calendario') return <MonthView {...props} />;
  return <ListView {...props} />;
}
