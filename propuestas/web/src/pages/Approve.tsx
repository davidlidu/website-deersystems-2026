import { useEffect, useRef, useState } from 'react';
import { api, draftBody, durationLabel, durationOptions, emptyDraft, formatDateTime, money, today, useApi, useLocation, usd, type PaymentDraft, type ProjectPerson, type Side, type TeamMember } from '../lib';
import { ErrorBox, Link, Loading, MoneyInput, PageHead, SecretBox, useAction, useToast } from '../ui';
import type { ClientApproval, ProposalRow } from './Proposals';
import { DraftHead, DraftRow, patchDrafts, withPercents } from './project/Payments';
import { OWNER, PeopleEditor, withOwner } from './project/People';
import { slotLabel, useSlotCheck } from './project/Schedule';

interface DraftTask {
  key: string;
  title: string;
  description: string;
  side: Side;
  /** Entrega al cliente (la revisa y aprueba o pide ajustes); si no, es operativa del equipo. */
  clientDelivery: boolean;
  assigneeId: number | null;
  /** Persona del cliente a cargo (proyectos compartidos), solo en tareas del cliente. */
  clientAssignee?: string;
  /** De todos: tú, tu equipo, el cliente y su equipo. */
  everyone?: boolean;
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
  meetings: { title: string; phaseIndex: number; date: string | null; time: string; durationMinutes: number; purpose: string; moved?: string }[];
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
  ai: { provider: string; model: string; costUsd: number; latencyMs: number; fallbackReason?: string | null };
  existingClientId: number | null;
}
interface ApprovalDetail {
  approval: ClientApproval;
  draft: Draft | null;
  ai: DraftResponse['ai'] | null;
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
  /** Invitar al cliente ya; si no, solo se reserva el horario en tu Calendar y la confirmas cuando él diga que le sirve. */
  inviteNow?: boolean;
  /** El sistema la movió de horario porque se cruzaba con otra reunión. */
  moved?: string;
}

interface Result {
  project: { id: number; name: string };
  client: { name: string; email: string };
  password: string | null;
  mail: { sent: boolean; error?: string };
  meetings: { scheduled: number; reserved?: number; errors: string[] };
  /** Al sumar a un proyecto existente: cuántas tareas se agregaron. */
  added?: number;
}

const key = () => Math.random().toString(36).slice(2);
// Solo cifras de dinero (igual que en el servidor): «pagan directamente a sus proveedores» no es un valor.
const PRICE_RE =
  /(\$\s?\d)|(\b(COP|USD|US\$|EUR)\s?\d)|(\d[\d.,]*\s?(COP|USD|US\$|EUR|pesos|d[oó]lares|millones)\b)|(\b\d{1,3}(?:\.\d{3}){2,}\b)|(\b\d{1,3}\s?%\s+(de\s+)?(anticipo|al aprobar|contra entrega))/i;
/** El fragmento que suena a valor, para mostrar qué quitar. */
function priceExcerpt(text: string): string | null {
  const m = PRICE_RE.exec(text);
  if (!m) return null;
  const from = Math.max(0, text.lastIndexOf('\n', m.index) + 1, m.index - 40);
  const nl = text.indexOf('\n', m.index);
  const to = Math.min(nl === -1 ? text.length : nl, m.index + m[0].length + 40);
  return `${from > 0 ? '…' : ''}${text.slice(from, to).trim()}${to < text.length ? '…' : ''}`;
}

const emptyTask = (): DraftTask => ({ key: key(), title: '', description: '', side: 'deersystems', clientDelivery: false, assigneeId: null, startDate: null, dueDate: null });

/** Estado del plan que se puede deshacer tras un ajuste con IA. */
interface PlanSnapshot {
  phases: DraftPhase[];
  meetings: DraftMeeting[];
  payments: (PaymentDraft & { key: string })[];
  startDate: string;
  endDate: string;
}
interface AdjustResponse {
  plan: { startDate: string | null; endDate: string | null; phases: Draft['phases']; meetings: Draft['meetings']; payments: Draft['payments'] };
  changes: string[];
  warnings: string[];
  ai: DraftResponse['ai'];
}

