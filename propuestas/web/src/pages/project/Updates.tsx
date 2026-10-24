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

interface MailInfo {
  to: string | null;
  canSend: boolean;
  defaultOn: boolean;
  reason: string | null;
}

/** El correo del avance tal como le llegaría al cliente. */
function MailPreview({ projectId, body, noteId }: { projectId: number; body: string; noteId?: number }) {
  const [preview, setPreview] = useState<{ subject: string; to: string; html: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ subject: string; to: string; html: string }>('POST', `projects/${projectId}/updates/mail-preview`, { body, noteId })
      .then(setPreview)
      .catch((err) => setError(err.message));
  }, [projectId, body, noteId]);
  if (error) return <p className="alert">{error}</p>;
  if (!preview) return <Loading />;
  return (
    <>
      <div className="mail-accordion__meta">
        <span>
          <small>Asunto</small>
          {preview.subject}
        </span>
        <span>
          <small>Para</small>
          {preview.to}
        </span>
      </div>
      {/* sandbox sin permisos: el HTML del correo no puede ejecutar nada en el portal. */}
      <iframe className="mail-preview" sandbox="" srcDoc={preview.html} title="Vista previa del correo del avance" />
    </>
  );
}

/** Ver el correo de un avance ya publicado y enviarlo desde ahí. */
function SendMailDialog({ note, projectId, onSent, onClose }: { note: Note; projectId: number; onSent: (n: Note) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { busy, run } = useAction();
  const toast = useToast();
  useEffect(() => ref.current?.showModal(), []);
  const send = () =>
    run(async () => {
      onSent(await api<Note>('POST', `notes/${note.id}/email`));
      toast('Avance enviado al correo del cliente.');
      ref.current?.close();
    });
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="update-mail-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) ref.current?.close();
      }}
    >
      <div className="modal__in">
        <header className="modal__head">
          <h2 id="update-mail-title">Enviar el avance por correo</h2>
          <button className="icon-btn" onClick={() => ref.current?.close()} aria-label="Cerrar">
            ✕
          </button>
        </header>
        <MailPreview projectId={projectId} body={note.body} noteId={note.id} />
        <div className="actions actions--tight">
          <button className="btn btn--primary btn--sm" disabled={busy} onClick={send}>
            {busy ? 'Enviando…' : 'Enviar al cliente'}
          </button>
          <button className="btn btn--outline btn--sm" disabled={busy} onClick={() => ref.current?.close()}>
            Cancelar
          </button>
        </div>
      </div>
    </dialog>
  );
}

/** Lo que verá el cliente, antes de publicar: en el portal y, si se envía, en su correo. */
function PreviewDialog({ projectId, body, internal, email, onClose }: { projectId: number; body: string; internal: boolean; email: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<'portal' | 'correo'>(!internal && email ? 'correo' : 'portal');
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
        {!internal && (
          <div className="segmented segmented--sm" role="tablist" aria-label="Dónde lo ve el cliente">
            <button role="tab" aria-selected={tab === 'portal'} className={tab === 'portal' ? 'is-active' : ''} onClick={() => setTab('portal')}>
              En el portal
            </button>
            <button role="tab" aria-selected={tab === 'correo'} className={tab === 'correo' ? 'is-active' : ''} onClick={() => setTab('correo')}>
              En su correo
            </button>
          </div>
        )}
        <p className="hint">
          {internal
            ? 'Solo lo verá tu equipo.'
            : tab === 'portal'
              ? 'Así lo verá el cliente en el portal.'
              : email
                ? 'Así le llegará al correo al publicar.'
                : 'Así le llegaría si activas «Enviar también por correo» (ahora no se enviará).'}
        </p>
        {tab === 'correo' && !internal ? (
          <MailPreview projectId={projectId} body={body} />
        ) : (
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
        )}
      </div>
    </dialog>
  );
}

function UpdateItem({
  note,
  projectId,
  staff,
  focused,
  editorProps,
  onChange,
  onDelete,
  onOpenLog,
}: {
  note: Note;
  projectId: number;
  staff: boolean;
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
  const [mailing, setMailing] = useState(false);
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
            {staff &&
              note.visibility === 'shared' &&
              (note.emailedAt ? (
                <span className="tag tag--sent" title={`Enviado el ${formatDateTime(note.emailedAt)}`}>
                  ✓ Enviado por correo
                </span>
              ) : (
                <button className="btn btn--outline btn--xs" onClick={() => setMailing(true)} disabled={busy} title="Hasta ahora solo está en el portal">
                  Enviar por correo
                </button>
              ))}
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
      {mailing && <SendMailDialog note={note} projectId={projectId} onSent={onChange} onClose={() => setMailing(false)} />}
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
  const mailInfo = useApi<MailInfo>(staff ? `projects/${project.id}/updates/mail` : null);
  // null = lo que diga Configuración → Avisos para este cliente; al tocar el interruptor, lo que elijas para este avance.
  const [emailChoice, setEmailChoice] = useState<boolean | null>(null);
  const email = !!mailInfo.data?.canSend && (emailChoice ?? mailInfo.data.defaultOn);
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
      const { email: mailed, ...note } = await api<Note & { email?: 'sent' | 'off' | 'error' }>('POST', `projects/${project.id}/notes`, {
        body: text,
        kind: 'avance',
        visibility: internal ? 'internal' : 'shared',
        ai: aiDraft,
        email: !internal && email,
      });
      setData([note, ...(data ?? [])]);
      setText('');
      setAiDraft(false);
      setEmailChoice(null);
      if (internal) toast('Avance guardado (solo equipo).');
      else if (mailed === 'sent') toast('Avance publicado: el cliente lo ve en el portal y le llegó a su correo.');
      else if (mailed === 'error') toast('Avance publicado en el portal, pero no se pudo enviar el correo. Usa «Enviar por correo» para reintentar.', true);
      else toast('Avance publicado solo en el portal. Si luego quieres, usa «Enviar por correo».');
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
                {!internal && mailInfo.data && (
                  <label className="auto-switch auto-switch--left update__mail" title={mailInfo.data.reason ?? `Se envía a ${mailInfo.data.to}`}>
                    <span className="switch">
                      <input type="checkbox" role="switch" checked={email} disabled={!mailInfo.data.canSend} onChange={(e) => setEmailChoice(e.target.checked)} />
                      <span className="switch__track" aria-hidden="true" />
                    </span>
                    <span>
                      Enviar también por correo
                      <small>{mailInfo.data.canSend ? (email ? `A ${mailInfo.data.to}` : 'Solo quedará en el portal') : mailInfo.data.reason}</small>
                    </span>
                  </label>
                )}
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
              staff={staff}
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

      {preview && <PreviewDialog projectId={project.id} body={text} internal={internal} email={email} onClose={() => setPreview(false)} />}
    </div>
  );
}
