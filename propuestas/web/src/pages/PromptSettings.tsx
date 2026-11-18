import { useState } from 'react';
import { api, formatDateTime, useApi, usd } from '../lib';
import { ErrorBox, Loading, useAction, useToast } from '../ui';

/**
 * Instrucciones propias para cada tarea de la IA. Se suman al final de su prompt y mandan sobre él. Puedes escribirlas
 * o decirle a la IA el cambio («las reuniones de avance duran 30 minutos») para que las reescriba; nada se guarda
 * hasta que lo apruebas.
 */

interface TaskPrompt {
  key: string;
  label: string;
  hint: string;
  text: string;
  lastUsedAt: string | null;
}
interface Suggestion {
  text: string;
  explanation: string;
  ai: { model: string; costUsd: number; latencyMs: number };
}

export function PromptSettings() {
  const { data, error, loading, reload, setData } = useApi<TaskPrompt[]>('settings/ai/instructions');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  return (
    <div className="stack">
      <section className="card form-section">
        <h2>Instrucciones de la IA</h2>
        <p className="hint">
          Cada tarea de la IA tiene su prompt base. Aquí le sumas reglas propias que mandan sobre él: escríbelas o dile a la IA qué cambiar y ella las
          reescribe. Revisas la propuesta antes de guardarla y aplica desde la siguiente vez que se use esa tarea.
        </p>
      </section>
      {data!.map((t) => (
        <PromptCard key={t.key} task={t} onSaved={(text) => setData(data!.map((x) => (x.key === t.key ? { ...x, text } : x)))} />
      ))}
    </div>
  );
}

function PromptCard({ task, onSaved }: { task: TaskPrompt; onSaved: (text: string) => void }) {
  const [text, setText] = useState(task.text);
  const [change, setChange] = useState('');
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [s, setS] = useState<Suggestion | null>(null);
  const { busy, run } = useAction();
  const toast = useToast();
  const dirty = text.trim() !== task.text.trim();

  const ask = () => {
    if (change.trim().length < 5) return setError('Escribe qué quieres cambiar.');
    setThinking(true);
    setError(null);
    setS(null);
    api<Suggestion>('POST', 'settings/ai/instructions/suggest', { key: task.key, change: change.trim(), text })
      .then(setS)
      .catch((e: Error) => setError(e.message))
      .finally(() => setThinking(false));
  };
  const save = (value: string) =>
    run(async () => {
      await api('PUT', 'settings/ai/instructions', { key: task.key, text: value });
      setText(value);
      setS(null);
      setChange('');
      onSaved(value);
      toast(value.trim() ? 'Instrucciones guardadas.' : 'Instrucciones borradas: la tarea usa solo su prompt base.');
    });

  return (
    <section className="card form-section prompt-card">
      <div className="form-section__head">
        <div>
          <h2>{task.label}</h2>
          <p className="hint">
            {task.hint}
            {task.lastUsedAt ? ` · Último uso: ${formatDateTime(task.lastUsedAt)}` : ''}
          </p>
        </div>
        {task.text.trim() ? <span className="tag tag--activo">Personalizada</span> : <span className="tag">Prompt base</span>}
      </div>

      <div className="prompt-card__ask">
        <span className="input">
          <input
            value={change}
            disabled={thinking || busy}
            placeholder="Dile a la IA qué cambiar. Ej.: las reuniones de avance siempre a las 3 p. m. y de 30 minutos"
            onChange={(e) => setChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && ask()}
          />
        </span>
        <button className="btn btn--outline btn--sm btn--ai" disabled={thinking || busy || !change.trim()} onClick={ask}>
          {thinking ? 'Pensando…' : '✦ Proponer con IA'}
        </button>
      </div>
      {error && <p className="alert">{error}</p>}
      {s && (
        <div className="prompt-card__suggestion">
          {s.explanation && <p className="callout">{s.explanation}</p>}
          <pre className="prompt-card__text">{s.text || '(sin instrucciones)'}</pre>
          <div className="actions actions--tight">
            <button className="btn btn--primary btn--sm" disabled={busy} onClick={() => save(s.text)}>
              Guardar esta versión
            </button>
            <button className="btn btn--outline btn--sm" disabled={busy} onClick={() => (setText(s.text), setS(null))}>
              Editarla antes
            </button>
            <button className="btn btn--outline btn--sm" disabled={busy} onClick={() => setS(null)}>
              Descartar
            </button>
            <span className="hint mono">
              {s.ai.model} · {(s.ai.latencyMs / 1000).toFixed(1)} s · {s.ai.costUsd ? usd(s.ai.costUsd) : 'sin costo'}
            </span>
          </div>
        </div>
      )}

      <label className="field">
        <span className="field__label">Instrucciones adicionales</span>
        <textarea
          rows={Math.min(12, Math.max(3, text.split('\n').length + 1))}
          value={text}
          placeholder="Sin instrucciones propias: la IA usa solo el prompt base."
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      {dirty && (
        <div className="actions actions--tight">
          <button className="btn btn--primary btn--sm" disabled={busy} onClick={() => save(text)}>
            Guardar
          </button>
          <button className="btn btn--outline btn--sm" disabled={busy} onClick={() => setText(task.text)}>
            Deshacer
          </button>
        </div>
      )}
    </section>
  );
}
