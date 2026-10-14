import { createHash, createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { promisify } from 'node:util';
import { PARTNERS_SECURE, SESSION_SECRET, SUPERADMIN_EMAIL } from '../config.ts';
import { getAccount, type Account } from './db.ts';

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** "scrypt$sal$hash" en base64url. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 32, SCRYPT);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, salt, hash] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const given = await scryptAsync(password, Buffer.from(salt, 'base64url'), expected.length, SCRYPT);
  return timingSafeEqual(expected, given);
}

/** Contraseña fácil de dictar: 3 bloques sin caracteres ambiguos (0/O, 1/l/I), p. ej. "Kp7m-x4Rt-9wQe". */
export function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const block = () => Array.from({ length: 4 }, () => chars[randomInt(chars.length)]).join('');
  for (;;) {
    const pw = `${block()}-${block()}-${block()}`;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw) && /\d/.test(pw)) return pw;
  }
}

export function checkNewPassword(pw: unknown): string {
  if (typeof pw !== 'string' || pw.length < 10) throw new Error('La contraseña debe tener al menos 10 caracteres.');
  if (pw.length > 200) throw new Error('La contraseña es demasiado larga.');
  return pw;
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('base64url');
export const newToken = () => randomBytes(32).toString('base64url');

// ───────── Sesión ─────────

const SESSION_COOKIE = 'dp_session';
export const STATE_COOKIE = 'dp_oauth';
const SESSION_SECONDS = 14 * 24 * 60 * 60;

type Payload = { k: 'owner'; email: string; exp: number } | { k: 'acct'; id: number; v: number; exp: number };

/** Quién está mirando. El dueño entra con Google; equipo y clientes, con contraseña. */
export type Viewer =
  | { kind: 'owner'; email: string; name: string }
  | { kind: 'team'; email: string; name: string; account: Account }
  | { kind: 'client'; email: string; name: string; account: Account; clientId: number };

const hmac = (value: string) => createHmac('sha256', `partners:${SESSION_SECRET}`).update(value).digest('base64url');

export function readCookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function setCookie(res: ServerResponse, name: string, value: string, maxAge: number): void {
  res.appendHeader(
    'Set-Cookie',
    `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${PARTNERS_SECURE ? '; Secure' : ''}`,
  );
}

function sign(payload: Payload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${hmac(body)}`;
}

export function startOwnerSession(res: ServerResponse, email: string): void {
  const exp = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  setCookie(res, SESSION_COOKIE, sign({ k: 'owner', email, exp }), SESSION_SECONDS);
}

export function startAccountSession(res: ServerResponse, account: Account): void {
  const exp = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  setCookie(res, SESSION_COOKIE, sign({ k: 'acct', id: account.id, v: account.session_version, exp }), SESSION_SECONDS);
}

export function endSession(res: ServerResponse): void {
  setCookie(res, SESSION_COOKIE, '', 0);
}

/**
 * Se revalida en cada petición: una cuenta desactivada o con contraseña cambiada
 * (session_version distinto) pierde la sesión de inmediato.
 */
export function viewer(req: IncomingMessage): Viewer | null {
  const [body, sig] = (readCookies(req)[SESSION_COOKIE] ?? '').split('.');
  if (!body || !sig) return null;
  const expected = Buffer.from(hmac(body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let p: Payload;
  try {
    p = JSON.parse(Buffer.from(body, 'base64url').toString());
  } catch {
    return null;
  }
  if (!(p.exp > Date.now() / 1000)) return null;
  if (p.k === 'owner') {
    return p.email === SUPERADMIN_EMAIL ? { kind: 'owner', email: p.email, name: 'DeerSystems' } : null;
  }
  const a = getAccount(p.id);
  if (!a || !a.active || a.session_version !== p.v) return null;
  if (a.role === 'team') return { kind: 'team', email: a.email, name: a.name, account: a };
  if (a.client_id === null) return null;
  return { kind: 'client', email: a.email, name: a.name, account: a, clientId: a.client_id };
}

// ───────── Límite de intentos ─────────

const attempts = new Map<string, { count: number; until: number }>();

/** Máximo 8 intentos fallidos por clave en 15 minutos. */
export function rateLimited(key: string): boolean {
  const a = attempts.get(key);
  if (!a || a.until < Date.now()) return false;
  return a.count >= 8;
}

export function recordFailure(key: string): void {
  const a = attempts.get(key);
  if (!a || a.until < Date.now()) attempts.set(key, { count: 1, until: Date.now() + 15 * 60_000 });
  else a.count++;
  if (attempts.size > 10_000) {
    for (const [k, v] of attempts) if (v.until < Date.now()) attempts.delete(k);
  }
}

export const clearFailures = (key: string) => attempts.delete(key);

export function clientIp(req: IncomingMessage): string {
  // Detrás del proxy de Dokploy (Traefik) la IP real llega en X-Forwarded-For.
  const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  return fwd || req.socket.remoteAddress || '?';
}
