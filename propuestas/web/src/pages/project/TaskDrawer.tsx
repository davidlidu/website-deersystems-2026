import { useEffect, useState } from 'react';
import {
  api,
  CLIENT_STATUSES,
  formatDate,
  isOverdue,
  STATUS,
  STATUSES,
  type Me,
  type Meeting,
  type Progress,
  type ProjectDetail,
  type Side,
  type Task,
  type TaskStatus,
  type TeamMember,
  useApi,
  taskOwner,
} from '../../lib';
import { Link, Loading, Markdown, StatusPill, useAction, useToast } from '../../ui';
import { ActivityFeed } from './Activity';
import { FilesPanel } from './Files';
import { NotesPanel } from './Notes';
import { ReviewBlock } from './Review';
import { EditMeeting, ScheduleFromTask } from './Schedule';

export interface TaskDefaults {
  phaseId?: number | null;
  side?: Side;
  dueDate?: string | null;
  status?: TaskStatus;
}

interface Form {
  title: string;
  description: string;
  phaseId: number | null;
  side: Side;
  assigneeId: number | null;
  clientAssignee: string;
  startDate: string;
  dueDate: string;
  isMeeting: boolean;
  clientDelivery: boolean;
}

const toForm = (t: Partial<Task>, d: TaskDefaults = {}): Form => ({
  title: t.title ?? '',
  description: t.description ?? '',
  phaseId: t.phaseId ?? d.phaseId ?? null,
  side: t.side ?? d.side ?? 'deersystems',
  assigneeId: t.assigneeId ?? null,
  clientAssignee: t.clientAssignee ?? '',
  startDate: t.startDate ?? '',
  dueDate: t.dueDate ?? d.dueDate ?? '',
  isMeeting: t.isMeeting ?? false,
  clientDelivery: t.clientDelivery ?? false,
});

const meetingWhen = (m: Meeting) => {
  const start = new Date(m.startAt);
  const day = start.toLocaleDateString('es-CO', { timeZone: 'America/Bogota', weekday: 'long', day: 'numeric', month: 'long' });
  const hour = (d: Date) => d.toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: 'numeric', minute: '2-digit' });
  return `${day} · ${hour(start)} – ${hour(new Date(m.endAt))}`;
};

/**
 * Las reuniones del plan, en el mismo detalle: cuándo es (fecha y hora), el enlace de Meet y, para ti, agendarla
 * en Calendar o cambiarle la fecha y hora sin ir al calendario de reuniones.
 */
