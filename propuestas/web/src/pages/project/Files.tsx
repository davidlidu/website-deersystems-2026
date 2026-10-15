import { useRef, useState, type DragEvent } from 'react';
import { api, formatDateTime, formatSize, timeAgo, upload, useApi, type Attachment, type Me } from '../../lib';
import { pickFromDrive } from '../../picker';
import { Empty, ErrorBox, Loading, useAction, useToast } from '../../ui';

/** Etiqueta corta del tipo de archivo, con color por familia. */
function kindOf(a: Attachment): { label: string; tone: string } {
  const m = a.mime;
  if (m === 'application/vnd.google-apps.document') return { label: 'DOC', tone: 'doc' };
  if (m === 'application/vnd.google-apps.spreadsheet') return { label: 'HOJA', tone: 'sheet' };
  if (m === 'application/vnd.google-apps.presentation') return { label: 'PPT', tone: 'slide' };
  const ext = (a.name.split('.').pop() ?? '').toLowerCase();
  if (/^image\//.test(m)) return { label: ext.toUpperCase().slice(0, 4) || 'IMG', tone: 'image' };
  if (m === 'application/pdf') return { label: 'PDF', tone: 'pdf' };
  if (/(sheet|excel|csv)/.test(m) || ['xls', 'xlsx', 'csv'].includes(ext)) return { label: ext.toUpperCase() || 'XLS', tone: 'sheet' };
  if (/(word|document)/.test(m) || ['doc', 'docx'].includes(ext)) return { label: ext.toUpperCase() || 'DOC', tone: 'doc' };
  if (/(presentation|powerpoint)/.test(m) || ['ppt', 'pptx'].includes(ext)) return { label: ext.toUpperCase(), tone: 'slide' };
  if (/(zip|compressed|rar)/.test(m)) return { label: 'ZIP', tone: 'zip' };
  if (/^video\//.test(m)) return { label: 'VID', tone: 'video' };
  return { label: (ext || 'ARCH').toUpperCase().slice(0, 4), tone: 'other' };
}

const Icon = {
  eye: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  download: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  ),
  trash: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M9 7V4h6v3" />
    </svg>
  ),
  drive: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
      <path d="M8.5 3h7l6 10.5-3.5 6h-12L2.5 13.5Z" />
      <path d="M8.5 3 15 13.5H2.5M15.5 3 9 13.5l3 6" />
    </svg>
  ),
};

function FileRow({ a, onChange, onRemove }: { a: Attachment; onChange: (a: Attachment) => void; onRemove: (a: Attachment) => void }) {
  const { busy, run } = useAction();
  const toast = useToast();
  const kind = kindOf(a);
  const download = `/api/attachments/${a.id}/download`;

  const toggle = () => {
    const next = a.visibility === 'shared' ? 'internal' : 'shared';
    const msg =
      next === 'shared'
        ? `¿Compartir «${a.name}» con el cliente? Podrá verlo y descargarlo, y recibirá un aviso.`
        : `¿Volver interno «${a.name}»? El cliente deja de verlo y se quita el acceso por enlace en Drive.`;
    if (!confirm(msg)) return;
    run(async () => {
      onChange(await api<Attachment>('PATCH', `attachments/${a.id}`, { visibility: next }));
      toast(next === 'shared' ? 'Archivo compartido con el cliente.' : 'Archivo interno.');
    });
  };

  return (
    <li className={`file${a.visibility === 'internal' ? ' is-internal' : ''}`}>
      <span className={`file__badge file__badge--${kind.tone}`} aria-hidden="true">
        {kind.label}
      </span>
      <div className="file__main">
        <a className="file__name" href={download} download={a.downloadName} title={a.name}>
          {a.name}
        </a>
        <span className="file__meta">
          {a.size ? `${formatSize(a.size)} · ` : ''}
          {a.authorName} · <time title={formatDateTime(a.createdAt)}>{timeAgo(a.createdAt)}</time>
          {a.linked && <span title="Enlazado desde tu Drive: quitarlo de aquí no lo borra de Drive"> · desde Drive</span>}
        </span>
      </div>
      <span className="file__actions">
        {a.canChangeVisibility ? (
          <button
            className={`vis-chip vis-chip--${a.visibility}`}
            disabled={busy}
            onClick={toggle}
            title={a.visibility === 'shared' ? 'Lo ve el cliente. Clic para volverlo interno.' : 'Solo lo ve tu equipo. Clic para compartirlo con el cliente.'}
          >
            {a.visibility === 'shared' ? 'Compartido' : 'Interno'}
          </button>
        ) : null}
        {a.viewUrl && (
          <a className="icon-btn" href={a.viewUrl} target="_blank" rel="noopener" title="Ver" aria-label={`Ver ${a.name}`}>
            {Icon.eye}
          </a>
        )}
        <a className="icon-btn" href={download} download={a.downloadName} title="Descargar" aria-label={`Descargar ${a.name}`}>
          {Icon.download}
        </a>
        {a.canDelete && (
          <button className="icon-btn icon-btn--danger" disabled={busy} onClick={() => onRemove(a)} title="Quitar" aria-label={`Quitar ${a.name}`}>
            {Icon.trash}
          </button>
        )}
      </span>
    </li>
  );
}

