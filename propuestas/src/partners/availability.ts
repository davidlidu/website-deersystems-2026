import { db as sqlite } from '../db.ts';
import * as google from '../google.ts';
import { HttpError } from '../http.ts';
import type { DraftMeeting } from './extract.ts';

/**
 * Disponibilidad para agendar: lo ocupado en tu Google Calendar más las reuniones programadas en Partners.
 * Ninguna reunión (agendada a mano, editada o propuesta en el plan de una propuesta) puede cruzarse con otra;
 * si choca, se sugiere el siguiente horario libre dentro del horario laboral.
 */

/** Horario laboral para sugerir: lunes a viernes, 8:00 a. m. a 6:00 p. m. (Colombia, -05:00 todo el año). */
const WORK_FROM = 8 * 60;
const WORK_TO = 18 * 60;
const STEP = 15 * 60_000;
const DAY = 86_400_000;
const OFFSET = 5 * 3_600_000;

export interface Busy {
  start: number;
  end: number;
  title: string;
}

export interface Slot {
  date: string;
  time: string;
  durationMinutes: number;
}

const at = (date: string, time: string) => new Date(`${date}T${time}:00-05:00`).getTime();
/** Instante → fecha y hora de Colombia. */
export function bogota(ms: number): { date: string; time: string } {
  const iso = new Date(ms - OFFSET).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}
const label = (ms: number) =>
  new Date(ms).toLocaleString('es-CO', { timeZone: 'America/Bogota', weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });
const hour = (ms: number) => new Date(ms).toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: 'numeric', minute: '2-digit' });

