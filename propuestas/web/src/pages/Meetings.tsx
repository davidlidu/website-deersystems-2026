import { useEffect, useState } from 'react';
import {
  api,
  formatDateTime,
  formatMeetingTime,
  MEETING_STATUS,
  timeAgo,
  useApi,
  usd,
  type Meeting,
  type MeetingStatus,
  type ProjectSummary,
  type Side,
  type TeamMember,
} from '../lib';
import { Empty, ErrorBox, Link, Loading, Markdown, PageHead, useAction, useToast } from '../ui';

interface SyncState {
  lastRun: string | null;
  lastError: string | null;
  found: number;
  processed: number;
}

export function MeetingStatusPill({ status }: { status: MeetingStatus }) {
  return <span className={`mpill mpill--${status}`}>{MEETING_STATUS[status]}</span>;
}

function MeetingRow({ m }: { m: Meeting }) {
  return (
    <Link to={`/reuniones/${m.id}`} className="table__row table__row--meeting">
      <span>
        <strong>{m.title}</strong>
        <small>
          {m.clientName ?? 'Sin cliente'}
          {m.projectName ? ` · ${m.projectName}` : ' · sin proyecto'}
        </small>
      </span>
      <span className="mono">{formatMeetingTime(m.startAt)}</span>
      <span>
        <MeetingStatusPill status={m.status} />
      </span>
    </Link>
  );
}

