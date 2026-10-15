import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { addDays, dayLabel, daysBetween, formatDate, isOverdue, STATUS, today, type Me, type ProjectDetail, type Task } from '../../lib';

type Zoom = 'dias' | 'semanas' | 'meses';
const DAY_WIDTH: Record<Zoom, number> = { dias: 40, semanas: 22, meses: 8 };
const ZOOM_LABEL: Record<Zoom, string> = { dias: 'Días', semanas: 'Semanas', meses: 'Meses' };

interface Props {
  me: Me;
  project: ProjectDetail;
  tasks: Task[];
  onOpen: (task: Task) => void;
  onMove: (task: Task, patch: { dueDate: string; startDate: string | null }) => void;
}

/** Inicio y fin de la barra: si falta una fecha, la tarea dura un día. */
function span(t: Task): [string, string] | null {
  const start = t.startDate ?? t.dueDate;
  const end = t.dueDate ?? t.startDate;
  return start && end ? [start, end < start ? start : end] : null;
}

/** 0 = lunes … 6 = domingo. */
const weekday = (iso: string) => (new Date(`${iso}T12:00:00`).getDay() + 6) % 7;

type Drag = { id: number; mode: 'move' | 'start' | 'end'; x: number; delta: number; moved: boolean };

/**
 * Cronograma tipo Gantt: cada tarea es una barra de inicio a entrega, agrupada por fase.
 * El equipo arrastra la barra para moverla o estira sus bordes para cambiar inicio o entrega.
 */
