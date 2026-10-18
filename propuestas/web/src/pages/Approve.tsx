import { useEffect, useRef, useState } from 'react';
import { api, draftBody, emptyDraft, money, today, useApi, usd, type PaymentDraft, type Side, type TeamMember } from '../lib';
import { ErrorBox, Link, Loading, PageHead, SecretBox, useAction, useToast } from '../ui';
import type { ProposalRow } from './Proposals';
import { DraftRow } from './project/Payments';

interface DraftTask {
  key: string;
  title: string;
  description: string;
  side: Side;
  assigneeId: number | null;
  startDate: string | null;
  dueDate: string | null;
}
interface DraftPhase {
  key: string;
  name: string;
  tasks: DraftTask[];
}
interface Draft {
  projectName: string;
  clientName: string;
  contactName: string;
  clientEmail: string;
  clientPhone: string;
  scope: string;
  pricing: string;
  startDate: string | null;
  endDate: string | null;
  approvedOption: string;
  approvalNotes: string;
  phases: { name: string; tasks: Omit<DraftTask, 'key' | 'assigneeId'>[] }[];
  meetings: { title: string; phaseIndex: number; date: string | null; time: string; durationMinutes: number; purpose: string }[];
  payments: { label: string; percent: number | null; amount: number; currency: 'USD' | 'COP'; dueDate: string | null }[];
  warnings: string[];
}
interface ProposalOption {
  name: string;
  summary: string;
  price: string;
}
interface DraftResponse {
  draft: Draft;
  ai: { provider: string; model: string; costUsd: number; latencyMs: number };
  existingClientId: number | null;
}
interface ClientRow {
  id: number;
  name: string;
  /** Null en clientes solo de facturación (importados de SmartBilling): al aprobar se les crea el acceso. */
  email: string | null;
}
/** Reunión de avance con el cliente propuesta por el plan. `phaseKey` apunta a la fase en pantalla. */
interface DraftMeeting {
  key: string;
  title: string;
  phaseKey: string;
  date: string;
  time: string;
  durationMinutes: number;
  purpose: string;
  schedule: boolean;
}

interface Result {
  project: { id: number; name: string };
  client: { name: string; email: string };
  password: string | null;
  mail: { sent: boolean; error?: string };
  meetings: { scheduled: number; errors: string[] };
}

const key = () => Math.random().toString(36).slice(2);
const PRICE_RE = /(\$\s?\d)|(\b(COP|USD|US\$|EUR|pesos|d[oó]lares)\b)|(\b\d{1,3}(?:[.,]\d{3}){2,}\b)|(\b(anticipo|abono|cuota|IVA|precio|valor total|inversi[oó]n)\b)/i;

const emptyTask = (): DraftTask => ({ key: key(), title: '', description: '', side: 'deersystems', assigneeId: null, startDate: null, dueDate: null });

/** Estado del plan que se puede deshacer tras un ajuste con IA. */
interface PlanSnapshot {
  phases: DraftPhase[];
  meetings: DraftMeeting[];
  startDate: string;
  endDate: string;
}
interface AdjustResponse {
  plan: { startDate: string | null; endDate: string | null; phases: Draft['phases']; meetings: Draft['meetings'] };
  changes: string[];
  warnings: string[];
  ai: DraftResponse['ai'];
}

const EXAMPLES = ['Mueve el arranque al próximo lunes', 'Agrega una fase de pruebas antes de la entrega', 'Las reuniones de avance a las 3 p. m.', 'El cliente entrega los accesos la primera semana'];

