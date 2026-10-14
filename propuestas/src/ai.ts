import { GEMINI_API_KEY, OPENROUTER_API_KEY, PARTNERS_URL } from './config.ts';
import { getSetting, logUsage, setSetting } from './partners/db.ts';
import { decrypt, encrypt, mask } from './secrets.ts';

export type Provider = 'gemini' | 'openrouter';
export const PROVIDERS: Provider[] = ['gemini', 'openrouter'];

export interface Target {
  provider: Provider;
  model: string;
}

/** Precio por millón de tokens, en USD. OpenRouter informa el costo real; para Gemini se calcula con esto. */
export interface Price {
  input: number;
  output: number;
}

/**
 * Cada uso tiene su propia configuración: las propuestas son tuyas y pueden ir a un modelo gratis;
 * las transcripciones de reuniones son del cliente y van solo a proveedores privados.
 */
export type Profile = 'propuestas' | 'reuniones';
export const PROFILES: Profile[] = ['propuestas', 'reuniones'];

export interface Route {
  primary: Target;
  fallback: Target | null;
  /** OpenRouter: usar solo proveedores que no guardan ni entrenan con los datos. */
  privateOnly: boolean;
}

interface Stored {
  profiles: Record<Profile, Route>;
  monthlyBudgetUsd: number;
  prices: Record<string, Price>;
  keys: Partial<Record<Provider, string>>; // cifradas
}

const DEFAULT_PROFILES: Record<Profile, Route> = {
  propuestas: {
    primary: { provider: 'gemini', model: 'gemini-flash-latest' },
    fallback: { provider: 'openrouter', model: 'nvidia/nemotron-3-super-120b-a12b:free' },
    privateOnly: false,
  },
  reuniones: {
    primary: { provider: 'gemini', model: 'gemini-flash-latest' },
    fallback: { provider: 'openrouter', model: 'anthropic/claude-haiku-5.5' },
    privateOnly: true,
  },
};

const DEFAULTS: Stored = {
  profiles: DEFAULT_PROFILES,
  monthlyBudgetUsd: 5,
  // Referencia de Gemini Flash; ajústala en el panel con la tarifa vigente de ai.google.dev/pricing.
  prices: { 'gemini-flash-latest': { input: 0.3, output: 2.5 } },
  keys: {},
};

function stored(): Stored {
  const raw = getSetting<Partial<Stored> & Partial<Route>>('ai') ?? {};
  const s: Stored = { ...DEFAULTS, ...raw, profiles: { ...DEFAULT_PROFILES, ...(raw.profiles ?? {}) } };
  // Versión anterior: una sola configuración para todo. Pasa a ser la de propuestas.
  if (!raw.profiles && raw.primary) {
    s.profiles.propuestas = { primary: raw.primary, fallback: raw.fallback ?? null, privateOnly: raw.privateOnly ?? true };
  }
  return s;
}

function apiKey(provider: Provider, s = stored()): string | null {
  return decrypt(s.keys[provider]) ?? ((provider === 'gemini' ? GEMINI_API_KEY : OPENROUTER_API_KEY) || null);
}

/** Lo que ve el panel: nunca las claves completas. */
export function publicSettings() {
  const s = stored();
  return {
    profiles: s.profiles,
    monthlyBudgetUsd: s.monthlyBudgetUsd,
    prices: s.prices,
    keys: Object.fromEntries(
      PROVIDERS.map((p) => [p, { saved: mask(decrypt(s.keys[p])), fromEnv: !s.keys[p] && !!apiKey(p, s) }]),
    ),
  };
}

const isProvider = (v: unknown): v is Provider => v === 'gemini' || v === 'openrouter';
export const isProfile = (v: unknown): v is Profile => v === 'propuestas' || v === 'reuniones';

export function parseTarget(v: unknown): Target | null {
  if (!v || typeof v !== 'object') return null;
  const { provider, model } = v as Record<string, unknown>;
  if (!isProvider(provider) || typeof model !== 'string' || !model.trim()) return null;
  return { provider, model: model.trim().slice(0, 200) };
}