function MeetingBlock({ me, project, task, form, onChanged }: { me: Me; project: ProjectDetail; task: Task; form: Form; onChanged: () => void }) {
  const { data, loading, reload } = useApi<{ meeting: Meeting | null; canSchedule: boolean }>(`tasks/${task.id}/meeting`);
  const [mode, setMode] = useState<null | 'edit' | 'schedule'>(null);
  const owner = me.role === 'owner';
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const m = data.meeting;
  const done = (fresh: boolean) => {
    setMode(null);
    reload();
    if (fresh) onChanged();
  };

  if (mode === 'edit' && m) return <EditMeeting meeting={m} onDone={() => done(true)} onCancel={() => setMode(null)} />;
  if (mode === 'schedule') {
    return (
      <div className="card form-section">
        <div className="meeting-block__head">
          <h2>Agendar con Meet</h2>
          <button className="btn btn--outline btn--xs" onClick={() => setMode(null)}>
            Cancelar
          </button>
        </div>
        <ScheduleFromTask
          projectId={project.id}
          projectName={project.name}
          preset={{ taskId: task.id, title: form.title, date: form.dueDate || task.dueDate, phaseId: form.phaseId, agenda: form.description }}
          onDone={() => done(true)}
        />
      </div>
    );
  }

  if (!m) {
    if (!owner) return null;
    return (
      <div className="meeting-block meeting-block--empty">
        <span>
          <small>Reunión</small>
          Aún no está en tu Google Calendar: no tiene hora ni enlace de Meet.
        </span>
        {data.canSchedule ? (
          <button className="btn btn--primary btn--sm" onClick={() => setMode('schedule')}>
            Agendar con Meet
          </button>
        ) : (
          <Link to="/configuracion?tab=google">Conecta Google para agendarla</Link>
        )}
      </div>
    );
  }

  const upcoming = m.status === 'programada';
  return (
    <div className="meeting-block">
      <span>
        <small>
          Reunión{m.tentative ? ' · reservada, por confirmar con el cliente' : upcoming ? ' · agendada' : ''}
        </small>
        <strong className="meeting-block__when">{meetingWhen(m)}</strong>
        {m.meetUrl && upcoming && (
          <a href={m.meetUrl} target="_blank" rel="noopener">
            {m.meetUrl.replace(/^https?:\/\//, '')}
          </a>
        )}
      </span>
      <span className="meeting-block__actions">
        {owner && upcoming && (
          <button className="btn btn--primary btn--sm" onClick={() => setMode('edit')}>
            Cambiar fecha u hora
          </button>
        )}
        {owner && m.calendarUrl && (
          <a className="btn btn--outline btn--sm" href={m.calendarUrl} target="_blank" rel="noopener">
            Ver en Calendar
          </a>
        )}
      </span>
    </div>
  );
}

/** Panel lateral de una tarea: detalle, edición (equipo), estado, comentarios e historial. */
export function TaskDrawer({
  me,
  project,
  team,
  task,
  defaults,
  onClose,
  onSaved,
  onDeleted,
  onStatus,
  onReload,
  context,
}: {
  me: Me;
  project: ProjectDetail;
  team: TeamMember[];
  task: Task | null;
  defaults?: TaskDefaults;
  onClose: () => void;
  onSaved: (task: Task, progress: Progress, isNew: boolean) => void;
  onDeleted: (id: number, progress: Progress) => void;
  onStatus: (task: Task, status: TaskStatus) => void;
  /** Para recargar el proyecto cuando un cambio toca más que la tarea (p. ej. agendar o mover su reunión). */
  onReload?: () => void;
  /** Fuera del proyecto (calendario general): de qué proyecto es, con enlace para abrirlo. */
  context?: { label: string; href: string };
}) {
  const isNew = !task;
  const staff = me.role !== 'client';
  // El panel se monta de nuevo por tarea (key en el padre), así que el formulario arranca limpio.
  const [form, setForm] = useState<Form>(() => toForm(task ?? {}, defaults));
  const [tab, setTab] = useState<'comentarios' | 'archivos' | 'historial'>('comentarios');
  const { busy, run } = useAction();
  const toast = useToast();


  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const original = toForm(task ?? {}, defaults);
  const dirty = isNew || JSON.stringify(form) !== JSON.stringify(original);
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  const save = () => {
    if (!form.title.trim()) return toast('La tarea necesita un título.', true);
    const body = {
      title: form.title,
      description: form.description,
      phaseId: form.phaseId,
      side: form.side,
      assigneeId: form.side === 'deersystems' ? form.assigneeId : null,
      clientAssignee: form.side === 'cliente' ? form.clientAssignee.trim() : '',
      startDate: form.startDate || null,
      dueDate: form.dueDate || null,
      isMeeting: form.isMeeting,
      clientDelivery: form.side === 'deersystems' && !form.isMeeting && form.clientDelivery,
    };
    run(async () => {
      const r = isNew
        ? await api<{ task: Task; progress: Progress }>('POST', `projects/${project.id}/tasks`, body)
        : await api<{ task: Task; progress: Progress }>('PATCH', `tasks/${task!.id}`, body);
      // Si se creó desde una columna del tablero, queda en ese estado.
      if (isNew && defaults?.status && defaults.status !== 'pendiente') {
        const s = await api<{ task: Task; progress: Progress }>('PATCH', `tasks/${r.task.id}`, { status: defaults.status });
        onSaved(s.task, s.progress, true);
      } else onSaved(r.task, r.progress, isNew);
      toast(isNew ? 'Tarea creada.' : `Cambios guardados en «${r.task.title}».`);
      // Se cierra al guardar: el aviso confirma el cambio y la lista ya lo muestra.
      onClose();
    });
  };

  const remove = () => {
    if (!task || !confirm(`¿Eliminar la tarea «${task.title}»? También se borran sus comentarios.`)) return;
    run(async () => {
      const r = await api<{ progress: Progress }>('DELETE', `tasks/${task.id}`);
      onDeleted(task.id, r.progress);
      toast('Tarea eliminada.');
      onClose();
    });
  };

  const options = me.role === 'client' ? CLIENT_STATUSES : STATUSES;
  const phaseName = project.phases.find((p) => p.id === task?.phaseId)?.name ?? 'Sin fase';
  const who = task ? taskOwner(task) : 'DeerSystems';
  // Personas del cliente del equipo del proyecto (proyectos compartidos), para elegir quién la hace.
  const clientPeople = (project.people ?? []).filter((p) => p.side === 'cliente');

  return (
    <div className="drawer" role="dialog" aria-modal="true" aria-label={isNew ? 'Nueva tarea' : task!.title}>
      <button className="drawer__backdrop" aria-label="Cerrar" onClick={onClose} />
      <aside className="drawer__panel">
        <div className="drawer__head">
          {context ? (
            <span className="drawer__context">
              <span className="eyebrow">{`${context.label} · ${phaseName}`}</span>
              <Link className="drawer__project-link" to={context.href}>
                Abrir en el proyecto →
              </Link>
            </span>
          ) : (
            <span className="eyebrow">{isNew ? 'Nueva tarea' : phaseName}</span>
          )}
          <button className="drawer__close" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </div>

        {staff ? (
          <div className="drawer__form">
            <textarea
              className="drawer__title-input"
              rows={2}
              value={form.title}
              placeholder="Título de la tarea"
              autoFocus={isNew}
              onChange={(e) => set({ title: e.target.value.replace(/\n/g, ' ') })}
            />
            <div className="drawer__grid">
              {task && (
                <label className="field">
                  <span className="field__label">Estado</span>
                  <span className="input">
                    <select value={task.status} onChange={(e) => onStatus(task, e.target.value as TaskStatus)}>
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {STATUS[s]}
                        </option>
                      ))}
                    </select>
                  </span>
                </label>
              )}
              <label className="field">
                <span className="field__label">Fase</span>
                <span className="input">
                  <select value={form.phaseId ?? ''} onChange={(e) => set({ phaseId: Number(e.target.value) || null })}>
                    <option value="">Sin fase</option>
                    {project.phases.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </span>
              </label>
              <label className="field">
                <span className="field__label">Le toca a</span>
                <span className="input">
                  <select value={form.side} onChange={(e) => set({ side: e.target.value as Side })}>
                    <option value="deersystems">DeerSystems</option>
                    <option value="cliente">Cliente</option>
                  </select>
                </span>
              </label>
              {form.side === 'deersystems' && (
                <label className="field">
                  <span className="field__label">Responsable</span>
                  <span className="input">
                    <select value={form.assigneeId ?? ''} onChange={(e) => set({ assigneeId: Number(e.target.value) || null })}>
                      <option value="">Sin asignar</option>
                      {team
                        .filter((m) => m.active || m.id === form.assigneeId)
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                    </select>
                  </span>
                </label>
              )}
              {form.side === 'cliente' && (clientPeople.length > 0 || form.clientAssignee) && (
                <label className="field">
                  <span className="field__label">Persona del cliente</span>
                  <span className="input">
                    <select value={form.clientAssignee} onChange={(e) => set({ clientAssignee: e.target.value })}>
                      <option value="">El cliente (en general)</option>
                      {[...new Set([...clientPeople.map((p) => p.name), ...(form.clientAssignee ? [form.clientAssignee] : [])])].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </span>
                </label>
              )}
              <label className="field">
                <span className="field__label">Inicio</span>
                <span className="input">
                  <input type="date" value={form.startDate} onChange={(e) => set({ startDate: e.target.value })} />
                </span>
              </label>
              <label className="field">
                <span className="field__label">Entrega</span>
                <span className="input">
                  <input type="date" value={form.dueDate} min={form.startDate || undefined} onChange={(e) => set({ dueDate: e.target.value })} />
                </span>
              </label>
            </div>
            {task?.isMeeting && <MeetingBlock me={me} project={project} task={task} form={form} onChanged={() => onReload?.()} />}
            <label className="check">
              <input type="checkbox" checked={form.isMeeting} onChange={(e) => set({ isMeeting: e.target.checked })} />
              Es una reunión con el cliente (franja naranja en el cronograma)
            </label>
            {form.side === 'deersystems' && !form.isMeeting && (
              <label className="check">
                <input type="checkbox" checked={form.clientDelivery} onChange={(e) => set({ clientDelivery: e.target.checked })} />
                <span>
                  Entrega al cliente: la revisa y la aprueba o pide ajustes{' '}
                  <small className="hint">(si no, es operativa: la cierra el equipo, sin rondas de ajustes)</small>
                </span>
              </label>
            )}
            <label className="field">
              <span className="field__label">Descripción y criterio de terminado</span>
              <textarea rows={5} value={form.description} onChange={(e) => set({ description: e.target.value })} />
            </label>
            <div className="actions actions--tight">
              <button className="btn btn--primary btn--sm" disabled={busy || !dirty} onClick={save}>
                {isNew ? 'Crear tarea' : 'Guardar cambios'}
              </button>
              {task && (
                <button className="btn btn--outline btn--sm btn--danger" disabled={busy} onClick={remove}>
                  Eliminar
                </button>
              )}
            </div>
          </div>
        ) : (
          task && (
            <div className="drawer__form">
              <h2 className="drawer__title">{task.title}</h2>
              <div className="drawer__facts">
                <span>
                  <small>Estado</small>
                  {task.canChangeStatus ? (
                    <select
                      className={`pill pill--${task.status} pill--select`}
                      value={task.status}
                      onChange={(e) => onStatus(task, e.target.value as TaskStatus)}
                    >
                      {[...new Set([task.status, ...options])].map((s) => (
                        <option key={s} value={s}>
                          {STATUS[s]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <StatusPill status={task.status} />
                  )}
                </span>
                <span>
                  <small>Le toca a</small>
                  {who}
                </span>
                <span>
                  <small>Inicio</small>
                  {formatDate(task.startDate)}
                </span>
                <span className={isOverdue(task) ? 'is-overdue' : ''}>
                  <small>Entrega</small>
                  {formatDate(task.dueDate)}
                </span>
              </div>
              {task.isMeeting && <MeetingBlock me={me} project={project} task={task} form={toForm(task)} onChanged={() => onReload?.()} />}
              {task.description && <Markdown text={task.description} />}
              {task.side === 'cliente' && task.status !== 'completada' && (
                <p className="callout">Cuando termines tu parte, cambia el estado a «En revisión». DeerSystems la revisa y la cierra.</p>
              )}
            </div>
          )
        )}

        {task?.canReview && <ReviewBlock me={me} task={task} onDone={(t, progress) => onSaved(t, progress, false)} />}

        {task && (
          <>
            <div className="tabs tabs--sm" role="tablist">
              <button role="tab" aria-selected={tab === 'comentarios'} className={tab === 'comentarios' ? 'is-active' : ''} onClick={() => setTab('comentarios')}>
                Comentarios {task.comments ? `(${task.comments})` : ''}
              </button>
              <button role="tab" aria-selected={tab === 'archivos'} className={tab === 'archivos' ? 'is-active' : ''} onClick={() => setTab('archivos')}>
                Archivos {task.files ? `(${task.files})` : ''}
              </button>
              <button role="tab" aria-selected={tab === 'historial'} className={tab === 'historial' ? 'is-active' : ''} onClick={() => setTab('historial')}>
                Historial
              </button>
            </div>
            {tab === 'comentarios' && (
              <NotesPanel
                key={`${task.revisionRound}-${task.status}`}
                me={me}
                projectId={project.id}
                taskId={task.id}
                rich
                onPosted={() => onSaved({ ...task, comments: task.comments + 1 }, project.progress, false)}
              />
            )}
            {tab === 'archivos' && (
              <FilesPanel
                me={me}
                projectId={project.id}
                taskId={task.id}
                onChange={(delta) => onSaved({ ...task, files: Math.max(0, task.files + delta) }, project.progress, false)}
              />
            )}
            {tab === 'historial' && <ActivityFeed projectId={project.id} taskId={task.id} compact />}
          </>
        )}
      </aside>
    </div>
  );
}
