import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, PARTNERS_URL } from './config.ts';
import { deleteSetting, getSetting, setSetting } from './partners/db.ts';
import { decrypt, encrypt } from './secrets.ts';

export const REDIRECT_URI = `${PARTNERS_URL}/auth/google/callback`;

/**
 * Permisos que pide "Conectar Google". Se piden todos de una vez para no tener que reconectar en
 * cada fase: Gmail (enviar), Drive (solo archivos que crea la app), Calendar (leer y crear eventos) y Meet (transcripciones).
 */
export const CONNECT_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/calendar.events',
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

/** ¿La cuenta conectada tiene alguno de estos permisos? (p. ej. calendar.events o el antiguo calendar.readonly) */
export function hasAnyScope(...scopes: string[]): boolean {
  const c = getSetting<Connection>('google');
  return !!c && scopes.some((s) => c.scopes.includes(`https://www.googleapis.com/auth/${s}`));
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
  /** Adjuntos (p. ej. el PDF de la cuenta de cobro). Con `cid`, va en línea dentro del HTML (src="cid:…"). */
  attachments?: { name: string; mime: string; data: Buffer; cid?: string }[];
}

/** Envía desde la cuenta conectada (normalmente ceo@deersystems.net). */
export async function sendMail(mail: Mail): Promise<void> {
  const from = getSetting<Connection>('google')?.email;
  const boundary = `ds-${Date.now().toString(36)}`;
  const body = [
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
  ];
  const head = [
    `From: ${header('DeerSystems')} <${from}>`,
    `To: ${mail.to}`,
    `Subject: ${header(mail.subject)}`,
    ...(mail.replyTo ? [`Reply-To: ${mail.replyTo}`] : []),
    'MIME-Version: 1.0',
  ];
  let raw: string;
  const b64lines = (d: Buffer) => d.toString('base64').replace(/.{76}/g, '$&\r\n');
  const inline = (mail.attachments ?? []).filter((a) => a.cid);
  const files = (mail.attachments ?? []).filter((a) => !a.cid);
  if (inline.length || files.length) {
    // multipart/mixed → [multipart/related → (multipart/alternative: texto + HTML) + imágenes en línea] + adjuntos.
    const mixed = `${boundary}-m`;
    const related = `${boundary}-r`;
    const content = inline.length
      ? [
          `Content-Type: multipart/related; boundary="${related}"`,
          '',
          `--${related}`,
          `Content-Type: multipart/alternative; boundary="${boundary}"`,
          '',
          ...body,
          ...inline.flatMap((a) => [
            `--${related}`,
            `Content-Type: ${a.mime}; name="${header(a.name)}"`,
            `Content-ID: <${a.cid}>`,
            `Content-Disposition: inline; filename="${header(a.name)}"`,
            'Content-Transfer-Encoding: base64',
            '',
            b64lines(a.data),
          ]),
          `--${related}--`,
        ]
      : [`Content-Type: multipart/alternative; boundary="${boundary}"`, '', ...body];
    raw = [
      ...head,
      `Content-Type: multipart/mixed; boundary="${mixed}"`,
      '',
      `--${mixed}`,
      ...content,
      ...files.flatMap((a) => [
        `--${mixed}`,
        `Content-Type: ${a.mime}; name="${header(a.name)}"`,
        `Content-Disposition: attachment; filename="${header(a.name)}"`,
        'Content-Transfer-Encoding: base64',
        '',
        b64lines(a.data),
      ]),
      `--${mixed}--`,
    ].join('\r\n');
  } else {
    raw = [...head, `Content-Type: multipart/alternative; boundary="${boundary}"`, '', ...body].join('\r\n');
  }

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

// ───────── Drive ─────────
// Con el permiso drive.file la app solo ve lo que ella misma crea: la carpeta
// "DeerSystems Partners" y lo que hay dentro. El resto de tu Drive queda fuera de su alcance.

const DRIVE = 'https://www.googleapis.com/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';

async function driveFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${await accessToken()}`, ...init.headers } });
  if (!r.ok && r.status !== 404) {
    const data = (await r.clone().json().catch(() => ({}))) as { error?: { message?: string } };
    throw new GoogleError(`Drive ${r.status}: ${data.error?.message ?? 'error'}`);
  }
  return r;
}

/** ¿La carpeta sigue existiendo y no está en la papelera? */
async function folderAlive(id: string | null | undefined): Promise<boolean> {
  if (!id) return false;
  const r = await driveFetch(`${DRIVE}/files/${encodeURIComponent(id)}?fields=id,trashed`);
  if (r.status === 404) return false;
  const f = (await r.json()) as { trashed?: boolean };
  return !f.trashed;
}

async function createFolder(name: string, parent?: string): Promise<{ id: string; webViewLink: string }> {
  const r = await driveFetch(`${DRIVE}/files?fields=id,webViewLink`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER, ...(parent ? { parents: [parent] } : {}) }),
  });
  return (await r.json()) as { id: string; webViewLink: string };
}

/** Carpeta raíz "DeerSystems Partners" en el Drive de la cuenta conectada. */
export async function rootFolder(): Promise<{ id: string; url: string }> {
  const saved = getSetting<{ id: string; url: string }>('drive');
  if (saved && (await folderAlive(saved.id))) return saved;
  const f = await createFolder('DeerSystems Partners');
  const root = { id: f.id, url: f.webViewLink };
  setSetting('drive', root);
  return root;
}

export const driveRoot = () => getSetting<{ id: string; url: string }>('drive');

/** Devuelve la carpeta guardada si sigue viva; si no, la crea dentro de `parent` y avisa con `save`. */
export async function ensureFolder(saved: string | null, name: string, parent: string, save: (id: string) => void): Promise<string> {
  if (await folderAlive(saved)) return saved!;
  const f = await createFolder(name.replace(/[\\/]/g, '-').slice(0, 120) || 'Sin nombre', parent);
  save(f.id);
  return f.id;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size: string;
  webViewLink: string;
}

/** Subida reanudable (sirve para archivos grandes) a una carpeta. */
export async function uploadFile(folderId: string, name: string, mime: string, data: Buffer): Promise<DriveFile> {
  const init = await driveFetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size,webViewLink`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mime,
      'X-Upload-Content-Length': String(data.length),
    },
    body: JSON.stringify({ name, parents: [folderId] }),
  });
  const location = init.headers.get('location');
  if (!location) throw new GoogleError('Drive no aceptó la subida.');
  const r = await fetch(location, { method: 'PUT', headers: { 'Content-Type': mime }, body: new Uint8Array(data) });
  if (!r.ok) throw new GoogleError(`Drive ${r.status}: no se pudo subir el archivo.`);
  return (await r.json()) as DriveFile;
}

