import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, useApi } from '../lib';
import { Empty, ErrorBox, Loading, MoneyInput, useAction, useToast } from '../ui';
import type { ProposalRow } from './Proposals';

/**
 * Plantillas de propuestas: los planes para agencias y las propuestas a la medida, guardados como datos.
 * Con «Usar» se publica una propuesta con la marca (y botón de aprobar) para un cliente, lista para enviar.
 */

type Billing = 'unico' | 'mensual' | 'anual' | 'hora';
type Category = 'agencia' | 'personalizada';

interface Item {
  name: string;
  description: string;
  price: number;
  billing: Billing;
  optional: boolean;
  details: string[];
}

export interface TemplateData {
  title: string;
  agency: string;
  endClient: string;
  intro: string;
  currency: 'COP' | 'USD';
  items: Item[];
  includes: string[];
  terms: string[];
  validityDays: number;
}

interface Template {
  id: number;
  name: string;
  category: Category;
  base: boolean;
  uses: number;
  updatedAt: string;
  data: TemplateData;
  totals: Record<Billing, number>;
}

interface ClientOption {
  id: number;
  name: string;
}

const BILLING: Record<Billing, string> = { unico: 'Pago único', mensual: 'Mensual', anual: 'Anual', hora: 'Por hora' };
const PERIOD: Record<Billing, string> = { unico: 'único', mensual: '/ mes', anual: '/ año', hora: '/ hora' };
const money = (n: number, c: TemplateData['currency']) => (c === 'USD' ? `USD $${n.toLocaleString('es-CO')}` : `$${n.toLocaleString('es-CO')}`);

const emptyItem = (): Item => ({ name: '', description: '', price: 0, billing: 'unico', optional: false, details: [] });
const emptyData = (): TemplateData => ({
  title: '',
  agency: '',
  endClient: '',
  intro: '',
  currency: 'COP',
  items: [emptyItem()],
  includes: [],
  terms: ['Pagos: 50% para iniciar y 50% al entregar.', 'Valores en pesos colombianos (COP).'],
  validityDays: 30,
});

/** Igual que slugify() del servidor. */
const slugify = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);

const defaultSlug = (d: TemplateData) => {
  const who = d.endClient || d.agency;
  return slugify(who && !d.title.toLowerCase().includes(who.toLowerCase()) ? `${d.title} ${who}` : d.title);
};

function totalsLine(t: Pick<Template, 'totals'>, c: TemplateData['currency']) {
  return (Object.keys(PERIOD) as Billing[])
    .filter((b) => t.totals[b] > 0)
    .map((b) => `${money(t.totals[b], c)} ${PERIOD[b]}`)
    .join(' · ');
}

type Editing = { id: number | null; name: string; category: Category; data: TemplateData };

