import { useRef, useState, type DragEvent } from 'react';
import { api, formatDateTime, formatSize, timeAgo, upload, useApi, type Attachment, type Me } from '../../lib';
import { Empty, ErrorBox, Loading, useAction, useToast } from '../../ui';

const ICONS: [RegExp, string][] = [
  [/^image\//, '🖼'],
  [/pdf$/, '📕'],
  [/(sheet|excel|csv)/, '📊'],
  [/(word|document|text)/, '📄'],
  [/(zip|compressed|rar)/, '🗜'],
  [/(presentation|powerpoint)/, '📽'],
  [/^video\//, '🎞'],
];
const iconFor = (mime: string) => ICONS.find(([re]) => re.test(mime))?.[1] ?? '📎';
const previewable = (mime: string) => /^image\/(png|jpeg|gif|webp)$/.test(mime) || mime === 'application/pdf';

/**
 * Archivos del proyecto (o de una tarea), guardados en Google Drive en la carpeta del cliente.
 * El cliente los ve y descarga desde aquí sin necesitar acceso al Drive.
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
          added.push(
            await upload<Attachment>(`projects/${projectId}/attachments`, f, {
              ...(taskId ? { taskId: String(taskId) } : {}),
              visibility: internal ? 'internal' : 'shared',
            }),
          );
        }
        toast(list.length > 1 ? `${list.length} archivos subidos.` : 'Archivo subido.');
      } finally {
        if (added.length) {
          setData([...added.reverse(), ...(data ?? [])]);
          onChange?.(added.length);
        }
        setUploading(null);
      }
    });
  };

  const remove = (a: Attachment) => {
    if (!confirm(`¿Quitar «${a.name}»? Queda en la papelera de Drive por 30 días.`)) return;
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
            {staff && (
              <div className="segmented segmented--sm">
                <button className={!internal ? 'is-active' : ''} onClick={() => setInternal(false)}>
                  Compartido con el cliente
                </button>
                <button className={internal ? 'is-active' : ''} onClick={() => setInternal(true)}>
                  Interno
                </button>
              </div>
            )}
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
            <li key={a.id} className={`file${a.visibility === 'internal' ? ' is-internal' : ''}`}>
              <span className="file__icon" aria-hidden="true">
                {iconFor(a.mime)}
              </span>
              <div className="file__main">
                <a className="file__name" href={`/api/attachments/${a.id}/download`} download={a.name}>
                  {a.name}
                </a>
                <span className="file__meta">
                  {formatSize(a.size)} · {a.authorName} · <time title={formatDateTime(a.createdAt)}>{timeAgo(a.createdAt)}</time>
                  {a.visibility === 'internal' && <span className="tag tag--internal">Interno</span>}
                </span>
              </div>
              <span className="file__actions">
                {previewable(a.mime) && (
                  <a href={`/api/attachments/${a.id}/download?inline=1`} target="_blank" rel="noopener">
                    Ver
                  </a>
                )}
                {a.driveUrl && (
                  <a href={a.driveUrl} target="_blank" rel="noopener">
                    Drive
                  </a>
                )}
                {a.canDelete && <button onClick={() => remove(a)}>Quitar</button>}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>{taskId ? 'Esta tarea no tiene archivos.' : 'Todavía no hay archivos en el proyecto.'}</Empty>
      )}
    </div>
  );
}
