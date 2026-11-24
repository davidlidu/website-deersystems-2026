import { useState } from 'react';
import { api, formatDate, useApi, usd, type ProjectPerson, type TeamMember } from '../../lib';
import { useAction, useToast } from '../../ui';

/**
 * Equipo de un proyecto compartido: DeerSystems (tú) orquesta y lleva la mayor carga; el cliente pone algunas personas
 * y tu equipo otras, cada una con sus habilidades. Se arma a mano o leyendo la reunión grabada donde se presentaron,
 * y con eso la IA reparte las tareas del plan.
 */

export const OWNER: ProjectPerson = { key: 'yo', name: 'DeerSystems (tú)', side: 'deersystems', skills: 'Orquestador: coordinación, arquitectura, integración y calidad', accountId: null, lead: true };

let seq = 0;
const newKey = () => `p${Date.now().toString(36)}${++seq}`;

/** Siempre con DeerSystems (tú) de primero. */
export const withOwner = (people: ProjectPerson[]) => (people.some((p) => p.key === OWNER.key) ? people : [OWNER, ...people]);

interface MeetingRow {
  id: number;
  title: string;
  startAt: string;
  client: string | null;
  related: boolean;
}

/** Trae las personas y sus habilidades de una reunión con transcripción (las suma a las que ya hay). */
function FromMeeting({ proposalId, clientId, onPeople }: { proposalId?: number; clientId?: number | null; onPeople: (p: Omit<ProjectPerson, 'key' | 'accountId' | 'lead'>[], notes: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const list = useApi<MeetingRow[]>(open ? `people/meetings?proposalId=${proposalId ?? 0}&clientId=${clientId ?? 0}` : null);
  const [id, setId] = useState('');
  const [thinking, setThinking] = useState(false);
  const toast = useToast();
  const read = () => {
    if (!id) return;
    setThinking(true);
    api<{ people: Omit<ProjectPerson, 'key' | 'accountId' | 'lead'>[]; notes: string[]; ai: { model: string; costUsd: number } }>('POST', `meetings/${id}/people`)
      .then((r) => {
        onPeople(r.people, r.notes);
        toast(`${r.people.length === 1 ? '1 persona' : `${r.people.length} personas`} desde la reunión · ${r.ai.model}${r.ai.costUsd ? ` · ${usd(r.ai.costUsd)}` : ''}`);
        setOpen(false);
      })
      .catch((e: Error) => toast(e.message, true))
      .finally(() => setThinking(false));
  };
  if (!open)
    return (
      <button type="button" className="btn btn--outline btn--sm btn--ai" onClick={() => setOpen(true)}>
        ✦ Traer de una reunión grabada
      </button>
    );
  return (
    <div className="people__meeting">
      <span className="input">
        <select value={id} disabled={thinking || list.loading} onChange={(e) => setId(e.target.value)} aria-label="Reunión">
          <option value="">{list.loading ? 'Cargando reuniones…' : list.data?.length ? 'Elige la reunión…' : 'No hay reuniones con transcripción'}</option>
          {list.data?.map((m) => (
            <option key={m.id} value={m.id}>
              {m.related ? '★ ' : ''}
              {formatDate(m.startAt, false)} · {m.title}
              {m.client ? ` · ${m.client}` : ''}
            </option>
          ))}
        </select>
      </span>
      <button type="button" className="btn btn--primary btn--sm" disabled={!id || thinking} onClick={read}>
        {thinking ? 'Leyendo…' : 'Sacar perfiles'}
      </button>
      <button type="button" className="btn btn--outline btn--sm" disabled={thinking} onClick={() => setOpen(false)}>
        Cancelar
      </button>
    </div>
  );
}

/** Lista editable de personas. Controlada: quien la usa guarda el estado. */
export function PeopleEditor({
  people,
  onChange,
  team,
  proposalId,
  clientId,
  disabled,
}: {
  people: ProjectPerson[];
  onChange: (p: ProjectPerson[]) => void;
  team: TeamMember[];
  proposalId?: number;
  clientId?: number | null;
  disabled?: boolean;
}) {
  const [notes, setNotes] = useState<string[]>([]);
  const list = withOwner(people);
  const patch = (key: string, p: Partial<ProjectPerson>) => onChange(list.map((x) => (x.key === key ? { ...x, ...p } : x)));
  const add = (side: ProjectPerson['side']) => onChange([...list, { key: newKey(), name: '', side, skills: '', accountId: null, lead: false }]);
  const merge = (found: Omit<ProjectPerson, 'key' | 'accountId' | 'lead'>[], n: string[]) => {
    const byName = new Map(list.map((p) => [p.name.trim().toLowerCase(), p]));
    const next = [...list];
    for (const f of found) {
      const same = byName.get(f.name.trim().toLowerCase());
      if (same) {
        const i = next.findIndex((x) => x.key === same.key);
        next[i] = { ...same, skills: same.skills || f.skills };
        continue;
      }
      // Si es del equipo de DeerSystems y tiene cuenta con ese nombre, queda ligada.
      const account = f.side === 'deersystems' ? team.find((m) => m.active && m.name.trim().toLowerCase() === f.name.trim().toLowerCase()) : undefined;
      next.push({ ...f, key: newKey(), accountId: account?.id ?? null, lead: false });
    }
    onChange(next);
    setNotes(n);
  };
  const activeTeam = team.filter((m) => m.active);

  return (
    <div className="people">
      {list.map((p) => (
        <div key={p.key} className={`people__row side-${p.side}`}>
          {p.lead ? (
            <span className="people__lead">
              <strong>{p.name}</strong>
              <small>Orquestador · mayor carga</small>
            </span>
          ) : (
            <>
              <span className="input people__name">
                <input value={p.name} placeholder="Nombre" aria-label="Nombre" disabled={disabled} onChange={(e) => patch(p.key, { name: e.target.value })} />
              </span>
              <span className="input">
                <select
                  value={p.side === 'cliente' ? 'cliente' : p.accountId ? String(p.accountId) : 'ds'}
                  aria-label="De qué lado"
                  disabled={disabled}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === 'cliente') patch(p.key, { side: 'cliente', accountId: null });
                    else if (v === 'ds') patch(p.key, { side: 'deersystems', accountId: null });
                    else {
                      const m = activeTeam.find((x) => x.id === Number(v));
                      patch(p.key, { side: 'deersystems', accountId: Number(v), name: p.name || m?.name || '' });
                    }
                  }}
                >
                  <option value="cliente">Del cliente</option>
                  <option value="ds">DeerSystems (sin cuenta)</option>
                  {activeTeam.map((m) => (
                    <option key={m.id} value={m.id}>
                      Equipo: {m.name}
                    </option>
                  ))}
                </select>
              </span>
            </>
          )}
          <span className="input people__skills">
            <input
              value={p.skills}
              placeholder="Rol y habilidades (p. ej. diseñadora UX, Figma; maneja el CRM)"
              aria-label="Habilidades"
              disabled={disabled}
              onChange={(e) => patch(p.key, { skills: e.target.value })}
            />
          </span>
          {!p.lead && (
            <button type="button" className="icon-btn" aria-label={`Quitar a ${p.name || 'esta persona'}`} disabled={disabled} onClick={() => onChange(list.filter((x) => x.key !== p.key))}>
              ✕
            </button>
          )}
        </div>
      ))}
      {notes.map((n) => (
        <p key={n} className="hint">
          ⚠ {n}
        </p>
      ))}
      <div className="actions actions--tight">
        <button type="button" className="btn btn--outline btn--sm" disabled={disabled} onClick={() => add('cliente')}>
          + Persona del cliente
        </button>
        <button type="button" className="btn btn--outline btn--sm" disabled={disabled} onClick={() => add('deersystems')}>
          + Persona de DeerSystems
        </button>
        {!disabled && <FromMeeting proposalId={proposalId} clientId={clientId} onPeople={merge} />}
      </div>
    </div>
  );
}

