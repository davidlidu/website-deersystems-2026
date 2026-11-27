import { useEffect, useRef, useState } from 'react';
import { ApiError, formatDateTime, formatSize } from '../lib';
import { Loading, useToast } from '../ui';

/**
 * El formulario que llena el cliente con su enlace (/f/{token}), sin iniciar sesión. Se guarda solo mientras escribe;
 * al final lo envía. Los archivos: solo PNG, JPG, PDF, Excel y Word.
 */

export type FieldType = 'seccion' | 'texto' | 'parrafo' | 'email' | 'telefono' | 'numero' | 'fecha' | 'url' | 'unica' | 'multiple' | 'lista' | 'sino' | 'escala' | 'archivo';

export interface Field {
  id: string;
  type: FieldType;
  label: string;
  help: string;
  required: boolean;
  options: string[];
}

export interface FormDef {
  title: string;
  description: string;
  fields: Field[];
  allowFiles: boolean;
  comments: boolean;
}

export interface FormFile {
  id: number;
  fieldId: string | null;
  name: string;
  mime: string;
  size: number;
  url: string;
}

export interface LinkDetail {
  id: number;
  title: string;
  clientName: string;
  projectName: string | null;
  status: 'pendiente' | 'en_progreso' | 'enviado';
  progress: { done: number; total: number };
  submittedAt: string | null;
  submittedBy: string | null;
  def: FormDef;
  answers: Record<string, unknown>;
  comment: string;
  fileList: FormFile[];
}

export const ACCEPT = '.png,.jpg,.jpeg,.pdf,.xls,.xlsx,.doc,.docx';

