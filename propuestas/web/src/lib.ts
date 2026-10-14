import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

// ───────── API ─────────

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path.startsWith('/') ? path : `/api/${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/auth/')) {
    navigate('/login');
    throw new ApiError(401, 'Tu sesión venció. Vuelve a entrar.');
  }
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Error ${res.status}`);
  return data as T;
}

/** Carga datos al montar (y cuando cambian las dependencias); `reload` vuelve a pedirlos. */
export function useApi<T>(path: string | null) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({
    data: null,
    error: null,
    loading: !!path,
  });
  const load = useCallback(async () => {
    if (!path) return;
    setState((s) => ({ ...s, loading: true }));
    try {
      setState({ data: await api<T>('GET', path), error: null, loading: false });
    } catch (err) {
      setState({ data: null, error: (err as Error).message, loading: false });
    }
  }, [path]);
  useEffect(() => {
    load();
  }, [load]);
  return { ...state, reload: load, setData: (data: T) => setState({ data, error: null, loading: false }) };
}

// ───────── Router mínimo (History API) ─────────

const listeners = new Set<() => void>();
window.addEventListener('popstate', () => listeners.forEach((l) => l()));

export function navigate(to: string, replace = false): void {
  if (to === location.pathname + location.search) return;
  history[replace ? 'replaceState' : 'pushState'](null, '', to);
  listeners.forEach((l) => l());
  window.scrollTo(0, 0);
}

export function useLocation() {
  const href = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => location.pathname + location.search,
  );
  const url = new URL(href, location.origin);
  return { path: url.pathname.replace(/\/+$/, '') || '/', query: url.searchParams };
}

/** "/proyectos/:id" contra "/proyectos/12" → { id: "12" } o null. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/');
  const s = path.split('/');
  if (p.length !== s.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(s[i]);
    else if (p[i] !== s[i]) return null;
  }
  return params;
}

// ───────── Tipos compartidos con el servidor ─────────

export type Role = 'owner' | 'team' | 'client';

export interface Me {
  email: string;
  name: string;
  role: Role;
  proposalsUrl?: string;
  client?: { id: number; name: string };
}

export type TaskStatus = 'pendiente' | 'en_progreso' | 'en_revision' | 'bloqueada' | 'completada';
export type Side = 'deersystems' | 'cliente';

export const STATUS: Record<TaskStatus, string> = {
  pendiente: 'Pendiente',
  en_progreso: 'En progreso',
  en_revision: 'En revisión',
  bloqueada: 'Bloqueada',
  completada: 'Completada',
};
export const STATUSES = Object.keys(STATUS) as TaskStatus[];
/** Lo que puede elegir el cliente en sus tareas. */
export const CLIENT_STATUSES: TaskStatus[] = ['pendiente', 'en_progreso', 'en_revision'];

export const PROJECT_STATUS = { activo: 'Activo', pausado: 'Pausado', finalizado: 'Finalizado' } as const;
export type ProjectStatus = keyof typeof PROJECT_STATUS;

export interface Progress {
  total: number;
  done: number;
  percent: number;
}

export interface ProjectSummary {
  id: number;
  clientId: number;
  clientName: string;
  name: string;
  approvedOption: string;
  status: ProjectStatus;
  startDate: string | null;
  endDate: string | null;
  approvedAt: string;
  progress: Progress;
  proposalUrl?: string | null;
}

export interface Task {
  id: number;
  phaseId: number | null;
  title: string;
  description: string;
  status: TaskStatus;
  side: Side;
  assigneeId: number | null;
  assigneeName: string | null;
  startDate: string | null;
  dueDate: string | null;
  completedAt: string | null;
  source: 'propuesta' | 'manual' | 'reunion';
  comments: number;
  files: number;
  canChangeStatus: boolean;
  canEdit: boolean;
}

export interface Note {
  id: number;
  taskId: number | null;
  kind: 'nota' | 'avance';
  visibility: 'shared' | 'internal';
  authorKind: Role;
  authorName: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
  canDelete: boolean;
}

export interface Attachment {
  id: number;
  taskId: number | null;
  name: string;
  mime: string;
  size: number;
  visibility: 'shared' | 'internal';
  authorKind: Role;
  authorName: string;
  createdAt: string;
  canDelete: boolean;
  canChangeVisibility: boolean;
  /** Visor de Drive (o vista del portal para imágenes y PDF); null si no hay vista disponible. */
  viewUrl: string | null;
  downloadName: string;
  linked: boolean;
}

export interface AppNotification {
  id: number;
  type: string;
  title: string;
  body: string;
  link: string;
  read: boolean;
  createdAt: string;
}

