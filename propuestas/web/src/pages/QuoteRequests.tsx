import { useEffect, useRef, useState } from 'react';
import { api, formatDateTime, navigate, timeAgo, useApi, useLocation } from '../lib';
import { Empty, ErrorBox, Loading, useAction, useToast } from '../ui';
import type { ProposalRow } from './Proposals';
import { SendProposalsDialog, type ReplyTo } from './ProposalSend';

/**
 * Solicitudes de cotización que llegan a tu correo: Partners revisa la bandeja de Gmail cada 10 minutos y la IA marca
 * las que piden una propuesta. Desde aquí respondes con la propuesta en el mismo hilo del correo.
 */

interface Request {
  id: number;
  fromEmail: string;
  fromName: string;
  subject: string;
  receivedAt: string;
  snippet: string;
  company: string;
  contact: string;
  service: string;
  summary: string;
  requirements: string[];
  status: 'nueva' | 'en_proceso' | 'respondida' | 'descartada';
  proposalIds: number[];
  repliedAt: string | null;
  gmailUrl: string;
  knownClient: string | null;
  body?: string;
}

interface Data {
  items: Request[];
  inbox: { enabled: boolean; canRead: boolean; connected: boolean; email: string | null; lastScanAt: string | null; lastError: string | null };
}

const STATUS: Record<Request['status'], string> = { nueva: 'Nueva', en_proceso: 'En proceso', respondida: 'Respondida', descartada: 'Descartada' };

