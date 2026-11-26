import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, formatDateTime, useApi } from '../lib';
import { Empty, ErrorBox, Loading, PageHead, useAction, useToast } from '../ui';

/**
 * Correos con la marca: un mensaje a varios destinatarios, cada uno en su propio correo y con sus datos
 * ({nombre}, {empresa}, {dominio}…). Plantillas reutilizables, vista previa, prueba a tu correo e historial.
 */

interface Draft {
  subject: string;
  eyebrow: string;
  title: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  footnote: string;
  fields: string[];
}

interface Recipient {
  email: string;
  name: string;
  company: string;
  data: Record<string, string>;
}

interface Template {
  id: number;
  name: string;
  base: boolean;
  draft: Draft;
}

interface Contact {
  clientId: number;
  email: string;
  name: string;
  company: string;
  label: string;
}

interface Campaign {
  id: number;
  subject: string;
  status: 'enviando' | 'enviado' | 'con_errores' | 'interrumpido';
  total: number;
  sent: number;
  failed: number;
  createdAt: string;
  results?: { email: string; ok: boolean; error?: string }[];
}

interface Data {
  campaigns: Campaign[];
  templates: Template[];
  contacts: Contact[];
  from: string | null;
}

const STATUS: Record<Campaign['status'], string> = { enviando: 'Enviando…', enviado: 'Enviado', con_errores: 'Con errores', interrumpido: 'Interrumpido' };
const blank = (): Draft => ({ subject: '', eyebrow: 'DeerSystems', title: '', body: 'Hola {nombre},\n\n', ctaLabel: '', ctaUrl: '', footnote: '', fields: [] });
const emptyRecipient = (): Recipient => ({ email: '', name: '', company: '', data: {} });
const fieldKey = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30);

