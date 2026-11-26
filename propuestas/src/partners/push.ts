import type { IncomingMessage, ServerResponse } from 'node:http';
import webpush from 'web-push';
import { PARTNERS_URL, SUPERADMIN_EMAIL } from '../config.ts';
import { db as sqlite } from '../db.ts';
import { HttpError, json, readJson } from '../http.ts';
import type { Viewer } from './auth.ts';
import { str } from './common.ts';
import * as db from './db.ts';

/**
 * Notificaciones push (Web Push) en los dispositivos donde cada persona las activa: el celular, el iPad (con la app
 * agregada a inicio) o el Mac. Llegan aunque la app esté cerrada, con los mismos avisos de la campana.
 * Las claves VAPID se crean solas la primera vez y quedan guardadas; cambiarlas obligaría a volver a activarlas.
 */

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient_kind TEXT NOT NULL,
    recipient_id INTEGER,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    device TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    last_ok_at TEXT
  );
  CREATE INDEX IF NOT EXISTS push_subscriptions_recipient ON push_subscriptions(recipient_kind, recipient_id);
`);

interface Keys {
  publicKey: string;
  privateKey: string;
}

function vapid(): Keys {
  let keys = db.getSetting<Keys>('push_vapid');
  if (!keys?.publicKey || !keys.privateKey) {
    keys = webpush.generateVAPIDKeys();
    db.setSetting('push_vapid', keys);
  }
  return keys;
}

let configured = false;
function configure(): void {
  if (configured) return;
  const k = vapid();
  webpush.setVapidDetails(`mailto:${SUPERADMIN_EMAIL}`, k.publicKey, k.privateKey);
  configured = true;
}

interface Row {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}

const recipientOf = (v: Viewer): db.Recipient => (v.kind === 'owner' ? { kind: 'owner' } : { kind: 'account', id: v.account.id });
const where = (r: db.Recipient) =>
  r.kind === 'owner' ? { sql: "recipient_kind = 'owner'", params: [] as number[] } : { sql: "recipient_kind = 'account' AND recipient_id = ?", params: [r.id] };

/** Envía el aviso a todos los dispositivos de esa persona. Los que ya no existen (desinstaló, revocó) se borran. */
export function pushTo(r: db.Recipient, n: { title: string; body: string; path: string; tag?: string }): void {
  const w = where(r);
  const subs = sqlite.prepare(`SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE ${w.sql}`).all(...w.params) as unknown as Row[];
  if (!subs.length) return;
  configure();
  const payload = JSON.stringify({ title: n.title, body: n.body, url: `${PARTNERS_URL}${n.path}`, tag: n.tag });
  for (const s of subs) {
    webpush
      .sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 24 * 3600, urgency: 'normal' })
      .then(() => sqlite.prepare('UPDATE push_subscriptions SET last_ok_at = ? WHERE id = ?').run(new Date().toISOString(), s.id))
      .catch((err: { statusCode?: number; message?: string }) => {
        if (err.statusCode === 404 || err.statusCode === 410) sqlite.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id);
        else console.warn('Push no enviado:', err.statusCode ?? '', err.message ?? err);
      });
  }
}

export async function handlePush(route: string, req: IncomingMessage, res: ServerResponse, v: Viewer): Promise<boolean> {
  if (!route.includes(' push/')) return false;
  const r = recipientOf(v);
  switch (route) {
    // La clave pública para suscribirse y cuántos dispositivos tiene activos esta persona.
    case 'GET push/key': {
      const w = where(r);
      const n = (sqlite.prepare(`SELECT COUNT(*) AS n FROM push_subscriptions WHERE ${w.sql}`).get(...w.params) as { n: number }).n;
      json(res, 200, { publicKey: vapid().publicKey, devices: n });
      return true;
    }
    case 'POST push/subscribe': {
      if (v.kind !== 'owner' && v.preview) throw new HttpError(403, 'Viendo como otra persona no se pueden activar notificaciones.');
      const body = await readJson(req, 8000);
      const sub = (body.subscription ?? {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
      const endpoint = str(sub.endpoint, 1000);
      const p256dh = str(sub.keys?.p256dh, 200);
      const auth = str(sub.keys?.auth, 100);
      if (!/^https:\/\//.test(endpoint) || !p256dh || !auth) throw new HttpError(400, 'Suscripción no válida.');
      // El mismo dispositivo puede cambiar de persona (otra sesión): queda a nombre de quien la activó ahora.
      sqlite
        .prepare(
          `INSERT INTO push_subscriptions (recipient_kind, recipient_id, endpoint, p256dh, auth, device, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(endpoint) DO UPDATE SET recipient_kind = excluded.recipient_kind, recipient_id = excluded.recipient_id,
             p256dh = excluded.p256dh, auth = excluded.auth, device = excluded.device`,
        )
        .run(r.kind, r.kind === 'account' ? r.id : null, endpoint, p256dh, auth, str(req.headers['user-agent'], 200), new Date().toISOString());
      json(res, 200, { ok: true });
      return true;
    }
    case 'POST push/unsubscribe': {
      const body = await readJson(req, 4000);
      sqlite.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(str(body.endpoint, 1000));
      json(res, 200, { ok: true });
      return true;
    }
    case 'POST push/test': {
      pushTo(r, { title: 'Notificaciones activas', body: 'Así te llegarán los avisos de DeerSystems Partners.', path: '/', tag: 'test' });
      json(res, 200, { ok: true });
      return true;
    }
  }
  return false;
}