/** Aplica lo que llega del panel. Una clave vacía ("") la borra; si no viene, se conserva. */
export function saveSettings(body: Record<string, unknown>): void {
  const s = stored();
  if (body.profiles && typeof body.profiles === 'object') {
    for (const [name, raw] of Object.entries(body.profiles as Record<string, Record<string, unknown>>)) {
      if (!isProfile(name) || !raw || typeof raw !== 'object') continue;
      const route = { ...s.profiles[name] };
      const primary = parseTarget(raw.primary);
      if (primary) route.primary = primary;
      if ('fallback' in raw) route.fallback = parseTarget(raw.fallback);
      if (typeof raw.privateOnly === 'boolean') route.privateOnly = raw.privateOnly;
      s.profiles[name] = route;
    }
  }
  if (typeof body.monthlyBudgetUsd === 'number' && body.monthlyBudgetUsd >= 0) s.monthlyBudgetUsd = body.monthlyBudgetUsd;
  if (body.prices && typeof body.prices === 'object') {
    s.prices = {};
    for (const [model, p] of Object.entries(body.prices as Record<string, Partial<Price>>)) {
      if (Number.isFinite(p?.input) && Number.isFinite(p?.output)) s.prices[model] = { input: p.input!, output: p.output! };
    }
  }
  if (body.keys && typeof body.keys === 'object') {
    for (const [provider, key] of Object.entries(body.keys as Record<string, unknown>)) {
      if (!isProvider(provider) || typeof key !== 'string') continue;
      if (key.trim()) s.keys[provider] = encrypt(key.trim());
      else delete s.keys[provider];
    }
  }
  setSetting('ai', { profiles: s.profiles, monthlyBudgetUsd: s.monthlyBudgetUsd, prices: s.prices, keys: s.keys });
}

export class AiError extends Error {}

export interface Completion {
  text: string;
  provider: Provider;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
}

interface Request {
  /** Qué configuración usar: la de propuestas o la de reuniones. */
  profile: Profile;
  /** Para qué se usó (aparece en el consumo): "propuesta", "reunion", "prueba"… */
  purpose: string;
  system: string;
  prompt: string;
  json?: boolean;
  maxOutputTokens?: number;
}

async function callGemini(target: Target, key: string, req: Request, s: Stored, _privateOnly: boolean): Promise<Omit<Completion, 'latencyMs'>> {
  const model = target.model.replace(/^models\//, '');
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: req.maxOutputTokens ?? 16384,
        ...(req.json ? { responseMimeType: 'application/json' } : {}),
      },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const data = (await r.json().catch(() => ({}))) as {
    error?: { message?: string };
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  };
  if (!r.ok) throw new AiError(`Gemini ${r.status}: ${data.error?.message ?? 'error desconocido'}`);
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const text = parts.filter((p) => !p.thought).map((p) => p.text ?? '').join('');
  if (!text) throw new AiError(`Gemini no devolvió texto (${data.candidates?.[0]?.finishReason ?? 'sin candidatos'}).`);
  const u = data.usageMetadata ?? {};
  const inputTokens = u.promptTokenCount ?? 0;
  // El razonamiento interno ("thoughts") se cobra como salida.
  const outputTokens = (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0);
  const price = s.prices[target.model];
  const costUsd = price ? (inputTokens * price.input + outputTokens * price.output) / 1e6 : 0;
  return { text, provider: 'gemini', model: target.model, inputTokens, outputTokens, costUsd };
}

