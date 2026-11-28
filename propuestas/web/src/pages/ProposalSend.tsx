import { useEffect, useRef, useState } from 'react';
import { api, useApi } from '../lib';
import { Loading, useAction, useToast } from '../ui';
import type { ProposalRow } from './Proposals';

interface ClientLite {
  id: number;
  name: string;
  contact_name: string;
  email: string | null;
}

interface Item {
  id: number;
  title: string;
  note: string;
  active: boolean;
}

const defaultMessage = (many: boolean) =>
  [
    `Gracias por tu tiempo y por contarnos lo que necesitas. Con base en lo que hablamos, preparamos ${
      many ? 'estas propuestas para tu empresa: cada una es una opción para que elijas la que mejor se ajuste a tu momento y presupuesto' : 'esta propuesta para tu empresa'
    }.`,
    `En ${many ? 'cada una' : 'ella'} encuentras el alcance, los tiempos y la inversión. Si te sirve, la revisamos juntos en una llamada corta.`,
  ].join('\n\n');

/**
 * Enviar una o varias propuestas por correo en un solo mensaje comercial. Cada propuesta lleva su nombre
 * (lo que verá el cliente) y una nota opcional; la vista previa muestra el correo tal cual le llegará.
 */
/** Responder una solicitud de cotización que llegó al correo: sale en el mismo hilo de Gmail. */
export interface ReplyTo {
  requestId: number;
  to: string;
  name: string;
  subject: string;
}