/** Lo ocupado entre dos instantes. `excludeMeetingId`: la reunión que se está editando no choca consigo misma. */
export async function busyBetween(from: number, to: number, excludeMeetingId?: number | null): Promise<Busy[]> {
  const rows = sqlite
    .prepare("SELECT id, event_id, title, start_at, end_at FROM meetings WHERE status = 'programada' AND start_at < ? AND end_at > ?")
    .all(new Date(to).toISOString(), new Date(from).toISOString()) as { id: number; event_id: string | null; title: string; start_at: string; end_at: string }[];
  const skipEvent = excludeMeetingId ? rows.find((r) => r.id === excludeMeetingId)?.event_id : null;
  const seen = new Set<string>();
  const out: Busy[] = [];
  for (const r of rows) {
    if (r.id === excludeMeetingId) continue;
    if (r.event_id) seen.add(r.event_id);
    out.push({ start: Date.parse(r.start_at), end: Date.parse(r.end_at), title: r.title });
  }
  if (google.connectionStatus().connected) {
    try {
      for (const e of await google.calendarEvents(new Date(from).toISOString(), new Date(to).toISOString())) {
        // Fuera: cancelados, de día completo, marcados como "disponible" y los que rechazaste.
        if (e.status === 'cancelled' || !e.start?.dateTime || !e.end?.dateTime || e.transparency === 'transparent') continue;
        if (e.attendees?.some((a) => a.self && a.responseStatus === 'declined')) continue;
        if (e.id === skipEvent || seen.has(e.id)) continue;
        out.push({ start: Date.parse(e.start.dateTime), end: Date.parse(e.end.dateTime), title: e.summary || 'Ocupado' });
      }
    } catch (err) {
      // Sin Calendar se revisa al menos contra las reuniones de Partners.
      console.warn('Disponibilidad sin Google Calendar:', (err as Error).message);
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

const clash = (busy: Busy[], start: number, end: number) => busy.find((b) => b.start < end && b.end > start);

/** Siguiente inicio libre desde `from` en horario laboral, en pasos de 15 minutos, hasta 30 días después. */
export function nextFree(busy: Busy[], from: number, minutes: number): number | null {
  let t = Math.ceil(Math.max(from, Date.now()) / STEP) * STEP;
  const limit = t + 30 * DAY;
  while (t < limit) {
    const local = new Date(t - OFFSET);
    const mins = local.getUTCHours() * 60 + local.getUTCMinutes();
    const weekday = local.getUTCDay();
    const dayStart = t - mins * 60_000;
    if (weekday === 0 || weekday === 6 || mins + minutes > WORK_TO) t = dayStart + DAY + WORK_FROM * 60_000;
    else if (mins < WORK_FROM) t = dayStart + WORK_FROM * 60_000;
    else {
      const c = clash(busy, t, t + minutes * 60_000);
      if (!c) return t;
      t = Math.ceil(c.end / STEP) * STEP;
    }
  }
  return null;
}

export interface SlotCheck {
  conflict: { title: string; start: string; end: string } | null;
  suggestion: { date: string; time: string } | null;
}

/**
 * Revisa varios horarios de una vez (p. ej. las reuniones del plan): cada uno contra el calendario y contra los
 * anteriores de la lista. También devuelve lo ocupado en cada fecha pedida, para mostrarlo en el formulario.
 */
export async function checkSlots(slots: Slot[], excludeMeetingId?: number | null): Promise<{ slots: SlotCheck[]; days: Record<string, { start: string; end: string; title: string }[]> }> {
  const valid = slots.filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.date) && /^\d{2}:\d{2}$/.test(s.time));
  if (!valid.length) return { slots: slots.map(() => ({ conflict: null, suggestion: null })), days: {} };
  const starts = valid.map((s) => at(s.date, s.time));
  const busy = await busyBetween(Math.min(...starts) - DAY, Math.max(...starts) + 31 * DAY, excludeMeetingId);
  const days: Record<string, { start: string; end: string; title: string }[]> = {};
  for (const s of valid) {
    const d0 = at(s.date, '00:00');
    days[s.date] = busy.filter((b) => b.start < d0 + DAY && b.end > d0).map((b) => ({ start: hour(b.start), end: hour(b.end), title: b.title }));
  }
  const taken = [...busy];
  const out = slots.map((s): SlotCheck => {
    if (!valid.includes(s)) return { conflict: null, suggestion: null };
    const start = at(s.date, s.time);
    const end = start + s.durationMinutes * 60_000;
    const c = clash(taken, start, end);
    const next = c ? nextFree(taken, start, s.durationMinutes) : null;
    // Lo que queda (el horario pedido o el sugerido) ya no está libre para los siguientes de la lista.
    const kept = c ? next : start;
    if (kept !== null) taken.push({ start: kept, end: kept + s.durationMinutes * 60_000, title: 'Otra reunión de este plan' });
    return {
      conflict: c ? { title: c.title, start: hour(c.start), end: hour(c.end) } : null,
      suggestion: next !== null ? bogota(next) : null,
    };
  });
  return { slots: out, days };
}

/** Antes de crear o mover una reunión: si el horario está ocupado, no se agenda y se dice cuál es el siguiente libre. */
export async function assertFree(start: Date, end: Date, excludeMeetingId?: number | null): Promise<void> {
  const minutes = Math.round((end.getTime() - start.getTime()) / 60_000);
  const busy = await busyBetween(start.getTime() - DAY, start.getTime() + 31 * DAY, excludeMeetingId);
  const c = clash(busy, start.getTime(), end.getTime());
  if (!c) return;
  const next = nextFree(busy, start.getTime(), minutes);
  throw new HttpError(
    409,
    // "a. m." ya termina en punto.
    `Ese horario se cruza con «${c.title}» (${hour(c.start)} – ${hour(c.end)}).${next !== null ? ` Siguiente horario libre: ${label(next)}.` : ''}`.replace(/\.\.$/, '.'),
  );
}

/**
 * Las reuniones que propone el plan de una propuesta no pueden caer en horarios ocupados: las que chocan se mueven
 * al siguiente horario libre. Devuelve los cambios hechos, para mostrarlos.
 */
export async function placeMeetings(meetings: DraftMeeting[]): Promise<string[]> {
  const dated = meetings.filter((m) => m.date);
  if (!dated.length) return [];
  const { slots } = await checkSlots(dated.map((m) => ({ date: m.date!, time: m.time, durationMinutes: m.durationMinutes })));
  const changes: string[] = [];
  dated.forEach((m, i) => {
    const s = slots[i];
    if (!s.conflict || !s.suggestion) return;
    m.date = s.suggestion.date;
    m.time = s.suggestion.time;
    changes.push(`«${m.title}» se movió al ${label(at(m.date, m.time))}: el horario propuesto se cruzaba con «${s.conflict.title}».`);
  });
  return changes;
}
