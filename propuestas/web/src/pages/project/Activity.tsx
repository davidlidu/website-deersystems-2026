import { formatDateTime, PROJECT_STATUS, STATUS, timeAgo, useApi, type ActivityItem, type ProjectStatus, type TaskStatus } from '../../lib';
import { Empty, ErrorBox, Loading } from '../../ui';

const q = (s: unknown) => `«${String(s ?? '')}»`;

/** Texto de cada evento de la bitácora: "movió «Diseñar maqueta» de Pendiente a En progreso". */
function describe(a: ActivityItem): string {
  const d = a.data;
  switch (a.type) {
    case 'project_created':
      return `aprobó la propuesta y creó el proyecto con ${d.tasks ?? 0} tareas`;
    case 'project_status':
      return `cambió el estado del proyecto a ${PROJECT_STATUS[d.to as ProjectStatus] ?? d.to}`;
    case 'task_created':
      return `creó la tarea ${q(d.title)}${d.side === 'cliente' ? ' para el cliente' : ''}`;
    case 'task_status':
      return `movió ${q(d.title)} de ${STATUS[d.from as TaskStatus] ?? d.from} a ${STATUS[d.to as TaskStatus] ?? d.to}`;
    case 'task_updated':
      return `cambió ${(d.fields as string[] | undefined)?.join(', ') ?? 'datos'} de ${q(d.title)}`;
    case 'task_deleted':
      return `eliminó la tarea ${q(d.title)}`;
    case 'phase_created':
      return `creó la fase ${q(d.name)}`;
    case 'phase_renamed':
      return `renombró la fase ${q(d.from)} a ${q(d.to)}`;
    case 'phase_deleted':
      return `eliminó la fase ${q(d.name)}`;
    case 'note_added':
      return d.visibility === 'internal' ? 'dejó una nota interna' : 'dejó una nota';
    case 'comment_added':
      return `comentó en ${q(d.taskTitle)}${d.visibility === 'internal' ? ' (interno)' : ''}`;
    case 'update_posted':
      return 'publicó un avance';
    case 'meeting_approved':
      return `envió el resumen de la reunión ${q(d.title)} con ${d.tasks ?? 0} tareas`;
    case 'meeting_scheduled':
      return `agendó la reunión ${q(d.title)} para el ${d.when}`;
    case 'meeting_updated':
      return `actualizó la reunión ${q(d.title)} (${d.when})`;
    case 'meeting_cancelled':
      return `canceló la reunión ${q(d.title)}`;
    case 'file_added':
      return `subió ${q(d.name)}${d.taskTitle ? ` en ${q(d.taskTitle)}` : ''}`;
    case 'file_visibility':
      return d.visibility === 'shared' ? `compartió con el cliente ${q(d.name)}` : `volvió interno ${q(d.name)}`;
    case 'file_deleted':
      return `quitó el archivo ${q(d.name)}`;
    default:
      return a.type;
  }
}

const ICON: Record<string, string> = {
  task_status: '⇄',
  task_created: '+',
  task_deleted: '−',
  comment_added: '💬',
  note_added: '✎',
  update_posted: '★',
  project_created: '✓',
  file_added: '📎',
  meeting_approved: '🎙',
  meeting_scheduled: '📅',
  meeting_updated: '📅',
};

export function ActivityFeed({ projectId, taskId, compact }: { projectId: number; taskId?: number; compact?: boolean }) {
  const { data, error, loading, reload } = useApi<ActivityItem[]>(
    `projects/${projectId}/activity${taskId ? `?taskId=${taskId}` : ''}`,
  );
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data!.length) return <Empty>Sin movimientos todavía.</Empty>;
  return (
    <ol className={`activity${compact ? ' activity--compact' : ''}`}>
      {data!.map((a) => (
        <li key={a.id} className={`activity__item activity--${a.actorKind}${a.internal ? ' is-internal' : ''}`}>
          <span className="activity__icon" aria-hidden="true">
            {ICON[a.type] ?? '•'}
          </span>
          <div>
            <p>
              <strong>{a.actorName}</strong> {describe(a)}
              {a.internal && <span className="tag tag--internal">Interno</span>}
            </p>
            {typeof a.data.excerpt === 'string' && !compact && <p className="activity__excerpt">{a.data.excerpt.replace(/[*_`#>]/g, '')}</p>}
            <time dateTime={a.createdAt} title={formatDateTime(a.createdAt)}>
              {timeAgo(a.createdAt)}
            </time>
          </div>
        </li>
      ))}
    </ol>
  );
}