/** Cuadro de texto para pedirle a la IA cambios al plan que está en pantalla. */
function AdjustPlan({ onAdjust, onUndo, canUndo }: { onAdjust: (instruction: string) => Promise<string[]>; onUndo: () => void; canUndo: boolean }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changes, setChanges] = useState<string[] | null>(null);

  const send = () => {
    if (text.trim().length < 5) return setError('Escribe qué quieres ajustar.');
    setBusy(true);
    setError(null);
    onAdjust(text.trim())
      .then((c) => {
        setChanges(c);
        setText('');
      })
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false));
  };

  return (
    <section className="card form-section adjust-plan">
      <div className="form-section__head">
        <h2>Ajustar el plan con IA</h2>
        {canUndo && !busy && (
          <button
            className="linklike"
            onClick={() => {
              onUndo();
              setChanges(null);
            }}
          >
            Deshacer el último ajuste
          </button>
        )}
      </div>
      <p className="hint">Dile qué cambiar de las fases, tareas, fechas o reuniones. Puedes ajustar varias veces; nada se guarda hasta que crees el proyecto.</p>
      <textarea
        rows={3}
        value={text}
        disabled={busy}
        placeholder="Ej.: el proyecto arranca el 3 de noviembre, junta Diseño y Maqueta en una sola fase y agrega una reunión para validar el catálogo."
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send();
        }}
      />
      <div className="adjust-plan__foot">
        <span className="adjust-plan__examples">
          {EXAMPLES.map((ex) => (
            <button key={ex} className="chip" disabled={busy} onClick={() => setText((t) => (t.trim() ? `${t.trim()}. ${ex}` : ex))}>
              {ex}
            </button>
          ))}
        </span>
        <button className="btn btn--primary btn--sm" onClick={send} disabled={busy || !text.trim()}>
          {busy ? 'Ajustando…' : 'Ajustar plan'}
        </button>
      </div>
      {busy && (
        <p className="loading">
          <span className="loading__dot" /> La IA está ajustando el plan…
        </p>
      )}
      {error && <p className="alert">{error}</p>}
      {changes && !busy && (
        <div className="adjust-plan__changes">
          <strong>Cambios aplicados</strong>
          <ul className="md-list">
            {changes.length ? changes.map((c, i) => <li key={i}>{c}</li>) : <li>Plan actualizado.</li>}
          </ul>
          <small>Revisa arriba las fases, tareas y reuniones. Cuando el plan esté listo, crea el proyecto.</small>
        </div>
      )}
    </section>
  );
}

/** Ventana emergente con el correo que recibirá el cliente al crear el proyecto. */
function WelcomePreview({ proposalId, body, onClose }: { proposalId: number; body: unknown; onClose: () => void }) {
  const [preview, setPreview] = useState<{ subject: string; to: string; html: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  const payload = JSON.stringify(body);

  useEffect(() => {
    ref.current?.showModal();
    api<{ subject: string; to: string; html: string }>('POST', `proposals/${proposalId}/welcome-preview`, JSON.parse(payload))
      .then(setPreview)
      .catch((err) => setError(err.message));
  }, [proposalId, payload]);

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="welcome-preview-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) ref.current?.close();
      }}
    >
      <div className="modal__in">
        <header className="modal__head">
          <h2 id="welcome-preview-title">Vista previa del correo</h2>
          <button className="icon-btn" onClick={() => ref.current?.close()} aria-label="Cerrar">
            ✕
          </button>
        </header>
        {error && <p className="alert">{error}</p>}
        {!preview && !error && <Loading />}
        {preview && (
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
            <iframe className="mail-preview" sandbox="" srcDoc={preview.html} title="Vista previa del correo de bienvenida" />
          </>
        )}
      </div>
    </dialog>
  );
}

