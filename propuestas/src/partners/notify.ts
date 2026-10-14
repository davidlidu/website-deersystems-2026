import { PARTNERS_URL, SUPERADMIN_EMAIL } from '../config.ts';
import * as google from '../google.ts';
import { notificationDigest } from '../mail.ts';
import type { Viewer } from './auth.ts';
import * as db from './db.ts';

/**
 * Tipos de aviso. "staff" = te llega a ti y al equipo; "team" = a la persona del equipo asignada;
 * "client" = al cliente del proyecto. Cada uno se enciende o apaga en Configuración → Avisos.
 */
export const EVENTS = {
  client_comment: { audience: 'staff', label: 'El cliente comenta una tarea o deja una nota', app: true, email: true },
  client_status: { audience: 'staff', label: 'El cliente cambia el estado de una tarea', app: true, email: true },
  client_file: { audience: 'staff', label: 'El cliente sube un archivo', app: true, email: true },
  team_assigned: { audience: 'team', label: 'A alguien del equipo le asignan una tarea', app: true, email: true },
  client_task: { audience: 'client', label: 'Hay una tarea nueva para el cliente', app: true, email: true },
  staff_update: { audience: 'client', label: 'DeerSystems publica un avance', app: true, email: true },
  staff_comment: { audience: 'client', label: 'DeerSystems comenta o deja una nota compartida', app: true, email: true },
  staff_file: { audience: 'client', label: 'DeerSystems comparte un archivo', app: true, email: false },
  meeting_draft: { audience: 'owner', label: 'Hay un resumen de reunión listo para revisar', app: true, email: true },
  meeting_summary: { audience: 'client', label: 'Se aprueba el resumen de una reunión (además del correo con el resumen)', app: true, email: false },
} as const;

export type EventType = keyof typeof EVENTS;

export interface NotifySettings {
  events: Record<EventType, { app: boolean; email: boolean }>;
  /** Los avisos del cliente también llegan por correo al equipo (si no, solo a ti). */
  teamEmail: boolean;
  /** Minutos que se esperan para juntar varios avisos en un solo correo. */
  digestMinutes: number;
}

const DEFAULTS: NotifySettings = {
  events: Object.fromEntries(Object.entries(EVENTS).map(([k, e]) => [k, { app: e.app, email: e.email }])) as NotifySettings['events'],
  teamEmail: false,
  digestMinutes: 3,
};

export function getSettings(): NotifySettings {
  const saved = db.getSetting<Partial<NotifySettings>>('notifications') ?? {};
  return { ...DEFAULTS, ...saved, events: { ...DEFAULTS.events, ...(saved.events ?? {}) } };
}

export function saveSettings(body: Record<string, unknown>): NotifySettings {
  const s = getSettings();
  if (body.events && typeof body.events === 'object') {
    for (const [k, v] of Object.entries(body.events as Record<string, { app?: unknown; email?: unknown }>)) {
      if (!(k in EVENTS) || !v) continue;
      const key = k as EventType;
      s.events[key] = {
        app: typeof v.app === 'boolean' ? v.app : s.events[key].app,
        email: typeof v.email === 'boolean' ? v.email : s.events[key].email,
      };
    }
  }
  if (typeof body.teamEmail === 'boolean') s.teamEmail = body.teamEmail;
  if (typeof body.digestMinutes === 'number') s.digestMinutes = Math.min(60, Math.max(1, Math.round(body.digestMinutes)));
  db.setSetting('notifications', s);
  return s;
}

export function recipientOf(v: Viewer): db.Recipient {
  return v.kind === 'owner' ? { kind: 'owner' } : { kind: 'account', id: v.account.id };
}

// ───────── Correo: se agrupan los avisos de unos minutos en un solo mensaje ─────────

interface Pending {
  name: string;
  client: boolean;
  items: { title: string; body: string; url: string }[];
}
const queue = new Map<string, Pending>();

