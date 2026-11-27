import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, formatDateTime, useApi, useLocation } from '../lib';
import { Empty, ErrorBox, Loading, PageHead, useAction, useToast } from '../ui';
import { ClientsTabs } from './Home';
import { FieldInput, FileList, type Field, type FieldType, type FormDef, type LinkDetail } from './FormFill';

/**
 * Formularios y onboardings: los creas (a mano o con IA), los envías a un cliente con su enlace y ves lo que respondió.
 * Las respuestas quedan en el espacio del cliente.
 */

interface FormItem {
  id: number;
  def: FormDef;
  updatedAt: string;
  sent: number;
  answered: number;
}

export interface LinkSummary {
  id: number;
  formId: number | null;
  title: string;
  clientId: number;
  clientName: string;
  projectName: string | null;
  status: 'pendiente' | 'en_progreso' | 'enviado';
  url: string;
  progress: { done: number; total: number };
  files: number;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
}

interface ClientOpt {
  id: number;
  name: string;
  email: string | null;
  contact: string;
  projects: { id: number; name: string }[];
}

interface Data {
  forms: FormItem[];
  links: LinkSummary[];
  clients: ClientOpt[];
}

export const FIELD_LABEL: Record<FieldType, string> = {
  seccion: 'Título de sección',
  texto: 'Texto corto',
  parrafo: 'Párrafo',
  email: 'Correo',
  telefono: 'Teléfono',
  numero: 'Número',
  fecha: 'Fecha',
  url: 'Enlace (URL)',
  unica: 'Selección única',
  multiple: 'Selección múltiple',
  lista: 'Lista desplegable',
  sino: 'Sí / No',
  escala: 'Escala de 1 a 5',
  archivo: 'Subir archivo',
};
const WITH_OPTIONS: FieldType[] = ['unica', 'multiple', 'lista'];
export const LINK_STATUS: Record<LinkSummary['status'], string> = { pendiente: 'Sin abrir', en_progreso: 'Llenando', enviado: 'Enviado' };

const newId = () => `c${Math.random().toString(36).slice(2, 8)}`;
const blankField = (type: FieldType = 'texto'): Field => ({ id: newId(), type, label: '', help: '', required: false, options: type === 'sino' ? [] : WITH_OPTIONS.includes(type) ? ['Opción 1', 'Opción 2'] : [] });
const blankDef = (): FormDef => ({ title: '', description: '', fields: [blankField()], allowFiles: true, comments: true });

