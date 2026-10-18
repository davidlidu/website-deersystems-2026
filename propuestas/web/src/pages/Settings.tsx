import { useEffect, useMemo, useState } from 'react';
import { api, compact, formatDateTime, navigate, useApi, useLocation, usd, type BillingProfile } from '../lib';
import { ErrorBox, Loading, PageHead, useAction, useToast } from '../ui';

type Provider = 'gemini' | 'openrouter';
interface Target {
  provider: Provider;
  model: string;
}
interface Price {
  input: number;
  output: number;
}
type Profile = 'propuestas' | 'reuniones';
interface Route {
  primary: Target;
  fallback: Target | null;
  privateOnly: boolean;
}
interface AiSettings {
  profiles: Record<Profile, Route>;
  monthlyBudgetUsd: number;
  prices: Record<string, Price>;
  keys: Record<Provider, { saved: string | null; fromEnv: boolean }>;
}
interface ModelInfo {
  id: string;
  name: string;
  context: number | null;
  free: boolean;
  price: Price | null;
  jsonMode: boolean;
}
interface TestResult {
  ok: boolean;
  error?: string;
  text?: string;
  model?: string;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

const PROVIDER_NAME: Record<Provider, string> = { gemini: 'Google Gemini', openrouter: 'OpenRouter' };

const PROFILE_INFO: Record<Profile, { eyebrow: string; title: string; hint: string; privacy: string }> = {
  propuestas: {
    eyebrow: 'Uso 1',
    title: 'Propuestas',
    hint: 'Lee la propuesta aprobada, detecta las opciones (A / B) y arma el plan de trabajo.',
    privacy:
      'El contenido es tuyo, así que puedes usar modelos gratis. Si un modelo gratis falla con esta casilla activa, desmárcala y permite el entrenamiento con modelos gratis en openrouter.ai/settings/privacy.',
  },
  reuniones: {
    eyebrow: 'Uso 2',
    title: 'Reuniones y transcripciones',
    hint: 'Resume las reuniones grabadas en Meet y saca las tareas de cada parte (fase 4).',
    privacy:
      'Recomendado activo: las transcripciones son conversaciones de tus clientes. Usa Gemini de pago o un modelo como anthropic/claude-haiku-5.5, no uno gratis.',
  },
};

// ───────── IA ─────────

const modelCache = new Map<Provider, Promise<ModelInfo[]>>();
function loadModels(provider: Provider, refresh = false) {
  if (refresh || !modelCache.has(provider)) {
    const p = api<ModelInfo[]>('GET', `settings/ai/models?provider=${provider}`);
    p.catch(() => modelCache.delete(provider));
    modelCache.set(provider, p);
  }
  return modelCache.get(provider)!;
}

function ModelPicker({ value, onChange, label }: { value: Target; onChange: (t: Target) => void; label: string }) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [onlyFree, setOnlyFree] = useState(false);

  useEffect(() => {
    setError(null);
    setModels([]);
    loadModels(value.provider)
      .then(setModels)
      .catch((err) => setError(err.message));
  }, [value.provider]);

  const info = models.find((m) => m.id === value.model);
  const listId = `models-${label.replace(/\W/g, '')}`;
  const options = models.filter((m) => !onlyFree || m.free);

  return (
    <div className="model-picker">
      <div className="form-grid form-grid--picker">
        <label className="field">
          <span className="field__label">{label} · proveedor</span>
          <span className="input">
            <select value={value.provider} onChange={(e) => onChange({ provider: e.target.value as Provider, model: '' })}>
              <option value="gemini">Google Gemini</option>
              <option value="openrouter">OpenRouter</option>
            </select>
          </span>
        </label>
        <label className="field">
          <span className="field__label">Modelo</span>
          <span className="input">
            <input
              list={listId}
              value={value.model}
              placeholder={value.provider === 'gemini' ? 'gemini-flash-latest' : 'nvidia/nemotron-3-super-120b-a12b:free'}
              onChange={(e) => onChange({ ...value, model: e.target.value.trim() })}
              spellCheck={false}
            />
          </span>
          <datalist id={listId}>
            {options.map((m) => (
              <option key={m.id} value={m.id}>
                {m.free ? 'GRATIS · ' : ''}
                {m.name}
              </option>
            ))}
          </datalist>
        </label>
      </div>
      {value.provider === 'openrouter' && (
        <label className="check">
          <input type="checkbox" checked={onlyFree} onChange={(e) => setOnlyFree(e.target.checked)} /> Sugerir solo modelos gratis
        </label>
      )}
      {error && <p className="hint">No se pudo listar los modelos: {error}</p>}
      {info && (
        <p className="hint mono">
          {info.name} · contexto {info.context ? compact(info.context) : '?'} tokens ·{' '}
          {info.free
            ? 'gratis'
            : info.price
              ? `${usd(info.price.input)} / ${usd(info.price.output)} por 1M (entrada/salida)`
              : 'precio: configúralo abajo'}
          {!info.jsonMode && ' · ⚠ no garantiza JSON estructurado'}
        </p>
      )}
    </div>
  );
}

function TestBadge({ result }: { result: TestResult | null }) {
  if (!result) return null;
  if (!result.ok) return <p className="alert">Falló: {result.error}</p>;
  return (
    <p className="callout mono">
      ✓ {result.model} respondió en {((result.latencyMs ?? 0) / 1000).toFixed(1)} s · {result.inputTokens}+{result.outputTokens} tokens ·{' '}
      {result.costUsd ? usd(result.costUsd) : 'sin costo'}
      <br />
      <span className="test-reply">{result.text}</span>
    </p>
  );
}

