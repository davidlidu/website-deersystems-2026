import { useEffect, useRef, useState } from 'react';
import { api, formatDateTime, useApi } from './lib';
import { useAction, useToast } from './ui';

/**
 * Programar envíos: el botón con reloj junto a cada «Enviar» (propuesta, resumen de reunión, cuenta de cobro)
 * y la lista de lo que está programado, con «Enviar ahora» y «Cancelar».
 */

export type ScheduledKind = 'proposal' | 'summary' | 'invoice';

export interface ScheduledMail {
  id: number;
  sendAt: string;
  to: string;
  subject: string;
  status: 'pendiente' | 'enviando' | 'enviado' | 'error' | 'cancelado';
  error: string | null;
  sentAt: string | null;
}

export function ClockIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

const pad = (n: number) => String(n).padStart(2, '0');
/** Fecha local → valor de <input type="datetime-local">. */
const toInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const at = (days: number, hour: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d;
};
const longLabel = (d: Date) => d.toLocaleString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });

/** Atajos: en una hora, hoy en la tarde (si aún no pasa), mañana temprano y el próximo lunes. */
function presets(): { label: string; date: Date }[] {
  const now = new Date();
  const out: { label: string; date: Date }[] = [];
  const inHour = new Date(Math.ceil((now.getTime() + 60 * 60_000) / (15 * 60_000)) * 15 * 60_000);
  out.push({ label: 'En 1 hora', date: inHour });
  const afternoon = at(0, 17);
  if (afternoon.getTime() - now.getTime() > 90 * 60_000) out.push({ label: 'Hoy, 5:00 p. m.', date: afternoon });
  // Mañana temprano: si mañana es fin de semana, el lunes ya lo cubre.
  const tomorrow = at(1, 8);
  if (tomorrow.getDay() !== 0 && tomorrow.getDay() !== 6) out.push({ label: 'Mañana, 8:00 a. m.', date: tomorrow });
  const toMonday = (8 - now.getDay()) % 7 || 7;
  out.push({ label: 'Lunes, 8:00 a. m.', date: at(toMonday, 8) });
  return out;
}

/** Botón con reloj: abre el selector de fecha y hora y devuelve el instante elegido (ISO). */
export function ScheduleButton({
  disabled,
  busy,
  what,
  onSchedule,
  small = true,
}: {
  disabled?: boolean;
  busy?: boolean;
  /** Qué se programa, para el título: «la propuesta», «el resumen», «la cuenta de cobro». */
  what: string;
  onSchedule: (sendAt: string) => void;
  small?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={`btn btn--schedule${small ? ' btn--sm' : ''}`}
        disabled={disabled || busy}
        onClick={() => setOpen(true)}
        title={`Programar el envío de ${what}`}
        aria-label={`Programar el envío de ${what}`}
      >
        <ClockIcon />
        <span>Programar</span>
      </button>
      {open && (
        <ScheduleDialog
          what={what}
          onClose={() => setOpen(false)}
          onPick={(iso) => {
            setOpen(false);
            onSchedule(iso);
          }}
        />
      )}
    </>
  );
}

