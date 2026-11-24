import { useEffect, useMemo, useRef, useState } from 'react';
import { api, formatDate, usd } from '../../lib';
import { useAction, useToast } from '../../ui';

/**
 * «✦ Ajustar con IA» en el alcance aprobado: le dices qué cambió («el blog queda en 3 artículos y se quita la integración
 * con Stripe»), la IA reescribe el texto cambiando solo eso y propone lo que implica en las tareas. Ves el texto con
 * los cambios marcados (puedes editarlo), eliges qué cambios del plan aplicar, y solo se guarda al aplicar.
 */

type Side = 'deersystems' | 'cliente';
interface Snapshot {
  title: string;
  startDate: string | null;
  dueDate: string | null;
  phase: string;
  side: Side;
  who?: string;
}
interface Suggestion {
  scopeBefore: string;
  scope: string;
  changes: string[];
  warnings: string[];
  plan: {
    ops: { updates: unknown[]; creates: unknown[]; deletes: unknown[] };
    preview: {
      updates: { id: number; title: string; before: Snapshot; after: Snapshot; descriptionChanged: boolean }[];
      creates: { title: string; phase: string; side: Side; who?: string; startDate: string | null; dueDate: string | null }[];
      deletes: { id: number; title: string }[];
    };
  };
  ai: { model: string; costUsd: number; latencyMs: number };
}
interface Applied {
  scopeChanged: boolean;
  applied: number;
  errors: string[];
}

const EXAMPLES = [
  'El blog queda en 3 artículos en vez de 5',
  'Se quita la integración con pasarela de pagos',
  'La landing se entrega en español e inglés',
  'Ordena el alcance por módulos, sin cambiar el contenido',
];

const SIDE = { deersystems: 'DeerSystems', cliente: 'Cliente' };

function when(a: string | null, b: string | null): string {
  if (!a && !b) return 'sin fecha';
  if (!a || !b || a === b) return formatDate(b ?? a, false);
  return `${formatDate(a, false)} – ${formatDate(b, false)}`;
}

function planDiff(b: Snapshot, a: Snapshot, desc: boolean): string {
  const out: string[] = [];
  if (when(b.startDate, b.dueDate) !== when(a.startDate, a.dueDate)) out.push(`${when(b.startDate, b.dueDate)} → ${when(a.startDate, a.dueDate)}`);
  if (b.title !== a.title) out.push(`nombre: «${a.title}»`);
  if (b.phase !== a.phase) out.push(`fase: ${b.phase || 'sin fase'} → ${a.phase || 'sin fase'}`);
  if (b.who !== a.who) out.push(`a cargo de ${a.who ?? SIDE[a.side]}`);
  else if (b.side !== a.side) out.push(`a cargo de ${SIDE[a.side]}`);
  if (desc) out.push('descripción actualizada');
  return out.join(' · ') || 'sin cambios visibles';
}

type Line = { type: 'same' | 'add' | 'del'; text: string };

/** Diferencia línea a línea (LCS): lo que se quita, lo que se agrega y lo que queda igual. */
function lineDiff(before: string, after: string): Line[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const n = a.length;
  const m = b.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: Line[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ type: 'del', text: a[i++] });
    else out.push({ type: 'add', text: b[j++] });
  }
  while (i < n) out.push({ type: 'del', text: a[i++] });
  while (j < m) out.push({ type: 'add', text: b[j++] });
  return out;
}

/** El texto con los cambios marcados; lo que no cambia se resume dejando 2 líneas de contexto. */
function ScopeDiff({ before, after }: { before: string; after: string }) {
  const lines = useMemo(() => lineDiff(before, after), [before, after]);
  const [full, setFull] = useState(false);
  const blocks: (Line | { type: 'gap'; count: number })[] = [];
  const near = (k: number) => lines.slice(Math.max(0, k - 2), k + 3).some((l) => l.type !== 'same');
  for (let k = 0; k < lines.length; k++) {
    if (full || lines[k].type !== 'same' || near(k)) {
      blocks.push(lines[k]);
      continue;
    }
    const last = blocks[blocks.length - 1];
    if (last?.type === 'gap') last.count++;
    else blocks.push({ type: 'gap', count: 1 });
  }
  const changed = lines.some((l) => l.type !== 'same');
  if (!changed) return <p className="hint">El texto del alcance queda igual.</p>;
  return (
    <div className="scope-diff">
      {blocks.map((l, k) =>
        l.type === 'gap' ? (
          <button key={k} type="button" className="scope-diff__gap" onClick={() => setFull(true)}>
            ⋯ {l.count} {l.count === 1 ? 'línea igual' : 'líneas iguales'}
          </button>
        ) : (
          <div key={k} className={`scope-diff__line scope-diff__line--${l.type}`}>
            <span aria-hidden>{l.type === 'add' ? '+' : l.type === 'del' ? '−' : ' '}</span>
            <span>{l.text || ' '}</span>
          </div>
        ),
      )}
    </div>
  );
}

