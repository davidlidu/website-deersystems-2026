import { useEffect, useState, type FormEvent } from 'react';
import { api, durationLabel, formatMeetingLong, PENDING_MEETINGS_EVENT, today, useApi, useLocation, type Me, type Meeting } from '../lib';
import { Empty, ErrorBox, Link, Loading, PageHead, useAction, useToast } from '../ui';

/** Fecha y hora de Colombia de un instante, para los campos del formulario. */
function bogota(iso: string) {
  const d = new Date(iso);
  return {
    date: d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }),
    time: d.toLocaleTimeString('en-GB', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
  };
}

const minutesOf = (m: Meeting) => Math.round((new Date(m.endAt).getTime() - new Date(m.startAt).getTime()) / 60_000);
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const changed = () => window.dispatchEvent(new Event(PENDING_MEETINGS_EVENT));

/**
 * Reuniones por confirmar (cliente): DeerSystems reservó un horario y el cliente lo confirma
 * (le llega la invitación de Google Calendar con Meet) o propone otro día y hora.
 */
export function PendingMeetingsPage({ me }: { me: Me }) {
  const { query } = useLocation();
  const focus = Number(query.get('reunion')) || null;
  const { data, error, loading, reload, setData } = useApi<{ items: Meeting[] }>('meetings/pending');
  const [done, setDone] = useState<Meeting[]>([]);

  // Desde el aviso o el correo: se lleva la vista a la reunión elegida.
  useEffect(() => {
    if (!focus || !data) return;
    document.getElementById(`reunion-${focus}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focus, data]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const items = data?.items ?? [];

  return (
    <>
      <PageHead eyebrow="Reuniones" title="Reuniones por confirmar">
        <p>
          DeerSystems reservó estos horarios para reunirse contigo. Confirma el día y la hora para recibir la invitación de Google Calendar con el
          enlace de Meet, o propón otro horario que te funcione mejor.
        </p>
      </PageHead>

      {!!done.length && (
        <div className="callout stack-sm">
          {done.map((m) => (
            <p key={m.id}>
              ✓ Confirmaste <strong>{m.title}</strong> para el {formatMeetingLong(m.startAt)}. Te llegará la invitación por correo.{' '}
              {m.projectId && <Link to={`/proyectos/${m.projectId}?tab=reuniones`}>Ver en el proyecto</Link>}
            </p>
          ))}
        </div>
      )}

      {items.length ? (
        <div className="confirm-list">
          {items.map((m) => (
            <ConfirmCard
              key={m.id}
              meeting={m}
              focused={m.id === focus}
              readOnly={!!me.preview}
              onConfirmed={(u) => {
                setDone((d) => [u, ...d]);
                setData({ items: items.filter((x) => x.id !== m.id) });
                changed();
              }}
              onProposed={(u) => {
                setData({ items: items.map((x) => (x.id === u.id ? u : x)) });
                changed();
              }}
            />
          ))}
        </div>
      ) : (
        <Empty>
          No tienes reuniones pendientes por confirmar. <Link to="/">Volver a mis proyectos</Link>
        </Empty>
      )}
    </>
  );
}

function ConfirmCard({
  meeting: m,
  focused,
  readOnly,
  onConfirmed,
  onProposed,
}: {
  meeting: Meeting;
  focused: boolean;
  readOnly: boolean;
  onConfirmed: (m: Meeting) => void;
  onProposed: (m: Meeting) => void;
}) {
  const toast = useToast();
  const { busy, run } = useAction();
  const p = m.clientProposal ?? null;
  const [proposing, setProposing] = useState(false);
  const [form, setForm] = useState(() => ({ ...bogota(p?.startAt ?? m.startAt), note: p?.note ?? '' }));
  const team = m.attendees.filter((a) => a.side === 'deersystems').map((a) => a.name || a.email);

  const confirm = () =>
    run(async () => {
      const u = await api<Meeting>('POST', `meetings/${m.id}/respond`, { action: 'confirm' });
      toast('Reunión confirmada. Te llegará la invitación de Google Calendar con el enlace de Meet.');
      onConfirmed(u);
    });

  const propose = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const u = await api<Meeting>('POST', `meetings/${m.id}/respond`, { action: 'propose', ...form });
      toast('Enviamos tu propuesta a DeerSystems. Te avisaremos cuando la confirmen.');
      setProposing(false);
      onProposed(u);
    });
  };

  return (
    <article id={`reunion-${m.id}`} className={`confirm-meeting card${focused ? ' is-focus' : ''}${p ? ' is-sent' : ''}`}>
      <header className="confirm-meeting__head">
        <div>
          {m.projectName && <p className="eyebrow">{m.projectName}</p>}
          <h2>{m.title}</h2>
        </div>
        <span className="tag tag--warn">{p ? 'Esperando respuesta de DeerSystems' : 'Por confirmar'}</span>
      </header>

      <dl className="confirm-meeting__facts">
        <div>
          <dt>Día y hora</dt>
          <dd className={p ? 'is-struck' : undefined}>{capital(formatMeetingLong(m.startAt))}</dd>
        </div>
        <div>
          <dt>Duración</dt>
          <dd>{durationLabel(minutesOf(m))}</dd>
        </div>
        {!!team.length && (
          <div>
            <dt>Por DeerSystems</dt>
            <dd>{team.join(', ')}</dd>
          </div>
        )}
        <div>
          <dt>Lugar</dt>
          <dd>Google Meet (el enlace llega con la invitación)</dd>
        </div>
      </dl>

      {p && !proposing && (
        <p className="callout callout--warn">
          Propusiste el <strong>{formatMeetingLong(p.startAt)}</strong>
          {p.note ? <> · «{p.note}»</> : null}. DeerSystems revisará tu propuesta y te avisará. Si al final te sirve el horario original, puedes
          confirmarlo.
        </p>
      )}

      {proposing ? (
        <form className="confirm-meeting__form" onSubmit={propose}>
          <div className="form-grid">
            <label className="field">
              <span className="field__label">Fecha</span>
              <span className="input">
                <input type="date" required min={today()} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </span>
            </label>
            <label className="field">
              <span className="field__label">Hora (Colombia)</span>
              <span className="input">
                <input type="time" required step={900} value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
              </span>
            </label>
            <label className="field field--wide">
              <span className="field__label">Nota para DeerSystems (opcional)</span>
              <textarea
                rows={2}
                maxLength={1000}
                value={form.note}
                placeholder="Ej.: esa semana estoy de viaje; me sirve en las mañanas."
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </label>
          </div>
          <p className="hint">La reunión dura lo mismo ({durationLabel(minutesOf(m))}). Revisamos que el horario esté libre en la agenda de DeerSystems.</p>
          <div className="actions actions--tight">
            <button className="btn btn--primary btn--sm" disabled={busy || readOnly}>
              {busy ? 'Enviando…' : 'Enviar propuesta'}
            </button>
            <button type="button" className="btn btn--outline btn--sm" disabled={busy} onClick={() => setProposing(false)}>
              Cancelar
            </button>
          </div>
        </form>
      ) : (
        <div className="actions actions--tight">
          <button className="btn btn--primary btn--sm" disabled={busy || readOnly} onClick={confirm}>
            {p ? 'Confirmar el horario original' : 'Confirmar día y hora'}
          </button>
          <button className="btn btn--outline btn--sm" disabled={busy || readOnly} onClick={() => setProposing(true)}>
            {p ? 'Cambiar mi propuesta' : 'Proponer otro día y hora'}
          </button>
        </div>
      )}
    </article>
  );
}