function AiTab() {
  const { data, error, loading, reload, setData } = useApi<AiSettings>('settings/ai');
  const [form, setForm] = useState<AiSettings | null>(null);
  const [keys, setKeys] = useState<Record<Provider, string>>({ gemini: '', openrouter: '' });
  const [tests, setTests] = useState<Record<string, TestResult | null>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const { busy, run } = useAction();
  const toast = useToast();

  useEffect(() => {
    if (data) setForm(structuredClone(data));
  }, [data]);

  if (loading || !form) return error ? <ErrorBox message={error} onRetry={reload} /> : <Loading />;

  const save = (extra: Partial<{ keys: Partial<Record<Provider, string>> }> = {}) =>
    run(async () => {
      const saved = await api<AiSettings>('PUT', 'settings/ai', {
        profiles: form.profiles,
        monthlyBudgetUsd: form.monthlyBudgetUsd,
        prices: form.prices,
        ...extra,
      });
      setData(saved);
      setKeys({ gemini: '', openrouter: '' });
      modelCache.clear();
      toast('Configuración guardada.');
    });

  const test = async (profile: Profile, which: 'primary' | 'fallback') => {
    const route = form.profiles[profile];
    const target = route[which];
    const id = `${profile}.${which}`;
    if (!target?.model) return toast('Elige un modelo primero.', true);
    setTesting(id);
    try {
      setTests((t) => ({ ...t, [id]: null }));
      // Se prueba lo que está en pantalla, aunque aún no se haya guardado.
      const r = await api<TestResult>('POST', 'settings/ai/test', { profile, ...target, privateOnly: route.privateOnly });
      setTests((t) => ({ ...t, [id]: r }));
    } catch (err) {
      setTests((t) => ({ ...t, [id]: { ok: false, error: (err as Error).message } }));
    } finally {
      setTesting(null);
    }
  };

  const setRoute = (profile: Profile, patch: Partial<Route>) =>
    setForm({ ...form, profiles: { ...form.profiles, [profile]: { ...form.profiles[profile], ...patch } } });

  const geminiModels = Object.values(form.profiles)
    .flatMap((r) => [r.primary, r.fallback])
    .filter((t): t is Target => t?.provider === 'gemini' && !!t.model)
    .map((t) => t.model);
  const priceModels = [...new Set([...geminiModels, ...Object.keys(form.prices)])];

  return (
    <div className="stack">
      <section className="card form-section">
        <h2>Claves</h2>
        <p className="hint">
          Se guardan cifradas. Si dejas una variable de entorno (GEMINI_API_KEY / OPENROUTER_API_KEY), se usa cuando no hay clave guardada aquí.
        </p>
        {(['gemini', 'openrouter'] as Provider[]).map((p) => (
          <div key={p} className="key-row">
            <label className="field">
              <span className="field__label">
                {PROVIDER_NAME[p]} ·{' '}
                {form.keys[p].saved ? `guardada (${form.keys[p].saved})` : form.keys[p].fromEnv ? 'desde variable de entorno' : 'sin clave'}
              </span>
              <span className="input">
                <input
                  type="password"
                  autoComplete="off"
                  placeholder={p === 'gemini' ? 'AIza…' : 'sk-or-v1-…'}
                  value={keys[p]}
                  onChange={(e) => setKeys({ ...keys, [p]: e.target.value })}
                />
              </span>
            </label>
            <button className="btn btn--outline btn--sm" disabled={busy || !keys[p]} onClick={() => save({ keys: { [p]: keys[p] } })}>
              Guardar clave
            </button>
            {form.keys[p].saved && (
              <button className="btn btn--outline btn--sm btn--danger" disabled={busy} onClick={() => save({ keys: { [p]: '' } })}>
                Borrar
              </button>
            )}
          </div>
        ))}
      </section>

      {(Object.keys(PROFILE_INFO) as Profile[]).map((profile) => {
        const route = form.profiles[profile];
        const info = PROFILE_INFO[profile];
        const testButton = (which: 'primary' | 'fallback') => (
          <div className="actions">
            <button className="btn btn--outline btn--sm" onClick={() => test(profile, which)} disabled={testing !== null}>
              {testing === `${profile}.${which}` ? 'Probando…' : 'Probar conexión'}
            </button>
          </div>
        );
        return (
          <section key={profile} className="card form-section">
            <div>
              <p className="eyebrow">{info.eyebrow}</p>
              <h2>{info.title}</h2>
              <p className="hint">{info.hint}</p>
            </div>
            <ModelPicker label="Principal" value={route.primary} onChange={(primary) => setRoute(profile, { primary })} />
            {testButton('primary')}
            <TestBadge result={tests[`${profile}.primary`] ?? null} />

            <label className="check">
              <input
                type="checkbox"
                checked={!!route.fallback}
                onChange={(e) => setRoute(profile, { fallback: e.target.checked ? { provider: 'openrouter', model: '' } : null })}
              />
              Usar un modelo de respaldo si el principal falla
            </label>
            {route.fallback && (
              <>
                <ModelPicker label="Respaldo" value={route.fallback} onChange={(fallback) => setRoute(profile, { fallback })} />
                {testButton('fallback')}
                <TestBadge result={tests[`${profile}.fallback`] ?? null} />
              </>
            )}

            <label className="check">
              <input type="checkbox" checked={route.privateOnly} onChange={(e) => setRoute(profile, { privateOnly: e.target.checked })} />
              OpenRouter: usar solo proveedores que no guardan ni entrenan con los datos
            </label>
            <p className="hint">{info.privacy}</p>
          </section>
        );
      })}

      <section className="card form-section">
        <h2>Costos y presupuesto</h2>
        <p className="hint">
          OpenRouter informa el costo real de cada llamada. Gemini no: se calcula con la tarifa por millón de tokens que pongas aquí (consúltala en
          ai.google.dev/pricing).
        </p>
        {priceModels.map((model) => {
          const price = form.prices[model] ?? { input: 0, output: 0 };
          const setPrice = (p: Partial<Price>) => setForm({ ...form, prices: { ...form.prices, [model]: { ...price, ...p } } });
          return (
            <div key={model} className="price-row">
              <span className="mono">{model}</span>
              <label className="field">
                <span className="field__label">Entrada US$/1M</span>
                <span className="input">
                  <input type="number" min={0} step="0.01" value={price.input} onChange={(e) => setPrice({ input: Number(e.target.value) })} />
                </span>
              </label>
              <label className="field">
                <span className="field__label">Salida US$/1M</span>
                <span className="input">
                  <input type="number" min={0} step="0.01" value={price.output} onChange={(e) => setPrice({ output: Number(e.target.value) })} />
                </span>
              </label>
            </div>
          );
        })}
        <label className="field narrow">
          <span className="field__label">Presupuesto mensual (US$) · aviso al superarlo</span>
          <span className="input">
            <input
              type="number"
              min={0}
              step="1"
              value={form.monthlyBudgetUsd}
              onChange={(e) => setForm({ ...form, monthlyBudgetUsd: Number(e.target.value) })}
            />
          </span>
        </label>
      </section>

      <div className="actions sticky-actions">
        <button className="btn btn--primary" disabled={busy} onClick={() => save()}>
          Guardar configuración
        </button>
        <button className="btn btn--outline" disabled={busy} onClick={() => setForm(structuredClone(data!))}>
          Descartar cambios
        </button>
      </div>

      <section className="card form-section">
        <h2>¿Qué modelo usar?</h2>
        <div className="md">
          <ul>
            <li>
              <strong>Recomendado: Gemini Flash (gemini-flash-latest) con facturación activa.</strong> Google no entrena con los datos de la API de
              pago, maneja transcripciones largas y el costo por reunión de 1 hora es de fracciones de centavo de dólar.
            </li>
            <li>
              <strong>Gratis en OpenRouter:</strong> <code>nvidia/nemotron-3-super-120b-a12b:free</code> y <code>google/gemma-4-31b-it:free</code>{' '}
              (256K de contexto, JSON estructurado). Buenos como respaldo. Límite: 50 llamadas al día, o 1.000 si compras 10 US$ de crédito una vez.
            </li>
            <li>
              <strong>Ojo con la privacidad:</strong> los endpoints gratis suelen registrar las peticiones. Para transcripciones de clientes usa un
              modelo de pago o deja activa la opción de solo proveedores privados.
            </li>
          </ul>
        </div>
      </section>
    </div>
  );
}

