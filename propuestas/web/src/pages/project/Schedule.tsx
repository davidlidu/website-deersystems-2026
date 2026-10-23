import { useState, type FormEvent } from 'react';
import { api, today, useApi, type Meeting, type ProjectSummary } from '../../lib';
import { ErrorBox, Link, Loading, useAction, useToast } from '../../ui';

interface Contacts {
  client: { name: string; company: string; email: string };
  team: { id: number; name: string; email: string }[];
  phases: { id: number; name: string }[];
  canSchedule: boolean;
}

/** Siguiente media hora, para proponer una hora razonable. */
function nextSlot(): string {
  const d = new Date(Date.now() + 60 * 60_000);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function Fields({ projectId, projectName, onDone }: { projectId: number; projectName: string; onDone: (m: Meeting) => void }) {
  const { data, error, loading, reload } = useApi<Contacts>(`projects/${projectId}/contacts`);
  const [team, setTeam] = useState<Set<number>>(new Set());
  const { busy, run } = useAction();
  const toast = useToast();

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const c = data!;

  if (!c.canSchedule) {
    return (
      <p className="alert">
        Para agendar desde aquí, Google debe estar conectado con permiso para crear eventos. Ve a{' '}
        <Link to="/configuracion?tab=google">Configuración → Google y correo</Link> y pulsa «Reconectar».
      </p>
    );
  }

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    run(async () => {
      const m = await api<Meeting>('POST', `projects/${projectId}/meetings/schedule`, {
        title: fd.get('title'),
        date: fd.get('date'),
        time: fd.get('time'),
        durationMinutes: Number(fd.get('duration')),
        agenda: fd.get('agenda'),
        includeClient: fd.get('includeClient') === 'on',
        phaseId: Number(fd.get('phase')) || null,
        team: [...team],
        guests: String(fd.get('guests') ?? '')
          .split(/[,;\s]+/)
          .filter((x) => x.includes('@')),
      });
      toast(
        m.phaseId
          ? 'Reunión agendada y añadida al cronograma. Google Calendar envió las invitaciones con el enlace de Meet.'
          : 'Reunión agendada. Google Calendar envió las invitaciones con el enlace de Meet.',
      );
      onDone(m);
    });
  };

  return (
    <form className="stack" onSubmit={submit}>
      <div className="form-grid">
        <label className="field field--wide">
          <span className="field__label">Título</span>
          <span className="input">
            <input name="title" required maxLength={200} defaultValue={`Seguimiento · ${projectName}`} />
          </span>
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
              <select name="duration" defaultValue="45">
                {[15, 30, 45, 60, 90, 120].map((m) => (
                  <option key={m} value={m}>
                    {m < 60 ? `${m} min` : `${m / 60} h${m % 60 ? ` ${m % 60} min` : ''}`}
                  </option>
                ))}
              </select>
            </span>
          </label>
        </div>
      </div>
      {c.phases.length > 0 && (
        <label className="field">
          <span className="field__label">Fase del proyecto</span>
          <span className="input">
            <select name="phase" defaultValue="">
              <option value="">Sin fase (no aparece en el cronograma)</option>
              {c.phases.map((ph) => (
                <option key={ph.id} value={ph.id}>
                  {ph.name}
                </option>
              ))}
            </select>
          </span>
          <small className="hint">La reunión queda en esa fase y aparece en el cronograma con su fecha.</small>
        </label>
      )}
      <label className="field">
        <span className="field__label">Agenda (va en la invitación)</span>
        <textarea name="agenda" rows={3} placeholder="Temas a revisar…" />
      </label>
      <fieldset className="invitees">
        <legend className="field__label">Invitados</legend>
        <label className="check">
          <input type="checkbox" name="includeClient" defaultChecked /> {c.client.name} · {c.client.email} <span className="tag">Cliente</span>
        </label>
        {c.team.map((m) => (
          <label key={m.id} className="check">
            <input
              type="checkbox"
              checked={team.has(m.id)}
              onChange={(e) => {
                const next = new Set(team);
                if (e.target.checked) next.add(m.id);
                else next.delete(m.id);
                setTeam(next);
              }}
            />{' '}
            {m.name} · {m.email} <span className="tag">Equipo</span>
          </label>
        ))}
        <label className="field">
          <span className="field__label">Otros invitados (correos separados por coma)</span>
          <span className="input">
            <input name="guests" placeholder="socio@empresa.com, contador@empresa.com" />
          </span>
        </label>
      </fieldset>
      <p className="hint">
        Se crea en tu Google Calendar con enlace de Meet y Google envía las invitaciones. Activa la transcripción en la reunión para que, al
        terminar, la IA prepare el resumen.
      </p>
      <div className="actions actions--tight">
        <button className="btn btn--primary" disabled={busy}>
          {busy ? 'Agendando…' : 'Agendar y enviar invitaciones'}
        </button>
      </div>
    </form>
  );
}

/** Formulario para agendar. Con `projectId` queda fijo al proyecto; sin él, se elige entre los proyectos activos. */
export function ScheduleMeeting({ projectId, projectName, onDone }: { projectId?: number; projectName?: string; onDone: (m: Meeting) => void }) {
  const projects = useApi<ProjectSummary[]>(projectId ? null : 'projects');
  const [chosen, setChosen] = useState<number | null>(projectId ?? null);
  const active = (projects.data ?? []).filter((p) => p.status === 'activo');
  const current = projectId ? { id: projectId, name: projectName ?? '' } : active.find((p) => p.id === chosen);

  return (
    <div className="card form-section">
      <h2>Agendar reunión</h2>
      {!projectId && (
        <label className="field">
          <span className="field__label">Proyecto en marcha</span>
          <span className="input">
            <select value={chosen ?? ''} onChange={(e) => setChosen(Number(e.target.value) || null)}>
              <option value="">Elige el proyecto…</option>
              {active.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.clientName} · {p.name}
                </option>
              ))}
            </select>
          </span>
        </label>
      )}
      {current && <Fields key={current.id} projectId={current.id} projectName={current.name} onDone={onDone} />}
    </div>
  );
}