async function call<T>(method: string, path: string, body?: unknown, raw?: File): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: raw ? { 'Content-Type': 'application/octet-stream' } : body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Error ${res.status}`);
  return data as T;
}

export function FormFillPage({ token }: { token: string }) {
  const base = `/api/public/forms/${token}`;
  const [d, setD] = useState<LinkDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [comment, setComment] = useState('');
  const [name, setName] = useState('');
  const [saved, setSaved] = useState<'guardado' | 'guardando' | 'sin-guardar' | null>(null);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const dirty = useRef(false);
  const toast = useToast();

  useEffect(() => {
    call<LinkDetail>('GET', base)
      .then((x) => {
        setD(x);
        setAnswers(x.answers);
        setComment(x.comment);
      })
      .catch((e: Error) => setError(e.message));
  }, [base]);

  // Se guarda solo, un segundo después de dejar de escribir.
  useEffect(() => {
    if (!dirty.current || !d || d.status === 'enviado') return;
    setSaved('sin-guardar');
    const t = window.setTimeout(() => {
      setSaved('guardando');
      call('PUT', base, { answers, comment })
        .then(() => setSaved('guardado'))
        .catch((e: Error) => {
          setSaved('sin-guardar');
          toast(e.message, true);
        });
    }, 900);
    return () => window.clearTimeout(t);
  }, [answers, comment]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) {
    return (
      <main className="formfill">
        <div className="formfill__card card">
          <h1>Formulario no disponible</h1>
          <p>{error}</p>
        </div>
      </main>
    );
  }
  if (!d) return <Loading />;
  const locked = d.status === 'enviado';
  const set = (id: string, v: unknown) => {
    dirty.current = true;
    setAnswers({ ...answers, [id]: v });
  };

  const upload = async (file: File, fieldId: string | null) => {
    setUploading(fieldId ?? '_');
    try {
      const q = new URLSearchParams({ filename: file.name, ...(fieldId ? { field: fieldId } : {}) });
      const x = await call<LinkDetail>('POST', `${base}/files?${q}`, undefined, file);
      setD({ ...d, fileList: x.fileList, progress: x.progress });
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setUploading(null);
    }
  };
  const removeFile = async (f: FormFile) => {
    try {
      const x = await call<LinkDetail>('DELETE', `${base}/files/${f.id}`);
      setD({ ...d, fileList: x.fileList, progress: x.progress });
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const submit = async () => {
    setSending(true);
    try {
      const x = await call<LinkDetail>('POST', `${base}/submit`, { answers, comment, name });
      setD(x);
      window.scrollTo(0, 0);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setSending(false);
    }
  };

  return (
    <main className="formfill">
      <a className="formfill__brand" href="https://deersystems.net">
        <span className="grad">Deer</span>Systems
      </a>
      <div className="formfill__card card">
        <p className="eyebrow">{d.clientName}{d.projectName ? ` · ${d.projectName}` : ''}</p>
        <h1>{d.def.title}</h1>
        {d.def.description && <p className="formfill__desc">{d.def.description}</p>}
        {locked ? (
          <p className="callout">
            ✓ Enviado{d.submittedAt ? ` el ${formatDateTime(d.submittedAt)}` : ''}. ¡Gracias! Si necesitas cambiar algo, responde el correo o escríbenos y lo
            reabrimos.
          </p>
        ) : (
          <p className="hint">Se guarda solo mientras escribes: puedes dejarlo y seguir después con el mismo enlace. Los campos con * son obligatorios.</p>
        )}

        <div className="formfill__fields">
          {d.def.fields.map((f) => (
            <FieldInput
              key={f.id}
              field={f}
              value={answers[f.id]}
              locked={locked}
              files={d.fileList.filter((x) => x.fieldId === f.id)}
              uploading={uploading === f.id}
              onChange={(v) => set(f.id, v)}
              onUpload={(file) => upload(file, f.id)}
              onRemoveFile={removeFile}
            />
          ))}
        </div>

        {d.def.allowFiles && (
          <section className="formfill__section">
            <h2>Archivos</h2>
            <p className="hint">Imágenes PNG o JPG, documentos PDF, Excel o Word. Hasta 15 MB cada uno.</p>
            <FileList files={d.fileList.filter((x) => !x.fieldId)} locked={locked} onRemove={removeFile} />
            {!locked && <FilePicker busy={uploading === '_'} onPick={(file) => upload(file, null)} />}
          </section>
        )}

        {d.def.comments && (
          <section className="formfill__section">
            <h2>Comentarios</h2>
            <textarea
              rows={4}
              value={comment}
              disabled={locked}
              placeholder="¿Algo más que debamos saber?"
              onChange={(e) => {
                dirty.current = true;
                setComment(e.target.value);
              }}
            />
          </section>
        )}

        {!locked && (
          <div className="formfill__submit">
            <label className="field">
              <span className="field__label">Tu nombre (quién lo llena)</span>
              <span className="input">
                <input value={name} maxLength={160} onChange={(e) => setName(e.target.value)} />
              </span>
            </label>
            <div className="actions actions--tight">
              <button className="btn btn--primary" disabled={sending} onClick={submit}>
                {sending ? 'Enviando…' : 'Enviar formulario'}
              </button>
              <span className="hint">
                {saved === 'guardando' ? 'Guardando…' : saved === 'guardado' ? 'Cambios guardados' : saved === 'sin-guardar' ? 'Cambios sin guardar…' : ''} ·{' '}
                {d.progress.done} de {d.progress.total} respondidas
              </span>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

export function FieldInput({
  field: f,
  value,
  locked,
  files,
  uploading,
  onChange,
  onUpload,
  onRemoveFile,
}: {
  field: Field;
  value: unknown;
  locked: boolean;
  files: FormFile[];
  uploading: boolean;
  onChange: (v: unknown) => void;
  onUpload: (file: File) => void;
  onRemoveFile: (f: FormFile) => void;
}) {
  if (f.type === 'seccion') {
    return (
      <div className="formfill__heading">
        <h2>{f.label}</h2>
        {f.help && <p className="hint">{f.help}</p>}
      </div>
    );
  }
  const label = (
    <span className="field__label formfill__label">
      {f.label}
      {f.required && <span className="formfill__req"> *</span>}
    </span>
  );
  const help = f.help ? <span className="hint">{f.help}</span> : null;
  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  const inputType: Partial<Record<FieldType, string>> = { texto: 'text', email: 'email', telefono: 'tel', numero: 'number', fecha: 'date', url: 'url' };

  if (inputType[f.type]) {
    return (
      <label className="field">
        {label}
        <span className="input">
          <input type={inputType[f.type]} value={text} disabled={locked} required={f.required} onChange={(e) => onChange(e.target.value)} />
        </span>
        {help}
      </label>
    );
  }
  if (f.type === 'parrafo') {
    return (
      <label className="field">
        {label}
        <textarea rows={4} value={text} disabled={locked} onChange={(e) => onChange(e.target.value)} />
        {help}
      </label>
    );
  }
  if (f.type === 'lista') {
    return (
      <label className="field">
        {label}
        <span className="input">
          <select value={text} disabled={locked} onChange={(e) => onChange(e.target.value)}>
            <option value="">Elige una opción</option>
            {f.options.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </span>
        {help}
      </label>
    );
  }
  if (f.type === 'unica' || f.type === 'sino' || f.type === 'escala') {
    const opts = f.type === 'sino' ? [['si', 'Sí'], ['no', 'No']] : f.type === 'escala' ? ['1', '2', '3', '4', '5'].map((x) => [x, x]) : f.options.map((o) => [o, o]);
    return (
      <fieldset className="field formfill__choices">
        <legend>{label}</legend>
        <div className={f.type === 'escala' ? 'formfill__scale' : 'formfill__opts'}>
          {opts.map(([v, l]) => (
            <label key={v} className="check">
              <input type="radio" name={f.id} checked={String(value ?? '') === v} disabled={locked} onChange={() => onChange(f.type === 'escala' ? Number(v) : v)} />
              {l}
            </label>
          ))}
        </div>
        {f.type === 'escala' && <span className="hint">1 = muy poco · 5 = mucho</span>}
        {help}
      </fieldset>
    );
  }
  if (f.type === 'multiple') {
    const list = Array.isArray(value) ? (value as string[]) : [];
    return (
      <fieldset className="field formfill__choices">
        <legend>{label}</legend>
        <div className="formfill__opts">
          {f.options.map((o) => (
            <label key={o} className="check">
              <input type="checkbox" checked={list.includes(o)} disabled={locked} onChange={(e) => onChange(e.target.checked ? [...list, o] : list.filter((x) => x !== o))} />
              {o}
            </label>
          ))}
        </div>
        {help}
      </fieldset>
    );
  }
  // archivo
  return (
    <div className="field">
      {label}
      {help}
      <FileList files={files} locked={locked} onRemove={onRemoveFile} />
      {!locked && <FilePicker busy={uploading} onPick={onUpload} />}
    </div>
  );
}

export function FileList({ files, locked, onRemove }: { files: FormFile[]; locked: boolean; onRemove?: (f: FormFile) => void }) {
  if (!files.length) return null;
  return (
    <ul className="formfill__files">
      {files.map((f) => (
        <li key={f.id}>
          <a href={f.url} target="_blank" rel="noopener">
            {f.name}
          </a>{' '}
          <span className="hint">{formatSize(f.size)}</span>
          {!locked && onRemove && (
            <button type="button" className="icon-btn" onClick={() => onRemove(f)} aria-label={`Quitar ${f.name}`}>
              ✕
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function FilePicker({ busy, onPick }: { busy: boolean; onPick: (f: File) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className="btn btn--outline btn--sm" disabled={busy} onClick={() => ref.current?.click()}>
        {busy ? 'Subiendo…' : 'Subir archivo'}
      </button>
      <input
        ref={ref}
        type="file"
        hidden
        accept={ACCEPT}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onPick(file);
          e.target.value = '';
        }}
      />
    </>
  );
}