export function MailPage() {
  const { data, error, loading, reload, setData } = useApi<Data>('mail-campaigns');
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>(blank);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [picking, setPicking] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [sending, setSending] = useState<Campaign | null>(null);
  const [open, setOpen] = useState<Campaign | null>(null);
  const started = useRef(false);
  const { busy, run } = useAction();
  const toast = useToast();

  // Al abrir: la plantilla de renovación (la primera base), lista para llenar.
  useEffect(() => {
    if (!data || started.current) return;
    started.current = true;
    const t = data.templates.find((x) => x.base) ?? data.templates[0];
    if (t) {
      setTemplateId(t.id);
      setDraft(t.draft);
    }
  }, [data]);

  // Mientras se envía, se consulta el avance.
  useEffect(() => {
    if (!sending || sending.status !== 'enviando') return;
    const t = window.setTimeout(async () => {
      const c = await api<Campaign>('GET', `mail-campaigns/${sending.id}`).catch(() => null);
      if (!c) return;
      setSending(c);
      if (c.status !== 'enviando') {
        toast(c.failed ? `Enviado con ${c.failed} errores: revisa el detalle.` : `Listo: ${c.sent} correos enviados.`, !!c.failed);
        reload();
      }
    }, 1500);
    return () => window.clearTimeout(t);
  }, [sending, reload, toast]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const d = data!;
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const valid = recipients.filter((r) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email.trim()));
  const template = d.templates.find((t) => t.id === templateId) ?? null;

  const saveTemplate = (asNew: boolean) => {
    const name = asNew ? prompt('Nombre de la plantilla', template ? `${template.name} (copia)` : draft.subject) : template?.name;
    if (!name) return;
    run(async () => {
      const t = await api<Template>(asNew ? 'POST' : 'PUT', asNew ? 'mail-templates' : `mail-templates/${template!.id}`, { name, draft });
      setData({ ...d, templates: [...d.templates.filter((x) => x.id !== t.id), t].sort((a, b) => a.name.localeCompare(b.name)) });
      setTemplateId(t.id);
      toast('Plantilla guardada.');
    });
  };

  const send = () => {
    if (!valid.length) return toast('Agrega al menos un destinatario con un correo válido.', true);
    if (!confirm(`¿Enviar «${draft.subject}» a ${valid.length} ${valid.length === 1 ? 'destinatario' : 'destinatarios'}?\n\nCada uno recibe su propio correo, con sus datos; nadie ve a los demás.`)) return;
    run(async () => {
      const c = await api<Campaign>('POST', 'mail-campaigns', { draft, recipients: valid });
      setSending(c);
      setData({ ...d, campaigns: [c, ...d.campaigns] });
    });
  };

  return (
    <>
      <PageHead
        eyebrow="Correos"
        title={
          <>
            Correos con tu <span className="grad">marca</span>
          </>
        }
      >
        <p>
          Escribe un mensaje y envíalo a varios clientes a la vez: cada uno recibe su propio correo, con el diseño de DeerSystems y sus datos
          (nombre, dominio, fecha, valor…). {d.from ? <>Sale desde <span className="mono">{d.from}</span>.</> : <strong>Conecta Google en Configuración para enviar.</strong>}
        </p>
      </PageHead>

      <section className="card form-section stack">
        <div className="form-section__head">
          <h2>Mensaje</h2>
          <span className="actions actions--tight">
            <span className="input input--chip">
              <select
                aria-label="Plantilla"
                value={templateId ?? ''}
                onChange={(e) => {
                  const t = d.templates.find((x) => x.id === Number(e.target.value));
                  setTemplateId(t?.id ?? null);
                  setDraft(t ? t.draft : blank());
                }}
              >
                <option value="">En blanco</option>
                {d.templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    Plantilla: {t.name}
                  </option>
                ))}
              </select>
            </span>
            {template && (
              <button className="btn btn--outline btn--sm" disabled={busy} onClick={() => saveTemplate(false)}>
                Guardar cambios en la plantilla
              </button>
            )}
            <button className="btn btn--outline btn--sm" disabled={busy} onClick={() => saveTemplate(true)}>
              Guardar como plantilla nueva
            </button>
            {template && !template.base && (
              <button
                className="btn btn--outline btn--sm btn--danger"
                disabled={busy}
                onClick={() => {
                  if (!confirm(`¿Eliminar la plantilla «${template.name}»?`)) return;
                  run(async () => {
                    await api('DELETE', `mail-templates/${template.id}`);
                    setData({ ...d, templates: d.templates.filter((x) => x.id !== template.id) });
                    setTemplateId(null);
                  });
                }}
              >
                Eliminar plantilla
              </button>
            )}
          </span>
        </div>
        <div className="form-grid">
          <Field label="Asunto" wide>
            <input value={draft.subject} maxLength={200} onChange={(e) => set({ subject: e.target.value })} placeholder="Renovación de tu dominio y hosting · {dominio}" />
          </Field>
          <Field label="Antetítulo (pequeño, en mayúsculas)">
            <input value={draft.eyebrow} maxLength={80} onChange={(e) => set({ eyebrow: e.target.value })} placeholder="Renovación de servicios" />
          </Field>
          <Field label="Título">
            <input value={draft.title} maxLength={200} onChange={(e) => set({ title: e.target.value })} placeholder="Es momento de renovar tu dominio y hosting" />
          </Field>
          <label className="field field--wide">
            <span className="field__label">Mensaje</span>
            <textarea rows={11} value={draft.body} onChange={(e) => set({ body: e.target.value })} />
            <span className="hint">
              **negrita**, [texto](https://enlace), viñetas con «- » y títulos con «## ». Datos de cada destinatario:{' '}
              {['nombre', 'empresa', 'correo', ...draft.fields].map((f) => (
                <button key={f} type="button" className="mail-var" onClick={() => set({ body: `${draft.body}{${f}}` })} title="Agregar al final del mensaje">
                  {`{${f}}`}
                </button>
              ))}
            </span>
          </label>
          <Field label="Botón (texto, opcional)">
            <input value={draft.ctaLabel} maxLength={80} onChange={(e) => set({ ctaLabel: e.target.value })} placeholder="Pagar la renovación" />
          </Field>
          <Field label="Botón (enlace)">
            <input value={draft.ctaUrl} maxLength={500} onChange={(e) => set({ ctaUrl: e.target.value })} placeholder="https://…" />
          </Field>
          <Field label="Nota al pie (opcional)" wide>
            <input value={draft.footnote} maxLength={500} onChange={(e) => set({ footnote: e.target.value })} />
          </Field>
        </div>
        <FieldsEditor fields={draft.fields} onChange={(fields) => set({ fields })} />
      </section>

      <section className="card form-section stack">
        <div className="form-section__head">
          <h2>Destinatarios ({valid.length})</h2>
          <span className="actions actions--tight">
            <button className="btn btn--outline btn--sm" onClick={() => setPicking(true)}>
              + Elegir clientes
            </button>
            <button className="btn btn--outline btn--sm" onClick={() => setPasting(true)}>
              Pegar lista
            </button>
            <button className="btn btn--outline btn--sm" onClick={() => setRecipients([...recipients, emptyRecipient()])}>
              + Agregar a mano
            </button>
            {!!recipients.length && (
              <button className="btn btn--outline btn--sm" onClick={() => confirm('¿Quitar todos los destinatarios?') && setRecipients([])}>
                Quitar todos
              </button>
            )}
          </span>
        </div>
        {recipients.length ? (
          <div className="mail-table">
            <table>
              <thead>
                <tr>
                  <th>Correo</th>
                  <th>Nombre</th>
                  <th>Empresa</th>
                  {draft.fields.map((f) => (
                    <th key={f}>{f}</th>
                  ))}
                  <th aria-label="Quitar" />
                </tr>
              </thead>
              <tbody>
                {recipients.map((r, i) => {
                  const upd = (patch: Partial<Recipient>) => setRecipients(recipients.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                  return (
                    <tr key={i}>
                      <td>
                        <input value={r.email} onChange={(e) => upd({ email: e.target.value })} placeholder="correo@empresa.com" aria-label="Correo" />
                      </td>
                      <td>
                        <input value={r.name} onChange={(e) => upd({ name: e.target.value })} aria-label="Nombre" />
                      </td>
                      <td>
                        <input value={r.company} onChange={(e) => upd({ company: e.target.value })} aria-label="Empresa" />
                      </td>
                      {draft.fields.map((f) => (
                        <td key={f}>
                          <input value={r.data[f] ?? ''} onChange={(e) => upd({ data: { ...r.data, [f]: e.target.value } })} aria-label={f} />
                        </td>
                      ))}
                      <td>
                        <button className="icon-btn" onClick={() => setRecipients(recipients.filter((_, j) => j !== i))} aria-label="Quitar">
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Elige clientes, pega una lista o agrégalos a mano. Cada uno recibe su propio correo.</Empty>
        )}
      </section>

      <Preview draft={draft} recipients={valid} canSend={!!d.from} busy={busy || sending?.status === 'enviando'} onSend={send} />

      {sending && (
        <p className={`callout${sending.failed ? ' callout--warn' : ''}`} role="status">
          {sending.status === 'enviando'
            ? `Enviando… ${sending.sent + sending.failed} de ${sending.total}`
            : `${STATUS[sending.status]}: ${sending.sent} de ${sending.total} enviados${sending.failed ? `, ${sending.failed} con error` : ''}.`}
        </p>
      )}

      <section className="section">
        <div className="section__head">
          <h2>Enviados</h2>
          <span className="mono">{d.campaigns.length}</span>
        </div>
        {d.campaigns.length ? (
          <div className="list">
            {d.campaigns.map((c) => (
              <article key={c.id} className="item card">
                <div>
                  <div className="item__title">
                    {c.subject}
                    <span className={`tag${c.failed ? ' tag--warn' : ''}`}>{STATUS[c.status]}</span>
                  </div>
                  <div className="item__meta">
                    <span>{formatDateTime(c.createdAt)}</span>
                    <span>
                      {c.sent} de {c.total} enviados
                    </span>
                    {!!c.failed && <span>{c.failed} con error</span>}
                  </div>
                  {open?.id === c.id && open.results && (
                    <ul className="mail-results">
                      {open.results.map((r) => (
                        <li key={r.email} className={r.ok ? '' : 'is-error'}>
                          {r.ok ? '✓' : '✕'} {r.email}
                          {r.error ? ` · ${r.error}` : ''}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="item__actions">
                  <button
                    className="btn btn--outline btn--sm"
                    onClick={() => (open?.id === c.id ? setOpen(null) : run(async () => setOpen(await api<Campaign>('GET', `mail-campaigns/${c.id}`))))}
                  >
                    {open?.id === c.id ? 'Ocultar' : 'Ver detalle'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty>Todavía no has enviado correos desde aquí.</Empty>
        )}
      </section>

      {picking && (
        <PickContacts
          contacts={d.contacts}
          already={new Set(recipients.map((r) => r.email.toLowerCase()))}
          onClose={() => setPicking(false)}
          onPick={(list) => {
            setRecipients([...recipients.filter((r) => r.email.trim()), ...list.map((c) => ({ email: c.email, name: c.name, company: c.company, data: {} }))]);
            setPicking(false);
          }}
        />
      )}
      {pasting && (
        <PasteList
          fields={draft.fields}
          onClose={() => setPasting(false)}
          onAdd={(list) => {
            const seen = new Set(recipients.map((r) => r.email.toLowerCase()));
            setRecipients([...recipients.filter((r) => r.email.trim()), ...list.filter((r) => !seen.has(r.email.toLowerCase()))]);
            setPasting(false);
          }}
        />
      )}
    </>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <label className={`field${wide ? ' field--wide' : ''}`}>
      <span className="field__label">{label}</span>
      <span className="input">{children}</span>
    </label>
  );
}

/** Los datos propios de cada destinatario: columnas de la tabla y variables del mensaje. */
function FieldsEditor({ fields, onChange }: { fields: string[]; onChange: (f: string[]) => void }) {
  const [text, setText] = useState('');
  const add = () => {
    const k = fieldKey(text);
    if (k && !fields.includes(k) && !['nombre', 'empresa', 'correo'].includes(k)) onChange([...fields, k]);
    setText('');
  };
  return (
    <div className="mail-fields">
      <span className="field__label">Datos de cada destinatario</span>
      <div className="mail-fields__row">
        {fields.map((f) => (
          <span key={f} className="tag">
            {`{${f}}`}{' '}
            <button className="mail-fields__x" onClick={() => onChange(fields.filter((x) => x !== f))} aria-label={`Quitar ${f}`}>
              ✕
            </button>
          </span>
        ))}
        <span className="input input--chip">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
            placeholder="p. ej. dominio, vence, valor"
            aria-label="Nuevo dato"
          />
        </span>
        <button className="btn btn--outline btn--sm" onClick={add} disabled={!fieldKey(text)}>
          + Agregar dato
        </button>
      </div>
      <span className="hint">Cada dato es una columna en la tabla de destinatarios y se usa en el texto como {'{dato}'}.</span>
    </div>
  );
}

function Preview({ draft, recipients, canSend, busy, onSend }: { draft: Draft; recipients: Recipient[]; canSend: boolean; busy: boolean; onSend: () => void }) {
  const [index, setIndex] = useState(0);
  const [preview, setPreview] = useState<{ to: string; subject: string; html: string; missing: { email: string; fields: string[] }[] } | null>(null);
  const { busy: testing, run } = useAction();
  const toast = useToast();
  const i = Math.min(index, Math.max(0, recipients.length - 1));

  // La vista previa se actualiza sola al escribir (con una pausa corta).
  useEffect(() => {
    const t = window.setTimeout(() => {
      api<typeof preview>('POST', 'mail-campaigns/preview', { draft, recipients, index: i })
        .then(setPreview)
        .catch(() => {});
    }, 400);
    return () => window.clearTimeout(t);
  }, [draft, recipients, i]);

  return (
    <section className="card form-section stack">
      <div className="form-section__head">
        <h2>Vista previa</h2>
        {recipients.length > 1 && (
          <span className="input input--chip">
            <select value={i} onChange={(e) => setIndex(Number(e.target.value))} aria-label="Ver como">
              {recipients.map((r, j) => (
                <option key={r.email} value={j}>
                  Como lo ve: {r.name || r.email}
                </option>
              ))}
            </select>
          </span>
        )}
      </div>
      {preview && (
        <>
          <div className="mail-accordion__meta">
            <span>
              <small>Para</small>
              {preview.to}
            </span>
            <span>
              <small>Asunto</small>
              {preview.subject}
            </span>
          </div>
          {!!preview.missing.length && (
            <p className="callout callout--warn">
              A {preview.missing.length === 1 ? 'un destinatario le faltan' : `${preview.missing.length} destinatarios les faltan`} datos que usa el mensaje:{' '}
              {preview.missing
                .slice(0, 4)
                .map((m) => `${m.email} (${m.fields.join(', ')})`)
                .join(' · ')}
              {preview.missing.length > 4 ? '…' : ''}
            </p>
          )}
          {/* sandbox sin permisos: el HTML del correo no ejecuta nada en el portal. */}
          <iframe className="mail-preview" sandbox="" srcDoc={preview.html} title="Vista previa del correo" />
        </>
      )}
      <div className="actions actions--tight">
        <button className="btn btn--primary" disabled={busy || !canSend || !recipients.length || !draft.subject || !draft.body} onClick={onSend}>
          {recipients.length ? `Enviar a ${recipients.length} ${recipients.length === 1 ? 'destinatario' : 'destinatarios'}` : 'Enviar'}
        </button>
        <button
          className="btn btn--outline"
          disabled={testing || busy || !canSend || !draft.subject || !draft.body}
          title="Te llega a tu correo con los datos del destinatario que estás viendo"
          onClick={() =>
            run(async () => {
              const r = await api<{ to: string }>('POST', 'mail-campaigns/test', { draft, recipients, index: i });
              toast(`Prueba enviada a ${r.to}.`);
            })
          }
        >
          {testing ? 'Enviando prueba…' : 'Enviarme una prueba'}
        </button>
      </div>
    </section>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => ref.current?.showModal(), []);
  return (
    <dialog ref={ref} className="modal" onClose={onClose} onClick={(e) => e.target === e.currentTarget && ref.current?.close()}>
      <div className="modal__in">
        <header className="modal__head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={() => ref.current?.close()} aria-label="Cerrar">
            ✕
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}

function PickContacts({ contacts, already, onClose, onPick }: { contacts: Contact[]; already: Set<string>; onClose: () => void; onPick: (c: Contact[]) => void }) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const shown = contacts.filter((c) => !already.has(c.email) && norm(`${c.company} ${c.name} ${c.email}`).includes(norm(q)));
  const toggle = (e: string) => {
    const next = new Set(picked);
    if (next.has(e)) next.delete(e);
    else next.add(e);
    setPicked(next);
  };
  return (
    <Modal title="Elegir clientes" onClose={onClose}>
      <span className="input">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por cliente, nombre o correo" autoFocus />
      </span>
      <div className="mail-pick">
        {shown.length ? (
          shown.map((c) => (
            <label key={c.email} className="check">
              <input type="checkbox" checked={picked.has(c.email)} onChange={() => toggle(c.email)} />
              <span>
                <strong>{c.company}</strong> · {c.name || c.email}
                <small>
                  {c.email} · {c.label}
                </small>
              </span>
            </label>
          ))
        ) : (
          <p className="hint">No hay más clientes con correo.</p>
        )}
      </div>
      <div className="actions actions--tight">
        <button className="btn btn--primary btn--sm" disabled={!picked.size} onClick={() => onPick(contacts.filter((c) => picked.has(c.email)))}>
          Agregar {picked.size || ''}
        </button>
        <button className="btn btn--outline btn--sm" disabled={!shown.length} onClick={() => setPicked(new Set([...picked, ...shown.map((c) => c.email)]))}>
          Marcar todos ({shown.length})
        </button>
      </div>
    </Modal>
  );
}

function PasteList({ fields, onClose, onAdd }: { fields: string[]; onClose: () => void; onAdd: (r: Recipient[]) => void }) {
  const [text, setText] = useState('');
  const cols = ['correo', 'nombre', 'empresa', ...fields];
  const parsed = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split(/\t|;|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((x) => x.trim().replace(/^"|"$/g, '')))
    .filter((p) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p[0] ?? ''))
    .map((p) => ({ email: p[0], name: p[1] ?? '', company: p[2] ?? '', data: Object.fromEntries(fields.map((f, j) => [f, p[3 + j] ?? ''])) }));
  return (
    <Modal title="Pegar lista de destinatarios" onClose={onClose}>
      <p className="hint">
        Uno por línea, separado por comas, punto y coma o tabulaciones (puedes copiar y pegar desde Excel o Google Sheets), en este orden:{' '}
        <span className="mono">{cols.join(', ')}</span>. Solo el correo es obligatorio.
      </p>
      <textarea rows={9} value={text} onChange={(e) => setText(e.target.value)} placeholder={`ana@empresa.com, Ana Pérez, Empresa S.A.S.${fields.length ? `, ${fields.map((f) => `<${f}>`).join(', ')}` : ''}`} autoFocus />
      <div className="actions actions--tight">
        <button className="btn btn--primary btn--sm" disabled={!parsed.length} onClick={() => onAdd(parsed)}>
          Agregar {parsed.length || ''}
        </button>
      </div>
    </Modal>
  );
}
