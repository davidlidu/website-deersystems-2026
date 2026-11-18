import { formatDate, isOverdue, STATUS, today, type ProjectDetail, type Task } from '../../lib';

/**
 * Resumen del proyecto arriba de los avances: el recorrido por fases (hechas, la actual con su %, la meta), las
 * entregas recientes y próximas, y el progreso de cada fase. Cuenta solo entregables: las reuniones no suman.
 */

interface PhaseStat {
  id: number | null;
  name: string;
  done: number;
  total: number;
  pct: number;
}

function phaseStats(p: ProjectDetail): PhaseStat[] {
  const work = p.tasks.filter((t) => !t.isMeeting);
  const stat = (id: number | null, name: string): PhaseStat => {
    const list = work.filter((t) => t.phaseId === id);
    const done = list.filter((t) => t.status === 'completada').length;
    return { id, name, done, total: list.length, pct: list.length ? Math.round((done / list.length) * 100) : 0 };
  };
  const out = p.phases.map((ph) => stat(ph.id, ph.name)).filter((s) => s.total > 0);
  const loose = stat(null, 'Otras entregas');
  if (loose.total) out.push(loose);
  return out;
}

function Ring({ pct }: { pct: number }) {
  const r = 20;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 48 48" className="mission__ring" aria-hidden="true">
      <circle cx="24" cy="24" r={r} className="mission__ring-bg" />
      <circle cx="24" cy="24" r={r} className="mission__ring-fg" strokeDasharray={`${(pct / 100) * c} ${c}`} transform="rotate(-90 24 24)" />
      <text x="24" y="28" textAnchor="middle">
        {pct}%
      </text>
    </svg>
  );
}

const Check = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const Star = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
  </svg>
);

function status(t: Task): { label: string; cls: string } {
  if (t.status === 'completada') return { label: 'Entregado', cls: 'ok' };
  if (isOverdue(t)) return { label: 'Atrasado', cls: 'late' };
  return { label: STATUS[t.status], cls: t.status === 'pendiente' ? 'idle' : 'run' };
}

export function ProjectSummary({ project: p, onOpenTask }: { project: ProjectDetail; onOpenTask: (id: number) => void }) {
  const phases = phaseStats(p);
  if (!phases.length) return null;
  const current = phases.findIndex((s) => s.done < s.total);
  const finished = current === -1;
  const work = p.tasks.filter((t) => !t.isMeeting);

  // Lo último entregado y lo que viene (atrasado primero), para que se vea qué pasó y qué sigue.
  const recent = work
    .filter((t) => t.status === 'completada')
    .sort((a, b) => (b.completedAt ?? b.dueDate ?? '').localeCompare(a.completedAt ?? a.dueDate ?? ''))
    .slice(0, 3);
  const next = work
    .filter((t) => t.status !== 'completada' && t.dueDate)
    .sort((a, b) => Number(isOverdue(b)) - Number(isOverdue(a)) || a.dueDate!.localeCompare(b.dueDate!))
    .slice(0, 6 - recent.length);
  const rows = [...next, ...recent];
  const late = work.filter(isOverdue).length;

  return (
    <div className="psum">
      <section className="card psum__mission" aria-label="Recorrido del proyecto">
        <p className="eyebrow">Recorrido del proyecto</p>
        <ol className="mission">
          {phases.map((s, i) => {
            const state = s.done === s.total ? 'done' : i === current ? 'current' : 'next';
            return (
              <li key={s.id ?? 'otras'} className={`mission__step is-${state}`}>
                <span className="mission__node">{state === 'done' ? <Check /> : state === 'current' ? <Ring pct={s.pct} /> : <span className="mono">{i + 1}</span>}</span>
                <span className="mission__label">
                  <small className="mono">{s.id === null ? 'Extra' : `Fase ${i + 1}`}</small>
                  <strong>{s.name}</strong>
                  <small>
                    {s.done}/{s.total} entregados
                  </small>
                </span>
              </li>
            );
          })}
          <li className={`mission__step mission__step--goal${finished ? ' is-done' : ''}`}>
            <span className="mission__node">
              <Star />
            </span>
            <span className="mission__label">
              <small className="mono">Meta</small>
              <strong>{finished ? '¡Proyecto entregado!' : 'Proyecto entregado'}</strong>
              <small>{p.endDate ? formatDate(p.endDate) : ''}</small>
            </span>
          </li>
        </ol>
      </section>

      <div className="psum__grid">
        <section className="card psum__table" aria-label="Entregas">
          <div className="psum__head">
            <p className="eyebrow">Entregas</p>
            {late > 0 ? <span className="psum__badge is-late">{late} atrasada{late === 1 ? '' : 's'}</span> : <span className="psum__badge">Al día</span>}
          </div>
          {rows.length ? (
            <table>
              <thead>
                <tr>
                  <th>Entregable</th>
                  <th>Fecha</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => {
                  const st = status(t);
                  const d = t.status === 'completada' ? (t.completedAt?.slice(0, 10) ?? t.dueDate) : t.dueDate;
                  return (
                    <tr key={t.id} onClick={() => onOpenTask(t.id)}>
                      <td>
                        <button className="linklike" onClick={() => onOpenTask(t.id)}>
                          {t.title}
                        </button>
                      </td>
                      <td className="mono">{d ? (d === today() ? 'hoy' : formatDate(d, false)) : '—'}</td>
                      <td>
                        <span className={`psum__st is-${st.cls}`}>{st.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="hint">Todavía no hay entregas con fecha.</p>
          )}
        </section>

        <section className="card psum__bars" aria-label="Progreso por fase">
          <div className="psum__head">
            <p className="eyebrow">Progreso del proyecto</p>
            <span className="mono psum__phase">
              {finished ? 'Completado' : `Fase ${current + 1}/${phases.length}`}
            </span>
          </div>
          <ul>
            {phases.map((s, i) => (
              <li key={s.id ?? 'otras'} className={s.pct === 100 ? 'is-done' : i === current ? 'is-current' : ''}>
                <span className="psum__bar-label">
                  <span>{s.name}</span>
                  <span className="mono">{s.pct}%</span>
                </span>
                <span className="psum__bar">
                  <span style={{ width: `${s.pct}%` }} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