export function SendProposalsDialog({ proposals, onSent, onClose, reply }: { proposals: ProposalRow[]; onSent: () => void; onClose: () => void; reply?: ReplyTo }) {
  const ref = useRef<HTMLDialogElement>(null);
  const toInput = useRef<HTMLInputElement>(null);
  const clients = useApi<ClientLite[]>('clients');
  const many = proposals.length > 1;
  const [to, setTo] = useState(reply?.to ?? '');
  const [name, setName] = useState(reply?.name ?? '');
  const [subject, setSubject] = useState(
    reply ? (/^re:/i.test(reply.subject) ? reply.subject : `Re: ${reply.subject}`) : many ? `${proposals.length} propuestas de DeerSystems para tu empresa` : `Tu propuesta: ${proposals[0].title || proposals[0].slug}`,
  );
  const [message, setMessage] = useState(defaultMessage(many));
  const [items, setItems] = useState<Item[]>(proposals.map((p) => ({ id: p.id, title: p.title || p.slug, note: '', active: p.active })));
  const [preview, setPreview] = useState<string | null>(null);
  const { busy, run } = useAction();
  const toast = useToast();

  useEffect(() => {
    ref.current?.showModal();
    toInput.current?.focus();
  }, []);

  const payload = () => ({ to, name, subject, message, requestId: reply?.requestId ?? null, items: items.map(({ id, title, note }) => ({ id, title, note })) });
  const paused = items.filter((i) => !i.active);

  // Al elegir el correo de un cliente conocido, el saludo usa su contacto.
  const pickTo = (value: string) => {
    setTo(value);
    const last = value.split(/[,;\s]+/).filter(Boolean).at(-1)?.toLowerCase();
    const c = clients.data?.find((x) => x.email?.toLowerCase() === last);
    if (c && !name) setName(c.contact_name || c.name);
  };

  const showPreview = () =>
    run(async () => {
      const r = await api<{ html: string }>('POST', 'proposals/send/preview', payload());
      setPreview(r.html);
    });

  const send = () =>
    run(async () => {
      const r = await api<{ to: string[] }>('POST', 'proposals/send', payload());
      toast(`${many ? `${items.length} propuestas enviadas` : 'Propuesta enviada'} a ${r.to.join(', ')}${reply ? ', en el mismo hilo del correo' : ''}.`);
      onSent();
      ref.current?.close();
    });

  const move = (i: number, d: -1 | 1) => {
    const next = [...items];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setItems(next);
  };

  return (
    <dialog
      ref={ref}
      className="modal modal--send"
      aria-labelledby="send-proposals-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) ref.current?.close();
      }}
    >
      <div className="modal__in">
        <header className="modal__head">
          <h2 id="send-proposals-title">{reply ? 'Responder la solicitud con la propuesta' : many ? `Enviar ${items.length} propuestas por correo` : 'Enviar la propuesta por correo'}</h2>
          <button className="icon-btn" onClick={() => ref.current?.close()} aria-label="Cerrar">
            ✕
          </button>
        </header>

        {preview ? (
          <>
            <div className="mail-accordion__meta">
              <span>
                <small>Para</small>
                {to || '—'}
              </span>
              <span>
                <small>Asunto</small>
                {subject}
              </span>
            </div>
            {/* sandbox sin permisos: el HTML del correo no puede ejecutar nada en el portal. */}
            <iframe className="mail-preview" sandbox="" srcDoc={preview} title="Vista previa del correo de propuestas" />
            <div className="actions actions--tight">
              <button className="btn btn--primary btn--sm" disabled={busy || !to.trim() || !!paused.length} onClick={send}>
                {busy ? 'Enviando…' : 'Enviar'}
              </button>
              <button className="btn btn--outline btn--sm" disabled={busy} onClick={() => setPreview(null)}>
                ← Editar
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="form-grid">
              <label className="field">
                <span className="field__label">Para</span>
                <span className="input">
                  <input
                    type="text"
                    list="send-proposals-clients"
                    ref={toInput}
                    value={to}
                    placeholder="cliente@empresa.com, otro@empresa.com"
                    onChange={(e) => pickTo(e.target.value)}
                  />
                </span>
                <datalist id="send-proposals-clients">
                  {(clients.data ?? [])
                    .filter((c) => c.email)
                    .map((c) => (
                      <option key={c.id} value={c.email!}>
                        {c.contact_name ? `${c.contact_name} · ${c.name}` : c.name}
                      </option>
                    ))}
                </datalist>
              </label>
              <label className="field">
                <span className="field__label">Nombre para el saludo</span>
                <span className="input">
                  <input value={name} maxLength={120} placeholder="Ej.: Alejandro (vacío = «Hola:»)" onChange={(e) => setName(e.target.value)} />
                </span>
              </label>
            </div>
            <label className="field">
              <span className="field__label">Asunto</span>
              <span className="input">
                <input value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
              </span>
            </label>
            <label className="field">
              <span className="field__label">Mensaje</span>
              <textarea rows={5} value={message} maxLength={4000} onChange={(e) => setMessage(e.target.value)} />
            </label>

            <div className="send-items">
              <span className="field__label">{many ? 'Propuestas (en este orden)' : 'Propuesta'}</span>
              {items.map((it, i) => (
                <div key={it.id} className={`send-item${it.active ? '' : ' is-paused'}`}>
                  <span className="send-item__num mono">{String(i + 1).padStart(2, '0')}</span>
                  <div className="send-item__fields">
                    <span className="input">
                      <input
                        value={it.title}
                        maxLength={160}
                        aria-label="Nombre que verá el cliente"
                        onChange={(e) => setItems(items.map((x) => (x.id === it.id ? { ...x, title: e.target.value } : x)))}
                      />
                    </span>
                    <span className="input">
                      <input
                        value={it.note}
                        maxLength={600}
                        placeholder="Nota corta opcional: qué incluye o para quién es esta opción"
                        aria-label="Nota de la propuesta"
                        onChange={(e) => setItems(items.map((x) => (x.id === it.id ? { ...x, note: e.target.value } : x)))}
                      />
                    </span>
                    {!it.active && <small className="send-item__warn">Está pausada: actívala antes de enviarla o el cliente verá un 404.</small>}
                  </div>
                  {many && (
                    <span className="send-item__order">
                      <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Subir" title="Subir">
                        ↑
                      </button>
                      <button className="icon-btn" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label="Bajar" title="Bajar">
                        ↓
                      </button>
                      <button
                        className="icon-btn icon-btn--danger"
                        onClick={() => (items.length > 1 ? setItems(items.filter((x) => x.id !== it.id)) : undefined)}
                        aria-label="Quitar del envío"
                        title="Quitar del envío"
                      >
                        ✕
                      </button>
                    </span>
                  )}
                </div>
              ))}
            </div>

            <div className="actions actions--tight">
              <button className="btn btn--primary btn--sm" disabled={busy || !to.trim() || !!paused.length} onClick={showPreview}>
                {busy ? 'Preparando…' : 'Ver el correo y enviar'}
              </button>
              <button className="btn btn--outline btn--sm" disabled={busy} onClick={() => ref.current?.close()}>
                Cancelar
              </button>
              {clients.loading && <Loading />}
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