async function callOpenRouter(target: Target, key: string, req: Request, _s: Stored, privateOnly: boolean): Promise<Omit<Completion, 'latencyMs'>> {
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      'HTTP-Referer': PARTNERS_URL,
      'X-Title': 'DeerSystems Partners',
    },
    body: JSON.stringify({
      model: target.model,
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.prompt },
      ],
      temperature: 0.2,
      max_tokens: req.maxOutputTokens ?? 16384,
      usage: { include: true },
      ...(req.json ? { response_format: { type: 'json_object' } } : {}),
      ...(privateOnly ? { provider: { data_collection: 'deny' } } : {}),
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const data = (await r.json().catch(() => ({}))) as {
    error?: { message?: string };
    model?: string;
    choices?: { message?: { content?: string }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  };
  if (!r.ok || data.error) {
    const hint =
      privateOnly && /no endpoints|data policy|guardrail/i.test(data.error?.message ?? '')
        ? ' Ningún proveedor de este modelo cumple "solo proveedores privados".'
        : '';
    throw new AiError(`OpenRouter ${r.status}: ${data.error?.message ?? 'error desconocido'}.${hint}`);
  }
  const text = data.choices?.[0]?.message?.content ?? '';
  if (!text) throw new AiError(`OpenRouter no devolvió texto (${data.choices?.[0]?.finish_reason ?? 'sin respuesta'}).`);
  return {
    text,
    provider: 'openrouter',
    model: target.model,
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
    costUsd: data.usage?.cost ?? 0,
  };
}

/** Llama a un modelo concreto y registra el consumo, salga bien o mal. */
async function callTarget(target: Target, req: Request, s: Stored, privateOnly: boolean): Promise<Completion> {
  const started = Date.now();
  const log = (c: Partial<Completion>, error: string | null) =>
    logUsage({
      provider: target.provider,
      model: target.model,
      purpose: req.purpose,
      input_tokens: c.inputTokens ?? 0,
      output_tokens: c.outputTokens ?? 0,
      cost_usd: c.costUsd ?? 0,
      latency_ms: Date.now() - started,
      ok: !error,
      error,
    });
  const key = apiKey(target.provider, s);
  if (!key) {
    const message = `Falta la clave de ${target.provider === 'gemini' ? 'Gemini' : 'OpenRouter'}.`;
    log({}, message);
    throw new AiError(message);
  }
  try {
    const result = await (target.provider === 'gemini' ? callGemini : callOpenRouter)(target, key, req, s, privateOnly);
    log(result, null);
    return { ...result, latencyMs: Date.now() - started };
  } catch (err) {
    const message = err instanceof Error ? (err.name === 'TimeoutError' ? 'Tiempo de espera agotado.' : err.message) : String(err);
    log({}, message.slice(0, 500));
    throw new AiError(message);
  }
}

/** Usa el modelo principal y, si falla, el de respaldo. */
export async function complete(req: Request): Promise<Completion> {
  const s = stored();
  const route = s.profiles[req.profile];
  try {
    return await callTarget(route.primary, req, s, route.privateOnly);
  } catch (err) {
    if (!route.fallback) throw err;
    console.warn(`IA principal falló (${(err as Error).message}); probando el respaldo.`);
    try {
      return await callTarget(route.fallback, req, s, route.privateOnly);
    } catch (fallbackErr) {
      throw new AiError(
        `Principal (${route.primary.model}): ${(err as Error).message} · Respaldo (${route.fallback.model}): ${(fallbackErr as Error).message}`,
      );
    }
  }
}