/** Equipo del proyecto en la pestaña Alcance (solo el equipo interno lo ve; solo tú lo editas). */
export function ProjectPeopleCard({ projectId, clientId, people, canEdit, onSaved }: { projectId: number; clientId: number; people: ProjectPerson[]; canEdit: boolean; onSaved: () => void }) {
  const team = useApi<TeamMember[]>(canEdit ? 'team' : null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ProjectPerson[]>([]);
  const { busy, run } = useAction();
  const toast = useToast();
  if (!people.length && !canEdit) return null;
  const save = () =>
    run(async () => {
      await api('PUT', `projects/${projectId}/people`, { people: withOwner(draft).filter((p) => p.lead || p.name.trim()) });
      toast('Equipo del proyecto guardado.');
      setEditing(false);
      onSaved();
    });
  return (
    <div className="scope-history people-card">
      <small>Equipo del proyecto</small>
      {editing ? (
        <>
          <PeopleEditor people={draft} onChange={setDraft} team={team.data ?? []} clientId={clientId} disabled={busy} />
          <div className="actions actions--tight">
            <button className="btn btn--primary btn--sm" disabled={busy} onClick={save}>
              Guardar
            </button>
            <button className="btn btn--outline btn--sm" disabled={busy} onClick={() => setEditing(false)}>
              Cancelar
            </button>
          </div>
        </>
      ) : people.length ? (
        <>
          {people.map((p) => (
            <div key={p.key} className="scope-history__item">
              <strong>
                {p.name}
                {p.lead ? ' · orquestador' : p.side === 'cliente' ? ' · del cliente' : ''}
              </strong>
              {p.skills && <span>{p.skills}</span>}
            </div>
          ))}
          {canEdit && (
            <span>
              <button
                className="btn btn--outline btn--sm"
                onClick={() => {
                  setDraft(withOwner(people));
                  setEditing(true);
                }}
              >
                Editar equipo
              </button>
            </span>
          )}
        </>
      ) : (
        <span className="hint">
          ¿El cliente pone parte del equipo?{' '}
          <button
            className="btn btn--outline btn--sm"
            onClick={() => {
              setDraft([OWNER]);
              setEditing(true);
            }}
          >
            Definir el equipo
          </button>
        </span>
      )}
    </div>
  );
}
