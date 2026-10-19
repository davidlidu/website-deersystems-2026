import { useEffect, useMemo, useRef, useState } from 'react';
import { api, formatDate, formatDateTime, timeAgo, useApi, type Me, type Meeting, type Note, type ProjectDetail } from '../../lib';
import { Empty, ErrorBox, Loading, Markdown, useAction, useToast } from '../../ui';
import { MdEditor, type InsertGroup, type Variable } from './MdEditor';

const Sparkle = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
    <circle cx="12" cy="12" r="2.2" />
  </svg>
);

const updateUrl = (projectId: number, noteId: number) => `${location.origin}/proyectos/${projectId}?tab=avances&avance=${noteId}`;

function Visibility({ internal, onChange }: { internal: boolean; onChange: (internal: boolean) => void }) {
  return (
    <span className="vis-toggle" role="radiogroup" aria-label="Quién lo ve">
      <button type="button" role="radio" aria-checked={!internal} className={!internal ? 'is-active' : ''} onClick={() => onChange(false)}>
        Compartido con el cliente
      </button>
      <button type="button" role="radio" aria-checked={internal} className={internal ? 'is-active is-internal' : ''} onClick={() => onChange(true)}>
        Solo equipo
      </button>
    </span>
  );
}

/** Lo que verá el cliente, antes de publicar. */
function PreviewDialog({ body, internal, onClose }: { body: string; internal: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => ref.current?.showModal(), []);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="update-preview-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) ref.current?.close();
      }}
    >
      <div className="modal__in">
        <header className="modal__head">
          <h2 id="update-preview-title">Vista previa del avance</h2>
          <button className="icon-btn" onClick={() => ref.current?.close()} aria-label="Cerrar">
            ✕
          </button>
        </header>
        <p className="hint">{internal ? 'Solo lo verá tu equipo.' : 'Así lo verá el cliente en el portal y en el aviso por correo.'}</p>
        <article className="update update--preview card">
          <div className="update__head">
            <span className="update__avatar" aria-hidden="true">
              DS
            </span>
            <strong>DeerSystems</strong>
            <time>Ahora</time>
          </div>
          <Markdown text={body} />
        </article>
      </div>
    </dialog>
  );
}

function UpdateItem({
  note,
  projectId,
  focused,
  editorProps,
  onChange,
  onDelete,
  onOpenLog,
}: {
  note: Note;
  projectId: number;
  focused: boolean;
  editorProps: { variables: Variable[]; links: InsertGroup[] };
  onChange: (n: Note) => void;
  onDelete: (id: number) => void;
  onOpenLog: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.body);
  const [internal, setInternal] = useState(note.visibility === 'internal');
  const ref = useRef<HTMLLIElement>(null);
  const { busy, run } = useAction();
  const toast = useToast();

  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focused]);

  const save = () =>
    run(async () => {
      onChange(await api<Note>('PATCH', `notes/${note.id}`, { body: text, visibility: internal ? 'internal' : 'shared' }));
      setEditing(false);
    });
  const remove = () => {
    if (!confirm('¿Borrar este avance?')) return;
    run(async () => {
      await api('DELETE', `notes/${note.id}`);
      onDelete(note.id);
    });
  };
  const copy = () =>
    navigator.clipboard.writeText(updateUrl(projectId, note.id)).then(
      () => toast('Enlace copiado.'),
      () => toast('No se pudo copiar el enlace.', true),
    );

  return (
    <li ref={ref} id={`avance-${note.id}`} className={`update card${note.visibility === 'internal' ? ' is-internal' : ''}${focused ? ' is-focused' : ''}`}>
      <div className="update__head">
        <span className={`update__avatar${note.ai ? ' update__avatar--ai' : ''}`} aria-hidden="true">
          {note.ai ? Sparkle : note.authorName.slice(0, 2).toUpperCase()}
        </span>
        {note.ai ? <span className="tag tag--ai">Generado por IA</span> : <span className="tag tag--manual">Redactado por {note.authorName}</span>}
        {note.visibility === 'internal' && <span className="tag tag--internal">Solo equipo</span>}
        <time dateTime={note.createdAt} title={formatDateTime(note.createdAt)}>
          {timeAgo(note.createdAt)}
          {note.updatedAt !== note.createdAt && ' · editado'}
        </time>
      </div>
      {editing ? (
        <div className="stack">
          <MdEditor value={text} onChange={setText} label="Editar avance" {...editorProps} onSubmit={save} />
          <div className="update__foot">
            <Visibility internal={internal} onChange={setInternal} />
            <span className="actions actions--tight">
              <button className="btn btn--outline btn--sm" onClick={() => setEditing(false)}>
                Cancelar
              </button>
              <button className="btn btn--primary btn--sm" disabled={busy || !text.trim()} onClick={save}>
                Guardar
              </button>
            </span>
          </div>
        </div>
      ) : (
        <>
          <Markdown text={note.body} />
          <div className="update__actions">
            {note.canEdit && (
              <button className="btn btn--outline btn--xs" onClick={() => setEditing(true)}>
                Editar
              </button>
            )}
            {note.visibility === 'shared' && (
              <button className="btn btn--outline btn--xs" onClick={copy}>
                Copiar enlace
              </button>
            )}
            <button className="btn btn--outline btn--xs" onClick={onOpenLog}>
              Ver bitácora técnica
            </button>
            {note.canDelete && (
              <button className="btn btn--ghost btn--xs" onClick={remove} disabled={busy}>
                Borrar
              </button>
            )}
          </div>
        </>
      )}
    </li>
  );
}