export function FormsPage() {
  const { data, error, loading, reload, setData } = useApi<Data>('forms');
  const { query } = useLocation();
  const [editing, setEditing] = useState<{ id: number | null; def: FormDef } | null>(null);
  const [ai, setAi] = useState(false);
  const [sending, setSending] = useState<FormItem | null>(null);
  const [viewing, setViewing] = useState<number | null>(Number(query.get('envio')) || null);
  const { busy, run } = useAction();
  const toast = useToast();

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const d = data!;

  if (editing) {
    return (
      <FormEditor
        initial={editing}
        onCancel={() => setEditing(null)}
        onSaved={(f) => {
          setData({ ...d, forms: [f, ...d.forms.filter((x) => x.id !== f.id)] });
          setEditing(null);
          toast('Formulario guardado.');
        }}
      />
    );
  }

  return (
    <>
      <ClientsTabs active="formularios" />
      <PageHead
        eyebrow="Formularios"
        title={
          <>
            Formularios y <span className="grad">onboardings</span>
          </>
        }
      >
        <p>
          Crea el formulario (o pídeselo a la IA), envíaselo a un cliente con su enlace y sus respuestas, archivos y comentarios quedan en su espacio. El
          cliente lo llena sin iniciar sesión y se guarda solo mientras escribe.
        </p>
      </PageHead>

      <div className="actions actions--tight">
        <button className="btn btn--primary btn--sm" onClick={() => setEditing({ id: null, def: blankDef() })}>
          + Nuevo formulario
        </button>
        <button className="btn btn--outline btn--sm" onClick={() => setAi(true)}>
          ✨ Crear con IA
        </button>
      </div>

      <section className="section">
        <div className="section__head">
          <h2>Formularios</h2>
          <span className="mono">{d.forms.length}</span>
        </div>
        {d.forms.length ? (
          <div className="list">
            {d.forms.map((f) => (
              <article key={f.id} className="item card">
                <div>
                  <div className="item__title">{f.def.title}</div>
                  {f.def.description && <div className="tpl__sub">{f.def.description}</div>}
                  <div className="item__meta">
                    <span>{f.def.fields.filter((x) => x.type !== 'seccion').length} preguntas</span>
                    {f.def.allowFiles && <span>con archivos</span>}
                    <span>
                      Enviado {f.sent} {f.sent === 1 ? 'vez' : 'veces'} · {f.answered} respondidos
                    </span>
                  </div>
                </div>
                <div className="item__actions tpl-actions">
                  <button className="btn btn--primary btn--sm" onClick={() => setSending(f)}>
                    Enviar a un cliente
                  </button>
                  <button className="btn btn--outline btn--sm" onClick={() => setEditing({ id: f.id, def: f.def })}>
                    Editar
                  </button>
                  <button className="btn btn--outline btn--sm" onClick={() => setEditing({ id: null, def: { ...structuredClone(f.def), title: `${f.def.title} (copia)` } })}>
                    Duplicar
                  </button>
                  <button
                    className="btn btn--outline btn--sm btn--danger"
                    disabled={busy}
                    onClick={() => {
                      if (!confirm(`¿Eliminar «${f.def.title}»? Lo que ya enviaste a clientes se conserva.`)) return;
                      run(async () => {
                        await api('DELETE', `forms/${f.id}`);
                        setData({ ...d, forms: d.forms.filter((x) => x.id !== f.id) });
                      });
                    }}
                  >
                    Eliminar
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty>Todavía no tienes formularios. Crea uno o pídeselo a la IA (p. ej. «Onboarding para un sitio web en WordPress»).</Empty>
        )}
      </section>

      <section className="section">
        <div className="section__head">
          <h2>Enviados a clientes</h2>
          <span className="mono">{d.links.length}</span>
        </div>
        <LinkList links={d.links} onView={setViewing} onChange={reload} />
      </section>

      {ai && (
        <AiDialog
          onClose={() => setAi(false)}
          onDraft={(def) => {
            setAi(false);
            setEditing({ id: null, def });
          }}
        />
      )}
      {sending && (
        <SendDialog
          form={sending}
          clients={d.clients}
          onClose={() => setSending(null)}
          onSent={(l) => {
            setData({ ...d, links: [l, ...d.links], forms: d.forms.map((x) => (x.id === sending.id ? { ...x, sent: x.sent + 1 } : x)) });
          }}
        />
      )}
      {viewing && <AnswersDialog id={viewing} onClose={() => setViewing(null)} onChange={reload} />}
    </>
  );
}

/** Lista de formularios enviados (en la página de Formularios y en la ficha del cliente). */
export function LinkList({ links, onView, onChange }: { links: LinkSummary[]; onView: (id: number) => void; onChange: () => void }) {
  const { busy, run } = useAction();
  const toast = useToast();
  if (!links.length) return <Empty>Aún no has enviado formularios.</Empty>;
  return (
    <div className="list">
      {links.map((l) => (
        <article key={l.id} className="item card">
          <div>
            <div className="item__title">
              {l.title}
              <span className={`tag${l.status === 'enviado' ? ' tag--activo' : l.status === 'en_progreso' ? ' tag--warn' : ''}`}>{LINK_STATUS[l.status]}</span>
            </div>
            <div className="tpl__sub">
              {l.clientName}
              {l.projectName ? ` · ${l.projectName}` : ''}
            </div>
            <div className="item__meta">
              <span>
                {l.progress.done} de {l.progress.total} respondidas
              </span>
              {!!l.files && <span>{l.files} archivos</span>}
              <span>{l.submittedAt ? `Enviado ${formatDateTime(l.submittedAt)}` : `Creado ${formatDateTime(l.createdAt)}`}</span>
            </div>
          </div>
          <div className="item__actions tpl-actions">
            <button className="btn btn--primary btn--sm" onClick={() => onView(l.id)}>
              Ver respuestas
            </button>
            <button
              className="btn btn--outline btn--sm"
              onClick={() => navigator.clipboard.writeText(l.url).then(() => toast('Enlace copiado.'), () => toast('No se pudo copiar.', true))}
            >
              Copiar enlace
            </button>
            {l.status === 'enviado' && (
              <button className="btn btn--outline btn--sm" disabled={busy} onClick={() => run(async () => { await api('POST', `form-links/${l.id}/reopen`); toast('Reabierto: el cliente puede volver a editarlo.'); onChange(); })}>
                Reabrir
              </button>
            )}
            <button
              className="btn btn--outline btn--sm btn--danger"
              disabled={busy}
              onClick={() => {
                if (!confirm(`¿Eliminar «${l.title}» de ${l.clientName}? Se borran sus respuestas y archivos, y el enlace deja de funcionar.`)) return;
                run(async () => {
                  await api('DELETE', `form-links/${l.id}`);
                  onChange();
                });
              }}
            >
              Eliminar
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

// ───────── Editor ─────────

function FormEditor({ initial, onCancel, onSaved }: { initial: { id: number | null; def: FormDef }; onCancel: () => void; onSaved: (f: FormItem) => void }) {
  const [def, setDef] = useState<FormDef>(initial.def);
  const [preview, setPreview] = useState(false);
  const { busy, run } = useAction();
  const set = (patch: Partial<FormDef>) => setDef({ ...def, ...patch });
  const setField = (i: number, patch: Partial<Field>) => set({ fields: def.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  const move = (i: number, by: number) => {
    const fields = [...def.fields];
    const [x] = fields.splice(i, 1);
    fields.splice(i + by, 0, x);
    set({ fields });
  };

  return (
    <div className="card form-section stack">
      <div className="form-section__head">
        <h2>{initial.id ? 'Editar formulario' : 'Nuevo formulario'}</h2>
        <span className="actions actions--tight">
          <button className="btn btn--outline btn--sm" onClick={() => setPreview(!preview)}>
            {preview ? 'Volver a editar' : 'Vista previa'}
          </button>
          <button className="btn btn--outline btn--sm" onClick={onCancel}>
            ← Volver
          </button>
        </span>
      </div>

      {preview ? (
        <div className="formfill__card formfill__card--preview">
          <h1>{def.title || 'Sin título'}</h1>
          {def.description && <p className="formfill__desc">{def.description}</p>}
          <div className="formfill__fields">
            {def.fields.map((f) => (
              <FieldInput key={f.id} field={f} value={undefined} locked={false} files={[]} uploading={false} onChange={() => {}} onUpload={() => {}} onRemoveFile={() => {}} />
            ))}
          </div>
          {def.allowFiles && <p className="hint">+ Sección para subir archivos (PNG, JPG, PDF, Excel, Word).</p>}
          {def.comments && <p className="hint">+ Sección de comentarios al final.</p>}
        </div>
      ) : (
        <>
          <div className="form-grid">
            <Field2 label="Título" wide>
              <input value={def.title} maxLength={200} onChange={(e) => set({ title: e.target.value })} placeholder="Onboarding · Sitio web" />
            </Field2>
            <label className="field field--wide">
              <span className="field__label">Descripción (la ve el cliente arriba)</span>
              <textarea rows={2} value={def.description} onChange={(e) => set({ description: e.target.value })} placeholder="Para arrancar tu proyecto necesitamos estos datos. Te toma unos 10 minutos." />
            </label>
          </div>
          <div className="actions actions--tight">
            <label className="check">
              <input type="checkbox" checked={def.allowFiles} onChange={(e) => set({ allowFiles: e.target.checked })} /> El cliente puede subir archivos (PNG, JPG, PDF, Excel, Word)
            </label>
            <label className="check">
              <input type="checkbox" checked={def.comments} onChange={(e) => set({ comments: e.target.checked })} /> Sección de comentarios al final
            </label>
          </div>

          <h3 className="subhead">Preguntas</h3>
          <div className="tpl-items">
            {def.fields.map((f, i) => (
              <div key={f.id} className={`tpl-item${f.type === 'seccion' ? ' is-section' : ''}`}>
                <div className="tpl-item__row">
                  <span className="input input--chip">
                    <select value={f.type} onChange={(e) => {
                      const type = e.target.value as FieldType;
                      setField(i, { type, options: WITH_OPTIONS.includes(type) ? (f.options.length ? f.options : ['Opción 1', 'Opción 2']) : [], required: type === 'seccion' ? false : f.required });
                    }} aria-label="Tipo de campo">
                      {(Object.keys(FIELD_LABEL) as FieldType[]).map((t) => (
                        <option key={t} value={t}>
                          {FIELD_LABEL[t]}
                        </option>
                      ))}
                    </select>
                  </span>
                  <span className="input tpl-item__name">
                    <input value={f.label} maxLength={300} placeholder={f.type === 'seccion' ? 'Título de la sección' : 'Pregunta'} onChange={(e) => setField(i, { label: e.target.value })} />
                  </span>
                  {f.type !== 'seccion' && (
                    <label className="check tpl-item__opt">
                      <input type="checkbox" checked={f.required} onChange={(e) => setField(i, { required: e.target.checked })} /> Obligatoria
                    </label>
                  )}
                  <span className="tpl-item__tools">
                    <button type="button" className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Subir">
                      ↑
                    </button>
                    <button type="button" className="icon-btn" disabled={i === def.fields.length - 1} onClick={() => move(i, 1)} aria-label="Bajar">
                      ↓
                    </button>
                    <button type="button" className="icon-btn" onClick={() => set({ fields: def.fields.filter((_, j) => j !== i) })} aria-label="Quitar">
                      ✕
                    </button>
                  </span>
                </div>
                <span className="input">
                  <input value={f.help} maxLength={600} placeholder="Ayuda (opcional)" onChange={(e) => setField(i, { help: e.target.value })} />
                </span>
                {WITH_OPTIONS.includes(f.type) && (
                  <textarea rows={3} value={f.options.join('\n')} placeholder="Una opción por línea" onChange={(e) => setField(i, { options: e.target.value.split('\n') })} />
                )}
              </div>
            ))}
          </div>
          <div className="actions actions--tight">
            <button type="button" className="btn btn--outline btn--sm" onClick={() => set({ fields: [...def.fields, blankField()] })}>
              + Pregunta
            </button>
            <button type="button" className="btn btn--outline btn--sm" onClick={() => set({ fields: [...def.fields, blankField('seccion')] })}>
              + Sección
            </button>
          </div>
        </>
      )}

      <div className="actions actions--tight">
        <button
          className="btn btn--primary"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const clean = { ...def, fields: def.fields.map((f) => ({ ...f, options: f.options.map((o) => o.trim()).filter(Boolean) })) };
              onSaved(await api<FormItem>(initial.id ? 'PUT' : 'POST', initial.id ? `forms/${initial.id}` : 'forms', { def: clean }));
            })
          }
        >
          {busy ? 'Guardando…' : 'Guardar formulario'}
        </button>
      </div>
    </div>
  );
}

function Field2({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <label className={`field${wide ? ' field--wide' : ''}`}>
      <span className="field__label">{label}</span>
      <span className="input">{children}</span>
    </label>
  );
}

// ───────── Diálogos ─────────

function Modal({ title, wide, onClose, children }: { title: string; wide?: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => ref.current?.showModal(), []);
  return (
    <dialog ref={ref} className={`modal${wide ? ' modal--send' : ''}`} onClose={onClose} onClick={(e) => e.target === e.currentTarget && ref.current?.close()}>
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

function AiDialog({ onClose, onDraft }: { onClose: () => void; onDraft: (d: FormDef) => void }) {
  const [brief, setBrief] = useState('');
  const { busy, run } = useAction();
  return (
    <Modal title="Crear un formulario con IA" onClose={onClose}>
      <p className="hint">Describe para qué es y qué información necesitas. La IA arma las secciones y preguntas; luego las revisas y ajustas.</p>
      <textarea
        rows={6}
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
        placeholder="Ej.: Onboarding para un chatbot de una clínica odontológica: datos de la clínica, servicios y precios, horarios, preguntas frecuentes, tono de respuesta, y que suban su logo y la lista de precios en Excel."
      />
      <div className="actions actions--tight">
        <button className="btn btn--primary btn--sm" disabled={busy || brief.trim().length < 15} onClick={() => run(async () => onDraft(await api<FormDef>('POST', 'forms/draft', { brief })))}>
          {busy ? 'Armando el formulario…' : 'Armar formulario'}
        </button>
      </div>
    </Modal>
  );
}

function SendDialog({ form, clients, onClose, onSent }: { form: FormItem; clients: ClientOpt[]; onClose: () => void; onSent: (l: LinkSummary) => void }) {
  const [clientId, setClientId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [to, setTo] = useState('');
  const [message, setMessage] = useState(
    'Hola {nombre},\n\nPara avanzar con tu proyecto necesitamos que nos compartas algunos datos. Te toma unos minutos y se guarda solo mientras lo llenas: puedes dejarlo y seguir después.',
  );
  const [done, setDone] = useState<{ link: LinkSummary; mailed: string[]; errors: string[] } | null>(null);
  const { busy, run } = useAction();
  const toast = useToast();
  const client = clients.find((c) => String(c.id) === clientId);

  if (done) {
    return (
      <Modal title="Formulario enviado" onClose={onClose}>
        <p>
          {done.mailed.length ? `Se envió a ${done.mailed.join(', ')}.` : 'Se creó el enlace (sin correo).'} Comparte este enlace si lo necesitas:
        </p>
        <p className="mono formsend__url">{done.link.url}</p>
        {!!done.errors.length && <p className="callout callout--warn">{done.errors.join(' · ')}</p>}
        <div className="actions actions--tight">
          <button className="btn btn--primary btn--sm" onClick={() => navigator.clipboard.writeText(done.link.url).then(() => toast('Enlace copiado.'), () => toast('No se pudo copiar.', true))}>
            Copiar enlace
          </button>
          <a className="btn btn--outline btn--sm" href={done.link.url} target="_blank" rel="noopener">
            Abrir como el cliente
          </a>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={`Enviar «${form.def.title}»`} onClose={onClose}>
      <div className="form-grid">
        <Field2 label="Cliente">
          <select
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value);
              setProjectId('');
              const c = clients.find((x) => String(x.id) === e.target.value);
              setTo(c?.email ?? '');
            }}
          >
            <option value="">Elige el cliente</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field2>
        <Field2 label="Proyecto (opcional)">
          <select value={projectId} disabled={!client} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Sin proyecto</option>
            {client?.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field2>
        <Field2 label="Enviar por correo a (separados por coma; vacío = solo el enlace)" wide>
          <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="cliente@empresa.com" />
        </Field2>
        <label className="field field--wide">
          <span className="field__label">Mensaje del correo</span>
          <textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)} />
        </label>
      </div>
      <p className="hint">El correo sale con tu marca y el botón «Llenar el formulario». Con proyecto, al cliente también le llega el aviso en el portal.</p>
      <div className="actions actions--tight">
        <button
          className="btn btn--primary btn--sm"
          disabled={busy || !client}
          onClick={() =>
            run(async () => {
              const r = await api<{ link: LinkSummary; mailed: string[]; errors: string[] }>('POST', `forms/${form.id}/send`, {
                clientId: Number(clientId),
                projectId: Number(projectId) || null,
                to: to.split(/[,;\s]+/).filter(Boolean),
                message,
              });
              setDone(r);
              onSent(r.link);
            })
          }
        >
          {busy ? 'Enviando…' : to.trim() ? 'Enviar' : 'Crear enlace'}
        </button>
      </div>
    </Modal>
  );
}

/** Las respuestas de un formulario enviado (tú, desde Formularios o la ficha del cliente). */
export function AnswersDialog({ id, onClose, onChange }: { id: number; onClose: () => void; onChange?: () => void }) {
  const [d, setD] = useState<LinkDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<LinkDetail>('GET', `form-links/${id}`).then(setD).catch((e: Error) => setError(e.message));
  }, [id]);
  return (
    <Modal title={d ? d.def.title : 'Respuestas'} wide onClose={() => { onClose(); onChange?.(); }}>
      {error && <ErrorBox message={error} />}
      {!d && !error && <Loading />}
      {d && <FormAnswers d={d} />}
    </Modal>
  );
}

export function FormAnswers({ d }: { d: LinkDetail }) {
  return (
    <div className="answers">
      <p className="hint">
        {d.clientName}
        {d.projectName ? ` · ${d.projectName}` : ''} · {LINK_STATUS[d.status]}
        {d.submittedAt ? ` el ${formatDateTime(d.submittedAt)}` : ''}
        {d.submittedBy ? ` por ${d.submittedBy}` : ''} · {d.progress.done} de {d.progress.total} respondidas
      </p>
      {d.def.fields.map((f) =>
        f.type === 'seccion' ? (
          <h3 key={f.id} className="answers__section">
            {f.label}
          </h3>
        ) : (
          <div key={f.id} className="answers__row">
            <span className="answers__q">{f.label}</span>
            <span className="answers__a">
              {f.type === 'archivo' ? (
                d.fileList.some((x) => x.fieldId === f.id) ? <FileList files={d.fileList.filter((x) => x.fieldId === f.id)} locked /> : '—'
              ) : (
                show(d.answers[f.id], f.type)
              )}
            </span>
          </div>
        ),
      )}
      {!!d.fileList.filter((x) => !x.fieldId).length && (
        <>
          <h3 className="answers__section">Archivos</h3>
          <FileList files={d.fileList.filter((x) => !x.fieldId)} locked />
        </>
      )}
      {d.comment && (
        <>
          <h3 className="answers__section">Comentarios</h3>
          <p className="answers__comment">{d.comment}</p>
        </>
      )}
    </div>
  );
}

function show(v: unknown, type: FieldType): string {
  if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return '—';
  if (Array.isArray(v)) return v.join(', ');
  if (type === 'sino') return v === 'si' ? 'Sí' : 'No';
  if (type === 'escala') return `${v} de 5`;
  return String(v);
}