/** Descarga el contenido (para reenviarlo al navegador sin exponer el Drive). */
export async function downloadFile(fileId: string): Promise<Response> {
  const r = await driveFetch(`${DRIVE}/files/${encodeURIComponent(fileId)}?alt=media`);
  if (r.status === 404) throw new GoogleError('El archivo ya no está en Drive.');
  return r;
}

/** Va a la papelera de Drive, no se borra: se puede recuperar desde ahí por 30 días. */
export async function trashFile(fileId: string): Promise<void> {
  await driveFetch(`${DRIVE}/files/${encodeURIComponent(fileId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  });
}

export const fileUrl = (fileId: string) => `https://drive.google.com/file/d/${fileId}/view`;

// ───────── Calendar ─────────

export interface CalendarEvent {
  id: string;
  status?: string;
  summary?: string;
  htmlLink?: string;
  hangoutLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { email?: string; displayName?: string; responseStatus?: string; self?: boolean; organizer?: boolean }[];
  conferenceData?: { conferenceId?: string; conferenceSolution?: { key?: { type?: string } } };
  extendedProperties?: { private?: Record<string, string> };
}

/**
 * Crea la reunión en tu Google Calendar con enlace de Meet y envía la invitación a los asistentes.
 * Queda marcada (extendedProperties) como agendada desde la plataforma y con su proyecto.
 */
export async function createCalendarEvent(e: {
  summary: string;
  description: string;
  startIso: string;
  endIso: string;
  attendees: string[];
  privateProps: Record<string, string>;
}): Promise<CalendarEvent> {
  const params = new URLSearchParams({ conferenceDataVersion: '1', sendUpdates: 'all' });
  const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary: e.summary,
      description: e.description,
      start: { dateTime: e.startIso, timeZone: 'America/Bogota' },
      end: { dateTime: e.endIso, timeZone: 'America/Bogota' },
      attendees: e.attendees.map((email) => ({ email })),
      conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } },
      extendedProperties: { private: e.privateProps },
      guestsCanModify: false,
      reminders: { useDefault: true },
    }),
  });
  const data = (await r.json().catch(() => ({}))) as CalendarEvent & { error?: { message?: string } };
  if (!r.ok) {
    const hint = r.status === 403 ? ' Vuelve a conectar Google en Configuración para dar el permiso de crear eventos.' : '';
    throw new GoogleError(`Calendar ${r.status}: ${data.error?.message ?? 'no se pudo crear la reunión'}.${hint}`);
  }
  return data;
}

