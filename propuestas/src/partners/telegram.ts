import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PARTNERS_URL } from '../config.ts';
import { HttpError, json, readJson } from '../http.ts';
import { decrypt, encrypt, mask } from '../secrets.ts';
import type { Viewer } from './auth.ts';
import { requireOwner } from './common.ts';
import * as db from './db.ts';

/**
 * Avisos al superadmin por Telegram. Tú creas un bot con @BotFather, pegas aquí su token y le escribes
 * /start con un código: así sabemos a qué chat mandarle los avisos. Sin webhook: el chat se busca con getUpdates.
 */
interface Stored {
  token: string | null;
  botUsername: string | null;
  chatId: string | null;
  chatName: string | null;
  /** Código que hay que mandarle al bot para vincular el chat. */
  linkCode: string | null;
}

const EMPTY: Stored = { token: null, botUsername: null, chatId: null, chatName: null, linkCode: null };
const load = (): Stored => ({ ...EMPTY, ...(db.getSetting<Partial<Stored>>('telegram') ?? {}) });
const save = (s: Stored) => db.setSetting('telegram', s);
const token = () => decrypt(load().token);

async function call<T>(method: string, body: Record<string, unknown>, tk = token()): Promise<T> {
  if (!tk) throw new HttpError(400, 'Primero guarda el token del bot.');
  let res: Response;
  try {
    res = await fetch(`https://api.telegram.org/bot${tk}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new HttpError(502, 'No se pudo conectar con Telegram.');
  }
  const out = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
  if (!out.ok) {
    if (res.status === 401 || res.status === 404) throw new HttpError(400, 'Telegram no reconoce ese token. Cópialo de nuevo desde @BotFather.');
    throw new HttpError(502, `Telegram: ${out.description ?? `error ${res.status}`}`);
  }
  return out.result as T;
}

export function isReady(): boolean {
  const s = load();
  return !!s.chatId && !!decrypt(s.token);
}

function status() {
  const s = load();
  const tk = decrypt(s.token);
  return {
    configured: !!tk,
    tokenHint: mask(tk),
    botUsername: s.botUsername,
    linked: !!tk && !!s.chatId,
    chatName: s.chatName,
    linkCode: tk && !s.chatId ? s.linkCode : null,
    linkUrl: tk && !s.chatId && s.botUsername && s.linkCode ? `https://t.me/${s.botUsername}?start=${s.linkCode}` : null,
  };
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Manda un aviso; nunca lanza (un aviso que falla no rompe la acción que lo disparó). */
export function sendAlert(a: { title: string; body?: string; path?: string }): void {
  if (!isReady()) return;
  const lines = [`<b>${esc(a.title)}</b>`];
  if (a.body) lines.push(esc(a.body));
  if (a.path) lines.push(`<a href="${esc(`${PARTNERS_URL}${a.path}`)}">Abrir en DeerSystems Partners</a>`);
  call('sendMessage', { chat_id: load().chatId, text: lines.join('\n'), parse_mode: 'HTML', disable_web_page_preview: true }).catch((err) =>
    console.error('No se pudo enviar el aviso por Telegram:', (err as Error).message),
  );
}

export async function handleTelegram(route: string, req: IncomingMessage, res: ServerResponse, v: Viewer): Promise<boolean> {
  switch (route) {
    case 'GET settings/telegram':
      requireOwner(v);
      json(res, 200, status());
      return true;

    // Guardar (o cambiar) el token: se valida con getMe y se genera el código para vincular el chat.
    case 'PUT settings/telegram': {
      requireOwner(v);
      const body = await readJson(req);
      const tk = typeof body.token === 'string' ? body.token.trim() : '';
      if (!/^\d+:[\w-]{20,}$/.test(tk)) throw new HttpError(400, 'Pega el token completo que te dio @BotFather (se ve como 123456789:AA…).');
      const me = await call<{ username: string }>('getMe', {}, tk);
      // Lo que el bot tenga pendiente no sirve para vincular: se descarta.
      const pending = await call<{ update_id: number }[]>('getUpdates', { timeout: 0 }, tk).catch(() => []);
      if (pending.length) await call('getUpdates', { offset: pending.at(-1)!.update_id + 1, timeout: 0 }, tk).catch(() => {});
      save({ token: encrypt(tk), botUsername: me.username, chatId: null, chatName: null, linkCode: randomBytes(6).toString('hex') });
      json(res, 200, status());
      return true;
    }

    // Después de mandarle /start al bot: se busca ese mensaje para saber el chat.
    case 'POST settings/telegram/link': {
      requireOwner(v);
      const s = load();
      if (!s.linkCode) throw new HttpError(400, 'Primero guarda el token del bot.');
      type Update = { update_id: number; message?: { text?: string; chat: { id: number; first_name?: string; username?: string; title?: string } } };
      const updates = await call<Update[]>('getUpdates', { timeout: 0, allowed_updates: ['message'] });
      const hit = updates.find((u) => u.message?.text?.trim() === `/start ${s.linkCode}`);
      if (updates.length) await call('getUpdates', { offset: updates.at(-1)!.update_id + 1, timeout: 0 }).catch(() => {});
      if (!hit?.message) throw new HttpError(404, 'Todavía no llega tu mensaje. Abre el enlace, toca «Iniciar» en Telegram y vuelve a intentarlo.');
      const chat = hit.message.chat;
      save({ ...s, chatId: String(chat.id), chatName: chat.title ?? chat.first_name ?? (chat.username ? `@${chat.username}` : 'tu chat'), linkCode: null });
      await call('sendMessage', { chat_id: chat.id, text: '✅ Listo: aquí te llegarán los avisos de DeerSystems Partners.' }).catch(() => {});
      json(res, 200, status());
      return true;
    }

    case 'POST settings/telegram/test': {
      requireOwner(v);
      const s = load();
      if (!s.chatId) throw new HttpError(400, 'Primero vincula tu chat.');
      await call('sendMessage', {
        chat_id: s.chatId,
        text: `<b>Aviso de prueba</b>\nAsí te llegarán los avisos de DeerSystems Partners.\n<a href="${esc(PARTNERS_URL)}">Abrir la plataforma</a>`,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
      json(res, 200, { ok: true });
      return true;
    }

    case 'POST settings/telegram/disconnect':
      requireOwner(v);
      save(EMPTY);
      json(res, 200, status());
      return true;
  }
  return false;
}
