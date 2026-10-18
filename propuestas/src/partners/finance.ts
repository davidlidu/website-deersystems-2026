import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, json, readJson } from '../http.ts';
import { decrypt, encrypt, mask } from '../secrets.ts';
import type { Viewer } from './auth.ts';
import { optDate, requireOwner, str } from './common.ts';
import * as db from './db.ts';

/**
 * Conexión con el Gestor financiero (POST/PUT/DELETE /integrations/billing-payment/:referencia, con x-api-key)
 * y TRM oficial. La usan los abonos (billing.ts) y el plan de pagos (payments.ts).
 */

export const DEFAULT_FINANCE_URL = 'https://api.finanzas.lidutech.net/api';

export const todayBogota = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

function financeConfig(): { url: string; apiKey: string | null } {
  const s = db.getSetting<{ url?: string; apiKey?: string }>('finanzas');
  return { url: (s?.url || DEFAULT_FINANCE_URL).replace(/\/+$/, ''), apiKey: decrypt(s?.apiKey) };
}

export function financeConfigured(): boolean {
  return !!financeConfig().apiKey;
}

export class FinanceError extends Error {}

export async function financeCall(method: 'PUT' | 'DELETE', path: string, body?: unknown): Promise<void> {
  const cfg = financeConfig();
  if (!cfg.apiKey) throw new FinanceError('El Gestor financiero no está conectado (Configuración → Finanzas).');
  let r: Response;
  try {
    r = await fetch(`${cfg.url}${path}`, {
      method,
      headers: { 'x-api-key': cfg.apiKey, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new FinanceError(`No se pudo conectar con el Gestor: ${(err as Error).message}`);
  }
  if (r.ok) return;
  const text = await r.text().catch(() => '');
  let msg = text.slice(0, 300);
  try {
    msg = (JSON.parse(text) as { error?: string }).error ?? msg;
  } catch {
    /* no es JSON */
  }
  if (r.status === 401) msg = 'La clave del Gestor no es válida.';
  throw new FinanceError(`Gestor financiero (${r.status}): ${msg || r.statusText}`);
}

/** Crea o actualiza el ingreso (idempotente por referencia). */
export const upsertIncome = (reference: string, body: { amount: number; date: string; clientName: string; description: string; paymentMethod: 'cash' | 'transfer' }) =>
  financeCall('PUT', `/integrations/billing-payment/${encodeURIComponent(reference)}`, body);

/** Borra el ingreso. Si no existe, el Gestor responde bien igual. */
export const deleteIncome = (reference: string) => financeCall('DELETE', `/integrations/billing-payment/${encodeURIComponent(reference)}`);

/** El Gestor solo acepta 'cash' o 'transfer' (mismo criterio que SmartBilling). */
export const paymentMethodFor = (method: string): 'cash' | 'transfer' => (/efectivo|cash/i.test(method) ? 'cash' : 'transfer');

// ───────── TRM (Superintendencia Financiera, datos abiertos) ─────────

const trmCache = new Map<string, number>();

/** TRM vigente para una fecha (la del día hábil anterior si cae en fin de semana o festivo). */
export async function trmFor(date: string): Promise<number | null> {
  if (trmCache.has(date)) return trmCache.get(date)!;
  const q = new URLSearchParams({ $where: `vigenciadesde <= '${date}T00:00:00.000'`, $order: 'vigenciadesde DESC', $limit: '1' });
  try {
    const r = await fetch(`https://www.datos.gov.co/resource/32sa-8pi3.json?${q}`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const value = Number(((await r.json()) as { valor?: string }[])[0]?.valor);
    if (!Number.isFinite(value) || value <= 0) return null;
    trmCache.set(date, value);
    return value;
  } catch {
    return null;
  }
}

// ───────── Rutas ─────────

const publicConfig = () => {
  const cfg = financeConfig();
  return { url: cfg.url, defaultUrl: DEFAULT_FINANCE_URL, hasKey: !!cfg.apiKey, keyHint: mask(cfg.apiKey) };
};

export async function handleFinance(route: string, _id: number, req: IncomingMessage, res: ServerResponse, v: Viewer, url: URL): Promise<boolean> {
  switch (route) {
    case 'GET trm': {
      requireOwner(v);
      const date = optDate(url.searchParams.get('date')) ?? todayBogota();
      json(res, 200, { date, trm: await trmFor(date) });
      return true;
    }

    case 'GET settings/finanzas':
      requireOwner(v);
      json(res, 200, publicConfig());
      return true;

    case 'PUT settings/finanzas': {
      requireOwner(v);
      const body = await readJson(req);
      const current = db.getSetting<{ url?: string; apiKey?: string }>('finanzas') ?? {};
      const urlIn = str(body.url, 300);
      if (urlIn && !/^https?:\/\/[^\s]+$/.test(urlIn)) throw new HttpError(400, 'La URL del Gestor no es válida.');
      const key = typeof body.apiKey === 'string' ? body.apiKey.trim() : undefined;
      db.setSetting('finanzas', {
        url: urlIn || current.url || DEFAULT_FINANCE_URL,
        apiKey: key === undefined ? current.apiKey : key ? encrypt(key) : undefined,
      });
      json(res, 200, publicConfig());
      return true;
    }

    case 'POST settings/finanzas/test': {
      // Borrar una referencia que no existe es inofensivo e idempotente: sirve para probar URL y clave.
      requireOwner(v);
      try {
        await deleteIncome('deersystems-prueba-conexion');
      } catch (err) {
        if (err instanceof FinanceError) throw new HttpError(502, err.message);
        throw err;
      }
      json(res, 200, { ok: true });
      return true;
    }
  }
  return false;
}