/** Cancela el evento y avisa a los invitados. */
export async function cancelCalendarEvent(eventId: string): Promise<void> {
  const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${await accessToken()}` },
  });
  if (!r.ok && r.status !== 404 && r.status !== 410) {
    const data = (await r.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new GoogleError(`Calendar ${r.status}: ${data.error?.message ?? 'no se pudo cancelar'}`);
  }
}

/** Eventos del calendario principal de la cuenta conectada, con las recurrencias expandidas. */
export async function calendarEvents(timeMin: string, timeMax: string): Promise<CalendarEvent[]> {
  const out: CalendarEvent[] = [];
  let pageToken = '';
  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
      showDeleted: 'true',
      ...(pageToken ? { pageToken } : {}),
    });
    const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
      headers: { Authorization: `Bearer ${await accessToken()}` },
    });
    const data = (await r.json().catch(() => ({}))) as { items?: CalendarEvent[]; nextPageToken?: string; error?: { message?: string } };
    if (!r.ok) throw new GoogleError(`Calendar ${r.status}: ${data.error?.message ?? 'error'}`);
    out.push(...(data.items ?? []));
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return out;
}

// ───────── Meet: grabaciones y transcripciones ─────────

const MEET = 'https://meet.googleapis.com/v2';

async function meetGet<T>(path: string): Promise<T> {
  const r = await fetch(`${MEET}/${path}`, { headers: { Authorization: `Bearer ${await accessToken()}` } });
  const data = (await r.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!r.ok) throw new GoogleError(`Meet ${r.status}: ${data.error?.message ?? 'error'}`);
  return data;
}

async function meetAll<T>(path: string, key: string): Promise<T[]> {
  const out: T[] = [];
  let pageToken = '';
  for (let page = 0; page < 50; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const data = await meetGet<Record<string, unknown>>(`${path}${sep}pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`);
    out.push(...((data[key] as T[] | undefined) ?? []));
    pageToken = (data.nextPageToken as string | undefined) ?? '';
    if (!pageToken) break;
  }
  return out;
}

export type TranscriptResult =
  | { state: 'ready'; record: string; text: string; docUrl: string | null }
  | { state: 'pending' | 'none'; record: string | null };

/**
 * Busca la transcripción de una reunión por su código de Meet (abc-defg-hij) cerca de la hora de inicio.
 * "pending": la reunión existe pero la transcripción aún se está generando; "none": no se transcribió.
 */
export async function meetTranscript(meetingCode: string, startIso: string): Promise<TranscriptResult> {
  const since = new Date(new Date(startIso).getTime() - 3 * 3600_000).toISOString();
  const filter = `space.meeting_code = "${meetingCode}" AND start_time >= "${since}"`;
  const records = await meetAll<{ name: string; startTime: string; endTime?: string }>(
    `conferenceRecords?filter=${encodeURIComponent(filter)}`,
    'conferenceRecords',
  );
  if (!records.length) return { state: 'none', record: null };
  // La sesión que empezó más cerca de la hora agendada.
  const target = new Date(startIso).getTime();
  records.sort((a, b) => Math.abs(new Date(a.startTime).getTime() - target) - Math.abs(new Date(b.startTime).getTime() - target));
  const record = records[0];
  if (!record.endTime) return { state: 'pending', record: record.name };

  const transcripts = await meetAll<{ name: string; state: string; docsDestination?: { exportUri?: string } }>(
    `${record.name}/transcripts`,
    'transcripts',
  );
  const done = transcripts.find((t) => t.state === 'FILE_GENERATED' || t.state === 'ENDED');
  if (!done) return { state: transcripts.length ? 'pending' : 'none', record: record.name };

  const participants = await meetAll<{
    name: string;
    signedinUser?: { displayName?: string };
    anonymousUser?: { displayName?: string };
    phoneUser?: { displayName?: string };
  }>(`${record.name}/participants`, 'participants');
  const names = new Map(
    participants.map((p) => [p.name, p.signedinUser?.displayName ?? p.anonymousUser?.displayName ?? p.phoneUser?.displayName ?? 'Participante']),
  );
  const entries = await meetAll<{ participant?: string; text?: string; startTime?: string }>(`${done.name}/entries`, 'transcriptEntries');
  if (!entries.length) return { state: done.state === 'FILE_GENERATED' ? 'none' : 'pending', record: record.name };

  // Une las intervenciones seguidas de la misma persona: "Laura: …".
  const lines: string[] = [];
  let last = '';
  for (const e of entries) {
    const who = names.get(e.participant ?? '') ?? 'Participante';
    const text = (e.text ?? '').trim();
    if (!text) continue;
    if (who === last) lines[lines.length - 1] += ` ${text}`;
    else lines.push(`${who}: ${text}`);
    last = who;
  }
  return { state: 'ready', record: record.name, text: lines.join('\n'), docUrl: done.docsDestination?.exportUri ?? null };
}

// ───────── Drive: compartir por enlace, metadatos y Google Picker ─────────

/**
 * Lectura para "cualquiera con el enlace" (sin aparecer en búsquedas). Así el cliente puede abrir el
 * archivo en el visor de Drive desde el portal, sin cuenta ni invitación. Se quita al volverlo interno.
 */
export async function setLinkSharing(fileId: string, on: boolean): Promise<void> {
  if (on) {
    await driveFetch(`${DRIVE}/files/${encodeURIComponent(fileId)}/permissions?sendNotificationEmail=false`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'anyone', role: 'reader', allowFileDiscovery: false }),
    });
  } else {
    await driveFetch(`${DRIVE}/files/${encodeURIComponent(fileId)}/permissions/anyoneWithLink`, { method: 'DELETE' });
  }
}

/** Metadatos de un archivo (por ejemplo, uno elegido con el Picker). */
export async function fileMeta(fileId: string): Promise<DriveFile> {
  const r = await driveFetch(`${DRIVE}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,webViewLink`);
  if (r.status === 404) throw new GoogleError('No se encontró el archivo en Drive (¿se eligió desde el selector?).');
  return (await r.json()) as DriveFile;
}

/** Documentos, hojas y presentaciones de Google no tienen archivo: se exportan a PDF para descargarlos. */
export const isGoogleNative = (mime: string) => mime.startsWith('application/vnd.google-apps.');

export async function exportPdf(fileId: string): Promise<Response> {
  const r = await driveFetch(`${DRIVE}/files/${encodeURIComponent(fileId)}/export?mimeType=application%2Fpdf`);
  if (r.status === 404) throw new GoogleError('El archivo ya no está en Drive.');
  return r;
}

/** Número del proyecto de Google Cloud: es el prefijo numérico del ID de cliente OAuth. */
export const cloudProjectNumber = () => /^(\d+)-/.exec(GOOGLE_CLIENT_ID)?.[1] ?? null;

export function pickerApiKey(): string | null {
  return getSetting<{ apiKey?: string }>('google_picker')?.apiKey || null;
}

export function savePickerApiKey(apiKey: string): void {
  setSetting('google_picker', { apiKey: apiKey.trim() });
}