/** Bandeja de reuniones (solo administrador): lo que hay que revisar primero. */
export function MeetingsPage() {
  const { data, error, loading, reload, setData } = useApi<{ items: Meeting[]; sync: SyncState }>('meetings');
  const { busy, run } = useAction();
  const toast = useToast();
  const [showOld, setShowOld] = useState(false);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const { items, sync } = data!;

  const syncNow = () =>
    run(async () => {
      const state = await api<SyncState>('POST', 'meetings/sync');
      const fresh = await api<{ items: Meeting[]; sync: SyncState }>('GET', 'meetings');
      setData(fresh);
      toast(state.lastError ? `Sincronizado con avisos: ${state.lastError}` : `Listo: ${state.found} reuniones con clientes, ${state.processed} procesadas.`, !!state.lastError);
    });

  const groups: [string, Meeting[], string][] = [
    ['Por revisar', items.filter((m) => m.status === 'borrador' || m.status === 'error'), 'Nada por revisar.'],
    ['Próximas', items.filter((m) => m.status === 'programada').reverse(), 'No hay reuniones agendadas con clientes.'],
    ['Esperando transcripción', items.filter((m) => m.status === 'esperando' || m.status === 'sin_transcripcion'), ''],
    ['Enviadas', items.filter((m) => m.status === 'aprobada'), ''],
  ];
  const discarded = items.filter((m) => m.status === 'descartada');

  return (
    <>
      <PageHead eyebrow="Reuniones" title={<>Reuniones con <span className="grad">clientes</span></>}>
        <p>
          Se leen de tu Google Calendar: cualquier evento donde esté el correo de un cliente. Al terminar, se busca la transcripción de Meet y la IA
          prepara el resumen y las tareas. Tú lo revisas y lo envías.
        </p>
        <div className="sync-bar">
          <button className="btn btn--primary btn--sm" disabled={busy} onClick={syncNow}>
            {busy ? 'Sincronizando…' : 'Sincronizar ahora'}
          </button>
          <span className="hint">
            {sync.lastRun ? `Última sincronización ${timeAgo(sync.lastRun)} · se repite cada 10 min` : 'Aún no se ha sincronizado.'}
          </span>
        </div>
        {sync.lastError && <p className="alert">{sync.lastError}</p>}
      </PageHead>

      {groups.map(([title, list, empty]) =>
        list.length || empty ? (
          <section key={title} className="section">
            <div className="section__head">
              <h2>{title}</h2>
              <span className="mono">{list.length}</span>
            </div>
            {list.length ? (
              <div className="table card">
                {list.map((m) => (
                  <MeetingRow key={m.id} m={m} />
                ))}
              </div>
            ) : (
              <Empty>{empty}</Empty>
            )}
          </section>
        ) : null,
      )}
      {discarded.length > 0 && (
        <section className="section">
          <button className="linklike" onClick={() => setShowOld(!showOld)}>
            {showOld ? 'Ocultar' : 'Ver'} descartadas ({discarded.length})
          </button>
          {showOld && (
            <div className="table card" style={{ marginTop: 12 }}>
              {discarded.map((m) => (
                <MeetingRow key={m.id} m={m} />
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}

// ───────── Revisión de una reunión ─────────

interface DraftTask {
  key: string;
  include: boolean;
  title: string;
  description: string;
  side: Side;
  assigneeId: number | null;
  dueDate: string;
}

const key = () => Math.random().toString(36).slice(2);

export function MeetingReviewPage({ id }: { id: number }) {
  const { data, error, loading, reload, setData } = useApi<Meeting>(`meetings/${id}?transcript=1`);
  const projects = useApi<ProjectSummary[]>('projects');
  const team = useApi<TeamMember[]>('team');
  const { busy, run } = useAction();
  const toast = useToast();

  const [summary, setSummary] = useState('');
  const [preview, setPreview] = useState(false);
  const [agreements, setAgreements] = useState<string[]>([]);
  const [tasks, setTasks] = useState<DraftTask[]>([]);
  const [recipients, setRecipients] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState('');
  const [paste, setPaste] = useState('');
  const [showTranscript, setShowTranscript] = useState(false);
  const [result, setResult] = useState<{ tasks: number; mail: { sent: string[]; failed: string[]; error: string | null } } | null>(null);

  // Al llegar (o regenerarse) el borrador, se copia al formulario editable.
  useEffect(() => {
    if (!data) return;
    setSummary(data.summary ?? '');
    setAgreements(data.agreements ?? []);
    setTasks(
      (data.proposedTasks ?? []).map((t) => ({ key: key(), include: true, title: t.title, description: t.description, side: t.side, assigneeId: null, dueDate: t.dueDate ?? '' })),
    );
    setRecipients(new Set(data.attendees.filter((a) => a.side !== 'deersystems').map((a) => a.email)));
  }, [data?.id, data?.status, data?.ai?.latencyMs]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const m = data!;
  const editable = m.status === 'borrador' || (m.status === 'error' && !!m.summary);
  const canGenerate = ['esperando', 'sin_transcripcion', 'error', 'borrador'].includes(m.status);

  const setProject = (projectId: number | null) =>
    run(async () => {
      setData(await api<Meeting>('PATCH', `meetings/${m.id}`, { projectId }));
      toast('Proyecto actualizado.');
    });

  const generate = (withPaste: boolean) =>
    run(async () => {
      const updated = withPaste
        ? await api<Meeting>('POST', `meetings/${m.id}/transcript`, { transcript: paste })
        : await api<Meeting>('POST', `meetings/${m.id}/generate`);
      setData({ ...updated, transcript: withPaste ? paste : m.transcript });
      if (updated.status === 'error') toast(updated.error ?? 'La IA falló.', true);
      else toast('Resumen generado. Revísalo antes de enviarlo.');
      setPaste('');
    });

  const discard = () => {
    if (!confirm('¿Descartar esta reunión? No se enviará nada al cliente.')) return;
    run(async () => setData(await api<Meeting>('POST', `meetings/${m.id}/discard`)));
  };

  const approve = () => {
    if (!m.projectId) return toast('Elige el proyecto de la reunión.', true);
    if (!summary.trim()) return toast('El resumen está vacío.', true);
    const to = [...recipients, ...extra.split(/[,;\s]+/).filter((e) => e.includes('@'))];
    const chosen = tasks.filter((t) => t.include && t.title.trim());
    if (!confirm(`Se crearán ${chosen.length} tareas en «${m.projectName}»${to.length ? ` y se enviará el resumen a ${to.join(', ')}` : ''}. ¿Continuar?`)) return;
    run(async () => {
      const r = await api<{ meeting: Meeting; tasks: number; mail: { sent: string[]; failed: string[]; error: string | null } }>(
        'POST',
        `meetings/${m.id}/approve`,
        {
          projectId: m.projectId,
          summary,
          agreements: agreements.filter((a) => a.trim()),
          tasks: chosen.map((t) => ({ ...t, dueDate: t.dueDate || null })),
          recipients: to,
        },
      );
      setData({ ...r.meeting, transcript: m.transcript });
      setResult({ tasks: r.tasks, mail: r.mail });
      window.scrollTo(0, 0);
    });
  };

  const setTask = (k: string, patch: Partial<DraftTask>) => setTasks((ts) => ts.map((t) => (t.key === k ? { ...t, ...patch } : t)));
  const activeTeam = (team.data ?? []).filter((t) => t.active);
  const external = m.attendees.filter((a) => a.side !== 'deersystems');

  return (
    <>
      <div className="crumbs">
        <Link to="/reuniones">Reuniones</Link> / {m.title}
      </div>
      <PageHead eyebrow={`${m.clientName ?? 'Sin cliente'} · ${formatMeetingTime(m.startAt)}`} title={m.title}>
        <div className="facts">
          <span>
            <small>Estado</small>
            <MeetingStatusPill status={m.status} />
          </span>
          <label className="project-head__status">
            <small>Proyecto</small>
            <select value={m.projectId ?? ''} disabled={busy || m.status === 'aprobada'} onChange={(e) => setProject(Number(e.target.value) || null)}>
              <option value="">Sin proyecto</option>
              {(projects.data ?? [])
                .filter((p) => !m.clientId || p.clientId === m.clientId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
          <span>
            <small>Asistentes</small>
            {m.attendees.map((a) => a.name || a.email).join(', ') || '—'}
          </span>
        </div>
        <div className="actions">
          {m.meetUrl && (
            <a className="btn btn--outline btn--sm" href={m.meetUrl} target="_blank" rel="noopener">
              Abrir Meet
            </a>
          )}
          {m.calendarUrl && (
            <a className="btn btn--outline btn--sm" href={m.calendarUrl} target="_blank" rel="noopener">
              Ver en Calendar
            </a>
          )}
          {m.transcriptUrl && (
            <a className="btn btn--outline btn--sm" href={m.transcriptUrl} target="_blank" rel="noopener">
              Transcripción en Docs
            </a>
          )}
          {m.projectId && (
            <Link className="btn btn--outline btn--sm" to={`/proyectos/${m.projectId}`}>
              Ir al proyecto
            </Link>
          )}
        </div>
      </PageHead>

      {result && (
        <div className="stack">
          <p className="callout">
            Listo: se crearon {result.tasks} tareas.{' '}
            {result.mail.sent.length ? `Resumen enviado a ${result.mail.sent.join(', ')}.` : 'No se envió correo.'}
          </p>
          {result.mail.error && <p className="alert">Correo: {result.mail.error}</p>}
        </div>
      )}

      {m.status === 'programada' && <Empty>La reunión aún no ocurre. Cuando termine, se buscará la transcripción de Meet automáticamente.</Empty>}

      {m.status === 'aprobada' && (
        <section className="section section--flush">
          <div className="card prose">
            <Markdown text={m.summary ?? ''} />
            {!!m.agreements?.length && (
              <>
                <h3>Acuerdos</h3>
                <ul>
                  {m.agreements.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </>
            )}
            <p className="hint">
              Aprobada {formatDateTime(m.approvedAt)} · {m.taskIds?.length ?? 0} tareas creadas
              {m.sentTo?.length ? ` · enviada a ${m.sentTo.join(', ')}` : ''}
            </p>
          </div>
        </section>
      )}

      {canGenerate && !editable && m.status !== 'aprobada' && (
        <section className="card form-section">
          <h2>{m.hasTranscript ? 'Generar el resumen' : 'Transcripción'}</h2>
          {m.status === 'error' && m.error && <p className="alert">{m.error}</p>}
          {m.status === 'sin_transcripcion' && <p className="hint">{m.error ?? 'Meet no generó transcripción.'} Puedes pegarla o escribir tus notas.</p>}
          {m.status === 'esperando' && !m.hasTranscript && (
            <p className="hint">Se está esperando la transcripción de Meet. Si no la activaste, pega aquí el texto o tus notas de la reunión.</p>
          )}
          {m.hasTranscript && (
            <div className="actions actions--tight">
              <button className="btn btn--primary" disabled={busy} onClick={() => generate(false)}>
                {busy ? 'Generando…' : m.status === 'error' ? 'Reintentar con IA' : 'Generar resumen con IA'}
              </button>
            </div>
          )}
          <label className="field">
            <span className="field__label">{m.hasTranscript ? 'O reemplaza la transcripción' : 'Pega la transcripción o tus notas'}</span>
            <textarea rows={8} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Laura: … / David: …" />
          </label>
          <div className="actions actions--tight">
            <button className="btn btn--outline" disabled={busy || paste.trim().length < 50} onClick={() => generate(true)}>
              Usar este texto y generar
            </button>
            <button className="btn btn--outline btn--danger" disabled={busy} onClick={discard}>
              Descartar reunión
            </button>
          </div>
        </section>
      )}

      {editable && (
        <div className="approve">
          {m.ai && (
            <p className="hint mono">
              Borrador de {m.ai.model} · {(m.ai.latencyMs / 1000).toFixed(1)} s · {m.ai.costUsd ? usd(m.ai.costUsd) : 'sin costo'} · revisa todo: esto lo leerá el
              cliente
            </p>
          )}
          {m.status === 'error' && m.error && <p className="alert">{m.error}</p>}

          <section className="card form-section">
            <div className="form-section__head">
              <h2>Resumen</h2>
              <button className="linklike" onClick={() => setPreview(!preview)}>
                {preview ? 'Editar' : 'Vista previa'}
              </button>
            </div>
            {preview ? <Markdown text={summary} /> : <textarea rows={12} value={summary} onChange={(e) => setSummary(e.target.value)} />}
          </section>

          <section className="card form-section">
            <h2>Acuerdos</h2>
            {agreements.map((a, i) => (
              <div key={i} className="row-edit">
                <span className="input">
                  <input value={a} onChange={(e) => setAgreements(agreements.map((x, j) => (j === i ? e.target.value : x)))} />
                </span>
                <button className="btn btn--outline btn--sm btn--danger" onClick={() => setAgreements(agreements.filter((_, j) => j !== i))} aria-label="Quitar acuerdo">
                  ✕
                </button>
              </div>
            ))}
            <button className="btn btn--outline btn--sm" onClick={() => setAgreements([...agreements, ''])}>
              + Acuerdo
            </button>
          </section>

          <section className="card form-section">
            <div className="form-section__head">
              <h2>Tareas que salen de la reunión</h2>
              <span className="mono">
                {tasks.filter((t) => t.include).length} de {tasks.length} se crearán
              </span>
            </div>
            {tasks.map((t) => (
              <div key={t.key} className={`draft-task side-${t.side}${t.include ? '' : ' is-excluded'}`}>
                <div className="draft-task__row">
                  <label className="check check--chip">
                    <input type="checkbox" checked={t.include} onChange={(e) => setTask(t.key, { include: e.target.checked })} aria-label="Crear esta tarea" />
                  </label>
                  <span className="input draft-task__title">
                    <input value={t.title} onChange={(e) => setTask(t.key, { title: e.target.value })} aria-label="Título" />
                  </span>
                  <span className="input">
                    <select value={t.side} onChange={(e) => setTask(t.key, { side: e.target.value as Side, assigneeId: null })} aria-label="Le toca a">
                      <option value="deersystems">DeerSystems</option>
                      <option value="cliente">Cliente</option>
                    </select>
                  </span>
                  {t.side === 'deersystems' && activeTeam.length > 0 && (
                    <span className="input">
                      <select value={t.assigneeId ?? ''} onChange={(e) => setTask(t.key, { assigneeId: Number(e.target.value) || null })} aria-label="Responsable">
                        <option value="">Sin asignar</option>
                        {activeTeam.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </span>
                  )}
                  <span className="input">
                    <input type="date" value={t.dueDate} onChange={(e) => setTask(t.key, { dueDate: e.target.value })} aria-label="Entrega" />
                  </span>
                </div>
                <textarea rows={2} value={t.description} onChange={(e) => setTask(t.key, { description: e.target.value })} aria-label="Descripción" />
              </div>
            ))}
            <button
              className="btn btn--outline btn--sm"
              onClick={() => setTasks([...tasks, { key: key(), include: true, title: '', description: '', side: 'deersystems', assigneeId: null, dueDate: '' }])}
            >
              + Tarea
            </button>
          </section>

          <section className="card form-section confirm">
            <h2>Enviar el resumen a</h2>
            {external.map((a) => (
              <label key={a.email} className="check">
                <input
                  type="checkbox"
                  checked={recipients.has(a.email)}
                  onChange={(e) => {
                    const next = new Set(recipients);
                    if (e.target.checked) next.add(a.email);
                    else next.delete(a.email);
                    setRecipients(next);
                  }}
                />
                {a.name ? `${a.name} · ${a.email}` : a.email}
              </label>
            ))}
            <label className="field" style={{ width: '100%' }}>
              <span className="field__label">Otros correos (separados por coma)</span>
              <span className="input">
                <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="gerencia@cliente.com" />
              </span>
            </label>
            <div className="actions actions--tight">
              <button className="btn btn--primary" disabled={busy} onClick={approve}>
                {busy ? 'Enviando…' : 'Aprobar y enviar'}
              </button>
              <button className="btn btn--outline" disabled={busy} onClick={() => generate(false)}>
                Regenerar con IA
              </button>
              <button className="btn btn--outline btn--danger" disabled={busy} onClick={discard}>
                Descartar
              </button>
            </div>
            <p className="hint">Al aprobar, las tareas entran al proyecto y a la bitácora, y el cliente ve el resumen en la pestaña Reuniones.</p>
          </section>
        </div>
      )}

      {m.transcript && (
        <section className="section">
          <button className="linklike" onClick={() => setShowTranscript(!showTranscript)}>
            {showTranscript ? 'Ocultar' : 'Ver'} transcripción ({m.transcriptSource === 'manual' ? 'pegada a mano' : 'de Meet'})
          </button>
          {showTranscript && <pre className="transcript card">{m.transcript}</pre>}
        </section>
      )}
    </>
  );
}