/**
 * Pestaña principal del proyecto: los avances. El equipo los redacta (o los genera con IA a partir de lo que pasó hoy)
 * con enlaces directos a tareas, reuniones y documentos; el cliente ve el historial.
 */
export function UpdatesPanel({
  me,
  project,
  focusId,
  onOpenLog,
  onAutoChange,
}: {
  me: Me;
  project: ProjectDetail;
  focusId: number | null;
  onOpenLog: () => void;
  onAutoChange: (enabled: boolean) => void;
}) {
  const staff = me.role !== 'client';
  const { data, error, loading, reload, setData } = useApi<Note[]>(`projects/${project.id}/notes?kind=avance`);
  const meetings = useApi<Meeting[]>(staff ? `projects/${project.id}/meetings` : null);
  const [text, setText] = useState('');
  const [aiDraft, setAiDraft] = useState(false);
  const [internal, setInternal] = useState(false);
  const [preview, setPreview] = useState(false);
  const [generating, setGenerating] = useState(false);
  const { busy, run } = useAction();
  const toast = useToast();

  const editorProps = useMemo(() => {
    const origin = location.origin;
    const tasks = [...project.tasks].sort((a, b) => Number(b.status === 'completada') - Number(a.status === 'completada') || (b.dueDate ?? '').localeCompare(a.dueDate ?? ''));
    const list = (meetings.data ?? []).filter((m) => m.status !== 'descartada').sort((a, b) => b.startAt.localeCompare(a.startAt));
    const next = list.filter((m) => m.status === 'programada' && new Date(m.startAt) > new Date()).at(-1);
    const pct = project.progress.total ? Math.round((project.progress.done / project.progress.total) * 100) : 0;
    const variables: Variable[] = [
      { label: 'Cliente', value: project.clientName },
      { label: 'Proyecto', value: project.name },
      { label: '% de avance', value: `${pct} %` },
      { label: 'Tareas completadas', value: `${project.progress.done} de ${project.progress.total}` },
      { label: 'Fecha de hoy', value: new Date().toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }) },
      ...(project.endDate ? [{ label: 'Entrega estimada', value: formatDate(project.endDate) }] : []),
      ...(next ? [{ label: 'Próxima reunión', value: `${next.title}, ${formatDateTime(next.startAt)}` }] : []),
    ];
    const links: InsertGroup[] = [
      {
        label: 'Tareas',
        items: tasks
          .filter((t) => !t.isMeeting)
          .map((t) => ({ title: t.title, url: `${origin}/proyectos/${project.id}?tarea=${t.id}`, hint: t.status === 'completada' ? 'Completada' : t.dueDate ? formatDate(t.dueDate) : undefined })),
      },
      {
        label: 'Reuniones',
        items: list.map((m) => ({ title: m.title, url: `${origin}/proyectos/${project.id}?tab=reuniones`, hint: formatDateTime(m.startAt) })),
      },
    ];
    return { variables, links };
  }, [project, meetings.data]);

  const generate = async () => {
    if (text.trim() && !confirm('¿Reemplazar lo que llevas escrito por el avance generado?')) return;
    setGenerating(true);
    try {
      const r = await api<{ body: string; ai: boolean; empty: boolean; warning?: string }>('POST', `projects/${project.id}/updates/draft`);
      setText(r.body);
      setAiDraft(r.ai);
      if (r.warning) toast(r.warning, true);
      else if (r.empty) toast('Hoy no hubo tareas completadas ni reuniones: te dejamos una base para escribir.');
      else toast('Avance generado. Revísalo antes de publicar.');
    } catch (err) {
      toast((err as Error).message, true);
    } finally {
      setGenerating(false);
    }
  };

  const publish = () => {
    if (!text.trim()) return;
    run(async () => {
      const note = await api<Note>('POST', `projects/${project.id}/notes`, { body: text, kind: 'avance', visibility: internal ? 'internal' : 'shared', ai: aiDraft });
      setData([note, ...(data ?? [])]);
      setText('');
      setAiDraft(false);
      toast(internal ? 'Avance guardado (solo equipo).' : 'Avance publicado: le llega al cliente.');
    });
  };

  const toggleAuto = (enabled: boolean) =>
    run(async () => {
      await api('PUT', `projects/${project.id}/updates/auto`, { enabled });
      onAutoChange(enabled);
      toast(enabled ? 'Listo: cada día a las 5:00 p. m. se publica el avance, si hubo movimientos.' : 'Envío diario automático apagado.');
    });

  return (
    <div className="updates">
      {staff && (
        <>
          <div className="card ai-gen" data-tour="updates-ai">
            <div className="ai-gen__main">
              <div className="ai-gen__title">
                <h2>Generador automático de avances (IA)</h2>
                <button className="btn btn--ai btn--sm" onClick={generate} disabled={generating}>
                  {Sparkle}
                  {generating ? 'Generando…' : 'Generar avance del día con IA'}
                </button>
              </div>
              <p className="hint">La IA recopila las tareas completadas y las reuniones del día y redacta el avance con sus enlaces. Lo revisas antes de publicar.</p>
            </div>
            <label className="auto-switch">
              <span>
                Automatizar envíos diarios
                <small>Todos los días a las 5:00 p. m., si hubo movimientos</small>
              </span>
              <span className="switch">
                <input type="checkbox" role="switch" checked={!!project.autoUpdates} disabled={busy} onChange={(e) => toggleAuto(e.target.checked)} />
                <span className="switch__track" aria-hidden="true" />
              </span>
            </label>
          </div>

          <div className="card update-composer">
            <MdEditor
              value={text}
              onChange={(md) => {
                setText(md);
                if (!md.trim()) setAiDraft(false);
              }}
              label="Avance"
              placeholder="Cuéntale al cliente qué se avanzó, qué sigue y si necesitas algo de su parte…"
              {...editorProps}
              onSubmit={publish}
            />
            <div className="update__foot">
              <span className="update__who">
                <span className="hint">{internal ? 'Solo lo verá tu equipo.' : 'El cliente verá este avance.'}</span>
                <Visibility internal={internal} onChange={setInternal} />
                {aiDraft && <span className="tag tag--ai">Borrador de la IA</span>}
              </span>
              <span className="actions actions--tight">
                <button className="btn btn--outline btn--sm" disabled={!text.trim()} onClick={() => setPreview(true)}>
                  Vista previa
                </button>
                <button className="btn btn--primary btn--sm" disabled={busy || !text.trim()} onClick={publish}>
                  {internal ? 'Guardar avance' : 'Publicar avance'}
                </button>
              </span>
            </div>
          </div>
        </>
      )}

      <div className="updates__head">
        <h2>Historial de avances</h2>
        <button className="linklike" onClick={onOpenLog}>
          Ver bitácora técnica →
        </button>
      </div>
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : data!.length ? (
        <ul className="update-list">
          {data!.map((n) => (
            <UpdateItem
              key={n.id}
              note={n}
              projectId={project.id}
              focused={n.id === focusId}
              editorProps={editorProps}
              onChange={(u) => setData(data!.map((x) => (x.id === u.id ? u : x)))}
              onDelete={(id) => setData(data!.filter((x) => x.id !== id))}
              onOpenLog={onOpenLog}
            />
          ))}
        </ul>
      ) : (
        <Empty>{staff ? 'Aún no hay avances. Genera el primero con IA o escríbelo arriba.' : 'Aquí verás los avances que publique DeerSystems.'}</Empty>
      )}

      {preview && <PreviewDialog body={text} internal={internal} onClose={() => setPreview(false)} />}
    </div>
  );
}
