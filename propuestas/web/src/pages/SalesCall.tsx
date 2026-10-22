import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { api, formatDateTime, today, useApi, type Meeting, type TeamMember } from '../lib';
import { Link, Loading, useAction, useToast } from '../ui';
import { sendFile, type ProposalRow } from './Proposals';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LABEL = { discovery: 'Discovery Call', proposal: 'Proposal Call' } as const;
type Kind = keyof typeof LABEL;

interface ClientOption {
  id: number;
  name: string;
  contact_name: string;
  email: string | null;
}

/** Siguiente media hora, para proponer una hora razonable. */
function nextSlot(): string {
  const d = new Date(Date.now() + 60 * 60_000);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Agendar una llamada comercial: «Discovery Call - Cliente (Contacto)» o «Proposal Call - Cliente (Contacto)».
 * Sirve para un cliente que ya existe o para un prospecto nuevo. En la Proposal Call se asigna la propuesta ya subida.
 */
export function SalesCallForm({ kind: initialKind, onDone }: { kind: Kind; onDone: (m: Meeting) => void }) {
  const clients = useApi<ClientOption[]>('clients');
  const proposals = useApi<ProposalRow[]>('proposals');
  const team = useApi<TeamMember[]>('team');
  const [kind, setKind] = useState<Kind>(initialKind);
  const [clientId, setClientId] = useState<number | null>(null);
  const [company, setCompany] = useState('');
  const [contact, setContact] = useState('');
  const [email, setEmail] = useState('');
  const [proposalId, setProposalId] = useState<number | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [teamIds, setTeamIds] = useState<Set<number>>(new Set());
  const { busy, run } = useAction();
  const toast = useToast();

  const auto = `${LABEL[kind]} - ${company.trim() || 'Cliente'}${contact.trim() ? ` (${contact.trim()})` : ''}`;
  const active = (proposals.data ?? []).filter((p) => p.active);

  const pickClient = (id: number | null) => {
    setClientId(id);
    const c = clients.data?.find((x) => x.id === id);
    setCompany(c?.name ?? '');
    setContact(c?.contact_name ?? '');
    setEmail(c?.email ?? '');
  };

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (!EMAIL.test(email.trim())) return toast('Escribe el correo del contacto.', true);
    run(async () => {
      const m = await api<Meeting>('POST', 'meetings/sales', {
        kind,
        clientId,
        company,
        contact,
        email,
        proposalId: kind === 'proposal' ? proposalId : null,
        title: title ?? auto,
        date: fd.get('date'),
        time: fd.get('time'),
        durationMinutes: Number(fd.get('duration')),
        agenda: fd.get('agenda'),
        team: [...teamIds],
        guests: String(fd.get('guests') ?? '')
          .split(/[,;\s]+/)
          .filter((x) => x.includes('@')),
      });
      toast(`${LABEL[kind]} agendada. Google Calendar envió la invitación con el enlace de Meet.`);
      onDone(m);
    });
  };

  if (clients.loading && !clients.data) return <Loading />;

  return (
    <form className="stack" onSubmit={submit}>
      <div className="segmented" role="radiogroup" aria-label="Tipo de llamada">
        {(Object.keys(LABEL) as Kind[]).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? 'is-active' : ''} onClick={() => setKind(k)}>
            {LABEL[k]}
          </button>
        ))}
      </div>
      <p className="hint">
        {kind === 'discovery'
          ? 'Primera conversación para entender el negocio y sus retos. Al terminar, la IA resume la llamada para armar la propuesta.'
          : 'Presentación de la propuesta. Al terminar, desde la reunión la envías con un mensaje de agradecimiento, o subes antes una versión nueva según lo que se habló.'}
      </p>

      <div className="form-grid">
        <label className="field">
          <span className="field__label">Cliente</span>
          <span className="input">
            <select value={clientId ?? ''} onChange={(e) => pickClient(Number(e.target.value) || null)}>
              <option value="">Prospecto nuevo (aún no es cliente)</option>
              {(clients.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </span>
        </label>
        <label className="field">
          <span className="field__label">Empresa o cliente</span>
          <span className="input">
            <input value={company} onChange={(e) => setCompany(e.target.value)} required maxLength={120} placeholder="Vantage Insurance" />
          </span>
        </label>
        <label className="field">
          <span className="field__label">Contacto</span>
          <span className="input">
            <input value={contact} onChange={(e) => setContact(e.target.value)} maxLength={120} placeholder="Laura Gómez" />
          </span>
        </label>
        <label className="field">
          <span className="field__label">Correo del contacto</span>
          <span className="input">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="laura@empresa.com" />
          </span>
        </label>
      </div>

      {kind === 'proposal' && (
        <label className="field">
          <span className="field__label">Propuesta que vas a presentar</span>
          <span className="input">
            <select value={proposalId ?? ''} onChange={(e) => setProposalId(Number(e.target.value) || null)}>
              <option value="">La elijo después</option>
              {active.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title || p.slug} · v{p.version}
                </option>
              ))}
            </select>
          </span>
          {!active.length && (
            <small className="hint">
              No hay propuestas activas. Súbela en <Link to="/propuestas">Propuestas</Link>.
            </small>
          )}
        </label>
      )}

      <div className="form-grid">
        <label className="field field--wide">
          <span className="field__label">Título</span>
          <span className="input">
            <input value={title ?? auto} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
          </span>
          {title !== null && title !== auto && (
            <button type="button" className="linklike" onClick={() => setTitle(null)}>
              Usar «{auto}»
            </button>
          )}
        </label>
        <label className="field">
          <span className="field__label">Fecha</span>
          <span className="input">
            <input name="date" type="date" required min={today()} defaultValue={today()} />
          </span>
        </label>
        <div className="form-grid form-grid--tight">
          <label className="field">
            <span className="field__label">Hora (Colombia)</span>
            <span className="input">
              <input name="time" type="time" required step={900} defaultValue={nextSlot()} />
            </span>
          </label>
          <label className="field">
            <span className="field__label">Duración</span>
            <span className="input">
              <select name="duration" defaultValue={kind === 'discovery' ? '30' : '45'} key={kind}>
                {[15, 30, 45, 60, 90].map((m) => (
                  <option key={m} value={m}>
                    {m < 60 ? `${m} min` : `${m / 60} h${m % 60 ? ` ${m % 60} min` : ''}`}
                  </option>
                ))}
              </select>
            </span>
          </label>
        </div>
      </div>
      <label className="field">
        <span className="field__label">Agenda (va en la invitación)</span>
        <textarea name="agenda" rows={3} placeholder={kind === 'discovery' ? 'Conocer el negocio, los procesos actuales y lo que quieren lograr…' : 'Presentación de la propuesta, preguntas y siguientes pasos…'} />
      </label>
      {(team.data ?? []).some((m) => m.active) && (
        <fieldset className="invitees">
          <legend className="field__label">Tu equipo</legend>
          {team.data!
            .filter((m) => m.active)
            .map((m) => (
              <label key={m.id} className="check">
                <input
                  type="checkbox"
                  checked={teamIds.has(m.id)}
                  onChange={(e) => {
                    const next = new Set(teamIds);
                    if (e.target.checked) next.add(m.id);
                    else next.delete(m.id);
                    setTeamIds(next);
                  }}
                />{' '}
                {m.name} · {m.email}
              </label>
            ))}
        </fieldset>
      )}
      <label className="field">
        <span className="field__label">Otros invitados (correos separados por coma)</span>
        <span className="input">
          <input name="guests" placeholder="socio@empresa.com" />
        </span>
      </label>
      <p className="hint">Activa la transcripción en Meet: con ella la IA resume la llamada y personaliza el correo de la propuesta.</p>
      <div className="actions actions--tight">
        <button className="btn btn--primary" disabled={busy}>
          {busy ? 'Agendando…' : `Agendar ${LABEL[kind]}`}
        </button>
      </div>
    </form>
  );
}