/** Pide JSON y lo interpreta, tolerando que el modelo lo envuelva en ```json. */
export async function completeJson<T>(req: Omit<Request, 'json'>): Promise<{ data: T; completion: Completion }> {
  const completion = await complete({ ...req, json: true });
  const raw = completion.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
  const start = raw.search(/[[{]/);
  try {
    return { data: JSON.parse(start > 0 ? raw.slice(start) : raw) as T, completion };
  } catch {
    throw new AiError(`El modelo ${completion.model} no devolvió un JSON válido. Prueba otro modelo.`);
  }
}

/**
 * Prueba de conexión: un mensaje mínimo al modelo indicado (aunque aún no esté guardado),
 * con la regla de privacidad del perfil, o la que llegue del panel.
 */
export async function testConnection(profile: Profile, target?: Target, privateOnly?: boolean) {
  const s = stored();
  const route = s.profiles[profile];
  const c = await callTarget(
    target ?? route.primary,
    {
      profile,
      purpose: 'prueba',
      system: 'Responde únicamente con JSON.',
      prompt: 'Devuelve exactamente {"ok": true, "saludo": "<un saludo corto en español>"}',
      json: true,
      maxOutputTokens: 512,
    },
    s,
    privateOnly ?? route.privateOnly,
  );
  return { ...c, text: c.text.slice(0, 300) };
}

export interface ModelInfo {
  id: string;
  name: string;
  context: number | null;
  free: boolean;
  /** USD por millón de tokens, si el proveedor lo informa. */
  price: Price | null;
  jsonMode: boolean;
}

/** Modelos disponibles para el selector del panel. */
export async function listModels(provider: Provider): Promise<ModelInfo[]> {
  if (provider === 'openrouter') {
    const r = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new AiError(`OpenRouter ${r.status} al listar modelos.`);
    const { data } = (await r.json()) as {
      data: {
        id: string;
        name: string;
        context_length?: number;
        pricing?: { prompt?: string; completion?: string };
        supported_parameters?: string[];
        architecture?: { output_modalities?: string[] };
      }[];
    };
    return data
      .filter((m) => (m.architecture?.output_modalities ?? ['text']).includes('text'))
      .map((m) => {
        const input = Number(m.pricing?.prompt ?? NaN) * 1e6;
        const output = Number(m.pricing?.completion ?? NaN) * 1e6;
        return {
          id: m.id,
          name: m.name,
          context: m.context_length ?? null,
          free: m.id.endsWith(':free') || (input === 0 && output === 0),
          price: Number.isFinite(input) && Number.isFinite(output) ? { input, output } : null,
          jsonMode: (m.supported_parameters ?? []).some((p) => p === 'response_format' || p === 'structured_outputs'),
        };
      })
      .sort((a, b) => Number(b.free) - Number(a.free) || a.id.localeCompare(b.id));
  }

  const key = apiKey('gemini');
  if (!key) throw new AiError('Guarda primero la clave de Gemini para ver sus modelos.');
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
    headers: { 'x-goog-api-key': key },
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await r.json().catch(() => ({}))) as {
    error?: { message?: string };
    models?: { name: string; displayName: string; inputTokenLimit?: number; supportedGenerationMethods?: string[] }[];
  };
  if (!r.ok) throw new AiError(`Gemini ${r.status}: ${data.error?.message ?? 'no se pudieron listar los modelos'}`);
  const prices = stored().prices;
  return (data.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent') && /gemini/i.test(m.name))
    .map((m) => {
      const id = m.name.replace(/^models\//, '');
      return { id, name: m.displayName, context: m.inputTokenLimit ?? null, free: false, price: prices[id] ?? null, jsonMode: true };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Saldo y límites de la clave de OpenRouter (Gemini no expone consumo por API). */
export async function openRouterKeyInfo() {
  const key = apiKey('openrouter');
  if (!key) return null;
  const r = await fetch('https://openrouter.ai/api/v1/key', {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!r?.ok) return { error: `No se pudo consultar la clave (${r?.status ?? 'sin conexión'}).` };
  const { data } = (await r.json()) as {
    data: { label?: string; usage?: number; limit?: number | null; limit_remaining?: number | null; is_free_tier?: boolean };
  };
  return {
    label: data.label ?? '',
    usageUsd: data.usage ?? 0,
    limitUsd: data.limit ?? null,
    remainingUsd: data.limit_remaining ?? null,
    // Sin haber comprado créditos: 50 peticiones diarias a modelos :free; con 10 USD o más, 1.000.
    freeTier: data.is_free_tier ?? null,
  };
}

export function budget() {
  return stored().monthlyBudgetUsd;
}