export function ApprovePage({ proposalId }: { proposalId: number }) {
  const proposals = useApi<ProposalRow[]>('proposals');
  const clients = useApi<ClientRow[]>('clients');
  const team = useApi<TeamMember[]>('team');
  const google = useApi<{ connected: boolean; missingScopes?: string[] }>('settings/google');
  const canSchedule = !!google.data?.connected && !google.data.missingScopes?.some((sc) => sc.endsWith('calendar.events'));
  const [meetings, setMeetings] = useState<DraftMeeting[]>([]);
  const toast = useToast();
  const { busy, run } = useAction();

  const [generating, setGenerating] = useState<null | 'options' | 'draft'>(null);
  // Alternativas detectadas (Opción A / B…): null = aún no se analiza; [] = oferta única.
  const [options, setOptions] = useState<ProposalOption[] | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [aiInfo, setAiInfo] = useState<DraftResponse['ai'] | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  const [clientMode, setClientMode] = useState<'new' | 'existing'>('new');
  const [existingId, setExistingId] = useState<number | null>(null);
  const [accessEmail, setAccessEmail] = useState('');
  const [client, setClient] = useState({ name: '', contactName: '', email: '', phone: '' });
  const [project, setProject] = useState({
    name: '',
    scope: '',
    pricing: '',
    approvedOption: '',
    approvalNotes: '',
    startDate: today(),
    endDate: '',
  });
  const [phases, setPhases] = useState<DraftPhase[]>([]);
  const [notify, setNotify] = useState(true);
  const [result, setResult] = useState<Result | null>(null);
  const [undo, setUndo] = useState<PlanSnapshot | null>(null);
  const [payments, setPayments] = useState<(PaymentDraft & { key: string })[]>([]);
  const [previewing, setPreviewing] = useState(false);

  const proposal = proposals.data?.find((p) => p.id === proposalId);

  useEffect(() => {
    if (proposal && !project.name) setProject((p) => ({ ...p, name: proposal.title || '' }));
  }, [proposal, project.name]);

  const generate = (option: ProposalOption | null) => {
    setGenerating('draft');
    setAiError(null);
    api<DraftResponse>('POST', `proposals/${proposalId}/draft`, { option, notes })
      .then(({ draft, ai, existingClientId }) => {
        setAiInfo(ai);
        setClient({ name: draft.clientName, contactName: draft.contactName, email: draft.clientEmail, phone: draft.clientPhone });
        if (existingClientId) {
          setClientMode('existing');
          setExistingId(existingClientId);
        }
        setProject({
          name: draft.projectName || proposal?.title || '',
          scope: draft.scope,
          pricing: draft.pricing,
          approvedOption: draft.approvedOption,
          approvalNotes: draft.approvalNotes,
          startDate: draft.startDate ?? today(),
          endDate: draft.endDate ?? '',
        });
        const newPhases = draft.phases.map((ph) => ({ key: key(), name: ph.name, tasks: ph.tasks.map((t) => ({ ...t, key: key(), assigneeId: null })) }));
        setPhases(newPhases);
        setMeetings(
          (draft.meetings ?? []).map((m) => ({
            key: key(),
            title: m.title,
            phaseKey: newPhases[m.phaseIndex]?.key ?? newPhases[0]?.key ?? '',
            date: m.date ?? '',
            time: m.time,
            durationMinutes: m.durationMinutes,
            purpose: m.purpose,
            schedule: true,
          })),
        );
        setPayments(
          (draft.payments ?? []).map((p) => ({
            key: key(),
            label: p.label,
            percent: p.percent?.toString() ?? '',
            amount: String(p.amount),
            currency: p.currency,
            dueDate: p.dueDate ?? '',
          })),
        );
        setStarted(true);
      })
      .catch((err) => setAiError(err.message))
      .finally(() => setGenerating(null));
  };

  /** Primero mira si la propuesta trae alternativas; si es una sola oferta, genera el plan de una vez. */
  const analyze = () => {
    setGenerating('options');
    setAiError(null);
    api<{ options: ProposalOption[] }>('POST', `proposals/${proposalId}/options`)
      .then(({ options }) => {
        setOptions(options);
        if (options.length > 1) setGenerating(null);
        else generate(null);
      })
      .catch((err) => {
        setAiError(err.message);
        setGenerating(null);
      });
  };

  const startBlank = () => {
    setProject((p) => ({ ...p, approvedOption: chosen !== null && options ? options[chosen].name : '', approvalNotes: notes }));
    setPhases([{ key: key(), name: 'Fase 1', tasks: [emptyTask()] }]);
    setStarted(true);
  };

  if (proposals.loading || clients.loading || team.loading) return <Loading />;
  if (proposals.error) return <ErrorBox message={proposals.error} />;
  if (!proposal) return <ErrorBox message="La propuesta no existe." />;

  if (result) {
    return (
      <>
        <PageHead eyebrow="Propuesta aprobada" title={<>Proyecto <span className="grad">creado</span></>}>
          <p>
            <strong>{result.project.name}</strong> ya está en el espacio de {result.client.name}.
          </p>
        </PageHead>
        <div className="stack">
          {result.mail.sent ? (
            <p className="callout">
              Se envió el correo {result.password ? 'de bienvenida con el acceso' : 'avisando del nuevo proyecto'} a {result.client.email}.
            </p>
          ) : (
            result.mail.error && <p className="alert">El correo no salió: {result.mail.error}</p>
          )}
          {result.meetings.scheduled > 0 && (
            <p className="callout">
              Se agendaron {result.meetings.scheduled} {result.meetings.scheduled === 1 ? 'reunión' : 'reuniones'} de avance en tu Google Calendar; el cliente recibió las
              invitaciones.
            </p>
          )}
          {result.meetings.errors.map((e) => (
            <p key={e} className="alert">
              No se agendó {e}
            </p>
          ))}
          {result.password && (
            <SecretBox
              label={`Contraseña de ${result.client.email}`}
              value={result.password}
              note="Solo se muestra esta vez. Si el correo no llegó, compártela por otro medio."
            />
          )}
          <div className="actions">
            <Link className="btn btn--primary" to={`/proyectos/${result.project.id}`}>
              Ver el proyecto
            </Link>
            <Link className="btn btn--outline" to="/propuestas">
              Volver a propuestas
            </Link>
          </div>
        </div>
      </>
    );
  }

  const updatePhase = (k: string, patch: Partial<DraftPhase>) => setPhases((ps) => ps.map((p) => (p.key === k ? { ...p, ...patch } : p)));
  const updateTask = (pk: string, tk: string, patch: Partial<DraftTask>) =>
    setPhases((ps) => ps.map((p) => (p.key === pk ? { ...p, tasks: p.tasks.map((t) => (t.key === tk ? { ...t, ...patch } : t)) } : p)));
  const removeTask = (pk: string, tk: string) =>
    setPhases((ps) => ps.map((p) => (p.key === pk ? { ...p, tasks: p.tasks.filter((t) => t.key !== tk) } : p)));
  const move = (index: number, dir: -1 | 1) =>
    setPhases((ps) => {
      const next = [...ps];
      const target = index + dir;
      if (target < 0 || target >= next.length) return ps;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const taskCount = phases.reduce((n, p) => n + p.tasks.filter((t) => t.title.trim()).length, 0);
  const clientTasks = phases.reduce((n, p) => n + p.tasks.filter((t) => t.side === 'cliente' && t.title.trim()).length, 0);
  const priceWarning =
    PRICE_RE.test(`${project.scope} ${project.approvedOption} ${project.approvalNotes}`) || phases.some((p) => p.tasks.some((t) => PRICE_RE.test(`${t.title} ${t.description}`)));
  const activeTeam = (team.data ?? []).filter((m) => m.active);

  /** Manda el plan en pantalla y la instrucción; aplica el plan ajustado y guarda el anterior para deshacer. */
  const adjust = async (instruction: string) => {
    const snapshot: PlanSnapshot = { phases, meetings, startDate: project.startDate, endDate: project.endDate };
    const r = await api<AdjustResponse>('POST', `proposals/${proposalId}/plan`, {
      instruction,
      projectName: project.name,
      scope: project.scope,
      plan: {
        startDate: project.startDate || null,
        endDate: project.endDate || null,
        phases: phases.map((p) => ({ name: p.name, tasks: p.tasks.filter((t) => t.title.trim()) })),
        meetings: meetings
          .filter((m) => m.title.trim())
          .map((m) => ({ ...m, phaseIndex: Math.max(0, phases.findIndex((p) => p.key === m.phaseKey)), date: m.date || null })),
      },
    });
    // Lo que la IA no conoce (responsable, si se agenda) se conserva por título.
    const norm = (t: string) => t.trim().toLowerCase();
    const assignees = new Map(phases.flatMap((p) => p.tasks.map((t) => [norm(t.title), t.assigneeId] as const)));
    const scheduled = new Map(meetings.map((m) => [norm(m.title), m.schedule] as const));
    const newPhases = r.plan.phases.map((ph) => ({
      key: key(),
      name: ph.name,
      tasks: ph.tasks.map((t) => ({ ...t, key: key(), assigneeId: assignees.get(norm(t.title)) ?? null })),
    }));
    setPhases(newPhases);
    setMeetings(
      r.plan.meetings.map((m) => ({
        key: key(),
        title: m.title,
        phaseKey: newPhases[m.phaseIndex]?.key ?? newPhases[0]?.key ?? '',
        date: m.date ?? '',
        time: m.time,
        durationMinutes: m.durationMinutes,
        purpose: m.purpose,
        schedule: scheduled.get(norm(m.title)) ?? true,
      })),
    );
    setProject((p) => ({ ...p, startDate: r.plan.startDate ?? p.startDate, endDate: r.plan.endDate ?? p.endDate }));
    setUndo(snapshot);
    setAiInfo(r.ai);
    r.warnings.forEach((w) => toast(w, true));
    return r.changes;
  };

  const undoAdjust = () => {
    if (!undo) return;
    setPhases(undo.phases);
    setMeetings(undo.meetings);
    setProject((p) => ({ ...p, startDate: undo.startDate, endDate: undo.endDate }));
    setUndo(null);
    toast('Se restauró el plan anterior.');
  };

  const submit = () => {
    if (!project.name.trim()) return toast('Falta el nombre del proyecto.', true);
    if (clientMode === 'existing' && !existingId) return toast('Elige el cliente.', true);
    if (clientMode === 'new' && (!client.name.trim() || !client.email.trim())) return toast('Falta el nombre o el correo del cliente.', true);
    if (!taskCount) return toast('Agrega al menos una tarea.', true);
    const badPayment = payments.find((p) => (p.label.trim() || p.amount) && !(p.label.trim() && Number(p.amount) > 0));
    if (badPayment) return toast('Cada pago necesita el tipo de abono y un monto mayor a cero.', true);
    if (priceWarning && !confirm('El alcance o alguna tarea parece mencionar valores, y tu equipo puede verlos. ¿Crear el proyecto igual?')) return;
    run(async () => {
      const sent = phases.filter((p) => p.tasks.some((t) => t.title.trim()));
      const validMeetings = meetings.filter((m) => m.title.trim());
      const r = await api<Result>('POST', 'projects', {
        proposalId,
        client: clientMode === 'existing' ? { id: existingId, email: accessEmail } : client,
        project,
        phases: sent.map((p) => ({ name: p.name, tasks: p.tasks.filter((t) => t.title.trim()) })),
        meetings: validMeetings.map((m) => ({
          title: m.title,
          phaseIndex: Math.max(0, sent.findIndex((p) => p.key === m.phaseKey)),
          date: m.date || null,
          time: m.time,
          durationMinutes: m.durationMinutes,
          purpose: m.purpose,
          schedule: canSchedule && m.schedule && !!m.date,
        })),
        payments: payments.filter((p) => p.label.trim() && Number(p.amount) > 0).map(draftBody),
        notify: notify && !!google.data?.connected,
      });
      setResult(r);
      window.scrollTo(0, 0);
    });
  };

  return (
    <>
      <div className="crumbs">
        <Link to="/propuestas">Propuestas</Link> / {proposal.title || proposal.slug}
      </div>
      <PageHead eyebrow="Propuesta aprobada" title={<>Arma el <span className="grad">plan de trabajo</span></>}>
        <p>
          La IA lee{' '}
          <a href={proposal.url} target="_blank" rel="noopener">
            la propuesta
          </a>{' '}
          y sugiere alcance, fases, tareas y fechas. Revisa todo antes de crear el proyecto: nada se guarda hasta que confirmes.
        </p>
        {proposal.projects.length > 0 && (
          <p className="callout">Esta propuesta ya generó {proposal.projects.map((p) => p.name).join(', ')}. Si sigues, se crea otro proyecto.</p>
        )}
      </PageHead>

      {!started && (
        <div className="card generate stack">
          {generating ? (
            <Loading
              label={
                generating === 'options'
                  ? 'Revisando si la propuesta trae varias opciones…'
                  : 'Leyendo la propuesta y armando el plan… puede tardar hasta un minuto.'
              }
            />
          ) : (
            <>
              {aiError && <ErrorBox message={aiError} />}
              {options && options.length > 1 && (
                <div className="stack">
                  <div>
                    <h2>¿Qué opción aprobó el cliente?</h2>
                    <p className="hint">La propuesta trae {options.length} alternativas. El plan se arma solo con la que elijas.</p>
                  </div>
                  <div className="options" role="radiogroup" aria-label="Opción aprobada">
                    {options.map((o, i) => (
                      <button
                        key={o.name}
                        role="radio"
                        aria-checked={chosen === i}
                        className={`option card${chosen === i ? ' is-active' : ''}`}
                        onClick={() => setChosen(i)}
                      >
                        <strong>{o.name}</strong>
                        {o.summary && <span>{o.summary}</span>}
                        {o.price && <span className="mono">{o.price}</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <label className="field">
                <span className="field__label">Ajustes acordados con el cliente (opcional)</span>
                <textarea
                  rows={3}
                  value={notes}
                  placeholder="Ej.: aprobó sin la app móvil; el pago será en 3 cuotas; agrega integración con Siigo."
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>
              <div className="actions">
                {options && options.length > 1 ? (
                  <button
                    className="btn btn--primary"
                    disabled={chosen === null}
                    onClick={() => generate(chosen === null ? null : options[chosen])}
                  >
                    Generar plan con esta opción
                  </button>
                ) : (
                  <button className="btn btn--primary" onClick={analyze}>
                    {aiError ? 'Reintentar con IA' : 'Generar plan con IA'}
                  </button>
                )}
                <button className="btn btn--outline" onClick={startBlank}>
                  Empezar en blanco
                </button>
              </div>
              {aiError && (
                <p className="hint">
                  Revisa el modelo y la clave en <Link to="/configuracion">Configuración</Link>.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {started && (
        <div className="approve">
          {project.approvedOption && (
            <p className="callout">
              Plan armado con <strong>{project.approvedOption}</strong>
              {project.approvalNotes ? ` · ${project.approvalNotes}` : ''}.
            </p>
          )}
          {aiInfo && (
            <p className="hint mono">
              Plan sugerido por {aiInfo.model} · {(aiInfo.latencyMs / 1000).toFixed(1)} s · {aiInfo.costUsd ? usd(aiInfo.costUsd) : 'sin costo'}
            </p>
          )}

          <section className="card form-section">
            <h2>Cliente</h2>
            <div className="segmented">
              <button className={clientMode === 'new' ? 'is-active' : ''} onClick={() => setClientMode('new')}>
                Cliente nuevo
              </button>
              <button
                className={clientMode === 'existing' ? 'is-active' : ''}
                onClick={() => setClientMode('existing')}
                disabled={!clients.data?.length}
              >
                Cliente existente
              </button>
            </div>
            {clientMode === 'existing' ? (
              <label className="field">
                <span className="field__label">Cliente (el proyecto se suma a su historial)</span>
                <span className="input">
                  <select value={existingId ?? ''} onChange={(e) => setExistingId(Number(e.target.value) || null)}>
                    <option value="">Elige…</option>
                    {clients.data?.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} · {c.email ?? 'sin acceso al portal'}
                      </option>
                    ))}
                  </select>
                </span>
              </label>
            ) : null}
            {clientMode === 'existing' && existingId && !clients.data?.find((c) => c.id === existingId)?.email && (
              <label className="field">
                <span className="field__label">Correo para su acceso al portal *</span>
                <span className="input">
                  <input type="email" value={accessEmail} onChange={(e) => setAccessEmail(e.target.value)} placeholder="cliente@empresa.com" />
                </span>
              </label>
            )}
            {clientMode === 'existing' ? null : (
              <div className="form-grid">
                <label className="field">
                  <span className="field__label">Empresa o cliente *</span>
                  <span className="input">
                    <input value={client.name} onChange={(e) => setClient({ ...client, name: e.target.value })} />
                  </span>
                </label>
                <label className="field">
                  <span className="field__label">Persona de contacto</span>
                  <span className="input">
                    <input value={client.contactName} onChange={(e) => setClient({ ...client, contactName: e.target.value })} />
                  </span>
                </label>
                <label className="field">
                  <span className="field__label">Correo de acceso *</span>
                  <span className="input">
                    <input type="email" value={client.email} onChange={(e) => setClient({ ...client, email: e.target.value })} />
                  </span>
                </label>
                <label className="field">
                  <span className="field__label">Teléfono</span>
                  <span className="input">
                    <input value={client.phone} onChange={(e) => setClient({ ...client, phone: e.target.value })} />
                  </span>
                </label>
              </div>
            )}
          </section>

          <section className="card form-section">
            <h2>Proyecto</h2>
            <div className="form-grid">
              <label className="field field--wide">
                <span className="field__label">Nombre *</span>
                <span className="input">
                  <input value={project.name} onChange={(e) => setProject({ ...project, name: e.target.value })} />
                </span>
              </label>
              <label className="field">
                <span className="field__label">Opción aprobada (si la propuesta tenía varias)</span>
                <span className="input">
                  <input
                    value={project.approvedOption}
                    placeholder="Ej.: Opción B"
                    onChange={(e) => setProject({ ...project, approvedOption: e.target.value })}
                  />
                </span>
              </label>
              <label className="field">
                <span className="field__label">Ajustes acordados</span>
                <span className="input">
                  <input value={project.approvalNotes} onChange={(e) => setProject({ ...project, approvalNotes: e.target.value })} />
                </span>
              </label>
              <label className="field">
                <span className="field__label">Inicio</span>
                <span className="input">
                  <input type="date" value={project.startDate} onChange={(e) => setProject({ ...project, startDate: e.target.value })} />
                </span>
              </label>
              <label className="field">
                <span className="field__label">Entrega estimada</span>
                <span className="input">
                  <input type="date" value={project.endDate} onChange={(e) => setProject({ ...project, endDate: e.target.value })} />
                </span>
              </label>
            </div>
            <label className="field">
              <span className="field__label">Alcance aprobado · lo ven el cliente y tu equipo (sin valores)</span>
              <textarea rows={10} value={project.scope} onChange={(e) => setProject({ ...project, scope: e.target.value })} />
            </label>
            {PRICE_RE.test(project.scope) && <p className="alert">El alcance parece mencionar valores o pagos. Tu equipo puede verlo.</p>}
            <label className="field">
              <span className="field__label">Valores y condiciones · solo tú y el cliente</span>
              <textarea rows={6} value={project.pricing} onChange={(e) => setProject({ ...project, pricing: e.target.value })} />
            </label>
          </section>

          <section className="card form-section">
            <div className="form-section__head">
              <h2>Fases y tareas</h2>
              <span className="mono">
                {taskCount} tareas · {clientTasks} del cliente
              </span>
            </div>
            {phases.map((ph, i) => (
              <div key={ph.key} className="draft-phase">
                <div className="draft-phase__head">
                  <span className="input">
                    <input value={ph.name} aria-label="Nombre de la fase" onChange={(e) => updatePhase(ph.key, { name: e.target.value })} />
                  </span>
                  <button className="btn btn--outline btn--sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Subir fase">
                    ↑
                  </button>
                  <button className="btn btn--outline btn--sm" onClick={() => move(i, 1)} disabled={i === phases.length - 1} aria-label="Bajar fase">
                    ↓
                  </button>
                  <button
                    className="btn btn--outline btn--sm btn--danger"
                    onClick={() => setPhases((ps) => ps.filter((p) => p.key !== ph.key))}
                  >
                    Quitar fase
                  </button>
                </div>
                {ph.tasks.map((t) => (
                  <div key={t.key} className={`draft-task side-${t.side}`}>
                    <div className="draft-task__row">
                      <span className="input draft-task__title">
                        <input
                          value={t.title}
                          placeholder="Tarea…"
                          aria-label="Título de la tarea"
                          onChange={(e) => updateTask(ph.key, t.key, { title: e.target.value })}
                        />
                      </span>
                      <span className="input">
                        <select
                          value={t.side}
                          aria-label="Quién la resuelve"
                          onChange={(e) => updateTask(ph.key, t.key, { side: e.target.value as Side, assigneeId: null })}
                        >
                          <option value="deersystems">DeerSystems</option>
                          <option value="cliente">Cliente</option>
                        </select>
                      </span>
                      {t.side === 'deersystems' && activeTeam.length > 0 && (
                        <span className="input">
                          <select
                            value={t.assigneeId ?? ''}
                            aria-label="Responsable"
                            onChange={(e) => updateTask(ph.key, t.key, { assigneeId: Number(e.target.value) || null })}
                          >
                            <option value="">Sin asignar</option>
                            {activeTeam.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name}
                              </option>
                            ))}
                          </select>
                        </span>
                      )}
                      <span className="input">
                        <input
                          type="date"
                          value={t.startDate ?? ''}
                          aria-label="Inicio"
                          onChange={(e) => updateTask(ph.key, t.key, { startDate: e.target.value || null })}
                        />
                      </span>
                      <span className="input">
                        <input
                          type="date"
                          value={t.dueDate ?? ''}
                          aria-label="Entrega"
                          onChange={(e) => updateTask(ph.key, t.key, { dueDate: e.target.value || null })}
                        />
                      </span>
                      <button className="btn btn--outline btn--sm btn--danger" onClick={() => removeTask(ph.key, t.key)} aria-label="Quitar tarea">
                        ✕
                      </button>
                    </div>
                    <textarea
                      rows={2}
                      value={t.description}
                      placeholder="Descripción y criterio de terminado"
                      aria-label="Descripción"
                      onChange={(e) => updateTask(ph.key, t.key, { description: e.target.value })}
                    />
                  </div>
                ))}
                <button className="btn btn--outline btn--sm" onClick={() => updatePhase(ph.key, { tasks: [...ph.tasks, emptyTask()] })}>
                  + Tarea
                </button>
              </div>
            ))}
            <button
              className="btn btn--outline"
              onClick={() => setPhases((ps) => [...ps, { key: key(), name: `Fase ${ps.length + 1}`, tasks: [emptyTask()] }])}
            >
              + Fase
            </button>
          </section>

          <section className="card form-section">
            <div className="form-section__head">
              <h2>Reuniones de avance con el cliente</h2>
              <span className="mono">
                {meetings.filter((m) => m.schedule && canSchedule && m.date).length} se agendarán
              </span>
            </div>
            <p className="hint">
              Cada reunión queda como tarea en su fase del cronograma. Las marcadas se agendan en tu Google Calendar con Meet y el cliente
              recibe la invitación{canSchedule ? '' : ' (para agendarlas, conecta Google con permiso de crear eventos en Configuración)'}.
            </p>
            {meetings.map((m) => {
              const setM = (patch: Partial<DraftMeeting>) => setMeetings((ms) => ms.map((x) => (x.key === m.key ? { ...x, ...patch } : x)));
              return (
                <div key={m.key} className="draft-task side-deersystems draft-meeting">
                  <div className="draft-task__row">
                    <label className="check check--chip" title="Agendar en Google Calendar">
                      <input type="checkbox" checked={m.schedule && canSchedule} disabled={!canSchedule} onChange={(e) => setM({ schedule: e.target.checked })} />
                      📅
                    </label>
                    <span className="input draft-task__title">
                      <input value={m.title} onChange={(e) => setM({ title: e.target.value })} aria-label="Título de la reunión" />
                    </span>
                    <span className="input">
                      <select value={m.phaseKey} onChange={(e) => setM({ phaseKey: e.target.value })} aria-label="Fase">
                        {phases.map((p) => (
                          <option key={p.key} value={p.key}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </span>
                    <span className="input">
                      <input type="date" value={m.date} min={today()} onChange={(e) => setM({ date: e.target.value })} aria-label="Fecha" />
                    </span>
                    <span className="input">
                      <input type="time" value={m.time} step={900} onChange={(e) => setM({ time: e.target.value })} aria-label="Hora" />
                    </span>
                    <span className="input">
                      <select value={m.durationMinutes} onChange={(e) => setM({ durationMinutes: Number(e.target.value) })} aria-label="Duración">
                        {[30, 45, 60, 90].map((d) => (
                          <option key={d} value={d}>
                            {d} min
                          </option>
                        ))}
                      </select>
                    </span>
                    <button className="btn btn--outline btn--sm btn--danger" onClick={() => setMeetings((ms) => ms.filter((x) => x.key !== m.key))} aria-label="Quitar reunión">
                      ✕
                    </button>
                  </div>
                  <textarea rows={1} value={m.purpose} placeholder="Qué se presenta o se valida con el cliente" onChange={(e) => setM({ purpose: e.target.value })} />
                </div>
              );
            })}
            <button
              className="btn btn--outline btn--sm"
              onClick={() =>
                setMeetings((ms) => [
                  ...ms,
                  { key: key(), title: 'Reunión de avance con el cliente', phaseKey: phases[phases.length - 1]?.key ?? '', date: '', time: '10:00', durationMinutes: 45, purpose: '', schedule: true },
                ])
              }
            >
              + Reunión
            </button>
          </section>

          <section className="card form-section">
            <div className="form-section__head">
              <h2>Pagos</h2>
              <span className="mono">
                {(['COP', 'USD'] as const)
                  .map((c) => [c, payments.filter((p) => p.currency === c).reduce((n, p) => n + (Number(p.amount) || 0), 0)] as const)
                  .filter(([, total]) => total > 0)
                  .map(([c, total]) => money(total, c))
                  .join(' + ') || 'sin pagos'}
              </span>
            </div>
            <p className="hint">
              El plan de pagos según la propuesta. Queda en la pestaña Pagos del proyecto (lo ven tú y el cliente, nunca el equipo); al marcar uno como
              pagado se registra en tu Gestor financiero.
            </p>
            {payments.map((p) => (
              <DraftRow
                key={p.key}
                d={p}
                onChange={(patch) => setPayments((ps) => ps.map((x) => (x.key === p.key ? { ...x, ...patch } : x)))}
                onRemove={() => setPayments((ps) => ps.filter((x) => x.key !== p.key))}
              />
            ))}
            <button
              className="btn btn--outline btn--sm"
              onClick={() => setPayments((ps) => [...ps, { ...emptyDraft(ps[0]?.currency), key: key() }])}
            >
              + Pago
            </button>
          </section>

          <AdjustPlan onAdjust={adjust} onUndo={undoAdjust} canUndo={!!undo} />

          <section className="card form-section confirm">
            <label className="check">
              <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} disabled={!google.data?.connected} />
              <span>
                {clientMode === 'existing' ? 'Avisar al cliente por correo del nuevo proyecto' : 'Enviar al cliente el correo de bienvenida con su contraseña'}{' '}
                ·{' '}
                <button
                  type="button"
                  className="linklike"
                  onClick={(e) => {
                    e.preventDefault();
                    setPreviewing(true);
                  }}
                >
                  ver el correo
                </button>
              </span>
            </label>
            {previewing && (
              <WelcomePreview
                proposalId={proposalId}
                body={{ client: clientMode === 'existing' ? { id: existingId, email: accessEmail } : client, projectName: project.name }}
                onClose={() => setPreviewing(false)}
              />
            )}
            {!google.data?.connected && (
              <p className="hint">
                Google no está conectado, así que no se envía correo: verás la contraseña aquí para compartirla. Conéctalo en{' '}
                <Link to="/configuracion">Configuración</Link>.
              </p>
            )}
            <button className="btn btn--primary" onClick={submit} disabled={busy}>
              {busy ? 'Creando…' : 'Crear proyecto'}
            </button>
          </section>
        </div>
      )}
    </>
  );
}
