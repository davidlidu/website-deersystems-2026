import { useState, type FormEvent } from 'react';
import { api, today, useApi, type Meeting, type ProjectSummary } from '../../lib';
import { ErrorBox, Link, Loading, useAction, useToast } from '../../ui';

interface Contacts {
  client: { name: string; company: string; email: string };
  team: { id: number; name: string; email: string }[];
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
        team: [...team],
        guests: String(fd.get('guests') ?? '')
          .split(/[,;\s]+/)
          .filter((x) => x.includes('@')),
      });
      toast('Reunión agendada. Google Calendar envió las invitaciones con el enlace de Meet.');
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
