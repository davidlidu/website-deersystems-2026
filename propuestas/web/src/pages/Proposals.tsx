import { useRef, useState, type DragEvent, type FormEvent } from 'react';
import { api, ApiError, formatDateTime, formatSize, timeAgo, useApi } from '../lib';
import { Empty, ErrorBox, Link, Loading, PageHead, useAction, useToast } from '../ui';

export interface ProposalRow {
  id: number;
  slug: string;
  title: string;
  url: string;
  active: boolean;
  views: number;
  lastViewedAt: string | null;
  version: number;
  filename: string;
  size: number;
  updatedAt: string;
  projects: { id: number; name: string; clientId: number; approvedOption: string }[];
}

interface Version {
  version: number;
  filename: string;
  size: number;
  note: string;
  createdAt: string;
  createdBy: string;
  current: boolean;
  viewUrl: string;
}

/** Igual que slugify() del servidor: la URL sale del nombre del archivo. */
function slugify(name: string): string {
  return name
    .replace(/\.(html?|zip)$/i, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

/** Sube el archivo crudo (.html o .zip) con parámetros en la URL, igual que el panel de propuestas. */
export async function sendFile<T>(method: 'POST' | 'PUT', path: string, file: File, params: Record<string, string>): Promise<T> {
  const res = await fetch(`/api/${path}?${new URLSearchParams({ filename: file.name, ...params })}`, {
    method,
    headers: { 'Content-Type': 'application/octet-stream' },
    body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Error ${res.status}`);
  return data as T;
}

const ACCEPT = '.html,.htm,.zip';
const valid = (f: File) => /\.(html?|zip)$/i.test(f.name);

function Versions({ proposal, onRestored }: { proposal: ProposalRow; onRestored: (p: ProposalRow) => void }) {
  const { data, error, loading, reload } = useApi<Version[]>(`proposals/${proposal.id}/versions`);
  const { busy, run } = useAction();
  const toast = useToast();
  const restore = (v: Version) => {
    if (!confirm(`¿Volver a publicar la v${v.version}? Se guarda como una versión nueva; la URL no cambia y no se pierde nada.`)) return;
    run(async () => {
      onRestored(await api<ProposalRow>('POST', `proposals/${proposal.id}/versions/${v.version}/restore`));
      toast(`v${v.version} publicada de nuevo.`);
      await reload();
    });
  };
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  return (
    <ol className="versions">
      {data!.map((v) => (
        <li key={v.version} className={v.current ? 'is-current' : ''}>
          <span className="versions__num mono">v{v.version}</span>
          <div className="versions__main">
            <span>
              {v.filename} · {formatSize(v.size)}
              {v.current && <span className="tag tag--activo">Publicada</span>}
            </span>
            <small>
              {formatDateTime(v.createdAt)} · {v.createdBy}
              {v.note ? ` · ${v.note}` : ''}
            </small>
          </div>
          <span className="versions__actions">
            <a href={v.viewUrl} target="_blank" rel="noopener">
              Ver
            </a>
            {!v.current && (
              <button disabled={busy} onClick={() => restore(v)}>
                Restaurar
              </button>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

function ProposalItem({ p, onChange, onRemove }: { p: ProposalRow; onChange: (p: ProposalRow) => void; onRemove: (id: number) => void }) {
  const [showVersions, setShowVersions] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { busy, run } = useAction();
  const toast = useToast();

  const replace = (file: File | undefined) => {
    if (!file) return;
    if (!valid(file)) return toast('Sube un .html o un .zip.', true);
    const note = prompt(`Nueva versión de /${p.slug} con «${file.name}».\nLa URL no cambia y la versión actual queda en el historial.\n\nNota del cambio (opcional):`, '');
    if (note === null) return;
    run(async () => {
      onChange(await sendFile<ProposalRow>('PUT', `proposals/${p.id}/file`, file, { note }));
      toast(`Publicada la v${p.version + 1}. El enlace sigue siendo el mismo.`);
    });
  };
  const toggle = () =>
    run(async () => {
      onChange(await api<ProposalRow>('PATCH', `proposals/${p.id}`, { active: !p.active }));
      toast(p.active ? 'Enlace pausado: el cliente verá un 404.' : 'Enlace activo de nuevo.');
    });
  const rename = () => {
    const title = prompt('Cliente o nota (solo la ves tú):', p.title);
    if (title === null) return;
    run(async () => onChange(await api<ProposalRow>('PATCH', `proposals/${p.id}`, { title })));
  };
  const remove = () => {
    if (!confirm(`¿Eliminar /${p.slug}? El enlace deja de funcionar y se borran todas sus versiones.`)) return;
    run(async () => {
      await api('DELETE', `proposals/${p.id}`);
      onRemove(p.id);
      toast('Propuesta eliminada.');
    });
  };
  const copy = () => navigator.clipboard.writeText(p.url).then(() => toast('Enlace copiado.'));

  return (
    <article className={`item card${p.active ? '' : ' is-paused'}`}>
      <div>
        <div className="item__title">
          {p.title || p.slug}
          {!p.active && <span className="tag tag--pausado">Pausada</span>}
          {p.projects.length > 0 && (
            <span className="tag tag--activo">
              Aprobada
              {[...new Set(p.projects.map((pr) => pr.approvedOption).filter(Boolean))].map((o) => ` · ${o}`)}
            </span>
          )}
        </div>
        <a className="item__url" href={p.url} target="_blank" rel="noopener">
          {p.url.replace(/^https?:\/\//, '')}
        </a>
        <div className="item__meta">
          <button className="linklike" onClick={() => setShowVersions(!showVersions)}>
            v{p.version} · {showVersions ? 'ocultar versiones' : 'ver versiones'}
          </button>
          <span>Actualizada {timeAgo(p.updatedAt)}</span>
          <span>{p.views ? `${p.views} ${p.views === 1 ? 'apertura' : 'aperturas'} · última ${timeAgo(p.lastViewedAt!)}` : 'Sin abrir'}</span>
        </div>
        {p.projects.map((pr) => (
          <Link key={pr.id} className="item__project" to={`/proyectos/${pr.id}`}>
            → {pr.name}
            {pr.approvedOption && ` (${pr.approvedOption})`}
          </Link>
        ))}
        {showVersions && <Versions proposal={p} onRestored={onChange} />}
      </div>
      <div className="item__actions">
        <Link className={`btn btn--sm ${p.projects.length ? 'btn--outline' : 'btn--primary'}`} to={`/propuestas/${p.id}/aprobar`}>
          {p.projects.length ? 'Aprobar de nuevo' : 'Propuesta aprobada'}
        </Link>
        <button className="btn btn--outline btn--sm" onClick={copy}>
          Copiar enlace
        </button>
        <button className="btn btn--outline btn--sm" disabled={busy} onClick={() => input.current?.click()}>
          Nueva versión
        </button>
        <button className="btn btn--outline btn--sm" disabled={busy} onClick={toggle}>
          {p.active ? 'Pausar' : 'Activar'}
        </button>
        <button className="btn btn--outline btn--sm" disabled={busy} onClick={rename}>
          Renombrar
        </button>
        {!p.projects.length && (
          <button className="btn btn--outline btn--sm btn--danger" disabled={busy} onClick={remove}>
            Eliminar
          </button>
        )}
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          hidden
          onChange={(e) => {
            replace(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>
    </article>
  );
}

export function ProposalsPage() {
  const { data, error, loading, reload, setData } = useApi<ProposalRow[]>('proposals');
  const [filter, setFilter] = useState<'pendientes' | 'todas'>('todas');
  const [pending, setPending] = useState<File | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { busy, run } = useAction();
  const toast = useToast();

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const list = data!;
  const rows = list.filter((p) => filter === 'todas' || !p.projects.length);
  const host = list[0]?.url.replace(/^https?:\/\//, '').split('/')[0] ?? 'propuestas.deersystems.net';

  const choose = (file: File | undefined) => {
    if (!file) return;
    if (!valid(file)) return toast('Sube un .html o un .zip.', true);
    setPending(file);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    choose(e.dataTransfer.files[0]);
  };
  const publish = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    run(async () => {
      const created = await sendFile<ProposalRow>('POST', 'proposals', pending!, {
        slug: slugify(String(fd.get('slug'))),
        title: String(fd.get('title') ?? ''),
      });
      setData([created, ...list]);
      setPending(null);
      navigator.clipboard.writeText(created.url).then(
        () => toast('Propuesta publicada. Enlace copiado.'),
        () => toast('Propuesta publicada.'),
      );
    });
  };

  return (
    <>
      <PageHead eyebrow="Propuestas" title={<>Publica y <span className="grad">aprueba</span> propuestas</>}>
        <p>
          Sube el <span className="mono">.html</span> o un <span className="mono">.zip</span> con imágenes. El enlace queda en{' '}
          <span className="mono">{host}</span> y no cambia aunque subas versiones nuevas; las anteriores quedan en el historial.
        </p>
      </PageHead>

      {pending ? (
        <form className="card form-section" onSubmit={publish}>
          <div className="form-section__head">
            <h2>Publicar «{pending.name}»</h2>
            <span className="mono">{formatSize(pending.size)}</span>
          </div>
          <div className="form-grid">
            <label className="field">
              <span className="field__label">URL de la propuesta</span>
              <span className="input">
                <span className="input__prefix">{host}/</span>
                <input name="slug" required minLength={3} maxLength={120} defaultValue={slugify(pending.name)} spellCheck={false} />
              </span>
            </label>
            <label className="field">
              <span className="field__label">Cliente o nota (solo para ti)</span>
              <span className="input">
                <input name="title" maxLength={200} placeholder="Acme S.A.S." />
              </span>
            </label>
          </div>
          <div className="actions actions--tight">
            <button className="btn btn--primary" disabled={busy}>
              {busy ? 'Publicando…' : 'Publicar propuesta'}
            </button>
            <button type="button" className="btn btn--outline" onClick={() => setPending(null)}>
              Cancelar
            </button>
          </div>
        </form>
      ) : (
        <div
          className={`drop${over ? ' is-over' : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => input.current?.click()}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
        >
          <strong>Arrastra la propuesta aquí</strong>
          <span>o haz clic para elegir un .html o un .zip</span>
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            hidden
            onChange={(e) => {
              choose(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
      )}

      <section className="section">
        <div className="section__head">
          <h2>Publicadas</h2>
          <div className="segmented segmented--sm">
            <button className={filter === 'todas' ? 'is-active' : ''} onClick={() => setFilter('todas')}>
              Todas ({list.length})
            </button>
            <button className={filter === 'pendientes' ? 'is-active' : ''} onClick={() => setFilter('pendientes')}>
              Sin aprobar ({list.filter((p) => !p.projects.length).length})
            </button>
          </div>
        </div>
        {rows.length ? (
          <div className="list">
            {rows.map((p) => (
              <ProposalItem
                key={p.id}
                p={p}
                onChange={(updated) => setData(list.map((x) => (x.id === updated.id ? updated : x)))}
                onRemove={(id) => setData(list.filter((x) => x.id !== id))}
              />
            ))}
          </div>
        ) : (
          <Empty>{filter === 'pendientes' ? 'No hay propuestas sin aprobar.' : 'Todavía no has publicado propuestas.'}</Empty>
        )}
      </section>
    </>
  );
}