// ───────── Consumo ─────────

interface Usage {
  month: {
    rows: { provider: string; model: string; calls: number; failed: number; input_tokens: number; output_tokens: number; cost_usd: number }[];
    calls: number;
    costUsd: number;
    tokens: number;
  };
  byDay: { day: string; calls: number; tokens: number; cost_usd: number }[];
  recent: {
    id: number;
    at: string;
    provider: string;
    model: string;
    purpose: string;
    input_tokens: number;
    output_tokens: number;
    cost_usd: number;
    latency_ms: number;
    ok: number;
    error: string | null;
  }[];
  budgetUsd: number;
  openrouter: {
    error?: string;
    label?: string;
    usageUsd?: number;
    limitUsd?: number | null;
    remainingUsd?: number | null;
    freeTier?: boolean | null;
  } | null;
}

function UsageTab() {
  const { data, error, loading, reload } = useApi<Usage>('settings/ai/usage');
  const days = useMemo(() => {
    const out: { day: string; calls: number; cost: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const day = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
      const row = data?.byDay.find((d) => d.day === day);
      out.push({ day, calls: row?.calls ?? 0, cost: row?.cost_usd ?? 0 });
    }
    return out;
  }, [data]);
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const u = data!;
  const pct = u.budgetUsd ? Math.min(100, (u.month.costUsd / u.budgetUsd) * 100) : 0;
  const maxCalls = Math.max(1, ...days.map((d) => d.calls));

  return (
    <div className="stack">
      <div className="stats">
        <div className="stat card">
          <small>Costo del mes</small>
          <strong>{usd(u.month.costUsd)}</strong>
          <div className={`budget${pct >= 100 ? ' is-over' : pct >= 80 ? ' is-near' : ''}`}>
            <div style={{ width: `${pct}%` }} />
          </div>
          <span className="mono">de {usd(u.budgetUsd)} presupuestados</span>
        </div>
        <div className="stat card">
          <small>Llamadas del mes</small>
          <strong>{u.month.calls.toLocaleString('es-CO')}</strong>
          <span className="mono">{u.month.rows.reduce((n, r) => n + r.failed, 0)} fallidas</span>
        </div>
        <div className="stat card">
          <small>Tokens del mes</small>
          <strong>{compact(u.month.tokens)}</strong>
          <span className="mono">entrada + salida</span>
        </div>
        {u.openrouter && (
          <div className="stat card">
            <small>Clave de OpenRouter</small>
            {u.openrouter.error ? (
              <span className="mono">{u.openrouter.error}</span>
            ) : (
              <>
                <strong>{usd(u.openrouter.usageUsd ?? 0)}</strong>
                <span className="mono">
                  {u.openrouter.limitUsd != null ? `límite ${usd(u.openrouter.limitUsd)} · ` : ''}
                  {u.openrouter.freeTier ? 'gratis: 50 llamadas/día' : 'con créditos: 1.000 llamadas/día en :free'}
                </span>
              </>
            )}
          </div>
        )}
      </div>

      <section className="card form-section">
        <h2>Últimos 30 días</h2>
        <div className="bars" role="img" aria-label="Llamadas por día en los últimos 30 días">
          {days.map((d) => (
            <div key={d.day} className="bars__col" title={`${d.day}: ${d.calls} llamadas · ${usd(d.cost)}`}>
              <div className="bars__bar" style={{ height: `${(d.calls / maxCalls) * 100}%` }} />
            </div>
          ))}
        </div>
      </section>

      <section className="card form-section">
        <h2>Por modelo (este mes)</h2>
        {u.month.rows.length ? (
          <div className="table">
            <div className="table__row table__row--head table__row--5">
              <span>Modelo</span>
              <span>Llamadas</span>
              <span>Entrada</span>
              <span>Salida</span>
              <span>Costo</span>
            </div>
            {u.month.rows.map((r) => (
              <div key={`${r.provider}/${r.model}`} className="table__row table__row--5">
                <span>
                  <strong>{r.model}</strong>
                  <small>{PROVIDER_NAME[r.provider as Provider] ?? r.provider}</small>
                </span>
                <span className="mono">
                  {r.calls}
                  {r.failed ? ` (${r.failed} ✕)` : ''}
                </span>
                <span className="mono">{compact(r.input_tokens)}</span>
                <span className="mono">{compact(r.output_tokens)}</span>
                <span className="mono">{usd(r.cost_usd)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="hint">Sin llamadas este mes.</p>
        )}
      </section>

      <section className="card form-section">
        <h2>Últimas llamadas</h2>
        {u.recent.length ? (
          <div className="table">
            {u.recent.map((r) => (
              <div key={r.id} className={`table__row table__row--5${r.ok ? '' : ' is-failed'}`}>
                <span>
                  <strong>{r.purpose}</strong>
                  <small>{formatDateTime(r.at)}</small>
                </span>
                <span className="mono">{r.model}</span>
                <span className="mono">{compact(r.input_tokens + r.output_tokens)} tok</span>
                <span className="mono">{(r.latency_ms / 1000).toFixed(1)} s</span>
                <span className="mono" title={r.error ?? ''}>
                  {r.ok ? usd(r.cost_usd) : '✕ error'}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="hint">Aún no hay llamadas.</p>
        )}
      </section>
    </div>
  );
}

// ───────── Google y correo ─────────

interface GoogleStatus {
  connected: boolean;
  email?: string;
  connectedAt?: string;
  missingScopes?: string[];
  error?: string | null;
  redirectUri: string;
  driveFolder?: string | null;
}

function GoogleTab() {
  const { data, error, loading, reload, setData } = useApi<GoogleStatus>('settings/google');
  const { busy, run } = useAction();
  const toast = useToast();
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const g = data!;

  return (
    <div className="stack">
      <section className="card form-section">
        <h2>Cuenta de Google Workspace</h2>
        <p className="hint">
          La plataforma usa esta cuenta para enviar los correos (Gmail), guardar adjuntos (Drive, fase 3) y leer reuniones y transcripciones (Calendar
          y Meet, fase 4).
        </p>
        {g.connected ? (
          <>
            <p className="callout">
              Conectada como <strong>{g.email}</strong> desde {formatDateTime(g.connectedAt)}.
            </p>
            <p className="hint">
              Archivos:{' '}
              {g.driveFolder ? (
                <a href={g.driveFolder} target="_blank" rel="noopener">
                  carpeta «DeerSystems Partners» en tu Drive
                </a>
              ) : (
                'la carpeta «DeerSystems Partners» se crea en tu Drive con el primer archivo que se suba.'
              )}
            </p>
            {g.error && <p className="alert">{g.error}</p>}
            {!!g.missingScopes?.length && (
              <p className="alert">
                Faltan permisos: {g.missingScopes.map((s) => s.split('/').pop()).join(', ')}. Vuelve a conectar y acéptalos todos.
              </p>
            )}
            <div className="actions">
              <button
                className="btn btn--primary"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const r = await api<{ to: string }>('POST', 'settings/google/test-mail');
                    toast(`Correo de prueba enviado a ${r.to}.`);
                  })
                }
              >
                Enviar correo de prueba
              </button>
              <a className="btn btn--outline" href="/auth/google/connect">
                Reconectar
              </a>
              <button
                className="btn btn--outline btn--danger"
                disabled={busy}
                onClick={() => {
                  if (!confirm('¿Desconectar Google? Dejarán de salir los correos.')) return;
                  run(async () => setData({ ...(await api<GoogleStatus>('POST', 'settings/google/disconnect')), redirectUri: g.redirectUri }));
                }}
              >
                Desconectar
              </button>
            </div>
          </>
        ) : (
          <>
            <p>Sin conectar: los correos no se envían y verás las contraseñas en pantalla para compartirlas tú.</p>
            <a className="btn btn--primary" href="/auth/google/connect">
              Conectar Google
            </a>
          </>
        )}
        <p className="hint">
          En Google Cloud Console, el cliente OAuth debe tener esta URI de redirección autorizada: <code>{g.redirectUri}</code>
        </p>
      </section>

      <PickerKey />

      <section className="card form-section">
        <h2>Así se ven los correos</h2>
        <iframe className="mail-preview" src="/api/settings/mail-preview" title="Vista previa del correo de bienvenida" />
      </section>
    </div>
  );
}

/** Clave de API para el selector de Drive (Google Picker). */
function PickerKey() {
  const { data, reload } = useApi<{ configured: boolean; hasKey: boolean; appId: string | null; keyHint?: string }>('settings/google/picker');
  const [key, setKey] = useState('');
  const { busy, run } = useAction();
  const toast = useToast();
  const save = (value: string) =>
    run(async () => {
      await api('PUT', 'settings/google/picker', { apiKey: value });
      setKey('');
      toast(value ? 'Clave guardada. Ya puedes agregar archivos desde tu Drive.' : 'Clave borrada.');
      await reload();
    });
  return (
    <section className="card form-section">
      <h2>Agregar archivos desde tu Drive</h2>
      <p className="hint">
        El botón «Desde mi Drive» abre el selector de Google dentro de la plataforma. Necesita una clave de API de tu proyecto de Google Cloud (el
        mismo del login).
      </p>
      <ol className="steps">
        <li>
          En Google Cloud Console → <strong>APIs y servicios → Biblioteca</strong>, habilita <strong>Google Picker API</strong>.
        </li>
        <li>
          En <strong>Credenciales → Crear credenciales → Clave de API</strong>. Restríngela: aplicaciones web con el sitio{' '}
          <code>https://partners.deersystems.net/*</code> y solo la API <strong>Google Picker API</strong>.
        </li>
        <li>Pega la clave aquí.</li>
      </ol>
      <p className="hint">
        La clave debe ser del <strong>mismo proyecto</strong> que el cliente OAuth del login. Número de proyecto que usa el portal:{' '}
        <code>{data?.appId ?? 'no se pudo leer del ID de cliente'}</code>
        {data?.keyHint && (
          <>
            {' '}
            · clave guardada: <code>{data.keyHint}</code>
          </>
        )}
        . Compáralo en Google Cloud Console → panel del proyecto → «Número del proyecto».
      </p>
      <div className="key-row">
        <label className="field">
          <span className="field__label">Clave de API · {data?.hasKey ? 'guardada' : 'sin clave'}</span>
          <span className="input">
            <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="AIza…" autoComplete="off" spellCheck={false} />
          </span>
        </label>
        <button className="btn btn--outline btn--sm" disabled={busy || !key.trim()} onClick={() => save(key)}>
          Guardar clave
        </button>
        {data?.hasKey && (
          <button className="btn btn--outline btn--sm btn--danger" disabled={busy} onClick={() => save('')}>
            Borrar
          </button>
        )}
      </div>
    </section>
  );
}

/** Lo que sale en la cuenta de cobro como emisor: datos, cuenta bancaria, QR de pago, logo y firma. */
function IssuerProfile() {
  const { data, error, loading, reload, setData } = useApi<BillingProfile>('billing/profile');
  const [f, setF] = useState<BillingProfile | null>(null);
  const { busy, run } = useAction();
  const toast = useToast();
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const p = f ?? data!;
  const set = (patch: Partial<BillingProfile>) => setF({ ...p, ...patch });
  const pick = (k: 'logo' | 'signature' | 'qr') => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp,image/gif';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 1_500_000) return toast('La imagen pesa más de 1,5 MB.', true);
      const reader = new FileReader();
      reader.onload = () => set({ [k]: String(reader.result) });
      reader.readAsDataURL(file);
    };
    input.click();
  };
  const text = (k: keyof BillingProfile, label: string, opts: { area?: boolean; hint?: string } = {}) => (
    <label className="field" key={k}>
      <span className="field__label">{label}</span>
      {opts.area ? (
        <textarea rows={3} value={String(p[k] ?? '')} onChange={(e) => set({ [k]: e.target.value })} placeholder={opts.hint} />
      ) : (
        <span className="input">
          <input value={String(p[k] ?? '')} onChange={(e) => set({ [k]: e.target.value })} placeholder={opts.hint} />
        </span>
      )}
    </label>
  );
  return (
    <section className="card form-section">
      <h2>Datos de la cuenta de cobro</h2>
      <p className="hint">Lo que sale como emisor en cada cuenta de cobro y lo que ve el cliente para pagarte.</p>
      <div className="form-grid">
        {text('name', 'Nombre')}
        {text('docType', 'Tipo de documento', { hint: 'CC o NIT' })}
        {text('docNumber', 'Número de documento')}
        {text('personType', 'Régimen', { hint: 'Persona natural · No responsable de IVA' })}
        {text('address', 'Dirección')}
        {text('city', 'Ciudad')}
        {text('phone', 'Celular')}
        {text('email', 'Correo')}
        {text('signatureName', 'Nombre de quien firma')}
        {text('signatureDoc', 'Documento de quien firma', { hint: 'CC 1.012.345.678' })}
      </div>
      {text('bankInfo', 'Forma de pago (sale en la cuenta de cobro y en el portal del cliente)', {
        area: true,
        hint: 'Cuenta de ahorros Bancolombia 000-000000-00 a nombre de…',
      })}
      {text('legalNote', 'Texto legal (sale en letra pequeña en la cuenta de cobro, no en el portal)', {
        area: true,
        hint: 'En virtud de lo contemplado en el artículo 616-2 del ET…',
      })}
      {text('defaultNotes', 'Notas por defecto de cada cuenta de cobro', { area: true })}
      <label className="field">
        <span className="field__label">Días para pagar (fecha límite por defecto; 0 = sin fecha límite)</span>
        <span className="input">
          <input type="number" min={0} max={120} value={p.defaultDueDays} onChange={(e) => set({ defaultDueDays: Number(e.target.value) })} />
        </span>
      </label>
      <div className="issuer-images">
        {(
          [
            ['logo', 'Logo'],
            ['signature', 'Firma'],
            ['qr', 'QR de pago (Bre-B, Bancolombia, Nequi…)'],
          ] as const
        ).map(([k, label]) => (
          <div key={k} className="issuer-image">
            <span className="field__label">{label}</span>
            {p[k] ? <img src={p[k]!} alt={label} /> : <span className="issuer-image__empty">Sin imagen</span>}
            <span className="actions actions--tight">
              <button className="btn btn--outline btn--sm" onClick={() => pick(k)}>
                {p[k] ? 'Cambiar' : 'Subir'}
              </button>
              {p[k] && (
                <button className="btn btn--outline btn--sm btn--danger" onClick={() => set({ [k]: null })}>
                  Quitar
                </button>
              )}
            </span>
          </div>
        ))}
      </div>
      <button
        className="btn btn--primary btn--sm"
        disabled={busy || !f}
        onClick={() =>
          run(async () => {
            setData(await api<BillingProfile>('PUT', 'billing/profile', p));
            setF(null);
            toast('Datos de la cuenta de cobro guardados.');
          })
        }
      >
        Guardar
      </button>
    </section>
  );
}

/** Pago en línea opcional (Wompi). Apagado por defecto: cobra comisión; se activa por cuenta de cobro. */
function OnlinePayments() {
  const { data, error, loading, reload, setData } = useApi<{
    enabled: boolean;
    env: 'sandbox' | 'production';
    publicKey: string;
    hasPrivateKey: boolean;
    privateKeyHint: string | null;
    hasEventsSecret: boolean;
    webhookUrl: string;
  }>('settings/online-payments');
  const [keys, setKeys] = useState({ publicKey: '', privateKey: '', eventsSecret: '' });
  const { busy, run } = useAction();
  const toast = useToast();
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const d = data!;
  const save = (body: Record<string, unknown>, msg: string) =>
    run(async () => {
      await api('PUT', 'settings/online-payments', body);
      setKeys({ publicKey: '', privateKey: '', eventsSecret: '' });
      await reload();
      toast(msg);
    });
  return (
    <section className="card form-section narrow-col" style={{ marginTop: 16 }}>
      <h2>Pago en línea (opcional)</h2>
      <p className="hint">
        Por defecto tus clientes pagan por transferencia o QR a tu cuenta, que no cobra comisión. Si un cliente pide pagar con PSE, Nequi, botón Bancolombia o
        tarjeta, activas el pago en línea <strong>solo en esa cuenta de cobro</strong>: se crea un link de Wompi de un solo uso por el saldo y, cuando se aprueba,
        el abono se registra solo (y va al Gestor). Wompi cobra ≈2,65 % + $700 + IVA por pago; confirma la tarifa vigente en wompi.com.
      </p>
      <label className="check">
        <input type="checkbox" checked={d.enabled} disabled={busy} onChange={(e) => save({ enabled: e.target.checked }, e.target.checked ? 'Pago en línea disponible.' : 'Pago en línea apagado.')} />
        Permitir activar el pago en línea en las cuentas de cobro
      </label>
      {d.enabled && (
        <>
          <div className="segmented segmented--sm">
            {(['sandbox', 'production'] as const).map((e) => (
              <button key={e} className={d.env === e ? 'is-active' : ''} onClick={() => setData({ ...d, env: e })}>
                {e === 'sandbox' ? 'Pruebas (sandbox)' : 'Producción'}
              </button>
            ))}
          </div>
          <div className="form-grid">
            <label className="field">
              <span className="field__label">Llave pública {d.publicKey ? `· ${d.publicKey.slice(0, 12)}…` : ''}</span>
              <span className="input">
                <input value={keys.publicKey} onChange={(e) => setKeys({ ...keys, publicKey: e.target.value })} placeholder="pub_test_… / pub_prod_…" autoComplete="off" />
              </span>
            </label>
            <label className="field">
              <span className="field__label">Llave privada · {d.hasPrivateKey ? `guardada ${d.privateKeyHint}` : 'sin guardar'}</span>
              <span className="input">
                <input type="password" value={keys.privateKey} onChange={(e) => setKeys({ ...keys, privateKey: e.target.value })} placeholder="prv_test_… / prv_prod_…" autoComplete="off" />
              </span>
            </label>
            <label className="field">
              <span className="field__label">Secreto de eventos · {d.hasEventsSecret ? 'guardado' : 'sin guardar'}</span>
              <span className="input">
                <input type="password" value={keys.eventsSecret} onChange={(e) => setKeys({ ...keys, eventsSecret: e.target.value })} placeholder="test_events_… / prod_events_…" autoComplete="off" />
              </span>
            </label>
          </div>
          <p className="hint">
            En el panel de Wompi → Desarrolladores, configura la URL de eventos: <code>{d.webhookUrl}</code>. Las llaves y el secreto están en Mi cuenta → Secretos para
            integración técnica. Se guardan cifrados.
          </p>
          <button
            className="btn btn--primary btn--sm"
            disabled={busy}
            onClick={() =>
              save(
                { env: d.env, ...(keys.publicKey ? { publicKey: keys.publicKey } : {}), ...(keys.privateKey ? { privateKey: keys.privateKey } : {}), ...(keys.eventsSecret ? { eventsSecret: keys.eventsSecret } : {}) },
                'Datos de Wompi guardados.',
              )
            }
          >
            Guardar
          </button>
        </>
      )}
    </section>
  );
}

// ───────── Finanzas ─────────

/** Conexión con el Gestor financiero: los pagos marcados como pagados se registran allí como ingresos. */
function FinanceTab() {
  const { data, error, loading, reload, setData } = useApi<{ url: string; defaultUrl: string; hasKey: boolean; keyHint: string | null; userEmail: string }>(
    'settings/finanzas',
  );
  const [key, setKey] = useState('');
  const [url, setUrl] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const status = useApi<{ connected: boolean; error?: string }>('settings/finanzas/status');
  const { busy, run } = useAction();
  const toast = useToast();
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const save = (body: { url?: string; apiKey?: string; userEmail?: string }, msg: string) =>
    run(async () => {
      setData(await api('PUT', 'settings/finanzas', body));
      setKey('');
      setUrl(null);
      setUserEmail(null);
      toast(msg);
      await status.reload();
    });
  return (
    <>
      <IssuerProfile />
      <OnlinePayments />
      <section className="card form-section narrow-col" style={{ marginTop: 16 }}>
        <div className="form-section__head">
          <h2>Gestor financiero</h2>
          {status.loading && !status.data ? (
            <span className="sync sync--off">Comprobando…</span>
          ) : status.data?.connected ? (
            <span className="sync sync--ok">● Conectado</span>
          ) : (
            <span className="sync sync--error" title={status.data?.error}>
              ○ Sin conectar
            </span>
          )}
        </div>
        {status.data && !status.data.connected && status.data.error && <p className="alert">{status.data.error}</p>}
        <p className="hint">
          Al marcar un pago como <strong>Pagado</strong> en la pestaña Pagos de un proyecto, se registra como ingreso en tu Gestor: la categoría es la
          empresa del cliente y la descripción lleva el proyecto, el tipo de abono y el porcentaje. Si lo desmarcas o lo borras, el ingreso se quita.
          El Gestor lleva todo en pesos: los pagos en USD se registran con los pesos recibidos (TRM oficial del día, editable).
        </p>
        <label className="field">
          <span className="field__label">URL de la API</span>
          <span className="input">
            <input value={url ?? data!.url} onChange={(e) => setUrl(e.target.value)} placeholder={data!.defaultUrl} spellCheck={false} />
          </span>
        </label>
        {url !== null && url !== data!.url && (
          <button className="btn btn--outline btn--sm" disabled={busy} onClick={() => save({ url }, 'URL guardada.')}>
            Guardar URL
          </button>
        )}
        <div className="key-row">
          <label className="field">
            <span className="field__label">Correo de tu usuario en el Gestor</span>
            <span className="input">
              <input
                type="email"
                value={userEmail ?? data!.userEmail}
                onChange={(e) => setUserEmail(e.target.value)}
                placeholder="El correo con el que entras a finanzas.lidutech.net"
                autoComplete="off"
              />
            </span>
          </label>
          {userEmail !== null && userEmail !== data!.userEmail && (
            <button className="btn btn--outline btn--sm" disabled={busy} onClick={() => save({ userEmail }, userEmail ? 'Correo del Gestor guardado.' : 'Correo del Gestor quitado.')}>
              Guardar correo
            </button>
          )}
        </div>
        <p className="hint">
          Los ingresos quedan en ese usuario del Gestor. Puede ser distinto al correo de Partners. Si lo dejas vacío, el Gestor usa su variable
          BILLING_INCOME_USER_EMAIL.
        </p>
        <div className="key-row">
          <label className="field">
            <span className="field__label">Clave de servicio (SERVICE_API_KEY) · {data!.hasKey ? `guardada ${data!.keyHint}` : 'sin clave'}</span>
            <span className="input">
              <input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="La misma SERVICE_API_KEY del Gestor"
                autoComplete="off"
                spellCheck={false}
              />
            </span>
          </label>
          <button
            className="btn btn--outline btn--sm"
            disabled={busy || !key.trim()}
            onClick={() => save({ apiKey: key }, 'Clave guardada (cifrada).')}
          >
            Guardar clave
          </button>
          {data!.hasKey && (
            <button className="btn btn--outline btn--sm btn--danger" disabled={busy} onClick={() => save({ apiKey: '' }, 'Clave borrada.')}>
              Borrar
            </button>
          )}
        </div>
        <p className="hint">Es la variable SERVICE_API_KEY del servicio del Gestor en Dokploy. Se guarda cifrada y nunca se muestra completa.</p>
        <div>
          <button
            className="btn btn--primary btn--sm"
            disabled={busy || !data!.hasKey}
            onClick={() =>
              run(async () => {
                try {
                  await api('POST', 'settings/finanzas/test');
                  toast('Conexión correcta con el Gestor financiero.');
                } finally {
                  await status.reload();
                }
              })
            }
          >
            Probar conexión
          </button>
        </div>
      </section>
    </>
  );
}

// ───────── Página ─────────

// ───────── Avisos ─────────

type Channel = 'app' | 'email';
interface NotifySettings {
  events: Record<string, Record<Channel, boolean>>;
  teamEmail: boolean;
  digestMinutes: number;
  catalog: { key: string; label: string; audience: 'owner' | 'staff' | 'team' | 'client' }[];
}

const AUDIENCE: Record<NotifySettings['catalog'][number]['audience'], string> = {
  owner: 'Solo te llegan a ti',
  staff: 'Te llegan a ti y a tu equipo',
  team: 'Le llegan a la persona del equipo',
  client: 'Le llegan al cliente',
};

function NotificationsTab() {
  const { data, error, loading, reload, setData } = useApi<NotifySettings>('settings/notifications');
  const { busy, run } = useAction();
  const toast = useToast();
  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const n = data!;

  // Cada cambio se guarda al instante.
  const save = (patch: Partial<Pick<NotifySettings, 'events' | 'teamEmail' | 'digestMinutes'>>) =>
    run(async () => {
      setData(await api<NotifySettings>('PUT', 'settings/notifications', patch));
      toast('Avisos actualizados.');
    });
  const toggle = (key: string, channel: Channel) => save({ events: { [key]: { ...n.events[key], [channel]: !n.events[key][channel] } } });

  const groups = (['owner', 'staff', 'team', 'client'] as const).map((aud) => ({ aud, rows: n.catalog.filter((c) => c.audience === aud) }));

  return (
    <div className="stack">
      <section className="card form-section">
        <h2>Qué avisar y por dónde</h2>
        <p className="hint">
          «En la plataforma» aparece en la campana del encabezado. «Por correo» llega desde tu Gmail con el diseño de DeerSystems; si pasan varias
          cosas seguidas, se juntan en un solo correo.
        </p>
        {groups.map(({ aud, rows }) => (
          <div key={aud} className="notify-group">
            <div className="notify-row notify-row--head">
              <span>{AUDIENCE[aud]}</span>
              <span>En la plataforma</span>
              <span>Por correo</span>
            </div>
            {rows.map((r) => (
              <div key={r.key} className="notify-row">
                <span>{r.label}</span>
                {(['app', 'email'] as Channel[]).map((ch) => (
                  <label key={ch} className="switch">
                    <input
                      type="checkbox"
                      role="switch"
                      checked={n.events[r.key][ch]}
                      disabled={busy}
                      aria-label={`${r.label}: ${ch === 'app' ? 'en la plataforma' : 'por correo'}`}
                      onChange={() => toggle(r.key, ch)}
                    />
                    <span className="switch__track" />
                  </label>
                ))}
              </div>
            ))}
          </div>
        ))}
      </section>

      <section className="card form-section">
        <h2>Correo</h2>
        <label className="check">
          <input type="checkbox" checked={n.teamEmail} disabled={busy} onChange={(e) => save({ teamEmail: e.target.checked })} />
          Enviar también por correo al equipo los avisos del cliente (si no, solo te llegan a ti; al equipo le aparecen en la campana)
        </label>
        <label className="field narrow">
          <span className="field__label">Juntar avisos durante (minutos)</span>
          <span className="input">
            <select value={n.digestMinutes} disabled={busy} onChange={(e) => save({ digestMinutes: Number(e.target.value) })}>
              {[1, 3, 5, 10, 15, 30, 60].map((m) => (
                <option key={m} value={m}>
                  {m} {m === 1 ? 'minuto' : 'minutos'}
                </option>
              ))}
            </select>
          </span>
        </label>
        <p className="hint">Los correos solo salen con Google conectado (pestaña Google y correo).</p>
      </section>
    </div>
  );
}

const TABS = { ia: 'Inteligencia artificial', consumo: 'Consumo de IA', avisos: 'Avisos', google: 'Google y correo', finanzas: 'Finanzas' } as const;
type Tab = keyof typeof TABS;

const GOOGLE_MESSAGES: Record<string, [string, boolean]> = {
  ok: ['Google conectado.', false],
  unauthorized: ['Solo se puede conectar la cuenta del administrador.', true],
  norefresh: ['Google no entregó acceso permanente. Quita el acceso de la app en myaccount.google.com/permissions y vuelve a conectar.', true],
  state: ['La conexión expiró. Inténtalo de nuevo.', true],
  google: ['Google no confirmó la conexión. Inténtalo de nuevo.', true],
};

export function SettingsPage() {
  const { query } = useLocation();
  const toast = useToast();
  const googleResult = query.get('google');
  const tabParam = query.get('tab') as Tab | null;
  const [tab, setTab] = useState<Tab>(googleResult ? 'google' : tabParam && tabParam in TABS ? tabParam : 'ia');

  useEffect(() => {
    if (!googleResult) return;
    const [msg, isError] = GOOGLE_MESSAGES[googleResult] ?? ['Respuesta inesperada de Google.', true];
    toast(msg, isError);
    navigate('/configuracion', true);
  }, [googleResult, toast]);

  return (
    <>
      <PageHead
        eyebrow="Configuración"
        title={
          <>
            Ajustes de la <span className="grad">plataforma</span>
          </>
        }
      />
      <div className="tabs" role="tablist">
        {(Object.keys(TABS) as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'is-active' : ''} onClick={() => setTab(t)}>
            {TABS[t]}
          </button>
        ))}
      </div>
      {tab === 'ia' && <AiTab />}
      {tab === 'consumo' && <UsageTab />}
      {tab === 'avisos' && <NotificationsTab />}
      {tab === 'google' && <GoogleTab />}
      {tab === 'finanzas' && <FinanceTab />}
    </>
  );
}
