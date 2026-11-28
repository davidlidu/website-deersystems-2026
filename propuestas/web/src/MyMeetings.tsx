import { useCallback, useEffect, useRef, useState } from 'react';
import { api, durationLabel, formatMeetingLong, PENDING_MEETINGS_EVENT, today, type Meeting } from './lib';
import { useAction, useToast } from './ui';

/**
 * Inicio del cliente: las reuniones que debe confirmar (resaltadas) y sus próximas reuniones, con «Unirse a Meet» y
 * «Reagendar» (propone otro día y hora; DeerSystems lo acepta y Google avisa a los invitados).
 */

const TZ = 'America/Bogota';
const day = (iso: string) => new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', timeZone: TZ });
const month = (iso: string) => new Date(iso).toLocaleDateString('es-CO', { month: 'short', timeZone: TZ }).replace('.', '');
const hour = (iso: string) => new Date(iso).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
const minutesOf = (m: Meeting) => Math.round((new Date(m.endAt).getTime() - new Date(m.startAt).getTime()) / 60_000);
const dateOf = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
function relative(iso: string): string {
  const d = Math.round((Date.parse(`${dateOf(iso)}T12:00:00`) - Date.parse(`${today()}T12:00:00`)) / 86_400_000);
  if (Date.parse(iso) <= Date.now() && Date.now() < Date.parse(iso) + 3 * 3_600_000) return 'Ahora';
  return d <= 0 ? 'Hoy' : d === 1 ? 'Mañana' : `En ${d} días`;
}
const changed = () => window.dispatchEvent(new Event(PENDING_MEETINGS_EVENT));

