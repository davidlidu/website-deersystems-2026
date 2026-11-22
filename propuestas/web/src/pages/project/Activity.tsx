import { formatDateTime, PROJECT_STATUS, STATUS, timeAgo, useApi, type ActivityItem, type ProjectStatus, type TaskStatus } from '../../lib';
import { Empty, ErrorBox, Loading } from '../../ui';

const q = (s: unknown) => `«${String(s ?? '')}»`;

/** Texto de cada evento de la bitácora: "movió «Diseñar maqueta» de Pendiente a En progreso". */
function describe(a: ActivityItem): string {
  const d = a.data;
  switch (a.type) {
    case 'project_created':
      return `aprobó la propuesta y creó el proyecto con ${d.tasks ?? 0} tareas`;
    case 'project_extended':
      return `sumó al proyecto lo aprobado después${d.option ? ` (${d.option})` : ''}: ${d.tasks === 1 ? '1 tarea nueva' : `${d.tasks ?? 0} tareas nuevas`}`;
    case 'report_published':
      return `publicó el ${d.kind === 'final' ? 'informe de cierre' : 'informe'} ${q(d.title)}`;
    case 'scope_added':
      return `agregó el adicional ${d.option ? q(String(d.option)) : ''}: ${d.tasks === 1 ? '1 tarea' : `${d.tasks ?? 0} tareas`}`;
    case 'scope_removed':
      return `retiró del alcance ${d.option ?? 'una parte'}: ${d.tasks ?? 0} tareas${d.meetings ? `, ${d.meetings} reuniones` : ''} y ${d.payments ?? 0} pagos`;
    case 'plan_adjusted':
      // Al cliente le llega sin la instrucción: ve «ajustó el plan», sin mencionar la IA.
      return `ajustó el plan${d.instruction ? ' con IA' : ''} (${d.changes ?? 0} ${d.changes === 1 ? 'cambio' : 'cambios'})${d.instruction ? `: ${q(d.instruction)}` : ''}`;
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
      return `envió el resumen de la reunión ${q(d.title)} con ${d.tasks ?? 0} tareas${d.changes ? ` y ajustes en ${d.changes === 1 ? '1 entrega' : `${d.changes} entregas`}` : ''}`;
    case 'deliveries_marked':
      return `marcó ${d.deliveries === 1 ? '1 entrega' : `${d.deliveries ?? 0} entregas`} al cliente (${d.changed ?? 0} ${d.changed === 1 ? 'cambio' : 'cambios'})`;
    case 'task_approved':
      return `aprobó la entrega ${q(d.title)}${d.round ? ` después de ${d.round === 1 ? '1 ronda' : `${d.round} rondas`} de ajustes` : ' a la primera'}`;
    case 'task_changes':
      return `pidió ajustes en ${q(d.title)} (ronda ${d.round ?? 1}${d.extra ? ', adicional' : ''})${d.meeting ? ` en la reunión ${q(d.meeting)}` : ''}`;
    case 'meeting_scheduled':
      return `agendó la reunión ${q(d.title)} para el ${d.when}`;
    case 'meeting_reserved':
      return `reservó la reunión ${q(d.title)} para el ${d.when} (por confirmar con el cliente)`;
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
  project_extended: '＋',
  scope_removed: '−',
  scope_added: '＋',
  report_published: '▤',
  plan_adjusted: '✦',
  file_added: '📎',
  meeting_approved: '🎙',
  task_approved: '✓',
  task_changes: '↺',
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
