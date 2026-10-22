import { useEffect, useState } from 'react';
import {
  api,
  formatDateTime,
  formatMeetingTime,
  MEETING_STATUS,
  navigate,
  timeAgo,
  useApi,
  useLocation,
  usd,
  type Meeting,
  type MeetingStatus,
  type ProjectSummary,
  type Side,
  type TeamMember,
} from '../lib';
import { Empty, ErrorBox, Link, Loading, Markdown, PageHead, useAction, useToast } from '../ui';
import { ClientsTabs } from './Home';
import { pickFromDrive } from '../picker';
import { ProposalSend, SalesCallForm } from './SalesCall';
import { EditMeeting, ScheduleMeeting } from './project/Schedule';

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
          {m.kind && m.kind !== 'proyecto'
            ? ` · ${m.kind === 'discovery' ? 'Discovery Call' : 'Proposal Call'}${m.proposalSentAt ? ' · propuesta enviada' : ''}`
            : m.projectName
              ? ` · ${m.projectName}`
              : ' · sin proyecto'}
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
  const { data, error, loading, reload, setData } = useApi<{ items: Meeting[]; sync: SyncState; settings: { importExternal: boolean } }>('meetings');
  const [scheduling, setScheduling] = useState(false);
  const [callKind, setCallKind] = useState<'proyecto' | 'discovery' | 'proposal'>('proyecto');
  const { busy, run } = useAction();
  const toast = useToast();
  const [showOld, setShowOld] = useState(false);
  // ?cliente=3: solo las reuniones de ese cliente (el breadcrumb de cada reunión lleva aquí).
  const { query } = useLocation();
  const clientFilter = Number(query.get('cliente')) || null;

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const { sync, settings } = data!;
  const all = data!.items;
  const items = clientFilter ? all.filter((m) => m.clientId === clientFilter) : all;
  const clients = [...new Map(all.filter((m) => m.clientId).map((m) => [m.clientId!, m.clientName ?? 'Cliente'])).entries()].sort((a, b) =>
    a[1].localeCompare(b[1], 'es'),
  );
  const setClient = (id: number | null) => navigate(id ? `/reuniones?cliente=${id}` : '/reuniones', true);

  const syncNow = () =>
    run(async () => {
      const state = await api<SyncState>('POST', 'meetings/sync');
      const fresh = await api<{ items: Meeting[]; sync: SyncState; settings: { importExternal: boolean } }>('GET', 'meetings');
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
      <ClientsTabs active="reuniones" />
      <PageHead eyebrow="Clientes · Reuniones" title={<>Reuniones con <span className="grad">clientes</span></>}>
        <p>
          Agenda aquí las reuniones de cada proyecto en marcha: se crean en tu Google Calendar con Meet y quedan asignadas al proyecto. Al
          terminar, se busca la transcripción y la IA prepara el resumen y las tareas. Tú lo revisas y lo envías.
        </p>
        <div className="sync-bar">
          <button className="btn btn--primary btn--sm" onClick={() => setScheduling(!scheduling)}>
            {scheduling ? 'Cerrar' : '+ Agendar reunión'}
          </button>
          <button className="btn btn--outline btn--sm" disabled={busy} onClick={syncNow}>
            {busy ? 'Sincronizando…' : 'Sincronizar ahora'}
          </button>
          <span className="hint">
            {sync.lastRun ? `Última sincronización ${timeAgo(sync.lastRun)} · se repite cada 10 min` : 'Aún no se ha sincronizado.'}
          </span>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.importExternal}
            disabled={busy}
            onChange={(e) =>
              run(async () => {
                const next = await api<{ importExternal: boolean }>('PUT', 'meetings/settings', { importExternal: e.target.checked });
                setData({ ...data!, settings: next });
              })
            }
          />
          Importar también las reuniones con clientes agendadas directamente en Google Calendar (si no, solo se siguen las agendadas desde aquí)
        </label>
        {sync.lastError && <p className="alert">{sync.lastError}</p>}
      </PageHead>
      {scheduling && (
        <>
          <div className="segmented call-kinds" role="radiogroup" aria-label="Tipo de reunión">
            {(
              [
                ['proyecto', 'Seguimiento de proyecto'],
                ['discovery', 'Discovery Call'],
                ['proposal', 'Proposal Call'],
              ] as const
            ).map(([k, label]) => (
              <button key={k} type="button" role="radio" aria-checked={callKind === k} className={callKind === k ? 'is-active' : ''} onClick={() => setCallKind(k)}>
                {label}
              </button>
            ))}
          </div>
          {callKind === 'proyecto' ? (
            <ScheduleMeeting
              onDone={async (m) => {
                setScheduling(false);
                setData({ ...data!, items: [m, ...all] });
              }}
            />
          ) : (
            <div className="card form-section">
              <h2>Agendar llamada comercial</h2>
              <SalesCallForm
                key={callKind}
                kind={callKind}
                onDone={(m) => {
                  setScheduling(false);
                  setData({ ...data!, items: [m, ...all] });
                }}
              />
            </div>
          )}
        </>
      )}

      {(clients.length > 1 || clientFilter) && (
        <div className="filters meetings-filter">
          <span className="input input--chip">
            <select value={clientFilter ?? ''} onChange={(e) => setClient(Number(e.target.value) || null)} aria-label="Cliente">
              <option value="">Todos los clientes</option>
              {clients.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </span>
          {clientFilter && (
            <button className="chip is-active" onClick={() => setClient(null)}>
              {clients.find(([id]) => id === clientFilter)?.[1] ?? 'Cliente'} ✕
            </button>
          )}
        </div>
      )}

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

// ───────── Vista previa del correo ─────────

interface PreviewContent {
  projectId: number | null;
  summary: string;
  agreements: string[];
  tasks: { title: string; side: Side; dueDate: string | null }[];
  to: string;
}

/**
 * Acordeón cerrado con el correo tal como lo recibirá el cliente. Se genera al abrirlo
 * y se actualiza solo (con una pequeña espera) mientras editas el resumen, los acuerdos o las tareas.
 */
function MailPreview({ meetingId, content }: { meetingId: number; content: PreviewContent }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<{ subject: string; to: string; html: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const payload = JSON.stringify(content);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const timer = setTimeout(() => {
      api<{ subject: string; to: string; html: string }>('POST', `meetings/${meetingId}/preview`, JSON.parse(payload))
        .then((p) => {
          setPreview(p);
          setError(null);
        })
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false));
    }, 600);
    return () => clearTimeout(timer);
  }, [open, payload, meetingId]);

  return (
    <details className="mail-accordion card" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>
        <span>
          <strong>Vista previa del correo</strong>
          <small>Así lo recibirá el cliente, con lo que tienes en pantalla</small>
        </span>
        {loading && open && <span className="loading__dot" aria-label="Actualizando" />}
      </summary>
      {error && <p className="alert">{error}</p>}
      {preview && (
        <div className="mail-accordion__body">
          <div className="mail-accordion__meta">
            <span>
              <small>Asunto</small>
              {preview.subject}
            </span>
            {preview.to && (
              <span>
                <small>Para</small>
                {content.to || preview.to}
              </span>
            )}
          </div>
          {/* sandbox sin permisos: el HTML del correo no puede ejecutar nada en el portal. */}
          <iframe className="mail-preview" sandbox="" srcDoc={preview.html} title="Vista previa del correo del resumen" />
        </div>
      )}
    </details>
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
  const [added, setAdded] = useState<string[]>([]);
  const [extra, setExtra] = useState('');
  const [paste, setPaste] = useState('');
  const [showTranscript, setShowTranscript] = useState(false);
  const [editingMeeting, setEditingMeeting] = useState(false);
  const [result, setResult] = useState<{ tasks: number; mail: { sent: string[]; failed: string[]; error: string | null } } | null>(null);

  // Al llegar (o regenerarse) el borrador, se copia al formulario editable.
  useEffect(() => {
    if (!data) return;
    setSummary(data.summary ?? '');
    setAgreements(data.agreements ?? []);
    setTasks(
      (data.proposedTasks ?? []).map((t) => ({ key: key(), include: true, title: t.title, description: t.description, side: t.side, assigneeId: null, dueDate: t.dueDate ?? '' })),
    );
    // Por defecto: la cuenta principal del cliente y los participantes que no son de DeerSystems.
    setRecipients(
      new Set([...(data.clientContacts ?? []).map((c) => c.email), ...data.attendees.filter((a) => a.side !== 'deersystems').map((a) => a.email.toLowerCase())]),
    );
  }, [data?.id, data?.status, data?.ai?.latencyMs, data?.projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const m = data!;
  const sales = !!m.kind && m.kind !== 'proyecto';
  // Las llamadas comerciales no tienen proyecto: su resumen se lee aquí, sin aprobar ni crear tareas.
  const editable = !sales && (m.status === 'borrador' || (m.status === 'error' && !!m.summary));
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

  const lookup = () =>
    run(async () => {
      const r = await api<{ result: 'ready' | 'pending' | 'none'; meeting: Meeting }>('POST', `meetings/${m.id}/lookup`);
      setData(r.meeting);
      if (r.result === 'ready') toast('Transcripción encontrada: resumen generado.');
      else if (r.result === 'pending') toast('Meet todavía está generando la transcripción. Se buscará sola cada 10 minutos.');
      else toast(r.meeting.error ?? 'Meet no tiene transcripción de esta reunión.', true);
    });

  const fromDrive = () =>
    run(async () => {
      const [file] = await pickFromDrive();
      if (!file) return;
      const updated = await api<Meeting>('POST', `meetings/${m.id}/transcript/drive`, { fileId: file.id });
      setData(updated);
      if (updated.status === 'error') toast(updated.error ?? 'La IA falló.', true);
      else toast(`«${file.name}» importado: resumen generado. Revísalo antes de enviarlo.`);
    });

  const discard = () => {
    if (!confirm('¿Descartar esta reunión? No se enviará nada al cliente.')) return;
    run(async () => setData(await api<Meeting>('POST', `meetings/${m.id}/discard`)));
  };

  const approve = () => {
    if (!m.projectId) return toast('Elige el proyecto de la reunión.', true);
    if (!summary.trim()) return toast('El resumen está vacío.', true);
    const to = [...recipients];
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
  // Todos los posibles destinatarios: cuenta principal y contacto del cliente, participantes de la reunión y los que agregues.
  const candidates: { email: string; name: string; label: string; kind: string }[] = [];
  const addCandidate = (email: string, name: string, label: string, kind: string) => {
    const e = email.trim().toLowerCase();
    const same = candidates.find((c) => c.email === e);
    // La cuenta principal que además estuvo en la reunión: una sola fila que lo dice.
    if (same && kind !== 'added' && same.kind === 'main' && !same.label.includes('participó')) same.label += ' · participó';
    else if (e && !same) candidates.push({ email: e, name, label, kind });
  };
  (m.clientContacts ?? []).forEach((c) => addCandidate(c.email, c.name, c.label, 'main'));
  m.attendees.forEach((a) =>
    addCandidate(a.email, a.name, a.side === 'deersystems' ? 'DeerSystems' : a.side === 'cliente' ? 'Participante · cliente' : 'Participante', a.side === 'deersystems' ? 'team' : 'guest'),
  );
  added.forEach((e) => addCandidate(e, '', 'Agregado', 'added'));

  return (
    <>
      <div className="crumbs">
        <Link to="/reuniones">Reuniones</Link>
        {m.clientId && (
          <>
            {' / '}
            <Link to={`/reuniones?cliente=${m.clientId}`}>{m.clientName ?? 'Cliente'}</Link>
          </>
        )}
        {!m.clientId && m.prospect?.company && <> / {m.prospect.company}</>}{' '}
        / {m.title}
      </div>
      <PageHead eyebrow={`${m.clientName ?? 'Sin cliente'} · ${formatMeetingTime(m.startAt)}`} title={m.title}>
        <div className="facts">
          <span>
            <small>Estado</small>
            <MeetingStatusPill status={m.status} />
          </span>
          {sales ? (
            <span>
              <small>Tipo</small>
              {m.kind === 'discovery' ? 'Discovery Call' : 'Proposal Call'}
              {m.prospect?.contact ? ` · ${m.prospect.contact}` : ''}
            </span>
          ) : (
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
          )}
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

      {m.status === 'programada' &&
        (editingMeeting ? (
          <EditMeeting
            meeting={m}
            onCancel={() => setEditingMeeting(false)}
            onDone={(updated) => {
              setEditingMeeting(false);
              setData({ ...updated, transcript: m.transcript });
            }}
          />
        ) : (
          <>
            <Empty>La reunión aún no ocurre. Cuando termine, se buscará la transcripción de Meet automáticamente.</Empty>
            <div className="actions actions--tight">
              <button className="btn btn--outline btn--sm" onClick={() => setEditingMeeting(true)}>
                Editar fecha, hora o invitados
              </button>
            </div>
          </>
        ))}

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
          {m.status === 'sin_transcripcion' && <p className="callout">{m.error ?? 'Meet no generó transcripción.'}</p>}
          {m.status === 'esperando' && !m.hasTranscript && (
            <p className="hint">Se está esperando la transcripción de Meet (se busca sola cada 10 minutos).</p>
          )}
          {!m.hasTranscript && (
            <div className="transcript-sources">
              <button className="btn btn--primary btn--sm" disabled={busy} onClick={fromDrive}>
                Importar desde Drive
              </button>
              {m.meetUrl && (
                <button className="btn btn--outline btn--sm" disabled={busy} onClick={lookup}>
                  Buscar de nuevo en Meet
                </button>
              )}
              <p className="hint">
                Elige en tu Drive (carpeta <em>Meet Recordings</em>) el documento de las <strong>notas de Gemini</strong> o de la <strong>transcripción</strong>, no
                el video. Se leen todas sus pestañas (también «Transcripción») y la IA arma el resumen con ese texto.
              </p>
            </div>
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

      {sales && !!m.summary && (
        <section className="section section--flush">
          <div className="card prose">
            <h2>Resumen de la llamada (IA)</h2>
            <Markdown text={m.summary} />
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
          </div>
        </section>
      )}

      {sales && (m.status !== 'programada' || new Date(m.endAt) < new Date()) && <ProposalSend m={m} onChange={(u) => setData({ ...u, transcript: m.transcript })} />}

      {editable && (
        <div className="approve">
          {m.ai && (
            <p className="hint mono">
              Borrador de {m.ai.model} · {(m.ai.latencyMs / 1000).toFixed(1)} s · {m.ai.costUsd ? usd(m.ai.costUsd) : 'sin costo'} · revisa todo: esto lo leerá el
              cliente
              {m.ai.fallbackReason && (
                <>
                  <br />
                  Se usó el modelo de respaldo porque falló el principal ({m.ai.fallbackReason})
                </>
              )}
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

          <MailPreview
            meetingId={m.id}
            content={{
              projectId: m.projectId,
              summary,
              agreements: agreements.filter((a) => a.trim()),
              tasks: tasks.filter((t) => t.include && t.title.trim()).map((t) => ({ title: t.title, side: t.side, dueDate: t.dueDate || null })),
              to: [...recipients].join(', '),
            }}
          />

          <section className="card form-section confirm">
            <h2>Enviar el resumen a</h2>
            <p className="hint">Marca quién recibe el correo. Puedes quitar a alguien o agregar más correos.</p>
            <ul className="recipients">
              {candidates.map((c) => (
                <li key={c.email}>
                  <label className={`recipient${recipients.has(c.email) ? ' is-on' : ''}`}>
                    <input
                      type="checkbox"
                      checked={recipients.has(c.email)}
                      onChange={(e) => {
                        const next = new Set(recipients);
                        if (e.target.checked) next.add(c.email);
                        else next.delete(c.email);
                        setRecipients(next);
                      }}
                    />
                    <span className="recipient__who">
                      <strong>{c.name || c.email}</strong>
                      {c.name && <small>{c.email}</small>}
                    </span>
                    <span className={`tag recipient__tag recipient__tag--${c.kind}`}>{c.label}</span>
                  </label>
                </li>
              ))}
            </ul>
            <form
              className="recipient-add"
              onSubmit={(e) => {
                e.preventDefault();
                const emails = extra.split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
                const bad = emails.find((x) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
                if (bad) return toast(`«${bad}» no es un correo válido.`, true);
                setAdded([...new Set([...added, ...emails])]);
                setRecipients(new Set([...recipients, ...emails]));
                setExtra('');
              }}
            >
              <span className="input">
                <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Agregar correo: gerencia@cliente.com" aria-label="Agregar correo" />
              </span>
              <button className="btn btn--outline btn--sm" disabled={!extra.trim()}>
                + Agregar
              </button>
            </form>
            <p className="hint">{recipients.size ? `Se enviará a ${recipients.size} ${recipients.size === 1 ? 'persona' : 'personas'}.` : 'Nadie marcado: se aprueba sin enviar correo.'}</p>
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
            {showTranscript ? 'Ocultar' : 'Ver'} transcripción ({m.transcriptSource === 'manual' ? 'pegada a mano' : m.transcriptSource === 'drive' ? 'importada de Drive' : 'de Meet'})
          </button>
          {showTranscript && <pre className="transcript card">{m.transcript}</pre>}
        </section>
      )}
    </>
  );
}