export function MyMeetings() {
  const [data, setData] = useState<{ pending: Meeting[]; upcoming: Meeting[] } | null>(null);
  const [all, setAll] = useState(false);
  const [openPending, setOpenPending] = useState(false);
  const [openUpcoming, setOpenUpcoming] = useState(false);
  const [moving, setMoving] = useState<{ m: Meeting; mode: 'propose' | 'reschedule' } | null>(null);
  const { busy, run } = useAction();
  const toast = useToast();

  const load = useCallback(() => {
    api<{ pending: Meeting[]; upcoming: Meeting[] }>('GET', 'me/meetings').then(setData).catch(() => {});
  }, []);
  useEffect(() => {
    load();
    window.addEventListener(PENDING_MEETINGS_EVENT, load);
    return () => window.removeEventListener(PENDING_MEETINGS_EVENT, load);
  }, [load]);

  if (!data || (!data.pending.length && !data.upcoming.length)) return null;
  const shown = all ? data.upcoming : data.upcoming.slice(0, 3);
  const after = () => {
    load();
    changed();
  };

  return (
    <section className="section mymeet">
      <div className="section__head">
        <h2>Reuniones</h2>
        <span className="mono">{data.pending.length + data.upcoming.length}</span>
      </div>

      {data.pending.length > 0 && (
        <div className="mymeet__pending card">
          <button type="button" className="mymeet__alert mymeet__toggle" aria-expanded={openPending} onClick={() => setOpenPending(!openPending)}>
            <span className="mymeet__dot" aria-hidden="true" />
            <span className="mymeet__head">
              {data.pending.length === 1 ? 'Tienes una reunión por confirmar' : `Tienes ${data.pending.length} reuniones por confirmar`}
              <small>
                {openPending
                  ? 'Confírmalas para recibir la invitación con el enlace de Meet, o propón otro horario.'
                  : `La próxima: ${formatMeetingLong(data.pending[0].startAt).replace(/\.$/, '')}. Toca para verlas y confirmarlas.`}
              </small>
            </span>
            <Chevron open={openPending} />
          </button>
          {openPending && data.pending.map((m) => (
            <div key={m.id} className="mymeet__row">
              <DateChip iso={m.startAt} />
              <div className="mymeet__info">
                <strong>{m.title}</strong>
                <small>
                  {hour(m.startAt)} · {durationLabel(minutesOf(m))}
                  {m.projectName ? ` · ${m.projectName}` : ''}
                </small>
                {m.clientProposal && (
                  <small className="mymeet__note">Propusiste {formatMeetingLong(m.clientProposal.startAt)}: esperando respuesta de DeerSystems.</small>
                )}
              </div>
              <div className="actions actions--tight">
                <button
                  className="btn btn--primary btn--sm"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await api('POST', `meetings/${m.id}/respond`, { action: 'confirm' });
                      toast('Reunión confirmada. Te llega la invitación de Google Calendar con el enlace de Meet.');
                      after();
                    })
                  }
                >
                  {m.clientProposal ? 'Confirmar el original' : 'Confirmar'}
                </button>
                <button className="btn btn--outline btn--sm" disabled={busy} onClick={() => setMoving({ m, mode: 'propose' })}>
                  {m.clientProposal ? 'Cambiar propuesta' : 'Otro horario'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {data.upcoming.length > 0 && (
        <div className="mymeet__list card">
          <button type="button" className="mymeet__toggle mymeet__listhead" aria-expanded={openUpcoming} onClick={() => setOpenUpcoming(!openUpcoming)}>
            <span className="mymeet__head">
              <span className="subhead">Próximas reuniones ({data.upcoming.length})</span>
              {!openUpcoming && (
                <small>
                  <span className="mymeet__rel">{relative(data.upcoming[0].startAt)}</span> · {data.upcoming[0].title} · {hour(data.upcoming[0].startAt)}
                </small>
              )}
            </span>
            <Chevron open={openUpcoming} />
          </button>
          {openUpcoming && shown.map((m, i) => {
            const soon = i === 0 && Date.parse(m.startAt) - Date.now() < 24 * 3_600_000;
            return (
              <div key={m.id} className={`mymeet__row${soon ? ' is-soon' : ''}`}>
                <DateChip iso={m.startAt} />
                <div className="mymeet__info">
                  <strong>{m.title}</strong>
                  <small>
                    <span className="mymeet__rel">{relative(m.startAt)}</span> · {hour(m.startAt)} · {durationLabel(minutesOf(m))}
                    {m.projectName ? ` · ${m.projectName}` : ''}
                  </small>
                  {m.clientProposal && (
                    <small className="mymeet__note">Pediste reagendarla para el {formatMeetingLong(m.clientProposal.startAt)}: esperando respuesta.</small>
                  )}
                </div>
                <div className="actions actions--tight">
                  {m.meetUrl && (
                    <a className={`btn btn--sm ${soon ? 'btn--primary' : 'btn--outline'}`} href={m.meetUrl} target="_blank" rel="noopener">
                      Unirse a Meet
                    </a>
                  )}
                  {m.canReschedule &&
                    (m.clientProposal ? (
                      <button
                        className="btn btn--outline btn--sm"
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            await api('POST', `meetings/${m.id}/respond`, { action: 'cancel-proposal' });
                            toast('Solicitud cancelada: la reunión sigue en su horario.');
                            after();
                          })
                        }
                      >
                        Cancelar solicitud
                      </button>
                    ) : (
                      <button className="btn btn--outline btn--sm" disabled={busy} onClick={() => setMoving({ m, mode: 'reschedule' })}>
                        Reagendar
                      </button>
                    ))}
                </div>
              </div>
            );
          })}
          {openUpcoming && data.upcoming.length > 3 && (
            <button className="linkbtn mymeet__more" onClick={() => setAll(!all)}>
              {all ? 'Ver menos' : `Ver todas (${data.upcoming.length})`}
            </button>
          )}
        </div>
      )}

      {moving && (
        <ProposeDialog
          meeting={moving.m}
          reschedule={moving.mode === 'reschedule'}
          onClose={() => setMoving(null)}
          onDone={() => {
            setMoving(null);
            after();
          }}
        />
      )}
    </section>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className={`mymeet__chev${open ? ' is-open' : ''}`} viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function DateChip({ iso }: { iso: string }) {
  return (
    <span className="mymeet__date" aria-hidden="true">
      <strong>{day(iso)}</strong>
      <small>{month(iso)}</small>
    </span>
  );
}

function ProposeDialog({ meeting: m, reschedule, onClose, onDone }: { meeting: Meeting; reschedule: boolean; onClose: () => void; onDone: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const start = m.clientProposal?.startAt ?? m.startAt;
  const [date, setDate] = useState(dateOf(start));
  const [time, setTime] = useState(new Date(start).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: TZ }));
  const [note, setNote] = useState(m.clientProposal?.note ?? '');
  const { busy, run } = useAction();
  const toast = useToast();
  useEffect(() => ref.current?.showModal(), []);
  return (
    <dialog ref={ref} className="modal modal--sm" onClose={onClose} onClick={(e) => e.target === e.currentTarget && !busy && ref.current?.close()}>
      <div className="modal__in">
        <header className="modal__head">
          <h2>{reschedule ? 'Reagendar la reunión' : 'Proponer otro horario'}</h2>
          <button className="icon-btn" onClick={() => ref.current?.close()} aria-label="Cerrar">
            ✕
          </button>
        </header>
        <p className="hint">
          «{m.title}» · hoy está para el {formatMeetingLong(m.startAt)}. {reschedule ? 'Tu reunión sigue igual hasta que DeerSystems acepte el nuevo horario.' : ''} Revisamos que el
          horario esté libre en la agenda de DeerSystems.
        </p>
        <div className="form-grid">
          <label className="field">
            <span className="field__label">Fecha</span>
            <span className="input">
              <input type="date" min={today()} value={date} onChange={(e) => setDate(e.target.value)} />
            </span>
          </label>
          <label className="field">
            <span className="field__label">Hora (Colombia)</span>
            <span className="input">
              <input type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} />
            </span>
          </label>
          <label className="field field--wide">
            <span className="field__label">Nota (opcional)</span>
            <textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej.: esa semana estoy de viaje; me sirve en las mañanas." />
          </label>
        </div>
        <div className="actions actions--tight">
          <button
            className="btn btn--primary btn--sm"
            disabled={busy || !date || !time}
            onClick={() =>
              run(async () => {
                await api('POST', `meetings/${m.id}/respond`, { action: 'propose', date, time, note });
                toast('Enviamos tu propuesta a DeerSystems. Te avisaremos cuando la confirmen.');
                onDone();
              })
            }
          >
            {busy ? 'Enviando…' : reschedule ? 'Pedir el cambio' : 'Enviar propuesta'}
          </button>
        </div>
      </div>
    </dialog>
  );
}
