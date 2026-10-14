import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, PARTNERS_URL } from './config.ts';
import { deleteSetting, getSetting, setSetting } from './partners/db.ts';
import { decrypt, encrypt } from './secrets.ts';

export const REDIRECT_URI = `${PARTNERS_URL}/auth/google/callback`;

/**
 * Permisos que pide "Conectar Google". Se piden todos de una vez para no tener que reconectar en
 * cada fase: Gmail (enviar), Drive (solo archivos que crea la app), Calendar (leer) y Meet (transcripciones).
 */
export const CONNECT_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/meetings.space.readonly',
];

export function authUrl(state: string, mode: 'login' | 'connect'): string {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    state,
    scope: mode === 'connect' ? CONNECT_SCOPES.join(' ') : 'openid email',
    prompt: mode === 'connect' ? 'consent select_account' : 'select_account',
    ...(mode === 'connect' ? { access_type: 'offline', include_granted_scopes: 'true' } : {}),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

/** Canjea el código. Devuelve el correo verificado y, al conectar, el refresh token. */
export async function exchangeCode(code: string) {
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
  if (!r.ok) return null;
  const data = (await r.json()) as { id_token?: string; refresh_token?: string; access_token?: string; expires_in?: number; scope?: string };
  // El id_token llega directo de Google por TLS, así que basta con leer sus claims.
  const claims = JSON.parse(Buffer.from(data.id_token?.split('.')[1] ?? '', 'base64url').toString() || '{}');
  if (claims.aud !== GOOGLE_CLIENT_ID || claims.email_verified !== true || typeof claims.email !== 'string') return null;
  return {
    email: (claims.email as string).toLowerCase(),
    refreshToken: data.refresh_token ?? null,
    scopes: (data.scope ?? '').split(' ').filter(Boolean),
  };
}

interface Connection {
  email: string;
  refreshToken: string; // cifrado
  scopes: string[];
  connectedAt: string;
  error?: string;
}

export function saveConnection(email: string, refreshToken: string, scopes: string[]): void {
  setSetting('google', { email, refreshToken: encrypt(refreshToken), scopes, connectedAt: new Date().toISOString() });
  cached = null;
}

export function disconnect(): void {
  const c = getSetting<Connection>('google');
  const token = decrypt(c?.refreshToken);
  if (token) {
    // Revoca en Google; si falla, igual se olvida localmente.
    fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => {});
  }
  deleteSetting('google');
  cached = null;
}

export function connectionStatus() {
  const c = getSetting<Connection>('google');
  if (!c) return { connected: false as const };
  const missing = CONNECT_SCOPES.filter((s) => s.startsWith('https://') && !c.scopes.includes(s));
  return { connected: true as const, email: c.email, connectedAt: c.connectedAt, missingScopes: missing, error: c.error ?? null };
}

export class GoogleError extends Error {}

let cached: { token: string; expires: number } | null = null;

/** Access token vigente de la cuenta conectada; lo renueva con el refresh token cuando vence. */
export async function accessToken(): Promise<string> {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  const c = getSetting<Connection>('google');
  const refresh = decrypt(c?.refreshToken);
  if (!c || !refresh) throw new GoogleError('Google no está conectado. Conéctalo en Configuración.');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refresh,
      grant_type: 'refresh_token',
    }),
  });
  const data = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!r.ok || !data.access_token) {
    const error = data.error === 'invalid_grant' ? 'Google revocó el acceso. Vuelve a conectar la cuenta.' : `Google: ${data.error ?? r.status}`;
    setSetting('google', { ...c, error });
    throw new GoogleError(error);
  }
  if (c.error) setSetting('google', { ...c, error: undefined });
  cached = { token: data.access_token, expires: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return cached.token;
}

// ───────── Gmail ─────────

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
/** Encabezado con tildes y ñ (RFC 2047). */
const header = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

/** Envía desde la cuenta conectada (normalmente ceo@deersystems.net). */
export async function sendMail(mail: Mail): Promise<void> {
  const from = getSetting<Connection>('google')?.email;
  const boundary = `ds-${Date.now().toString(36)}`;
  const raw = [
    `From: ${header('DeerSystems')} <${from}>`,
    `To: ${mail.to}`,
    `Subject: ${header(mail.subject)}`,
    ...(mail.replyTo ? [`Reply-To: ${mail.replyTo}`] : []),
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(mail.text),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(mail.html),
    `--${boundary}--`,
  ].join('\r\n');

  const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: Buffer.from(raw).toString('base64url') }),
  });
  if (!r.ok) {
    const data = (await r.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new GoogleError(`Gmail no envió el correo: ${data.error?.message ?? r.status}`);
  }
}