/**
 * Archivos del proyecto (o de una tarea), guardados en Google Drive en la carpeta del cliente.
 * El cliente los ve y descarga desde aquí sin necesitar cuenta de Google.
 */
export function FilesPanel({
  me,
  projectId,
  taskId,
  onChange,
}: {
  me: Me;
  projectId: number;
  taskId?: number;
  onChange?: (delta: number) => void;
}) {
  const { data, error, loading, reload, setData } = useApi<Attachment[]>(
    `projects/${projectId}/attachments${taskId ? `?taskId=${taskId}` : ''}`,
  );
  const [internal, setInternal] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { run } = useAction();
  const toast = useToast();
  const staff = me.role !== 'client';
  const owner = me.role === 'owner';
  const visibility = internal ? 'internal' : 'shared';

  const add = (added: Attachment[]) => {
    setData([...added, ...(data ?? [])]);
    onChange?.(added.length);
  };

  const send = async (files: FileList | File[]) => {
    const list = [...files];
    if (!list.length) return;
    const tooBig = list.find((f) => f.size > 50 * 1024 * 1024);
    if (tooBig) return toast(`«${tooBig.name}» supera los 50 MB.`, true);
    await run(async () => {
      const added: Attachment[] = [];
      try {
        for (const [i, f] of list.entries()) {
          setUploading(list.length > 1 ? `Subiendo ${i + 1} de ${list.length}: ${f.name}` : `Subiendo ${f.name}…`);
          added.push(await upload<Attachment>(`projects/${projectId}/attachments`, f, { ...(taskId ? { taskId: String(taskId) } : {}), visibility }));
        }
        toast(list.length > 1 ? `${list.length} archivos subidos.` : 'Archivo subido.');
      } finally {
        if (added.length) add(added.reverse());
        setUploading(null);
      }
    });
  };

  const fromDrive = () =>
    run(async () => {
      const picked = await pickFromDrive();
      if (!picked.length) return;
      setUploading(`Agregando ${picked.length === 1 ? `«${picked[0].name}»` : `${picked.length} archivos`} desde Drive…`);
      try {
        const added = await api<Attachment[]>('POST', `projects/${projectId}/attachments/drive`, {
          fileIds: picked.map((p) => p.id),
          taskId,
          visibility,
        });
        add(added);
        toast(added.length === 1 ? 'Archivo agregado desde Drive.' : `${added.length} archivos agregados desde Drive.`);
      } finally {
        setUploading(null);
      }
    });

  const remove = (a: Attachment) => {
    const msg = a.linked
      ? `¿Quitar «${a.name}» del proyecto? El archivo sigue en tu Drive.`
      : `¿Quitar «${a.name}»? Queda en la papelera de Drive por 30 días.`;
    if (!confirm(msg)) return;
    run(async () => {
      await api('DELETE', `attachments/${a.id}`);
      setData((data ?? []).filter((x) => x.id !== a.id));
      onChange?.(-1);
    });
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (e.dataTransfer.files.length) send(e.dataTransfer.files);
  };

  return (
    <div className="files">
      <div
        className={`dropzone${over ? ' is-over' : ''}${uploading ? ' is-busy' : ''}`}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        {uploading ? (
          <span className="loading">
            <span className="loading__dot" /> {uploading}
          </span>
        ) : (
          <>
            <span>
              Arrastra archivos aquí o{' '}
              <button className="linklike" onClick={() => input.current?.click()}>
                elígelos
              </button>{' '}
              · máx. 50 MB
            </span>
            <span className="dropzone__tools">
              {owner && (
                <button className="btn btn--outline btn--sm" onClick={fromDrive}>
                  {Icon.drive} Desde mi Drive
                </button>
              )}
              {staff && (
                <span className="segmented segmented--sm">
                  <button className={!internal ? 'is-active' : ''} onClick={() => setInternal(false)}>
                    Compartido con el cliente
                  </button>
                  <button className={internal ? 'is-active' : ''} onClick={() => setInternal(true)}>
                    Interno
                  </button>
                </span>
              )}
            </span>
          </>
        )}
        <input
          ref={input}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) send(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : data!.length ? (
        <ul className="file-list">
          {data!.map((a) => (
            <FileRow key={a.id} a={a} onChange={(u) => setData(data!.map((x) => (x.id === u.id ? u : x)))} onRemove={remove} />
          ))}
        </ul>
      ) : (
        <Empty>{taskId ? 'Esta tarea no tiene archivos.' : 'Todavía no hay archivos en el proyecto.'}</Empty>
      )}
    </div>
  );
}