/** Sube un archivo tal cual (sin JSON). Devuelve la respuesta del servidor. */
export async function upload<T>(path: string, file: File, params: Record<string, string>): Promise<T> {
  const query = new URLSearchParams({ filename: file.name, ...params });
  const res = await fetch(`/api/${path}?${query}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Error ${res.status}`);
  return data as T;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export type MeetingStatus = 'programada' | 'esperando' | 'borrador' | 'aprobada' | 'sin_transcripcion' | 'error' | 'descartada';

export const MEETING_STATUS: Record<MeetingStatus, string> = {
  programada: 'Programada',
  esperando: 'Esperando transcripción',
  borrador: 'Por revisar',
  aprobada: 'Enviada',
  sin_transcripcion: 'Sin transcripción',
  error: 'Error de IA',
  descartada: 'Descartada',
};

export interface Meeting {
  id: number;
  projectId: number | null;
  projectName: string | null;
  clientId: number | null;
  clientName: string | null;
  title: string;
  startAt: string;
  endAt: string;
  meetUrl: string | null;
  status: MeetingStatus;
  attendees: { email: string; name: string; side: 'deersystems' | 'cliente' | 'otro' }[];
  summary?: string;
  agreements?: string[];
  taskIds?: number[];
  approvedAt?: string | null;
  calendarUrl?: string | null;
  proposedTasks?: { title: string; description: string; side: Side; dueDate: string | null }[];
  hasTranscript?: boolean;
  transcriptSource?: 'meet' | 'manual' | null;
  transcriptUrl?: string | null;
  transcript?: string | null;
  ai?: { provider: string; model: string; costUsd: number; latencyMs: number } | null;
  error?: string | null;
  sentTo?: string[];
}

export function formatMeetingTime(iso: string): string {
  return new Date(iso).toLocaleString('es-CO', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export interface ActivityItem {
  id: number;
  taskId: number | null;
  actorKind: Role;
  actorName: string;
  type: string;
  data: Record<string, unknown>;
  internal: boolean;
  createdAt: string;
}

export interface ProjectDetail extends ProjectSummary {
  scope: string;
  approvalNotes: string;
  pricing?: string;
  phases: { id: number; name: string }[];
  tasks: Task[];
}

export interface TeamMember {
  id: number;
  name: string;
  email: string;
  active: boolean;
  lastLoginAt: string | null;
}

// ───────── Formato ─────────

export function formatDate(iso: string | null | undefined, withYear = true): string {
  if (!iso) return '—';
  // Las fechas "YYYY-MM-DD" son días, no instantes: se leen en hora local para no correrse un día.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00`) : new Date(iso);
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export const usd = (n: number) =>
  `US$ ${n.toLocaleString('es-CO', { minimumFractionDigits: n > 0 && n < 0.01 ? 4 : 2, maximumFractionDigits: n < 0.01 ? 4 : 2 })}`;

export const compact = (n: number) => n.toLocaleString('es-CO', { notation: 'compact', maximumFractionDigits: 1 });

/** Hoy en Bogotá, como "YYYY-MM-DD". */
export const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

export const isOverdue = (t: Pick<Task, 'dueDate' | 'status'>) => !!t.dueDate && t.status !== 'completada' && t.dueDate < today();

// ───────── Fechas de calendario ("YYYY-MM-DD", sin zona horaria) ─────────

const parseDay = (iso: string) => new Date(`${iso}T12:00:00`);
const toDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function addDays(iso: string, days: number): string {
  const d = parseDay(iso);
  d.setDate(d.getDate() + days);
  return toDay(d);
}

export const daysBetween = (a: string, b: string) => Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86_400_000);

/** Lunes de la semana del día dado. */
export function startOfWeek(iso: string): string {
  const day = (parseDay(iso).getDay() + 6) % 7;
  return addDays(iso, -day);
}

export function startOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function addMonths(iso: string, n: number): string {
  const d = parseDay(startOfMonth(iso));
  d.setMonth(d.getMonth() + n);
  return toDay(d);
}

/** 6 semanas × 7 días que cubren el mes, empezando en lunes. */
export function monthGrid(iso: string): string[] {
  const first = startOfWeek(startOfMonth(iso));
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
}

export function dayLabel(iso: string, opts: Intl.DateTimeFormatOptions): string {
  return parseDay(iso).toLocaleDateString('es-CO', opts);
}

/** Relativo y corto: "hace 5 min", "ayer", "12 oct". */
export function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'ahora';
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86_400) return `hace ${Math.floor(s / 3600)} h`;
  if (s < 172_800) return 'ayer';
  return new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
}