function ScheduleDialog({ what, onPick, onClose }: { what: string; onPick: (iso: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const options = presets();
  const [value, setValue] = useState(toInput(options.find((o) => o.label.startsWith('Mañana'))?.date ?? options[options.length - 1].date));
  useEffect(() => ref.current?.showModal(), []);
  const chosen = value ? new Date(value) : null;
  const tooSoon = !chosen || Number.isNaN(chosen.getTime()) || chosen.getTime() < Date.now() + 60_000;

  return (
    <dialog
      ref={ref}
      className="modal modal--sm"
      aria-labelledby="schedule-title"
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && ref.current?.close()}
    >
      <form
        className="modal__in"
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (!tooSoon) onPick(chosen!.toISOString());
        }}
      >
        <header className="modal__head">
          <h2 id="schedule-title" className="schedule__title">
            <ClockIcon size={18} /> Programar el envío
          </h2>
          <button type="button" className="icon-btn" onClick={() => ref.current?.close()} aria-label="Cerrar">
            ✕
          </button>
        </header>
        <p className="hint">Elige cuándo sale {what}. Se envía sola a esa hora desde tu cuenta de Google; puedes cancelarla o enviarla antes.</p>
        <div className="schedule__presets">
          {options.map((o) => (
            <button
              key={o.label}
              type="button"
              className={`schedule__preset${value === toInput(o.date) ? ' is-on' : ''}`}
              onClick={() => setValue(toInput(o.date))}
            >
              <strong>{o.label}</strong>
              <small>{o.date.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' })}</small>
            </button>
          ))}
        </div>
        <label className="field">
          <span className="field__label">O elige fecha y hora</span>
          <span className="input">
            <input type="datetime-local" value={value} min={toInput(new Date())} onChange={(e) => setValue(e.target.value)} required />
          </span>
        </label>
        <p className="hint" aria-live="polite">
          {tooSoon ? (
            'Elige una hora al menos un minuto en el futuro.'
          ) : (
            <>
              {/* La hora ya termina en «a. m.» o «p. m.»: sin punto final. */}
              Saldrá el <strong>{longLabel(chosen!)}</strong>
            </>
          )}
        </p>
        <div className="actions actions--tight">
          <button className="btn btn--primary btn--sm" disabled={tooSoon}>
            <ClockIcon /> Programar envío
          </button>
          <button type="button" className="btn btn--outline btn--sm" onClick={() => ref.current?.close()}>
            Cancelar
          </button>
        </div>
      </form>
    </dialog>
  );
}

const STATUS: Record<ScheduledMail['status'], string> = {
  pendiente: 'Programado',
  enviando: 'Enviando…',
  enviado: 'Enviado',
  error: 'No salió',
  cancelado: 'Cancelado',
};

/** Lo programado para una propuesta, un resumen o una cuenta de cobro. `refresh` cambia cuando se programa algo nuevo. */
export function ScheduledMails({ kind, refId, refresh = 0, onSent }: { kind: ScheduledKind; refId: number; refresh?: number; onSent?: () => void }) {
  const { data, reload } = useApi<ScheduledMail[]>(`scheduled-mails?kind=${kind}&ref=${refId}`);
  const { busy, run } = useAction();
  const toast = useToast();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) first.current = false;
    else void reload();
  }, [refresh, reload]);
  // Mientras haya algo programado se revisa cada minuto, para ver cuándo sale.
  const pending = (data ?? []).some((s) => s.status === 'pendiente' || s.status === 'enviando');
  useEffect(() => {
    if (!pending) return;
    const t = window.setInterval(() => void reload(), 60_000);
    return () => clearInterval(t);
  }, [pending, reload]);

  const list = data ?? [];
  if (!list.length) return null;

  const sendNow = (s: ScheduledMail) => {
    if (!confirm(`¿Enviar ahora a ${s.to}?`)) return;
    run(async () => {
      await api('POST', `scheduled-mails/${s.id}/send-now`);
      toast('Enviado.');
      await reload();
      onSent?.();
    });
  };
  const cancel = (s: ScheduledMail) => {
    if (!confirm(`¿Cancelar el envío programado a ${s.to}?`)) return;
    run(async () => {
      await api('POST', `scheduled-mails/${s.id}/cancel`);
      toast('Envío cancelado.');
      await reload();
    });
  };

  return (
    <ul className="scheduled">
      {list.map((s) => (
        <li key={s.id} className={`scheduled__item scheduled__item--${s.status}`}>
          <span className="scheduled__icon">
            <ClockIcon />
          </span>
          <span className="scheduled__text">
            <strong>
              {STATUS[s.status]} {s.status === 'enviado' ? formatDateTime(s.sentAt) : `para el ${formatDateTime(s.sendAt)}`}
            </strong>
            <small>{s.to}</small>
            {s.error && <small className="scheduled__error">{s.error}</small>}
          </span>
          {(s.status === 'pendiente' || s.status === 'error') && (
            <span className="actions actions--tight">
              <button type="button" className="btn btn--outline btn--xs" disabled={busy} onClick={() => sendNow(s)}>
                {s.status === 'error' ? 'Reintentar' : 'Enviar ahora'}
              </button>
              <button type="button" className="btn btn--outline btn--xs btn--danger" disabled={busy} onClick={() => cancel(s)}>
                Cancelar
              </button>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