/** Vista previa del correo de la propuesta (con lo que está en pantalla). */
function PreviewDialog({ meetingId, body, onClose }: { meetingId: number; body: Record<string, unknown>; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [preview, setPreview] = useState<{ subject: string; to: string; html: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    ref.current?.showModal();
    api<{ subject: string; to: string; html: string }>('POST', `meetings/${meetingId}/proposal/preview`, body)
      .then(setPreview)
      .catch((err) => setError(err.message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <dialog ref={ref} className="modal" aria-labelledby="proposal-preview-title" onClose={onClose} onClick={(e) => e.target === e.currentTarget && ref.current?.close()}>
      <div className="modal__in">
        <header className="modal__head">
          <h2 id="proposal-preview-title">Vista previa del correo</h2>
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
                {preview.to || '—'}
              </span>
            </div>
            <iframe className="mail-preview" sandbox="" srcDoc={preview.html} title="Vista previa del correo de la propuesta" />
          </>
        )}
      </div>
    </dialog>
  );
}

/**
 * Después de la Proposal Call: elegir (o subir una versión nueva de) la propuesta, revisar el mensaje
 * —el copy por defecto o personalizado por la IA con lo que se habló— y enviarla al cliente.
 */
export function ProposalSend({ m, onChange }: { m: Meeting; onChange: (m: Meeting) => void }) {
  const proposals = useApi<ProposalRow[]>('proposals');
  const [proposalId, setProposalId] = useState<number | null>(m.proposal?.id ?? null);
  const [message, setMessage] = useState('');
  const [subject, setSubject] = useState('');
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState(false);
  const [recipients, setRecipients] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState('');
  const [added, setAdded] = useState<string[]>([]);
  const file = useRef<HTMLInputElement>(null);
  const { busy, run } = useAction();
  const toast = useToast();
  const hasContext = !!m.hasTranscript || !!m.summary;

  // El copy por defecto, con el nombre del contacto y la empresa.
  useEffect(() => {
    api<{ message: string }>('POST', `meetings/${m.id}/proposal/message`, { ai: false })
      .then((r) => setMessage((cur) => cur || r.message))
      .catch(() => {});
  }, [m.id]);

  const candidates = useMemo(() => {
    const out: { email: string; name: string; label: string }[] = [];
    const add = (email: string, name: string, label: string) => {
      const e = email.trim().toLowerCase();
      if (e && !out.some((x) => x.email === e)) out.push({ email: e, name, label });
    };
    (m.clientContacts ?? []).forEach((c) => add(c.email, c.name, c.label));
    m.attendees.filter((a) => a.side !== 'deersystems').forEach((a) => add(a.email, a.name, 'Participante'));
    added.forEach((e) => add(e, '', 'Agregado'));
    return out;
  }, [m.clientContacts, m.attendees, added]);

  useEffect(() => {
    setRecipients(new Set([...(m.clientContacts ?? []).map((c) => c.email), ...m.attendees.filter((a) => a.side !== 'deersystems').map((a) => a.email.toLowerCase())]));
  }, [m.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = (proposals.data ?? []).filter((p) => p.active || p.id === proposalId);
  const current = list.find((p) => p.id === proposalId);

  const choose = (id: number | null) => {
    setProposalId(id);
    run(async () => onChange(await api<Meeting>('PATCH', `meetings/${m.id}`, { proposalId: id })));
  };

  const upload = (f: File | undefined) => {
    if (!f || !current) return;
    if (!/\.(html?|zip)$/i.test(f.name)) return toast('Sube un archivo .html o .zip.', true);
    run(async () => {
      const updated = await sendFile<ProposalRow>('PUT', `proposals/${current.id}/file`, f, { note: note || `Ajustes tras la ${m.title}` });
      proposals.setData((proposals.data ?? []).map((p) => (p.id === updated.id ? updated : p)));
      setNote('');
      toast(`Nueva versión publicada (v${updated.version}) en el mismo enlace.`);
    });
  };

  const personalize = () =>
    run(async () => {
      const r = await api<{ message: string }>('POST', `meetings/${m.id}/proposal/message`, { ai: true });
      setMessage(r.message);
      toast('Mensaje personalizado con lo que se habló. Revísalo antes de enviar.');
    });

  const body = { proposalId, to: [...recipients], subject, message };

  const send = () => {
    if (!proposalId) return toast('Elige la propuesta.', true);
    if (!recipients.size) return toast('Elige al menos un destinatario.', true);
    if (!confirm(`¿Enviar «${current?.title || current?.slug}» a ${[...recipients].join(', ')}?`)) return;
    run(async () => {
      onChange(await api<Meeting>('POST', `meetings/${m.id}/proposal/send`, body));
      toast('Propuesta enviada.');
    });
  };

  return (
    <section className="card form-section proposal-send">
      <h2>Enviar la propuesta</h2>
      {m.proposalSentAt && (
        <p className="callout">
          Enviada {formatDateTime(m.proposalSentAt)} a {(m.proposalSentTo ?? []).join(', ')}. Puedes volver a enviarla si subes una versión nueva.
        </p>
      )}

      <div className="proposal-send__pick">
        <label className="field">
          <span className="field__label">Propuesta</span>
          <span className="input">
            <select value={proposalId ?? ''} onChange={(e) => choose(Number(e.target.value) || null)} disabled={busy}>
              <option value="">Elige la propuesta…</option>
              {list.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title || p.slug} · v{p.version}
                </option>
              ))}
            </select>
          </span>
        </label>
        {current && (
          <div className="proposal-send__current">
            <a className="btn btn--outline btn--sm" href={current.url} target="_blank" rel="noopener">
              Ver la propuesta (v{current.version})
            </a>
            <span className="hint">
              {current.views} {current.views === 1 ? 'visita' : 'visitas'}
              {!current.active && ' · enlace pausado'}
            </span>
          </div>
        )}
      </div>

      {current && (
        <div className="proposal-send__version">
          <span className="field__label">¿Cambios según la conversación?</span>
          <div className="proposal-send__upload">
            <span className="input">
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Qué cambió (queda en el historial de versiones)" maxLength={300} />
            </span>
            <button type="button" className="btn btn--outline btn--sm" disabled={busy} onClick={() => file.current?.click()}>
              Subir versión nueva (.html o .zip)
            </button>
            <input
              ref={file}
              type="file"
              accept=".html,.htm,.zip"
              hidden
              onChange={(e) => {
                upload(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </div>
          <small className="hint">Se publica en el mismo enlace y la versión anterior queda en el historial.</small>
        </div>
      )}

      <div className="field">
        <span className="field__label">Para</span>
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
                <span className="tag recipient__tag">{c.label}</span>
              </label>
            </li>
          ))}
        </ul>
        <div className="recipient-add">
          <span className="input">
            <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Agregar correo" aria-label="Agregar correo" />
          </span>
          <button
            type="button"
            className="btn btn--outline btn--sm"
            disabled={!extra.trim()}
            onClick={() => {
              const emails = extra.split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
              const bad = emails.find((x) => !EMAIL.test(x));
              if (bad) return toast(`«${bad}» no es un correo válido.`, true);
              setAdded([...new Set([...added, ...emails])]);
              setRecipients(new Set([...recipients, ...emails]));
              setExtra('');
            }}
          >
            + Agregar
          </button>
        </div>
      </div>

      <label className="field">
        <span className="field__label">Asunto</span>
        <span className="input">
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={`Propuesta DeerSystems${m.prospect?.company || m.clientName ? ` para ${m.prospect?.company || m.clientName}` : ''}`} />
        </span>
      </label>
      <label className="field">
        <span className="field__label">Mensaje</span>
        <textarea rows={12} value={message} onChange={(e) => setMessage(e.target.value)} />
      </label>
      <div className="actions actions--tight">
        <button type="button" className="btn btn--ai btn--sm" disabled={busy || !hasContext} onClick={personalize} title={hasContext ? '' : 'Importa la transcripción de la llamada para personalizarlo'}>
          ✦ Personalizar con IA según la conversación
        </button>
        <button type="button" className="btn btn--outline btn--sm" disabled={busy || !proposalId} onClick={() => setPreview(true)}>
          Vista previa
        </button>
        <button type="button" className="btn btn--primary btn--sm" disabled={busy || !proposalId || !recipients.size} onClick={send}>
          {busy ? 'Enviando…' : m.proposalSentAt ? 'Enviar de nuevo' : 'Enviar al cliente'}
        </button>
      </div>
      {!hasContext && <p className="hint">Para personalizar el mensaje con la IA, primero importa la transcripción de la llamada (arriba).</p>}
      {preview && <PreviewDialog meetingId={m.id} body={body} onClose={() => setPreview(false)} />}
    </section>
  );
}