export function QuoteRequests({ proposals, onReplied }: { proposals: ProposalRow[]; onReplied: () => void }) {
  const { data, error, loading, reload, setData } = useApi<Data>('quote-requests');
  const { query } = useLocation();
  const [open, setOpen] = useState<number | null>(Number(query.get('solicitud')) || null);
  const [body, setBody] = useState<Record<number, string>>({});
  const [filter, setFilter] = useState<'abiertas' | 'todas'>('abiertas');
  const [choosing, setChoosing] = useState<Request | null>(null);
  const [replying, setReplying] = useState<{ r: Request; proposals: ProposalRow[] } | null>(null);
  const { busy, run } = useAction();
  const toast = useToast();

  useEffect(() => {
    if (!open || body[open] !== undefined) return;
    api<Request>('GET', `quote-requests/${open}`)
      .then((r) => setBody((b) => ({ ...b, [open]: r.body ?? '' })))
      .catch(() => {});
  }, [open, body]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const d = data!;
  const rows = d.items.filter((r) => filter === 'todas' || r.status === 'nueva' || r.status === 'en_proceso');
  const setStatus = (r: Request, status: Request['status']) =>
    run(async () => {
      const u = await api<Request>('PATCH', `quote-requests/${r.id}`, { status });
      setData({ ...d, items: d.items.map((x) => (x.id === r.id ? u : x)) });
    });

  return (
    <>
      <div className="push-card">
        <div>
          <strong>Tu correo{d.inbox.email ? ` (${d.inbox.email})` : ''}</strong>
          <p className="hint">
            {!d.inbox.connected
              ? 'Conecta Google en Configuración para que Partners revise tu correo.'
              : !d.inbox.canRead
                ? 'Falta el permiso para leer Gmail: ve a Configuración → Google y correo, vuelve a conectar Google y acepta todos los permisos.'
                : d.inbox.enabled
                  ? `Se revisa cada 10 minutos (lo nuevo de la bandeja principal, sin promociones ni notificaciones). ${d.inbox.lastScanAt ? `Última revisión: ${timeAgo(d.inbox.lastScanAt)}.` : ''}`
                  : 'La revisión automática está apagada.'}
            {d.inbox.lastError ? ` · Último error: ${d.inbox.lastError}` : ''}
          </p>
        </div>
        {d.inbox.canRead && (
          <span className="actions actions--tight">
            <button
              className="btn btn--outline btn--sm"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const r = await api<{ checked: number; found: number }>('POST', 'quote-requests/scan');
                  toast(r.found ? `${r.found} solicitud(es) nueva(s).` : r.checked ? `Revisados ${r.checked} correos: ninguna solicitud nueva.` : 'No hay correos nuevos.');
                  reload();
                })
              }
            >
              {busy ? 'Revisando…' : 'Revisar ahora'}
            </button>
            <label className="check">
              <input
                type="checkbox"
                checked={d.inbox.enabled}
                onChange={(e) =>
                  run(async () => {
                    await api('PUT', 'inbox/settings', { enabled: e.target.checked });
                    reload();
                  })
                }
              />{' '}
              Revisar automáticamente
            </label>
          </span>
        )}
      </div>

      <section className="section">
        <div className="section__head">
          <h2>Solicitudes de cotización</h2>
          <div className="segmented segmented--sm">
            <button className={filter === 'abiertas' ? 'is-active' : ''} onClick={() => setFilter('abiertas')}>
              Por atender ({d.items.filter((r) => r.status === 'nueva' || r.status === 'en_proceso').length})
            </button>
            <button className={filter === 'todas' ? 'is-active' : ''} onClick={() => setFilter('todas')}>
              Todas ({d.items.length})
            </button>
          </div>
        </div>
        {rows.length ? (
          <div className="list">
            {rows.map((r) => (
              <article key={r.id} className={`item card qreq${r.status === 'nueva' ? ' is-new' : ''}`}>
                <div className="qreq__main">
                  <div className="item__title">
                    {r.company || r.fromName || r.fromEmail}
                    <span className={`tag${r.status === 'nueva' ? ' tag--warn' : r.status === 'respondida' ? ' tag--activo' : ''}`}>{STATUS[r.status]}</span>
                    {r.knownClient && <span className="tag">Cliente: {r.knownClient}</span>}
                  </div>
                  <div className="tpl__sub">
                    {r.service ? <strong>{r.service}</strong> : null}
                    {r.service ? ' · ' : ''}
                    {r.contact || r.fromName} &lt;{r.fromEmail}&gt;
                  </div>
                  {r.summary && <p className="qreq__summary">{r.summary}</p>}
                  {r.requirements.length > 0 && (
                    <ul className="qreq__reqs">
                      {r.requirements.slice(0, open === r.id ? 12 : 4).map((x, i) => (
                        <li key={i}>{x}</li>
                      ))}
                      {open !== r.id && r.requirements.length > 4 && <li className="hint">+ {r.requirements.length - 4} más</li>}
                    </ul>
                  )}
                  <div className="item__meta">
                    <span>«{r.subject}»</span>
                    <span>{formatDateTime(r.receivedAt)}</span>
                    {r.repliedAt && <span>Respondida {formatDateTime(r.repliedAt)}</span>}
                  </div>
                  {open === r.id && (
                    <pre className="qreq__body">{body[r.id] === undefined ? 'Cargando el correo…' : body[r.id] || r.snippet}</pre>
                  )}
                </div>
                <div className="item__actions tpl-actions">
                  <button className="btn btn--primary btn--sm" disabled={busy || !proposals.length} title={proposals.length ? '' : 'Primero publica la propuesta'} onClick={() => setChoosing(r)}>
                    Responder con propuesta
                  </button>
                  <button className="btn btn--outline btn--sm" onClick={() => setOpen(open === r.id ? null : r.id)}>
                    {open === r.id ? 'Ocultar correo' : 'Ver correo'}
                  </button>
                  <button className="btn btn--outline btn--sm" onClick={() => navigate('/propuestas?tab=plantillas')}>
                    Crear propuesta
                  </button>
                  <a className="btn btn--outline btn--sm" href={r.gmailUrl} target="_blank" rel="noopener">
                    Abrir en Gmail
                  </a>
                  {r.status === 'nueva' && (
                    <button className="btn btn--outline btn--sm" disabled={busy} onClick={() => setStatus(r, 'en_proceso')}>
                      En proceso
                    </button>
                  )}
                  {r.status !== 'descartada' ? (
                    <button className="btn btn--outline btn--sm" disabled={busy} onClick={() => setStatus(r, 'descartada')}>
                      Descartar
                    </button>
                  ) : (
                    <button className="btn btn--outline btn--sm" disabled={busy} onClick={() => setStatus(r, 'nueva')}>
                      Reabrir
                    </button>
                  )}
                  <button
                    className="btn btn--outline btn--sm"
                    disabled={busy}
                    title="La IA se equivocó: no es una solicitud de cotización"
                    onClick={() =>
                      run(async () => {
                        await api('PATCH', `quote-requests/${r.id}`, { notQuote: true });
                        setData({ ...d, items: d.items.filter((x) => x.id !== r.id) });
                      })
                    }
                  >
                    No es cotización
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty>{filter === 'abiertas' ? 'No hay solicitudes por atender.' : 'Todavía no ha llegado ninguna solicitud de cotización.'}</Empty>
        )}
      </section>

      {choosing && (
        <ChooseProposals
          request={choosing}
          proposals={proposals}
          onClose={() => setChoosing(null)}
          onChosen={(list) => {
            setReplying({ r: choosing, proposals: list });
            setChoosing(null);
          }}
        />
      )}
      {replying && (
        <SendProposalsDialog
          proposals={replying.proposals}
          reply={{ requestId: replying.r.id, to: replying.r.fromEmail, name: replying.r.contact || replying.r.fromName, subject: replying.r.subject } satisfies ReplyTo}
          onSent={() => {
            reload();
            onReplied();
          }}
          onClose={() => setReplying(null)}
        />
      )}
    </>
  );
}

/** Elegir la(s) propuesta(s) publicadas con las que se responde (las más recientes primero). */
function ChooseProposals({ request, proposals, onClose, onChosen }: { request: Request; proposals: ProposalRow[]; onClose: () => void; onChosen: (p: ProposalRow[]) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [picked, setPicked] = useState<number[]>([]);
  useEffect(() => ref.current?.showModal(), []);
  const list = proposals.filter((p) => p.active);
  return (
    <dialog ref={ref} className="modal" onClose={onClose} onClick={(e) => e.target === e.currentTarget && ref.current?.close()}>
      <div className="modal__in">
        <header className="modal__head">
          <h2>¿Con qué propuesta respondes a {request.company || request.fromName || request.fromEmail}?</h2>
          <button className="icon-btn" onClick={() => ref.current?.close()} aria-label="Cerrar">
            ✕
          </button>
        </header>
        <p className="hint">Elige una o varias propuestas publicadas. Si aún no la tienes, créala desde una plantilla o súbela y vuelve aquí.</p>
        <div className="mail-pick">
          {list.map((p) => (
            <label key={p.id} className="check">
              <input type="checkbox" checked={picked.includes(p.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, p.id] : picked.filter((x) => x !== p.id))} />
              <span>
                <strong>{p.title || p.slug}</strong>
                <small>
                  {p.url.replace(/^https?:\/\//, '')} · actualizada {formatDateTime(p.updatedAt)}
                </small>
              </span>
            </label>
          ))}
        </div>
        <div className="actions actions--tight">
          <button className="btn btn--primary btn--sm" disabled={!picked.length} onClick={() => onChosen(list.filter((p) => picked.includes(p.id)))}>
            Continuar
          </button>
        </div>
      </div>
    </dialog>
  );
}