export function GanttView({ me, project, tasks, onOpen, onMove }: Props) {
  const [zoom, setZoom] = useState<Zoom>('semanas');
  const [drag, setDrag] = useState<Drag | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const editable = me.role !== 'client';
  const day = DAY_WIDTH[zoom];
  const now = today();

  // Rango visible: todo el proyecto y sus tareas, con un margen a cada lado, empezando en lunes.
  const range = useMemo(() => {
    const dates = [now, project.startDate, project.endDate, ...tasks.flatMap((t) => [t.startDate, t.dueDate])].filter(Boolean) as string[];
    const min = dates.reduce((a, b) => (a < b ? a : b));
    const max = dates.reduce((a, b) => (a > b ? a : b));
    const first = addDays(min, -7 - weekday(addDays(min, -7)));
    const total = Math.min(Math.max(daysBetween(first, max) + 21, 42), 800);
    return { first, total, days: Array.from({ length: total }, (_, i) => addDays(first, i)) };
  }, [tasks, project.startDate, project.endDate, now]);

  const x = (iso: string) => daysBetween(range.first, iso) * day;

  // Al abrir (o cambiar la escala), se centra en hoy.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = Math.max(0, x(now) - el.clientWidth / 3);
  }, [zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = [
    ...project.phases.map((ph) => ({ id: ph.id, name: ph.name, tasks: tasks.filter((t) => t.phaseId === ph.id) })),
    { id: 0, name: 'Sin fase', tasks: tasks.filter((t) => !t.phaseId || !project.phases.some((ph) => ph.id === t.phaseId)) },
  ].filter((g) => g.tasks.length);
  const unscheduled = tasks.filter((t) => !span(t));

  // ── Arrastre (pointer events: sirve con mouse y con el dedo)
  const begin = (e: ReactPointerEvent, t: Task, mode: Drag['mode']) => {
    if (!editable || !t.canEdit) return;
    e.stopPropagation();
    try {
      // El arrastre sigue aunque el puntero salga de la barra.
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      /* sin captura: igual funciona mientras el puntero esté sobre la barra */
    }
    setDrag({ id: t.id, mode, x: e.clientX, delta: 0, moved: false });
  };
  const moveDrag = (e: ReactPointerEvent) => {
    if (!drag) return;
    const delta = Math.round((e.clientX - drag.x) / day);
    if (delta !== drag.delta || (!drag.moved && Math.abs(e.clientX - drag.x) > 3)) setDrag({ ...drag, delta, moved: drag.moved || Math.abs(e.clientX - drag.x) > 3 });
  };
  const endDrag = (t: Task) => {
    if (!drag) return;
    const d = drag;
    setDrag(null);
    if (!d.moved) return onOpen(t);
    const s = span(t);
    if (!s || d.delta === 0) return;
    let [start, end] = s;
    if (d.mode === 'move') [start, end] = [addDays(start, d.delta), addDays(end, d.delta)];
    else if (d.mode === 'start') start = addDays(start, d.delta) > end ? end : addDays(start, d.delta);
    else end = addDays(end, d.delta) < start ? start : addDays(end, d.delta);
    onMove(t, { startDate: start, dueDate: end });
  };

  /** Barra con el arrastre en curso aplicado (vista previa mientras se mueve). */
  const liveSpan = (t: Task): [string, string] | null => {
    const s = span(t);
    if (!s || drag?.id !== t.id || !drag.delta) return s;
    const [start, end] = s;
    if (drag.mode === 'move') return [addDays(start, drag.delta), addDays(end, drag.delta)];
    if (drag.mode === 'start') return [addDays(start, drag.delta) > end ? end : addDays(start, drag.delta), end];
    return [start, addDays(end, drag.delta) < start ? start : addDays(end, drag.delta)];
  };

  // Encabezado: meses arriba; abajo, días (o el lunes de cada semana en la escala de meses).
  const months: { label: string; left: number; width: number }[] = [];
  for (const d of range.days) {
    if (d.endsWith('-01') || d === range.first) {
      const label = dayLabel(d, { month: zoom === 'meses' ? 'short' : 'long', year: 'numeric' });
      months.push({ label: label.charAt(0).toUpperCase() + label.slice(1), left: x(d), width: 0 });
    }
  }
  months.forEach((m, i) => (m.width = (months[i + 1]?.left ?? range.total * day) - m.left));

  const width = range.total * day;
  const background = {
    // Líneas por día (o por semana en la escala de meses) y fines de semana sombreados.
    backgroundImage: `repeating-linear-gradient(to right, transparent 0 ${5 * day}px, rgba(148,163,184,.06) ${5 * day}px ${7 * day}px), repeating-linear-gradient(to right, rgba(148,163,184,.10) 0 1px, transparent 1px ${zoom === 'meses' ? 7 * day : day}px)`,
    backgroundPositionX: `${-weekday(range.first) * day}px, 0`,
    width,
  };

  return (
    <div className="gantt-wrap">
      <div className="gantt-tools">
        <div className="segmented segmented--sm" role="group" aria-label="Escala">
          {(Object.keys(DAY_WIDTH) as Zoom[]).map((z) => (
            <button key={z} className={zoom === z ? 'is-active' : ''} onClick={() => setZoom(z)}>
              {ZOOM_LABEL[z]}
            </button>
          ))}
        </div>
        <button
          className="btn btn--outline btn--sm"
          onClick={() => scroller.current?.scrollTo({ left: Math.max(0, x(now) - scroller.current.clientWidth / 3), behavior: 'smooth' })}
        >
          Hoy
        </button>
        <span className="gantt-legend">
          <i className="lg lg--deersystems" /> DeerSystems <i className="lg lg--cliente" /> Cliente <i className="lg lg--done" /> Completada <i className="lg lg--meeting" /> Reunión
        </span>
        {editable && <span className="hint">Arrastra una barra para moverla o sus bordes para cambiar las fechas.</span>}
      </div>

      <div className="gantt" ref={scroller}>
        <div className="gantt__grid" style={{ width: width + 260 }}>
          <div className="gantt__head">
            <div className="gantt__corner">Tarea</div>
            <div className="gantt__scale" style={{ width }}>
              <div className="gantt__months">
                {months.map((m) => (
                  <span key={m.left} style={{ left: m.left, width: m.width }}>
                    {m.label}
                  </span>
                ))}
              </div>
              <div className="gantt__days">
                {range.days.map((d, i) =>
                  zoom === 'meses' ? (
                    weekday(d) === 0 && (
                      <span key={d} className="gantt__day" style={{ left: i * day, width: 7 * day }}>
                        {Number(d.slice(8))}
                      </span>
                    )
                  ) : (
                    <span key={d} className={`gantt__day${weekday(d) > 4 ? ' is-weekend' : ''}${d === now ? ' is-today' : ''}`} style={{ left: i * day, width: day }}>
                      {zoom === 'dias' ? dayLabel(d, { weekday: 'narrow', day: 'numeric' }) : Number(d.slice(8))}
                    </span>
                  ),
                )}
              </div>
            </div>
          </div>

          {groups.map((g) => {
            const spans = g.tasks.map(span).filter(Boolean) as [string, string][];
            const gs = spans.length ? spans.reduce((a, b) => (a < b[0] ? a : b[0]), spans[0][0]) : null;
            const ge = spans.length ? spans.reduce((a, b) => (a > b[1] ? a : b[1]), spans[0][1]) : null;
            const done = g.tasks.filter((t) => t.status === 'completada').length;
            return (
              <div key={g.id} className="gantt__group">
                <div className="gantt__row gantt__row--phase">
                  <div className="gantt__name">
                    <strong>{g.name}</strong>
                    <span className="mono">
                      {done}/{g.tasks.length}
                    </span>
                  </div>
                  <div className="gantt__track" style={background}>
                    {gs && ge && (
                      <div className="gantt__phase" style={{ left: x(gs), width: (daysBetween(gs, ge) + 1) * day }}>
                        <div style={{ width: `${(done / g.tasks.length) * 100}%` }} />
                      </div>
                    )}
                    <div className="gantt__today" style={{ left: x(now) + day / 2 }} />
                  </div>
                </div>
                {g.tasks
                  .filter((t) => span(t))
                  .map((t) => {
                    const [s, e] = liveSpan(t)!;
                    const w = (daysBetween(s, e) + 1) * day;
                    const canDrag = editable && t.canEdit;
                    return (
                      <div key={t.id} className="gantt__row">
                        <button className="gantt__name gantt__name--task" onClick={() => onOpen(t)} title={t.title}>
                          <span className={`dot dot--${t.status}`} />
                          <span className="gantt__title">{t.title}</span>
                        </button>
                        <div className="gantt__track" style={background}>
                          <div
                            className={`gantt__bar side-${t.side} is-${t.status}${isOverdue(t) ? ' is-overdue' : ''}${drag?.id === t.id ? ' is-dragging' : ''}${canDrag ? ' can-drag' : ''}${t.isMeeting ? ' is-meeting' : ''}`}
                            style={{ left: x(s), width: w }}
                            title={`${t.title}\n${formatDate(s)} → ${formatDate(e)} · ${STATUS[t.status]}${t.assigneeName ? ` · ${t.assigneeName}` : ''}`}
                            onPointerDown={(ev) => (canDrag ? begin(ev, t, 'move') : undefined)}
                            onPointerMove={moveDrag}
                            onPointerUp={() => (canDrag ? endDrag(t) : onOpen(t))}
                            onPointerCancel={() => setDrag(null)}
                          >
                            {canDrag && <span className="gantt__handle gantt__handle--start" onPointerDown={(ev) => begin(ev, t, 'start')} />}
                            <span className="gantt__label" style={w < 90 ? { left: w + 6, color: 'var(--body)' } : undefined}>
                              {t.title}
                            </span>
                            {canDrag && <span className="gantt__handle gantt__handle--end" onPointerDown={(ev) => begin(ev, t, 'end')} />}
                          </div>
                          <div className="gantt__today" style={{ left: x(now) + day / 2 }} />
                        </div>
                      </div>
                    );
                  })}
              </div>
            );
          })}
          {!groups.length && <p className="empty card">No hay tareas con este filtro.</p>}
        </div>
      </div>

      {unscheduled.length > 0 && (
        <div className="unscheduled">
          <span className="field__label">Sin fechas ({unscheduled.length}) · ábrelas para asignarles inicio y entrega</span>
          <div className="unscheduled__list">
            {unscheduled.map((t) => (
              <button key={t.id} className={`chip-task side-${t.side}${t.isMeeting ? ' is-meeting' : ''}`} onClick={() => onOpen(t)}>
                <span className="chip-task__title">{t.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