export function ScopeAiDialog({ projectId, onDone, onClose }: { projectId: number; onDone: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => ref.current?.showModal(), []);
  const [text, setText] = useState('');
  const [withPlan, setWithPlan] = useState(true);
  const [weekends, setWeekends] = useState(false);
  const [notify, setNotify] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [s, setS] = useState<Suggestion | null>(null);
  const [scope, setScope] = useState('');
  const [editing, setEditing] = useState(false);
  /** Cambios del plan que NO se aplican ("u0", "c2", "d1"). */
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<Applied | null>(null);
  const { busy, run } = useAction();
  const toast = useToast();

  const ask = () => {
    if (text.trim().length < 5) return setError('Escribe qué cambia en el alcance.');
    setThinking(true);
    setError(null);
    setS(null);
    setEditing(false);
    api<Suggestion>('POST', `projects/${projectId}/scope/adjust/suggest`, { instruction: text.trim(), allowWeekends: weekends, withPlan })
      .then((r) => {
        setS(r);
        setScope(r.scope);
        setSkip(new Set());
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setThinking(false));
  };

  const pick = <T,>(list: T[], prefix: string) => list.filter((_, i) => !skip.has(`${prefix}${i}`));
  const ops = s ? { updates: pick(s.plan.ops.updates, 'u'), creates: pick(s.plan.ops.creates, 'c'), deletes: pick(s.plan.ops.deletes, 'd') } : null;
  const planCount = ops ? ops.updates.length + ops.creates.length + ops.deletes.length : 0;
  const planTotal = s ? s.plan.preview.updates.length + s.plan.preview.creates.length + s.plan.preview.deletes.length : 0;
  const scopeChanged = !!s && scope.trim() !== s.scopeBefore.trim();
  const toggle = (key: string, on: boolean) =>
    setSkip((prev) => {
      const next = new Set(prev);
      if (on) next.delete(key);
      else next.add(key);
      return next;
    });

  const apply = () =>
    run(async () => {
      const r = await api<Applied>('POST', `projects/${projectId}/scope/adjust`, { instruction: text.trim(), scope, changes: s!.changes, ops, notify });
      onDone();
      const msg = [r.scopeChanged && 'alcance actualizado', r.applied && `${r.applied} ${r.applied === 1 ? 'cambio' : 'cambios'} en el plan`].filter(Boolean).join(' y ');
      toast(`Listo: ${msg}.${r.errors.length ? ' Con avisos.' : ''}`, r.errors.length > 0);
      if (r.errors.length) setDone(r);
      else ref.current?.close();
    });

  const locked = thinking || busy;
  const check = (k: string) => (
    <input type="checkbox" checked={!skip.has(k)} disabled={busy} onChange={(e) => toggle(k, e.target.checked)} aria-label="Aplicar este cambio" />
  );

  return (
    <dialog
      ref={ref}
      className="modal modal--send"
      aria-labelledby="scope-ai-title"
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && !locked && ref.current?.close()}
    >
      <div className="modal__in">
        <header className="modal__head">
          <h2 id="scope-ai-title">✦ Ajustar el alcance con IA</h2>
          <button type="button" className="icon-btn" onClick={() => ref.current?.close()} aria-label="Cerrar" disabled={busy}>
            ✕
          </button>
        </header>
        {done ? (
          <>
            <p className="callout">
              {done.scopeChanged ? 'Se actualizó el alcance' : 'El alcance quedó igual'}
              {done.applied ? ` y se aplicaron ${done.applied} ${done.applied === 1 ? 'cambio' : 'cambios'} al plan` : ''}.
            </p>
            {done.errors.map((e) => (
              <p key={e} className="alert">
                {e}
              </p>
            ))}
            <div className="actions actions--tight">
              <button className="btn btn--primary btn--sm" onClick={() => ref.current?.close()}>
                Listo
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="hint">
              Dile qué cambió en lo acordado con el cliente. La IA reescribe el alcance cambiando solo eso y propone los ajustes del plan; revisas todo antes
              de guardar. Lo que tiene costo va por «Agregar adicional» o «Retirar del alcance».
            </p>
            <textarea
              rows={3}
              value={text}
              disabled={locked}
              autoFocus
              placeholder="Ej.: el cliente pidió que el blog quede en 3 artículos y quitar la integración con la pasarela de pagos."
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) ask();
              }}
            />
            <label className="scope-check">
              <input type="checkbox" checked={withPlan} disabled={locked} onChange={(e) => setWithPlan(e.target.checked)} />
              <span>
                Ajustar también el plan <small>· tareas nuevas, que cambian o que sobran por el ajuste</small>
              </span>
            </label>
            {withPlan && (
              <label className="scope-check" title="Para una excepción acordada: las tareas pueden caer en sábado o domingo.">
                <input type="checkbox" checked={weekends} disabled={locked} onChange={(e) => setWeekends(e.target.checked)} />
                <span>
                  Permitir fin de semana <small>· excepción: las tareas pueden caer en sábado o domingo</small>
                </span>
              </label>
            )}
            <div className="adjust-plan__foot">
              <span className="adjust-plan__examples">
                {EXAMPLES.map((ex) => (
                  <button key={ex} className="chip" disabled={locked} onClick={() => setText(ex)}>
                    {ex}
                  </button>
                ))}
              </span>
              <button className="btn btn--primary btn--sm" onClick={ask} disabled={locked || !text.trim()}>
                {thinking ? 'Pensando…' : s ? 'Volver a proponer' : 'Proponer cambios'}
              </button>
            </div>
            {thinking && (
              <p className="loading">
                <span className="loading__dot" /> La IA está revisando el alcance…
              </p>
            )}
            {error && <p className="alert">{error}</p>}
            {s && !thinking && (
              <div className="plan-adjust">
                {s.changes.length > 0 && (
                  <div className="adjust-plan__changes">
                    <strong>Lo que propone</strong>
                    <ul className="md-list">
                      {s.changes.map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {s.warnings.map((w) => (
                  <p key={w} className="hint">
                    ⚠ {w}
                  </p>
                ))}

                <div className="scope-ai__head">
                  <strong>Alcance</strong>
                  <button type="button" className="btn btn--outline btn--sm" disabled={busy} onClick={() => setEditing((e) => !e)}>
                    {editing ? 'Ver cambios' : 'Editar texto'}
                  </button>
                </div>
                {editing ? (
                  <textarea className="scope-ai__edit" rows={14} value={scope} disabled={busy} onChange={(e) => setScope(e.target.value)} />
                ) : (
                  <ScopeDiff before={s.scopeBefore} after={scope} />
                )}

                {planTotal > 0 && (
                  <>
                    <div className="scope-ai__head">
                      <strong>Plan de trabajo</strong>
                      <small className="hint">Desmarca lo que no quieras aplicar.</small>
                    </div>
                    <ul className="plan-adjust__list scope-ai__plan">
                      {s.plan.preview.updates.map((u, i) => (
                        <li key={`u${i}`}>
                          {check(`u${i}`)}
                          <span className="plan-adjust__tag plan-adjust__tag--tarea">Cambia</span>
                          <span>
                            <strong>{u.title}</strong>
                            <small>{planDiff(u.before, u.after, u.descriptionChanged)}</small>
                          </span>
                        </li>
                      ))}
                      {s.plan.preview.creates.map((c, i) => (
                        <li key={`c${i}`}>
                          {check(`c${i}`)}
                          <span className="plan-adjust__tag plan-adjust__tag--new">Nueva</span>
                          <span>
                            <strong>{c.title}</strong>
                            <small>{[c.phase || 'sin fase', when(c.startDate, c.dueDate), c.who ?? SIDE[c.side]].join(' · ')}</small>
                          </span>
                        </li>
                      ))}
                      {s.plan.preview.deletes.map((d, i) => (
                        <li key={`d${i}`}>
                          {check(`d${i}`)}
                          <span className="plan-adjust__tag plan-adjust__tag--del">Se elimina</span>
                          <span>
                            <strong>{d.title}</strong>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                <label className="scope-check">
                  <input type="checkbox" checked={notify} disabled={busy} onChange={(e) => setNotify(e.target.checked)} />
                  <span>
                    Avisar al cliente <small>· deja una nota en su portal con los cambios</small>
                  </span>
                </label>
                <p className="hint mono">
                  {s.ai.model} · {(s.ai.latencyMs / 1000).toFixed(1)} s · {s.ai.costUsd ? usd(s.ai.costUsd) : 'sin costo'}
                </p>
                <div className="actions actions--tight">
                  <button className="btn btn--primary btn--sm" onClick={apply} disabled={busy || (!scopeChanged && !planCount) || !scope.trim()}>
                    {busy
                      ? 'Aplicando…'
                      : !scopeChanged && !planCount
                        ? 'Sin cambios para aplicar'
                        : `Aplicar${scopeChanged ? ' el alcance' : ''}${scopeChanged && planCount ? ' y' : ''}${planCount ? ` ${planCount} ${planCount === 1 ? 'cambio' : 'cambios'} del plan` : ''}`}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </dialog>
  );
}
