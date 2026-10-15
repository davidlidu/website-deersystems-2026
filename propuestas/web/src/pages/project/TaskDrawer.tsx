import { useEffect, useState } from 'react';
import {
  api,
  CLIENT_STATUSES,
  formatDate,
  isOverdue,
  STATUS,
  STATUSES,
  type Me,
  type Progress,
  type ProjectDetail,
  type Side,
  type Task,
  type TaskStatus,
  type TeamMember,
} from '../../lib';
import { Markdown, StatusPill, useAction, useToast } from '../../ui';
import { ActivityFeed } from './Activity';
import { FilesPanel } from './Files';
import { NotesPanel } from './Notes';

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
  startDate: string;
  dueDate: string;
  isMeeting: boolean;
}

const toForm = (t: Partial<Task>, d: TaskDefaults = {}): Form => ({
  title: t.title ?? '',
  description: t.description ?? '',
  phaseId: t.phaseId ?? d.phaseId ?? null,
  side: t.side ?? d.side ?? 'deersystems',
  assigneeId: t.assigneeId ?? null,
  startDate: t.startDate ?? '',
  dueDate: t.dueDate ?? d.dueDate ?? '',
  isMeeting: t.isMeeting ?? false,
});

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
      startDate: form.startDate || null,
      dueDate: form.dueDate || null,
      isMeeting: form.isMeeting,
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
      toast(isNew ? 'Tarea creada.' : 'Cambios guardados.');
      if (isNew) onClose();
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
  const who = task?.side === 'cliente' ? 'Cliente' : (task?.assigneeName ?? 'DeerSystems');

  return (
    <div className="drawer" role="dialog" aria-modal="true" aria-label={isNew ? 'Nueva tarea' : task!.title}>
      <button className="drawer__backdrop" aria-label="Cerrar" onClick={onClose} />
      <aside className="drawer__panel">
        <div className="drawer__head">
          <span className="eyebrow">{isNew ? 'Nueva tarea' : phaseName}</span>
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
            <label className="check">
              <input type="checkbox" checked={form.isMeeting} onChange={(e) => set({ isMeeting: e.target.checked })} />
              Es una reunión con el cliente (franja naranja en el cronograma)
            </label>
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
              {task.description && <Markdown text={task.description} />}
              {task.side === 'cliente' && task.status !== 'completada' && (
                <p className="callout">Cuando termines tu parte, cambia el estado a «En revisión». DeerSystems la revisa y la cierra.</p>
              )}
            </div>
          )
        )}

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
              <NotesPanel me={me} projectId={project.id} taskId={task.id} onPosted={() => onSaved({ ...task, comments: task.comments + 1 }, project.progress, false)} />
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
