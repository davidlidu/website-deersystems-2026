/**
 * Festivos de Colombia (Ley 51 de 1983, «Ley Emiliani»), calculados para cualquier año: los mismos que publica
 * festivos.com.co, sin depender de que ese sitio esté en línea ni de que cambie su página.
 *
 * - Fijos: 1 de enero, 1 de mayo, 20 de julio, 7 de agosto, 8 y 25 de diciembre.
 * - Se pasan al lunes siguiente: Reyes (6 ene), San José (19 mar), San Pedro y San Pablo (29 jun),
 *   Asunción (15 ago), Día de la Raza (12 oct), Todos los Santos (1 nov) e Independencia de Cartagena (11 nov).
 * - Según la Pascua: Jueves y Viernes Santo, y (pasados a lunes) Ascensión, Corpus Christi y Sagrado Corazón.
 */

export interface Holiday {
  date: string;
  name: string;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
/** El mismo día si es lunes; si no, el lunes siguiente. */
const toMonday = (d: Date) => addDays(d, (8 - d.getUTCDay()) % 7);

/** Domingo de Pascua (algoritmo de Meeus/Jones/Butcher, calendario gregoriano). */
function easter(y: number): Date {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(y, month, day);
}

const cache = new Map<number, Holiday[]>();

export function holidaysOf(year: number): Holiday[] {
  const hit = cache.get(year);
  if (hit) return hit;
  const e = easter(year);
  const list: [Date, string][] = [
    [utc(year, 1, 1), 'Año Nuevo'],
    [toMonday(utc(year, 1, 6)), 'Día de los Reyes Magos'],
    [toMonday(utc(year, 3, 19)), 'Día de San José'],
    [addDays(e, -3), 'Jueves Santo'],
    [addDays(e, -2), 'Viernes Santo'],
    [utc(year, 5, 1), 'Día del Trabajo'],
    [toMonday(addDays(e, 39)), 'Ascensión del Señor'],
    [toMonday(addDays(e, 60)), 'Corpus Christi'],
    [toMonday(addDays(e, 68)), 'Sagrado Corazón de Jesús'],
    [toMonday(utc(year, 6, 29)), 'San Pedro y San Pablo'],
    [utc(year, 7, 20), 'Día de la Independencia'],
    [utc(year, 8, 7), 'Batalla de Boyacá'],
    [toMonday(utc(year, 8, 15)), 'Asunción de la Virgen'],
    [toMonday(utc(year, 10, 12)), 'Día de la Raza'],
    [toMonday(utc(year, 11, 1)), 'Día de Todos los Santos'],
    [toMonday(utc(year, 11, 11)), 'Independencia de Cartagena'],
    [utc(year, 12, 8), 'Día de la Inmaculada Concepción'],
    [utc(year, 12, 25), 'Navidad'],
  ];
  const out = list.map(([d, name]) => ({ date: iso(d), name })).sort((a, b) => a.date.localeCompare(b.date));
  cache.set(year, out);
  return out;
}

/** Nombre del festivo de esa fecha (AAAA-MM-DD), o null si no es festivo. */
export function holidayName(date: string): string | null {
  const y = Number(date.slice(0, 4));
  if (!y) return null;
  return holidaysOf(y).find((h) => h.date === date)?.name ?? null;
}

export const isWeekend = (date: string) => [0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay());

/** Día hábil: de lunes a viernes y que no sea festivo en Colombia. */
export const isWorkday = (date: string) => !isWeekend(date) && !holidayName(date);

/** La misma fecha si es hábil; si no, el siguiente día hábil. */
export function nextWorkday(date: string): string {
  let d = date;
  for (let i = 0; i < 15 && !isWorkday(d); i++) d = iso(addDays(new Date(`${d}T12:00:00Z`), 1));
  return d;
}

/** Festivos entre dos fechas (AAAA-MM-DD), incluidas. */
export function holidaysBetween(from: string, to: string): Holiday[] {
  const y1 = Number(from.slice(0, 4));
  const y2 = Number(to.slice(0, 4));
  const out: Holiday[] = [];
  for (let y = y1; y <= y2; y++) out.push(...holidaysOf(y).filter((h) => h.date >= from && h.date <= to));
  return out;
}

/** Para los prompts de la IA: los festivos de los próximos meses, para que no ponga fechas en ellos. */
export function holidaysForAi(from: string, months = 12): string {
  const end = new Date(`${from}T12:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() + months);
  const list = holidaysBetween(from, iso(end));
  return list.length ? `Festivos de Colombia (no son días hábiles): ${list.map((h) => `${h.date} ${h.name}`).join('; ')}.` : '';
}
