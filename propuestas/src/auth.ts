import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, PUBLIC_URL, SECURE, SESSION_SECRET } from './config.ts';
import { isAllowed } from './db.ts';

const SESSION_COOKIE = 'ds_session';
const STATE_COOKIE = 'ds_oauth';
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const REDIRECT_URI = `${PUBLIC_URL}/auth/google/callback`;

const hmac = (value: string) => createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');

function cookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function cookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${SECURE ? '; Secure' : ''}`;
}

/** Correo de la sesión activa, o null. Se revalida contra la lista de autorizados en cada petición. */
export function sessionEmail(req: IncomingMessage): string | null {
  const [body, sig] = (cookies(req)[SESSION_COOKIE] ?? '').split('.');
  if (!body || !sig) return null;
  const expected = Buffer.from(hmac(body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const { email, exp } = JSON.parse(Buffer.from(body, 'base64url').toString());
    return typeof email === 'string' && exp > Date.now() / 1000 && isAllowed(email) ? email : null;
  } catch {
    return null;
  }
}

export function startSession(res: ServerResponse, email: string): void {
  const exp = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const body = Buffer.from(JSON.stringify({ email, exp })).toString('base64url');
  res.appendHeader('Set-Cookie', cookie(SESSION_COOKIE, `${body}.${hmac(body)}`, SESSION_SECONDS));
}

export function endSession(res: ServerResponse): void {
  res.appendHeader('Set-Cookie', cookie(SESSION_COOKIE, '', 0));
}

export const googleConfigured = () => !!GOOGLE_CLIENT_ID && !!GOOGLE_CLIENT_SECRET;

/** URL de consentimiento de Google; deja el state en una cookie para validarlo al volver. */
export function googleAuthUrl(res: ServerResponse): string {
  const state = randomBytes(24).toString('base64url');
  res.appendHeader('Set-Cookie', cookie(STATE_COOKIE, state, 600));
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email',
    state,
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export type GoogleResult = { email: string } | { error: 'state' | 'google' | 'unauthorized' };

/** Canjea el código de Google y devuelve el correo verificado si está autorizado. */
export async function googleCallback(req: IncomingMessage, res: ServerResponse, query: URLSearchParams): Promise<GoogleResult> {
  const expected = cookies(req)[STATE_COOKIE];
  res.appendHeader('Set-Cookie', cookie(STATE_COOKIE, '', 0));
  const code = query.get('code');
  if (!expected || query.get('state') !== expected) return { error: 'state' };
  if (!code) return { error: 'google' };

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });
  if (!r.ok) return { error: 'google' };
  // El id_token llega directo de Google por TLS, así que basta con leer sus claims.
  const { id_token } = (await r.json()) as { id_token?: string };
  const claims = JSON.parse(Buffer.from(id_token?.split('.')[1] ?? '', 'base64url').toString() || '{}');
  if (claims.aud !== GOOGLE_CLIENT_ID || claims.email_verified !== true || typeof claims.email !== 'string') {
    return { error: 'google' };
  }
  const email = claims.email.toLowerCase();
  return isAllowed(email) ? { email } : { error: 'unauthorized' };
}