const EXAMPLES = [
  'Mueve el arranque al próximo lunes',
  'Agrega una fase de pruebas antes de la entrega',
  'Las reuniones de avance a las 3 p. m.',
  'El cliente entrega los accesos la primera semana',
];

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
      <p className="hint">
        Dile qué cambiar de las fases, tareas, fechas, reuniones o pagos. Puedes ajustar varias veces; nada se guarda hasta que crees el proyecto.
      </p>
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
          <ul className="md-list">{changes.length ? changes.map((c, i) => <li key={i}>{c}</li>) : <li>Plan actualizado.</li>}</ul>
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
  // Ninguna reunión del plan puede caer en un horario ya ocupado (ni cruzarse con otra del mismo plan).
  const dated = meetings.filter((m) => m.date && m.time);
  const slotCheck = useSlotCheck(dated.map((m) => ({ date: m.date, time: m.time, durationMinutes: m.durationMinutes })));
  const clashes = new Map(dated.map((m, i) => [m.key, slotCheck.result?.slots[i]?.conflict ? slotCheck.result.slots[i] : null]));
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
  // TRM fija para toda la propuesta (pagos en USD): la oficial de hoy, editable.
  const [trm, setTrm] = useState('');
  const trmAsked = useRef(false);
  // Proyecto compartido: el equipo (tú orquestas) y el reparto del trabajo con IA.
  const [shared, setShared] = useState(false);
  const [people, setPeople] = useState<ProjectPerson[]>([OWNER]);
  const [distributing, setDistributing] = useState(false);
  const [distribution, setDistribution] = useState<{ load: { person: string; summary: string }[]; notes: string[]; model: string } | null>(null);
  const [distHint, setDistHint] = useState('');
  // Aprobación del cliente desde el enlace (?aprobacion=ID): el plan ya se armó en segundo plano.
  const { query } = useLocation();
  const approvalId = Number(query.get('aprobacion')) || null;
  const [clientApproval, setClientApproval] = useState<ClientApproval | null>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [retries, setRetries] = useState(0);

  const proposal = proposals.data?.find((p) => p.id === proposalId);
  // Si la propuesta ya tiene proyecto (el cliente aprobó otra fase después), lo aprobado se suma a ese proyecto.
  const [target, setTarget] = useState<number | null>(null);
  const targetSet = useRef(false);
  useEffect(() => {
    if (targetSet.current || !proposal) return;
    targetSet.current = true;
    const last = proposal.projects[proposal.projects.length - 1];
    if (last && approvalId) setTarget(last.id);
  }, [proposal, approvalId]);
  const targetProject = proposal?.projects.find((p) => p.id === target) ?? null;
  const hasUsd = payments.some((p) => p.currency === 'USD');
  useEffect(() => {
    if (!hasUsd || trmAsked.current) return;
    trmAsked.current = true;
    api<{ trm: number | null }>('GET', `trm?date=${today()}`)
      .then((r) => r.trm && setTrm((t) => t || String(r.trm)))
      .catch(() => {});
  }, [hasUsd]);

  useEffect(() => {
    if (proposal && !project.name) setProject((p) => ({ ...p, name: proposal.title || '' }));
  }, [proposal, project.name]);
  // Propuesta vinculada a un cliente que ya existe: el proyecto es para él.
  const clientSet = useRef(false);
  useEffect(() => {
    if (clientSet.current || !proposal?.client) return;
    clientSet.current = true;
    setClientMode('existing');
    setExistingId(proposal.client.id);
  }, [proposal]);

  /** Pone en pantalla un plan: recién generado aquí o el que se armó cuando el cliente aprobó desde el enlace. */
  const applyDraft = ({ draft, ai, existingClientId }: DraftResponse) => {
    setAiInfo(ai);
    // Avisos del borrador: valores en el alcance, reuniones movidas por choque de horario…
    draft.warnings?.forEach((w) => toast(w));
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
        moved: m.moved,
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
  };

  const generate = (option: ProposalOption | null) => {
    setGenerating('draft');
    setAiError(null);
    api<DraftResponse>('POST', `proposals/${proposalId}/draft`, { option, notes })
      .then(applyDraft)
      .catch((err) => setAiError(err.message))
      .finally(() => setGenerating(null));
  };

  useEffect(() => {
    if (!approvalId) return;
    let timer: number | undefined;
    let alive = true;
    const load = () =>
      api<ApprovalDetail>('GET', `proposals/${proposalId}/approvals/${approvalId}`)
        .then((r) => {
          if (!alive) return;
          setClientApproval(r.approval);
          if (r.approval.status === 'listo' && r.draft && r.ai) applyDraft({ draft: r.draft, ai: r.ai, existingClientId: r.existingClientId });
          else if (r.approval.status === 'generando') timer = window.setTimeout(load, 4000);
          else if (r.approval.status !== 'error') setApprovalError('Esta aprobación ya se convirtió en proyecto o se descartó.');
        })
        .catch((err) => alive && setApprovalError(err.message));
    load();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
    // applyDraft cambia en cada render; solo se carga al abrir o al reintentar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approvalId, proposalId, retries]);

  const retryApproval = () =>
    run(async () => {
      await api('POST', `proposals/${proposalId}/approvals/${approvalId}/retry`);
      setClientApproval((a) => (a ? { ...a, status: 'generando', error: null } : a));
      setRetries((n) => n + 1);
    });

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
    if (clientApproval) {
      setProject((p) => ({ ...p, approvedOption: clientApproval.optionName, approvalNotes: clientApproval.notes }));
      setClient((c) => ({
        ...c,
        name: c.name || clientApproval.company || clientApproval.name,
        contactName: clientApproval.name,
        email: clientApproval.email,
        phone: clientApproval.phone,
      }));
    } else setProject((p) => ({ ...p, approvedOption: chosen !== null && options ? options[chosen].name : '', approvalNotes: notes }));
    setPhases([{ key: key(), name: 'Fase 1', tasks: [emptyTask()] }]);
    setStarted(true);
  };

  if (proposals.loading || clients.loading || team.loading) return <Loading />;
  if (proposals.error) return <ErrorBox message={proposals.error} />;
  if (!proposal) return <ErrorBox message="La propuesta no existe." />;

  if (result) {
    return (
      <>
        <PageHead
          eyebrow="Propuesta aprobada"
          title={
            <>
              Proyecto <span className="grad">{result.added !== undefined ? 'actualizado' : 'creado'}</span>
            </>
          }
        >
          <p>
            {result.added !== undefined ? (
              <>
                {result.added === 1 ? 'Se sumó 1 tarea' : `Se sumaron ${result.added} tareas`}, sus reuniones y sus pagos a <strong>{result.project.name}</strong>. El cliente lo ve en su portal.
              </>
            ) : (
              <>
                <strong>{result.project.name}</strong> ya está en el espacio de {result.client.name}.
              </>
            )}
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
              Se agendaron {result.meetings.scheduled} {result.meetings.scheduled === 1 ? 'reunión' : 'reuniones'} de avance en tu Google Calendar; el cliente
              recibió las invitaciones.
            </p>
          )}
          {(result.meetings.reserved ?? 0) > 0 && (
            <p className="callout">
              Se {result.meetings.reserved === 1 ? 'reservó 1 reunión' : `reservaron ${result.meetings.reserved} reuniones`} en tu Google Calendar como «Por
              confirmar». Cuando el cliente te confirme que le sirve, ábrela en la pestaña Reuniones del proyecto y pulsa «Confirmar e invitar»: ahí le llega
              la invitación.
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
  const removeTask = (pk: string, tk: string) => setPhases((ps) => ps.map((p) => (p.key === pk ? { ...p, tasks: p.tasks.filter((t) => t.key !== tk) } : p)));
  const move = (index: number, dir: -1 | 1) =>
    setPhases((ps) => {
      const next = [...ps];
      const target = index + dir;
      if (target < 0 || target >= next.length) return ps;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const clientPeople = shared ? people.filter((p) => p.side === 'cliente' && p.name.trim()) : [];
  /** La IA reparte las tareas del plan entre el equipo según sus habilidades; tú quedas con la mayor carga. */
  const distribute = () => {
    const team = withOwner(people).filter((p) => p.lead || p.name.trim());
    if (team.length < 2) return toast('Agrega al menos otra persona al equipo.', true);
    setDistributing(true);
    api<{ assignments: Record<string, string>; load: { person: string; summary: string }[]; notes: string[]; ai: { model: string } }>('POST', 'people/distribute', {
      projectName: project.name,
      scope: project.scope,
      people: team,
      instruction: distHint.trim(),
      phases: phases.map((ph) => ({ name: ph.name, tasks: ph.tasks.map((t) => ({ title: t.title, description: t.description, side: t.side })) })),
    })
      .then((r) => {
        const byKey = new Map(team.map((p) => [p.key, p]));
        setPhases((ps) =>
          ps.map((ph, i) => ({
            ...ph,
            tasks: ph.tasks.map((t, j) => {
              const k = r.assignments[`${i}.${j}`];
              if (k === undefined) return t;
              if (k === '') return { ...t, side: 'cliente' as const, assigneeId: null, clientAssignee: '', clientDelivery: false };
              const p = byKey.get(k);
              if (!p) return t;
              if (p.side === 'cliente') return { ...t, side: 'cliente' as const, assigneeId: null, clientAssignee: p.name, clientDelivery: false };
              return { ...t, side: 'deersystems' as const, assigneeId: p.accountId, clientAssignee: '' };
            }),
          })),
        );
        setDistribution({ load: r.load.map((l) => ({ person: byKey.get(l.person)?.name ?? l.person, summary: l.summary })), notes: r.notes, model: r.ai.model });
        toast('Trabajo repartido: revisa los responsables en cada tarea.');
      })
      .catch((e: Error) => toast(e.message, true))
      .finally(() => setDistributing(false));
  };

  const taskCount = phases.reduce((n, p) => n + p.tasks.filter((t) => t.title.trim()).length, 0);
  const clientTasks = phases.reduce((n, p) => n + p.tasks.filter((t) => t.side === 'cliente' && t.title.trim()).length, 0);
  const priceWarning =
    PRICE_RE.test(`${project.scope} ${project.approvedOption} ${project.approvalNotes}`) ||
    phases.some((p) => p.tasks.some((t) => PRICE_RE.test(`${t.title} ${t.description}`)));
  const activeTeam = (team.data ?? []).filter((m) => m.active);

  /** Manda el plan en pantalla y la instrucción; aplica el plan ajustado y guarda el anterior para deshacer. */
  const adjust = async (instruction: string) => {
    const snapshot: PlanSnapshot = { phases, meetings, payments, startDate: project.startDate, endDate: project.endDate };
    const r = await api<AdjustResponse>('POST', `proposals/${proposalId}/plan`, {
      instruction,
      projectName: project.name,
      scope: project.scope,
      pricing: project.pricing,
      plan: {
        startDate: project.startDate || null,
        endDate: project.endDate || null,
        phases: phases.map((p) => ({ name: p.name, tasks: p.tasks.filter((t) => t.title.trim()) })),
        meetings: meetings
          .filter((m) => m.title.trim())
          .map((m) => ({
            ...m,
            phaseIndex: Math.max(
              0,
              phases.findIndex((p) => p.key === m.phaseKey),
            ),
            date: m.date || null,
          })),
        payments: payments.filter((p) => p.label.trim() && Number(p.amount) > 0).map(draftBody),
      },
    });
    // Lo que la IA no conoce (responsable, si se agenda) se conserva por título.
    const norm = (t: string) => t.trim().toLowerCase();
    const assignees = new Map(phases.flatMap((p) => p.tasks.map((t) => [norm(t.title), t.assigneeId] as const)));
    const clientAssignees = new Map(phases.flatMap((p) => p.tasks.map((t) => [norm(t.title), t.clientAssignee ?? ''] as const)));
    const everyone = new Set(phases.flatMap((p) => p.tasks.filter((t) => t.everyone).map((t) => norm(t.title))));
    const scheduled = new Map(meetings.map((m) => [norm(m.title), m.schedule] as const));
    const inviting = new Map(meetings.map((m) => [norm(m.title), m.inviteNow] as const));
    const newPhases = r.plan.phases.map((ph) => ({
      key: key(),
      name: ph.name,
      tasks: ph.tasks.map((t) => ({
        ...t,
        key: key(),
        assigneeId: t.side === 'deersystems' ? (assignees.get(norm(t.title)) ?? null) : null,
        clientAssignee: t.side === 'cliente' ? (clientAssignees.get(norm(t.title)) ?? '') : '',
        everyone: everyone.has(norm(t.title)),
      })),
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
        inviteNow: inviting.get(norm(m.title)),
        moved: m.moved,
      })),
    );
    setPayments(
      (r.plan.payments ?? []).map((p) => ({
        key: key(),
        label: p.label,
        percent: p.percent?.toString() ?? '',
        amount: String(p.amount),
        currency: p.currency,
        dueDate: p.dueDate ?? '',
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
    setPayments(undo.payments);
    setProject((p) => ({ ...p, startDate: undo.startDate, endDate: undo.endDate }));
    setUndo(null);
    toast('Se restauró el plan anterior.');
  };

  const submit = () => {
    if (!targetProject) {
      if (!project.name.trim()) return toast('Falta el nombre del proyecto.', true);
      if (clientMode === 'existing' && !existingId) return toast('Elige el cliente.', true);
      if (clientMode === 'new' && (!client.name.trim() || !client.email.trim())) return toast('Falta el nombre o el correo del cliente.', true);
    }
    if (!taskCount) return toast('Agrega al menos una tarea.', true);
    const badPayment = payments.find((p) => (p.label.trim() || p.amount) && !(p.label.trim() && Number(p.amount) > 0));
    if (badPayment) return toast('Cada pago necesita el tipo de abono y un monto mayor a cero.', true);
    if ([...clashes.values()].some(Boolean)) return toast('Hay reuniones en horarios ocupados: muévelas al siguiente horario libre.', true);
    if (priceWarning && !confirm('El alcance o alguna tarea parece mencionar valores, y tu equipo puede verlos. ¿Crear el proyecto igual?')) return;
    run(async () => {
      const sent = phases.filter((p) => p.tasks.some((t) => t.title.trim()));
      const validMeetings = meetings.filter((m) => m.title.trim());
      const r = await api<Result>('POST', 'projects', {
        proposalId,
        approvalId,
        projectId: targetProject?.id ?? null,
        client: clientMode === 'existing' ? { id: existingId, email: accessEmail } : client,
        project,
        phases: sent.map((p) => ({ name: p.name, tasks: p.tasks.filter((t) => t.title.trim()) })),
        meetings: validMeetings.map((m) => ({
          title: m.title,
          phaseIndex: Math.max(
            0,
            sent.findIndex((p) => p.key === m.phaseKey),
          ),
          date: m.date || null,
          time: m.time,
          durationMinutes: m.durationMinutes,
          purpose: m.purpose,
          schedule: canSchedule && m.schedule && !!m.date,
          tentative: !m.inviteNow,
        })),
        payments: payments.filter((p) => p.label.trim() && Number(p.amount) > 0).map(draftBody),
        trm: hasUsd && Number(trm) > 0 ? Number(trm) : null,
        people: shared ? withOwner(people).filter((p) => p.lead || p.name.trim()) : [],
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
      <PageHead
        eyebrow="Propuesta aprobada"
        title={
          <>
            Arma el <span className="grad">plan de trabajo</span>
          </>
        }
      >
        <p>
          La IA lee{' '}
          <a href={proposal.url} target="_blank" rel="noopener">
            la propuesta
          </a>{' '}
          y sugiere alcance, fases, tareas y fechas. Revisa todo antes de crear el proyecto: nada se guarda hasta que confirmes.
        </p>
        {proposal.projects.length > 0 && (
          <p className="callout">
            Esta propuesta ya generó {proposal.projects.map((p) => p.name).join(', ')}. Puedes sumar lo nuevo a ese proyecto o crear otro.
          </p>
        )}
      </PageHead>

      {clientApproval && (
        <div className="callout client-approval-info">
          <strong>
            {clientApproval.name} aprobó la propuesta el {formatDateTime(clientApproval.createdAt)}
            {clientApproval.optionName && <> · {clientApproval.optionName}</>}
          </strong>
          <span>
            {[clientApproval.email, clientApproval.company, clientApproval.phone].filter(Boolean).join(' · ')}
            {clientApproval.version !== proposal.version && ` · aprobó la versión ${clientApproval.version} (hoy va en la ${proposal.version})`}
          </span>
          {clientApproval.notes && <span>Comentarios: «{clientApproval.notes}»</span>}
        </div>
      )}
      {approvalError && <ErrorBox message={approvalError} />}

      {approvalId && !started && !approvalError && (
        <div className="card generate stack">
          {!clientApproval || clientApproval.status === 'generando' ? (
            <Loading label="La IA está armando el plan con la opción que aprobó el cliente… puede tardar hasta un minuto." />
          ) : (
            <>
              <ErrorBox message={`No se pudo armar el plan: ${clientApproval.error ?? 'error desconocido'}`} />
              <div className="actions">
                <button className="btn btn--primary" disabled={busy} onClick={retryApproval}>
                  Reintentar con IA
                </button>
                <button className="btn btn--outline" onClick={startBlank}>
                  Empezar en blanco
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {!started && !approvalId && (
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
                  <button className="btn btn--primary" disabled={chosen === null} onClick={() => generate(chosen === null ? null : options[chosen])}>
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
              {project.approvalNotes ? ` · ${project.approvalNotes.replace(/[.\s]+$/, '')}` : ''}.
              {approvalId && (
                <>
                  {' '}
                  <button
                    type="button"
                    className="linkbtn"
                    disabled={busy}
                    title="Vuelve a armar las fases, tareas, reuniones y pagos con la IA. Se pierden los cambios que hayas hecho aquí."
                    onClick={() => {
                      if (!confirm('¿Volver a armar el plan con IA? Se reemplazan las fases, tareas, reuniones y pagos, y se pierden los cambios que hayas hecho aquí.')) return;
                      setStarted(false);
                      retryApproval();
                    }}
                  >
                    Volver a armar el plan
                  </button>
                </>
              )}
            </p>
          )}
          {aiInfo && (
            <p className="hint mono">
              Plan sugerido por {aiInfo.model} · {(aiInfo.latencyMs / 1000).toFixed(1)} s · {aiInfo.costUsd ? usd(aiInfo.costUsd) : 'sin costo'}
              {aiInfo.fallbackReason && (
                <>
                  <br />
                  Se usó el modelo de respaldo porque falló el principal ({aiInfo.fallbackReason})
                </>
              )}
            </p>
          )}

          {proposal.projects.length > 0 && (
            <section className="card form-section">
              <h2>Dónde queda</h2>
              <div className="segmented">
                <button className={target ? 'is-active' : ''} onClick={() => setTarget(proposal.projects[proposal.projects.length - 1].id)}>
                  Sumar a un proyecto existente
                </button>
                <button className={!target ? 'is-active' : ''} onClick={() => setTarget(null)}>
                  Crear proyecto nuevo
                </button>
              </div>
              {target ? (
                <>
                  <label className="field">
                    <span className="field__label">Proyecto</span>
                    <span className="input">
                      <select value={target} onChange={(e) => setTarget(Number(e.target.value))}>
                        {proposal.projects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                            {p.approvedOption ? ` · ${p.approvedOption}` : ''}
                          </option>
                        ))}
                      </select>
                    </span>
                  </label>
                  <p className="hint">
                    Las fases y tareas de abajo se agregan al final de su cronograma, y las reuniones y los pagos se suman a los que ya tiene. El cliente y su acceso
                    no cambian.
                  </p>
                </>
              ) : null}
            </section>
          )}

          {!targetProject && (
          <section className="card form-section">
            <h2>Cliente</h2>
            <div className="segmented">
              <button className={clientMode === 'new' ? 'is-active' : ''} onClick={() => setClientMode('new')}>
                Cliente nuevo
              </button>
              <button className={clientMode === 'existing' ? 'is-active' : ''} onClick={() => setClientMode('existing')} disabled={!clients.data?.length}>
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
          )}

          <section className="card form-section">
            <h2>Proyecto</h2>
            <div className="form-grid">
              {!targetProject && (
                <label className="field field--wide">
                  <span className="field__label">Nombre *</span>
                  <span className="input">
                    <input value={project.name} onChange={(e) => setProject({ ...project, name: e.target.value })} />
                  </span>
                </label>
              )}
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
            {priceExcerpt(project.scope) && (
              <p className="alert">
                El alcance menciona un valor: «{priceExcerpt(project.scope)}». Tu equipo puede verlo; pásalo a «Valores y condiciones».
              </p>
            )}
            <label className="field">
              <span className="field__label">Valores y condiciones · solo tú y el cliente</span>
              <textarea rows={6} value={project.pricing} onChange={(e) => setProject({ ...project, pricing: e.target.value })} />
            </label>
          </section>

          <section className="card form-section">
            <div className="form-section__head">
              <h2>Equipo del proyecto</h2>
              <label className="check check--chip">
                <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
                Proyecto compartido
              </label>
            </div>
            {!shared ? (
              <p className="hint">Márcalo si el cliente pone parte del equipo (personas que ejecutan tareas) y tú orquestas.</p>
            ) : (
              <>
                <p className="hint">
                  Tú orquestas y llevas la mayor carga. Agrega las personas del cliente (y de tu equipo) con sus habilidades, o tráelas de la reunión grabada
                  donde se presentaron; luego la IA reparte las tareas según eso.
                </p>
                <PeopleEditor
                  people={people}
                  onChange={setPeople}
                  team={team.data ?? []}
                  proposalId={proposalId}
                  clientId={clientMode === 'existing' ? existingId : null}
                  disabled={distributing}
                />
                <div className="adjust-plan__foot">
                  <span className="input people__hint">
                    <input
                      value={distHint}
                      disabled={distributing}
                      placeholder="Indicaciones opcionales (p. ej. Ana solo tiene medio tiempo)"
                      onChange={(e) => setDistHint(e.target.value)}
                    />
                  </span>
                  <button className="btn btn--primary btn--sm btn--ai" disabled={distributing || !taskCount} onClick={distribute}>
                    {distributing ? 'Repartiendo…' : distribution ? '✦ Volver a repartir' : '✦ Repartir el trabajo con IA'}
                  </button>
                </div>
                {distribution && (
                  <div className="adjust-plan__changes">
                    <strong>Reparto</strong>
                    <ul className="md-list">
                      {distribution.load.map((l) => (
                        <li key={l.person}>
                          <strong>{l.person}:</strong> {l.summary}
                        </li>
                      ))}
                    </ul>
                    {distribution.notes.map((n) => (
                      <small key={n}>⚠ {n}</small>
                    ))}
                    <small className="mono">{distribution.model}</small>
                  </div>
                )}
              </>
            )}
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
                  <button className="btn btn--outline btn--sm btn--danger" onClick={() => setPhases((ps) => ps.filter((p) => p.key !== ph.key))}>
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
                          onChange={(e) => updateTask(ph.key, t.key, { side: e.target.value as Side, assigneeId: null, clientAssignee: '', clientDelivery: false })}
                        >
                          <option value="deersystems">DeerSystems</option>
                          <option value="cliente">Cliente</option>
                        </select>
                      </span>
                      {t.side === 'deersystems' && (
                        <label className="check check--chip" title="Entrega al cliente: la revisa y la aprueba o pide ajustes. Sin marcar, es operativa del equipo.">
                          <input
                            type="checkbox"
                            checked={!!t.clientDelivery}
                            onChange={(e) => updateTask(ph.key, t.key, { clientDelivery: e.target.checked })}
                            aria-label="Entrega al cliente"
                          />
                          Entrega
                        </label>
                      )}
                      <label className="check check--chip" title="De todos: tú, tu equipo, el cliente y su equipo la ven y reciben sus avisos (p. ej. una entrega en la que todos deben estar pendientes).">
                        <input type="checkbox" checked={!!t.everyone} onChange={(e) => updateTask(ph.key, t.key, { everyone: e.target.checked })} aria-label="Asignar a todos" />
                        Todos
                      </label>
                      {t.side === 'cliente' && clientPeople.length > 0 && (
                        <span className="input">
                          <select value={t.clientAssignee ?? ''} aria-label="Persona del cliente" onChange={(e) => updateTask(ph.key, t.key, { clientAssignee: e.target.value })}>
                            <option value="">El cliente</option>
                            {clientPeople.map((p) => (
                              <option key={p.key} value={p.name}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                        </span>
                      )}
                      {t.side === 'deersystems' && activeTeam.length > 0 && (
                        <span className="input">
                          <select
                            value={t.assigneeId ?? ''}
                            aria-label="Responsable"
                            onChange={(e) => updateTask(ph.key, t.key, { assigneeId: Number(e.target.value) || null })}
                          >
                            <option value="">{shared ? 'Tú (orquestador)' : 'Sin asignar'}</option>
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
                {(() => {
                  const on = meetings.filter((m) => m.schedule && canSchedule && m.date);
                  const now = on.filter((m) => m.inviteNow).length;
                  return [on.length - now ? `${on.length - now} se reservan` : '', now ? `${now} con invitación` : ''].filter(Boolean).join(' · ') || 'ninguna se agenda';
                })()}
              </span>
            </div>
            <p className="hint">
              Cada reunión queda como tarea en su fase del cronograma. Las marcadas con 📅 se reservan en tu Google Calendar con Meet como «Por confirmar»:
              el cliente no recibe nada hasta que confirmes con él que el día y la hora le sirven. Marca «Invitar ya» si ya lo acordaron
              {canSchedule ? '' : ' (para agendarlas, conecta Google con permiso de crear eventos en Configuración)'}.
            </p>
            {(() => {
              const crossing = [...clashes.values()].filter(Boolean).length;
              const moved = meetings.filter((m) => m.moved && !clashes.get(m.key)).length;
              if (crossing)
                return (
                  <p className="alert">
                    {crossing === 1 ? '1 reunión se cruza' : `${crossing} reuniones se cruzan`} con otras de tu agenda o de este plan: están marcadas en rojo.
                    Muévelas al horario libre que se sugiere antes de crear el proyecto.
                  </p>
                );
              if (moved)
                return (
                  <p className="callout callout--warn">
                    {moved === 1 ? '1 reunión se movió' : `${moved} reuniones se movieron`} al siguiente horario libre porque el horario propuesto se cruzaba con
                    otra reunión. Ninguna queda cruzada; revisa que el nuevo horario te sirva.
                  </p>
                );
              return null;
            })()}
            {meetings.map((m) => {
              // Si cambias la fecha o la hora a mano, el aviso de «se movió» ya no aplica.
              const setM = (patch: Partial<DraftMeeting>) =>
                setMeetings((ms) => ms.map((x) => (x.key === m.key ? { ...x, ...patch, ...('date' in patch || 'time' in patch ? { moved: undefined } : {}) } : x)));
              const clash = clashes.get(m.key)?.conflict;
              return (
                <div key={m.key} className={`draft-task side-deersystems draft-meeting${clash ? ' is-clash' : m.moved ? ' is-moved' : ''}`}>
                  <div className="draft-task__row">
                    <label className="check check--chip" title="Agendar en Google Calendar">
                      <input
                        type="checkbox"
                        checked={m.schedule && canSchedule}
                        disabled={!canSchedule}
                        onChange={(e) => setM({ schedule: e.target.checked })}
                      />
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
                        {durationOptions(m.durationMinutes).map((d) => (
                          <option key={d} value={d}>
                            {durationLabel(d)}
                          </option>
                        ))}
                      </select>
                    </span>
                    <button
                      className="btn btn--outline btn--sm btn--danger"
                      onClick={() => setMeetings((ms) => ms.filter((x) => x.key !== m.key))}
                      aria-label="Quitar reunión"
                    >
                      ✕
                    </button>
                  </div>
                  <textarea
                    rows={1}
                    value={m.purpose}
                    placeholder="Qué se presenta o se valida con el cliente"
                    onChange={(e) => setM({ purpose: e.target.value })}
                  />
                  {m.schedule && canSchedule && (
                    <div className="draft-meeting__mode" role="radiogroup" aria-label="Cómo agendarla">
                      <button type="button" role="radio" aria-checked={!m.inviteNow} className={`chip${!m.inviteNow ? ' is-active' : ''}`} onClick={() => setM({ inviteNow: false })}>
                        Reservar · confirmar con el cliente
                      </button>
                      <button type="button" role="radio" aria-checked={!!m.inviteNow} className={`chip${m.inviteNow ? ' is-active' : ''}`} onClick={() => setM({ inviteNow: true })}>
                        Invitar ya
                      </button>
                    </div>
                  )}
                  {m.moved && !clash && <p className="slot-status slot-status--moved">↻ {m.moved}</p>}
                  {(() => {
                    const c = clashes.get(m.key);
                    if (!c?.conflict) return null;
                    return (
                      <p className="alert slot-status">
                        Horario ocupado: se cruza con «{c.conflict.title}» ({c.conflict.span ?? `${c.conflict.start} – ${c.conflict.end}`}).{' '}
                        {c.suggestion && (
                          <button
                            type="button"
                            className="btn btn--outline btn--xs"
                            onClick={() => setM({ date: c.suggestion!.date, time: c.suggestion!.time })}
                          >
                            Mover a {slotLabel(c.suggestion.date, c.suggestion.time)}
                          </button>
                        )}
                      </p>
                    );
                  })()}
                </div>
              );
            })}
            <button
              className="btn btn--outline btn--sm"
              onClick={() =>
                setMeetings((ms) => [
                  ...ms,
                  {
                    key: key(),
                    title: 'Reunión de avance con el cliente',
                    phaseKey: phases[phases.length - 1]?.key ?? '',
                    date: '',
                    time: '10:00',
                    durationMinutes: 45,
                    purpose: '',
                    schedule: true,
                  },
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
              El plan de pagos según la propuesta. Queda en la pestaña Pagos del proyecto (lo ven tú y el cliente, nunca el equipo); al marcar uno como pagado
              se registra en tu Gestor financiero. Si cambias un monto, el porcentaje de cada pago se recalcula sobre el total.
            </p>
            {hasUsd && (
              <div className="trm-fixed">
                <label className="field">
                  <span className="field__label">TRM fija de la propuesta (COP por USD)</span>
                  <span className="input">
                    <MoneyInput value={trm} onChange={setTrm} />
                  </span>
                </label>
                <p className="hint">
                  {targetProject
                    ? 'Si el proyecto aún no tiene TRM fija, queda esta. Si ya tiene, se conserva la suya.'
                    : 'La de hoy, para toda la propuesta: todas las cuotas en USD se liquidan a este valor aunque se paguen en meses distintos. Se puede ajustar después en Pagos.'}
                  {Number(trm) > 0 &&
                    ` Total USD ≈ ${money(
                      payments.filter((p) => p.currency === 'USD').reduce((n, p) => n + (Number(p.amount) || 0), 0) * Number(trm),
                      'COP',
                    )}.`}
                </p>
              </div>
            )}
            {payments.length > 0 && <DraftHead />}
            {payments.map((p, i) => (
              <DraftRow
                key={p.key}
                d={p}
                onChange={(patch) => setPayments((ps) => patchDrafts(ps, i, patch))}
                onRemove={() => setPayments((ps) => withPercents(ps.filter((x) => x.key !== p.key)))}
              />
            ))}
            <button className="btn btn--outline btn--sm" onClick={() => setPayments((ps) => [...ps, { ...emptyDraft(ps[0]?.currency), key: key() }])}>
              + Pago
            </button>
          </section>

          <AdjustPlan onAdjust={adjust} onUndo={undoAdjust} canUndo={!!undo} />

          <section className="card form-section confirm">
            {targetProject ? (
              <p className="hint">
                Se suma a <strong>{targetProject.name}</strong>. Al cliente le llegan las novedades por los avisos del proyecto, y las reuniones marcadas se
                agendan en tu Calendar con invitación.
              </p>
            ) : (
            <>
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
            </>
            )}
            <button className="btn btn--primary" onClick={submit} disabled={busy}>
              {busy ? (targetProject ? 'Agregando…' : 'Creando…') : targetProject ? `Agregar a ${targetProject.name}` : 'Crear proyecto'}
            </button>
          </section>
        </div>
      )}
    </>
  );
}