/** Fecha (YYYY-MM-DD) y hora (HH:MM) de Colombia a partir de un ISO. */
function bogota(iso: string) {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  const time = d.toLocaleTimeString('en-GB', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return { date, time };
}

const SIDE_TAG = { cliente: 'Cliente', deersystems: 'Equipo', otro: 'Invitado' } as const;

/** Editar una reunión agendada: fecha, hora, duración, título e invitados, avisando o no a los invitados. */
export function EditMeeting({ meeting, onDone, onCancel }: { meeting: Meeting; onDone: (m: Meeting) => void; onCancel: () => void }) {
  const contacts = useApi<Contacts>(meeting.projectId ? `projects/${meeting.projectId}/contacts` : null);
  const { date, time } = bogota(meeting.startAt);
  const duration = Math.max(15, Math.round((new Date(meeting.endAt).getTime() - new Date(meeting.startAt).getTime()) / 60_000) || 45);
  const [invited, setInvited] = useState<Set<string>>(new Set(meeting.attendees.map((a) => a.email.toLowerCase())));
  const [extra, setExtra] = useState('');
  const { busy, run } = useAction();
  const toast = useToast();

  // Todos los que se pueden marcar: los invitados actuales, el cliente y el equipo.
  const people = new Map<string, { email: string; label: string; tag: string }>();
  for (const a of meeting.attendees) people.set(a.email.toLowerCase(), { email: a.email.toLowerCase(), label: a.name || a.email, tag: SIDE_TAG[a.side] });
  const c = contacts.data;
  if (c?.client.email && !people.has(c.client.email.toLowerCase())) {
    people.set(c.client.email.toLowerCase(), { email: c.client.email.toLowerCase(), label: c.client.name, tag: 'Cliente' });
  }
  for (const m of c?.team ?? []) {
    if (!people.has(m.email.toLowerCase())) people.set(m.email.toLowerCase(), { email: m.email.toLowerCase(), label: m.name, tag: 'Equipo' });
  }
  const options = [15, 30, 45, 60, 90, 120].includes(duration) ? [15, 30, 45, 60, 90, 120] : [15, 30, 45, 60, 90, 120, duration].sort((a, b) => a - b);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const added = extra.split(/[,;\s]+/).filter((x) => x.includes('@'));
    const notify = fd.get('notify') === 'on';
    run(async () => {
      const m = await api<Meeting>('POST', `meetings/${meeting.id}/update`, {
        title: fd.get('title'),
        date: fd.get('date'),
        time: fd.get('time'),
        durationMinutes: Number(fd.get('duration')),
        attendees: [...invited, ...added],
        notify,
      });
      toast(notify ? 'Reunión actualizada. Google avisó a los invitados.' : 'Reunión actualizada sin avisar a los invitados.');
      onDone(m);
    });
  };

  return (
    <form className="card form-section stack" onSubmit={submit}>
      <h2>Editar reunión</h2>
      <div className="form-grid">
        <label className="field field--wide">
          <span className="field__label">Título</span>
          <span className="input">
            <input name="title" required maxLength={200} defaultValue={meeting.title} />
          </span>
        </label>
        <label className="field">
          <span className="field__label">Fecha</span>
          <span className="input">
            <input name="date" type="date" required min={today()} defaultValue={date} />
          </span>
        </label>
        <div className="form-grid form-grid--tight">
          <label className="field">
            <span className="field__label">Hora (Colombia)</span>
            <span className="input">
              <input name="time" type="time" required step={900} defaultValue={time} />
            </span>
          </label>
          <label className="field">
            <span className="field__label">Duración</span>
            <span className="input">
              <select name="duration" defaultValue={String(duration)}>
                {options.map((m) => (
                  <option key={m} value={m}>
                    {m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`}
                  </option>
                ))}
              </select>
            </span>
          </label>
        </div>
      </div>
      <fieldset className="invitees">
        <legend className="field__label">Invitados</legend>
        {[...people.values()].map((p) => (
          <label key={p.email} className="check">
            <input
              type="checkbox"
              checked={invited.has(p.email)}
              onChange={(e) => {
                const next = new Set(invited);
                if (e.target.checked) next.add(p.email);
                else next.delete(p.email);
                setInvited(next);
              }}
            />{' '}
            {p.label !== p.email ? `${p.label} · ${p.email}` : p.email} <span className="tag">{p.tag}</span>
          </label>
        ))}
        <label className="field">
          <span className="field__label">Invitar a más personas (correos separados por coma)</span>
          <span className="input">
            <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="socio@empresa.com, contador@empresa.com" />
          </span>
        </label>
      </fieldset>
      <label className="check">
        <input type="checkbox" name="notify" defaultChecked /> Avisar del cambio a los invitados (Google envía el correo y la invitación a los
        nuevos)
      </label>
      <p className="hint">Si no avisas, el cambio queda en Calendar sin enviar correos: los invitados nuevos no recibirán la invitación con el enlace.</p>
      <div className="actions actions--tight">
        <button className="btn btn--primary" disabled={busy}>
          {busy ? 'Guardando…' : 'Guardar cambios'}
        </button>
        <button type="button" className="btn btn--outline" disabled={busy} onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
