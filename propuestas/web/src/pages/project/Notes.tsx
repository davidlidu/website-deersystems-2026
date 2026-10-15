import { useState, type FormEvent } from 'react';
import { api, formatDateTime, timeAgo, useApi, type Me, type Note } from '../../lib';
import { Empty, ErrorBox, Loading, Markdown, useAction } from '../../ui';

const ROLE_LABEL = { owner: 'DeerSystems', team: 'Equipo', client: 'Cliente' } as const;

function NoteItem({ note, onChange, onDelete }: { note: Note; onChange: (n: Note) => void; onDelete: (id: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.body);
  const { busy, run } = useAction();

  const save = () =>
    run(async () => {
      onChange(await api<Note>('PATCH', `notes/${note.id}`, { body: text }));
      setEditing(false);
    });
  const remove = () => {
    if (!confirm('¿Borrar esta nota?')) return;
    run(async () => {
      await api('DELETE', `notes/${note.id}`);
      onDelete(note.id);
    });
  };

  return (
    <li className={`note note--${note.authorKind}${note.visibility === 'internal' ? ' is-internal' : ''}`}>
      <div className="note__head">
        <span className="note__author">{note.authorName}</span>
        <span className="note__role">{ROLE_LABEL[note.authorKind]}</span>
        {note.visibility === 'internal' && <span className="tag tag--internal">Interna</span>}
        <time dateTime={note.createdAt} title={formatDateTime(note.createdAt)}>
          {timeAgo(note.createdAt)}
          {note.updatedAt !== note.createdAt && ' · editada'}
        </time>
      </div>
      {editing ? (
        <div className="stack">
          <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="actions actions--tight">
            <button className="btn btn--primary btn--sm" disabled={busy || !text.trim()} onClick={save}>
              Guardar
            </button>
            <button className="btn btn--outline btn--sm" onClick={() => setEditing(false)}>
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <Markdown text={note.body} />
      )}
      {!editing && (note.canEdit || note.canDelete) && (
        <div className="note__actions">
          {note.canEdit && <button onClick={() => setEditing(true)}>Editar</button>}
          {note.canDelete && (
            <button onClick={remove} disabled={busy}>
              Borrar
            </button>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Notas del proyecto, comentarios de una tarea (con taskId) o avances (kind="avance").
 * El equipo puede marcar una nota como interna: el cliente no la ve.
 */
export function NotesPanel({
  me,
  projectId,
  kind = 'nota',
  taskId,
  onPosted,
}: {
  me: Me;
  projectId: number;
  kind?: 'nota' | 'avance';
  taskId?: number;
  onPosted?: () => void;
}) {
  const query = new URLSearchParams({ kind, ...(taskId ? { taskId: String(taskId) } : {}) });
  const { data, error, loading, reload, setData } = useApi<Note[]>(`projects/${projectId}/notes?${query}`);
  const [text, setText] = useState('');
  const [internal, setInternal] = useState(false);
  const { busy, run } = useAction();
  const staff = me.role !== 'client';
  const canPost = kind === 'nota' || staff;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    run(async () => {
      const note = await api<Note>('POST', `projects/${projectId}/notes`, {
        body: text,
        kind,
        taskId,
        visibility: internal ? 'internal' : 'shared',
      });
      setData([note, ...(data ?? [])]);
      setText('');
      onPosted?.();
    });
  };

  const placeholder =
    kind === 'avance'
      ? 'Cuéntale al cliente qué se avanzó, qué sigue y si necesitas algo de su parte…'
      : taskId
        ? 'Escribe un comentario…'
        : staff
          ? 'Deja una nota sobre el proyecto…'
          : 'Escríbenos lo que necesites sobre el proyecto…';

  return (
    <div className="notes">
      {canPost && (
        <form className="composer card" onSubmit={submit}>
          <textarea
            rows={kind === 'avance' ? 5 : 3}
            value={text}
            placeholder={placeholder}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e);
            }}
          />
          <div className="composer__foot">
            {staff && kind === 'nota' ? (
              <div className="segmented segmented--sm">
                <button type="button" className={!internal ? 'is-active' : ''} onClick={() => setInternal(false)}>
                  Compartida con el cliente
                </button>
                <button type="button" className={internal ? 'is-active' : ''} onClick={() => setInternal(true)}>
                  Interna (solo equipo)
                </button>
              </div>
            ) : (
              <span className="hint">{kind === 'avance' ? 'El cliente verá este avance.' : 'Lo verá el equipo de DeerSystems.'}</span>
            )}
            <button className="btn btn--primary btn--sm" disabled={busy || !text.trim()}>
              {kind === 'avance' ? 'Publicar avance' : taskId ? 'Comentar' : 'Guardar nota'}
            </button>
          </div>
        </form>
      )}
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : data!.length ? (
        <ul className="note-list">
          {data!.map((n) => (
            <NoteItem
              key={n.id}
              note={n}
              onChange={(updated) => setData(data!.map((x) => (x.id === updated.id ? updated : x)))}
              onDelete={(id) => setData(data!.filter((x) => x.id !== id))}
            />
          ))}
        </ul>
      ) : (
        <Empty>
          {kind === 'avance'
            ? staff
              ? 'Aún no hay avances publicados.'
              : 'Aquí verás los avances que publique DeerSystems.'
            : taskId
              ? 'Sin comentarios.'
              : 'Sin notas todavía.'}
        </Empty>
      )}
    </div>
  );
}