export function ProposalTemplates({ onPublished }: { onPublished: (p: ProposalRow, send: boolean) => void }) {
  const { data, error, loading, reload, setData } = useApi<Template[]>('proposal-templates');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [ai, setAi] = useState(false);
  const [using, setUsing] = useState<{ id: number; name: string; data: TemplateData } | null>(null);
  const [previewing, setPreviewing] = useState<{ id: number; html: string } | null>(null);
  const { busy, run } = useAction();
  const toast = useToast();

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const list = data!;

  const saved = (t: Template) => {
    setData(list.some((x) => x.id === t.id) ? list.map((x) => (x.id === t.id ? t : x)) : [...list, t]);
    return t;
  };

  if (editing) {
    return (
      <TemplateEditor
        initial={editing}
        onCancel={() => setEditing(null)}
        onSaved={(t) => {
          saved(t);
          setEditing({ id: t.id, name: t.name, category: t.category, data: t.data });
        }}
        onUse={(t, d) => setUsing({ id: t.id, name: t.name, data: d })}
        using={using}
        onCloseUse={() => setUsing(null)}
        onPublished={(p, send) => {
          setUsing(null);
          reload();
          onPublished(p, send);
        }}
      />
    );
  }

  const groups: { key: Category; title: string; hint: string }[] = [
    { key: 'agencia', title: 'Para agencias', hint: 'Planes prediseñados para asignar a una agencia o a su cliente.' },
    { key: 'personalizada', title: 'Personalizadas', hint: 'Las propuestas a la medida que guardas para volver a usar.' },
  ];

  return (
    <>
      <div className="tpl-toolbar">
        <p>
          Elige una plantilla, ajústala para el cliente y publícala: queda en propuestas con su enlace y el botón de aprobar, lista para enviar por
          correo.
        </p>
        <span className="actions actions--tight">
          <button className="btn btn--outline btn--sm" onClick={() => setAi(true)}>
            ✨ Crear con IA
          </button>
          <button className="btn btn--primary btn--sm" onClick={() => setEditing({ id: null, name: '', category: 'personalizada', data: emptyData() })}>
            + Propuesta personalizada
          </button>
        </span>
      </div>

      {groups.map((g) => {
        const rows = list.filter((t) => t.category === g.key);
        return (
          <section className="section" key={g.key}>
            <div className="section__head">
              <h2>{g.title}</h2>
              <span className="mono">{rows.length}</span>
            </div>
            <p className="hint tpl-hint">{g.hint}</p>
            {rows.length ? (
              <div className="list">
                {rows.map((t) => (
                  <article key={t.id} className="item card tpl">
                    <div>
                      <div className="item__title">
                        {t.name}
                        {t.base && <span className="tag">Base</span>}
                      </div>
                      <div className="tpl__sub">
                        {t.data.title}
                        {(t.data.agency || t.data.endClient) && <> · para {[t.data.agency, t.data.endClient].filter(Boolean).join(' / ')}</>}
                      </div>
                      <div className="item__meta">
                        <span>{totalsLine(t, t.data.currency) || 'Sin valores'}</span>
                        {t.data.items.some((i) => i.optional) && <span>+ {t.data.items.filter((i) => i.optional).length} opcionales</span>}
                        <span>{t.uses ? `Usada ${t.uses} ${t.uses === 1 ? 'vez' : 'veces'}` : 'Sin usar'}</span>
                      </div>
                    </div>
                    <div className="item__actions">
                      <button className="btn btn--primary btn--sm" onClick={() => setUsing({ id: t.id, name: t.name, data: t.data })}>
                        Usar
                      </button>
                      <button
                        className="btn btn--outline btn--sm"
                        disabled={busy}
                        title="Ver la propuesta tal como la verá el cliente"
                        onClick={() => run(async () => setPreviewing({ id: t.id, html: await previewHtml(t.data) }))}
                      >
                        Vista previa
                      </button>
                      <button className="btn btn--outline btn--sm" onClick={() => setEditing({ id: t.id, name: t.name, category: t.category, data: t.data })}>
                        Editar
                      </button>
                      <button
                        className="btn btn--outline btn--sm"
                        onClick={() => setEditing({ id: null, name: `${t.name} (copia)`, category: 'personalizada', data: structuredClone(t.data) })}
                      >
                        Duplicar
                      </button>
                      <button
                        className="btn btn--outline btn--sm btn--danger"
                        disabled={busy}
                        onClick={() => {
                          if (!confirm(`¿Eliminar la plantilla «${t.name}»? Las propuestas ya publicadas con ella no cambian.`)) return;
                          run(async () => {
                            await api('DELETE', `proposal-templates/${t.id}`);
                            setData(list.filter((x) => x.id !== t.id));
                            toast('Plantilla eliminada.');
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
              <Empty>{g.key === 'personalizada' ? 'Aún no tienes propuestas personalizadas: crea una o duplica una plantilla.' : 'No hay plantillas.'}</Empty>
            )}
          </section>
        );
      })}

      {ai && (
        <AiDialog
          onClose={() => setAi(false)}
          onDraft={(name, d) => {
            setAi(false);
            setEditing({ id: null, name, category: 'personalizada', data: d });
          }}
        />
      )}
      {previewing && (
        <PreviewDialog
          html={previewing.html}
          onClose={() => setPreviewing(null)}
          onUse={() => {
            const t = list.find((x) => x.id === previewing.id);
            setPreviewing(null);
            if (t) setUsing({ id: t.id, name: t.name, data: t.data });
          }}
        />
      )}
      {using && (
        <PublishDialog
          template={using}
          onClose={() => setUsing(null)}
          onPublished={(p, send) => {
            setUsing(null);
            reload();
            onPublished(p, send);
          }}
        />
      )}
    </>
  );
}

// ───────── Editor ─────────

function TemplateEditor({
  initial,
  onCancel,
  onSaved,
  onUse,
  using,
  onCloseUse,
  onPublished,
}: {
  initial: Editing;
  onCancel: () => void;
  onSaved: (t: Template) => void;
  onUse: (t: Template, d: TemplateData) => void;
  using: { id: number; name: string; data: TemplateData } | null;
  onCloseUse: () => void;
  onPublished: (p: ProposalRow, send: boolean) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [category, setCategory] = useState<Category>(initial.category);
  const [d, setD] = useState<TemplateData>(initial.data);
  const [preview, setPreview] = useState<string | null>(null);
  const { busy, run } = useAction();
  const toast = useToast();
  const set = (patch: Partial<TemplateData>) => setD({ ...d, ...patch });
  const setItem = (i: number, patch: Partial<Item>) => set({ items: d.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const move = (i: number, by: number) => {
    const items = [...d.items];
    const [x] = items.splice(i, 1);
    items.splice(i + by, 0, x);
    set({ items });
  };

  const save = () =>
    run(async () => {
      const t = await api<Template>(initial.id ? 'PUT' : 'POST', initial.id ? `proposal-templates/${initial.id}` : 'proposal-templates', { name, category, data: d });
      onSaved(t);
      toast('Plantilla guardada.');
      return t;
    });

  return (
    <div className="card form-section stack tpl-editor">
      <div className="form-section__head">
        <h2>{initial.id ? 'Editar plantilla' : 'Nueva propuesta personalizada'}</h2>
        <button className="btn btn--outline btn--sm" onClick={onCancel}>
          ← Volver a las plantillas
        </button>
      </div>

      <div className="form-grid">
        <Field label="Nombre de la plantilla (solo para ti)">
          <input value={name} maxLength={160} onChange={(e) => setName(e.target.value)} placeholder="Chatbot Grupo Oral Flex Click Lab" />
        </Field>
        <Field label="Tipo">
          <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            <option value="agencia">Para agencias</option>
            <option value="personalizada">Personalizada</option>
          </select>
        </Field>
        <Field label="Título que ve el cliente" wide>
          <input value={d.title} maxLength={200} onChange={(e) => set({ title: e.target.value })} placeholder="Chatbot con inteligencia artificial para…" />
        </Field>
        <Field label="Preparada para (cliente o agencia)">
          <input value={d.agency} maxLength={160} onChange={(e) => set({ agency: e.target.value })} placeholder="Click Lab" />
        </Field>
        <Field label="Cliente final (si es una agencia)">
          <input value={d.endClient} maxLength={160} onChange={(e) => set({ endClient: e.target.value })} placeholder="Grupo Oral Flex" />
        </Field>
        <label className="field field--wide">
          <span className="field__label">Introducción</span>
          <textarea rows={3} maxLength={3000} value={d.intro} onChange={(e) => set({ intro: e.target.value })} placeholder="Qué se propone y para qué." />
        </label>
        <Field label="Moneda">
          <select value={d.currency} onChange={(e) => set({ currency: e.target.value as TemplateData['currency'] })}>
            <option value="COP">COP (pesos colombianos)</option>
            <option value="USD">USD (dólares)</option>
          </select>
        </Field>
        <Field label="Vigencia (días)">
          <input type="number" min={1} max={365} value={d.validityDays} onChange={(e) => set({ validityDays: Number(e.target.value) || 30 })} />
        </Field>
      </div>

      <div>
        <h3 className="subhead">Ítems e inversión</h3>
        <div className="tpl-items">
          {d.items.map((it, i) => (
            <div key={i} className={`tpl-item${it.optional ? ' is-optional' : ''}`}>
              <div className="tpl-item__row">
                <span className="input tpl-item__name">
                  <input value={it.name} maxLength={160} placeholder="Concepto (p. ej. Instalación y setup)" onChange={(e) => setItem(i, { name: e.target.value })} />
                </span>
                <span className="input tpl-item__price">
                  <span className="input__prefix">{d.currency === 'USD' ? 'USD $' : '$'}</span>
                  <MoneyInput value={String(it.price || '')} onChange={(v) => setItem(i, { price: Math.round(Number(v) || 0) })} placeholder="0" aria-label="Valor" />
                </span>
                <span className="input input--chip">
                  <select value={it.billing} onChange={(e) => setItem(i, { billing: e.target.value as Billing })} aria-label="Cobro">
                    {(Object.keys(BILLING) as Billing[]).map((b) => (
                      <option key={b} value={b}>
                        {BILLING[b]}
                      </option>
                    ))}
                  </select>
                </span>
                <label className="check tpl-item__opt" title="Adicional que el cliente puede sumar; no entra en los totales">
                  <input type="checkbox" checked={it.optional} onChange={(e) => setItem(i, { optional: e.target.checked })} /> Opcional
                </label>
                <span className="tpl-item__tools">
                  <button type="button" className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Subir">
                    ↑
                  </button>
                  <button type="button" className="icon-btn" disabled={i === d.items.length - 1} onClick={() => move(i, 1)} aria-label="Bajar">
                    ↓
                  </button>
                  <button type="button" className="icon-btn" onClick={() => set({ items: d.items.filter((_, j) => j !== i) })} aria-label="Quitar ítem">
                    ✕
                  </button>
                </span>
              </div>
              <span className="input">
                <input value={it.description} maxLength={600} placeholder="Descripción (p. ej. hasta 800 chats mensuales)" onChange={(e) => setItem(i, { description: e.target.value })} />
              </span>
              <textarea
                rows={2}
                value={it.details.join('\n')}
                placeholder="Qué incluye: un punto por línea (opcional)"
                onChange={(e) => setItem(i, { details: e.target.value.split('\n') })}
              />
            </div>
          ))}
        </div>
        <button type="button" className="btn btn--outline btn--sm" onClick={() => set({ items: [...d.items, emptyItem()] })}>
          + Agregar ítem
        </button>
      </div>

      <div className="form-grid">
        <label className="field">
          <span className="field__label">Qué incluye (un punto por línea, opcional)</span>
          <textarea rows={4} value={d.includes.join('\n')} onChange={(e) => set({ includes: e.target.value.split('\n') })} />
        </label>
        <label className="field">
          <span className="field__label">Condiciones (un punto por línea)</span>
          <textarea rows={4} value={d.terms.join('\n')} onChange={(e) => set({ terms: e.target.value.split('\n') })} />
        </label>
      </div>

      <div className="actions actions--tight">
        <button className="btn btn--primary" disabled={busy} onClick={save}>
          {busy ? 'Guardando…' : 'Guardar plantilla'}
        </button>
        <button
          className="btn btn--outline"
          disabled={busy}
          onClick={() =>
            run(async () => {
              setPreview(await previewHtml(d));
            })
          }
        >
          Vista previa
        </button>
        <button
          className="btn btn--outline"
          disabled={busy}
          title="Se guarda la plantilla y se publica una propuesta para un cliente"
          onClick={async () => {
            const t = await save();
            if (t) onUse(t, t.data);
          }}
        >
          Guardar y publicar para un cliente
        </button>
      </div>

      {preview !== null && <PreviewDialog html={preview} onClose={() => setPreview(null)} />}
      {using && <PublishDialog template={using} onClose={onCloseUse} onPublished={onPublished} />}
    </div>
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

// ───────── Diálogos ─────────

function Modal({ title, wide, onClose, children, busy }: { title: string; wide?: boolean; onClose: () => void; children: ReactNode; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => ref.current?.showModal(), []);
  return (
    <dialog
      ref={ref}
      className={`modal${wide ? ' modal--send tpl-preview' : ' modal--sm'}`}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) ref.current?.close();
      }}
    >
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

/** El HTML de la propuesta tal como se publicaría (con el diseño del Cotizador 2026). */
const previewHtml = async (data: TemplateData) => (await api<{ html: string }>('POST', 'proposal-templates/preview', { data })).html;

function PreviewDialog({ html, onClose, onUse }: { html: string; onClose: () => void; onUse?: () => void }) {
  return (
    <Modal title="Vista previa de la propuesta" wide onClose={onClose}>
      {onUse && (
        <div className="actions actions--tight tpl-preview__bar">
          <span className="hint">Así la verá el cliente. La fecha y el número de propuesta se ponen al publicarla.</span>
          <button className="btn btn--primary btn--sm" onClick={onUse}>
            Usar esta plantilla
          </button>
        </div>
      )}
      {/* La presentación se dibuja con su propio JavaScript: solo scripts, sin acceso al portal (sin allow-same-origin). */}
      <iframe className="mail-preview tpl-preview__frame" sandbox="allow-scripts" srcDoc={html} title="Vista previa de la propuesta" />
    </Modal>
  );
}

function AiDialog({ onClose, onDraft }: { onClose: () => void; onDraft: (name: string, d: TemplateData) => void }) {
  const [brief, setBrief] = useState('');
  const { busy, run } = useAction();
  return (
    <Modal title="Crear una propuesta con IA" onClose={onClose} busy={busy}>
      <p className="hint">
        Describe el servicio, para quién es y los valores. La IA arma la propuesta (ítems, cobros, opcionales y condiciones) y la revisas antes de
        guardarla.
      </p>
      <textarea
        rows={7}
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
        placeholder="Ej.: Automatización de WhatsApp para la clínica Sonrisas, presentada por la agencia Click Lab. Setup $900.000 pago único, IA $60.000 al mes hasta 500 chats, servidor $850.000 al año. Opcional: soporte $200.000 al mes."
      />
      <div className="actions actions--tight">
        <button
          className="btn btn--primary btn--sm"
          disabled={busy || brief.trim().length < 20}
          onClick={() =>
            run(async () => {
              const r = await api<{ name: string; data: TemplateData }>('POST', 'proposal-templates/draft', { brief });
              onDraft(r.name, { ...r.data, items: r.data.items.length ? r.data.items : [emptyItem()] });
            })
          }
        >
          {busy ? 'Armando la propuesta…' : 'Armar propuesta'}
        </button>
      </div>
    </Modal>
  );
}

function PublishDialog({
  template,
  onClose,
  onPublished,
}: {
  template: { id: number; name: string; data: TemplateData };
  onClose: () => void;
  onPublished: (p: ProposalRow, send: boolean) => void;
}) {
  const clients = useApi<ClientOption[]>('clients');
  const [agency, setAgency] = useState(template.data.agency);
  const [endClient, setEndClient] = useState(template.data.endClient);
  const [clientId, setClientId] = useState('');
  const [slug, setSlug] = useState('');
  const [done, setDone] = useState<ProposalRow | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const { busy, run } = useAction();
  const toast = useToast();
  const data = { ...template.data, agency, endClient };
  const host = location.host.replace(/^partners\./, 'propuestas.');

  if (done) {
    return (
      <Modal title="Propuesta publicada" onClose={() => onPublished(done, false)}>
        <p>
          Quedó en <a href={done.url} target="_blank" rel="noopener">{done.url.replace(/^https?:\/\//, '')}</a>
          {done.client ? <> y asignada a <strong>{done.client.name}</strong></> : null}. Aparece en la lista de propuestas publicadas.
        </p>
        <div className="actions actions--tight">
          <button className="btn btn--primary btn--sm" onClick={() => onPublished(done, true)}>
            Enviar por correo
          </button>
          <button
            className="btn btn--outline btn--sm"
            onClick={() => navigator.clipboard.writeText(done.url).then(() => toast('Enlace copiado.'), () => toast('No se pudo copiar.', true))}
          >
            Copiar enlace
          </button>
          <a className="btn btn--outline btn--sm" href={done.url} target="_blank" rel="noopener">
            Ver propuesta
          </a>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={`Usar «${template.name}»`} onClose={onClose} busy={busy}>
      <div className="form-grid">
        <label className="field field--wide">
          <span className="field__label">Asignar a un cliente (opcional)</span>
          <span className="input">
            <select
              value={clientId}
              onChange={(e) => {
                setClientId(e.target.value);
                const c = clients.data?.find((x) => String(x.id) === e.target.value);
                if (c && !agency) setAgency(c.name);
              }}
            >
              <option value="">Cliente nuevo (llena sus datos al aprobar)</option>
              {(clients.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </span>
        </label>
        <Field label="Preparada para">
          <input value={agency} maxLength={160} onChange={(e) => setAgency(e.target.value)} placeholder="Cliente o agencia" />
        </Field>
        <Field label="Cliente final">
          <input value={endClient} maxLength={160} onChange={(e) => setEndClient(e.target.value)} />
        </Field>
        <label className="field field--wide">
          <span className="field__label">URL de la propuesta</span>
          <span className="input">
            <span className="input__prefix">{host}/</span>
            <input value={slug || defaultSlug(data)} maxLength={120} spellCheck={false} onChange={(e) => setSlug(slugify(e.target.value) || e.target.value)} />
          </span>
        </label>
      </div>
      <p className="hint">Se publica con los valores de la plantilla. Para cambiar ítems o precios solo para este cliente, duplica la plantilla y edítala.</p>
      <div className="actions actions--tight">
        <button
          className="btn btn--primary btn--sm"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const p = await api<ProposalRow>('POST', `proposal-templates/${template.id}/publish`, {
                data,
                clientId: Number(clientId) || null,
                slug: slug || defaultSlug(data),
              });
              setDone(p);
            })
          }
        >
          {busy ? 'Publicando…' : 'Publicar propuesta'}
        </button>
        <button className="btn btn--outline btn--sm" disabled={busy} onClick={() => run(async () => setPreview(await previewHtml(data)))}>
          Vista previa
        </button>
      </div>
      {preview !== null && <PreviewDialog html={preview} onClose={() => setPreview(null)} />}
    </Modal>
  );
}