function enqueueMail(to: string, name: string, client: boolean, item: Pending['items'][number], minutes: number): void {
  const pending = queue.get(to);
  if (pending) {
    pending.items.push(item);
    return;
  }
  queue.set(to, { name, client, items: [item] });
  setTimeout(() => flush(to), minutes * 60_000).unref();
}

async function flush(to: string): Promise<void> {
  const pending = queue.get(to);
  queue.delete(to);
  if (!pending?.items.length) return;
  if (!google.connectionStatus().connected) return console.warn(`Aviso por correo a ${to} sin enviar: Google no está conectado.`);
  try {
    await google.sendMail(notificationDigest({ to, name: pending.name, items: pending.items.slice(0, 20), client: pending.client }));
  } catch (err) {
    console.error(`No se pudo enviar el resumen de avisos a ${to}:`, (err as Error).message);
  }
}

/** Al apagar el servidor (despliegue), se envía lo que esté en cola en vez de perderlo. */
export async function flushAll(): Promise<void> {
  await Promise.all([...queue.keys()].map(flush));
}

// ───────── Disparar un aviso ─────────

interface Target {
  recipient: db.Recipient;
  email: string | null;
  name: string;
  client: boolean;
}

export function notify(
  type: EventType,
  ctx: {
    /** null = lo dispara el sistema (p. ej. la sincronización de reuniones). */
    actor: Viewer | null;
    projectId: number | null;
    taskId?: number | null;
    title: string;
    body?: string;
    /** Ruta dentro de partners, p. ej. /proyectos/3?tarea=12 */
    path: string;
    /** Para team_assigned: la cuenta del equipo asignada. */
    accountId?: number;
  },
): void {
  try {
    const s = getSettings();
    const pref = s.events[type];
    if (!pref.app && !pref.email) return;
    const audience = EVENTS[type].audience;
    const project = ctx.projectId ? db.getProject(ctx.projectId) : undefined;
    // Solo los avisos para ti pueden no tener proyecto (p. ej. una reunión aún sin asociar).
    if (!project && audience !== 'owner') return;
    const actorAccount = !ctx.actor || ctx.actor.kind === 'owner' ? null : ctx.actor.account.id;
    const targets: Target[] = [];

    if (audience === 'owner') {
      targets.push({ recipient: { kind: 'owner' }, email: SUPERADMIN_EMAIL, name: '', client: false });
    } else if (audience === 'staff') {
      if (ctx.actor?.kind !== 'owner') targets.push({ recipient: { kind: 'owner' }, email: SUPERADMIN_EMAIL, name: '', client: false });
      for (const a of db.listTeam()) {
        if (!a.active || a.id === actorAccount) continue;
        targets.push({ recipient: { kind: 'account', id: a.id }, email: s.teamEmail ? a.email : null, name: a.name, client: false });
      }
    } else if (audience === 'team' && ctx.accountId && ctx.accountId !== actorAccount) {
      const a = db.getAccount(ctx.accountId);
      if (a?.active && a.role === 'team') targets.push({ recipient: { kind: 'account', id: a.id }, email: a.email, name: a.name, client: false });
    } else if (audience === 'client' && project && ctx.actor?.kind !== 'client') {
      const a = db.getClientAccount(project.client_id);
      if (a?.active) targets.push({ recipient: { kind: 'account', id: a.id }, email: a.email, name: a.name, client: true });
    }

    const body = (ctx.body ?? '').replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
    for (const t of targets) {
      if (pref.app) {
        db.createNotification(t.recipient, {
          projectId: project?.id ?? null,
          taskId: ctx.taskId,
          type,
          title: ctx.title,
          body,
          link: ctx.path,
          collapse: type === 'client_status',
        });
      }
      if (pref.email && t.email) {
        enqueueMail(t.email, t.name, t.client, { title: ctx.title, body: body || (project?.name ?? ''), url: `${PARTNERS_URL}${ctx.path}` }, s.digestMinutes);
      }
    }
  } catch (err) {
    // Un aviso que falla nunca debe romper la acción que lo disparó.
    console.error('No se pudo registrar el aviso:', err);
  }
}
