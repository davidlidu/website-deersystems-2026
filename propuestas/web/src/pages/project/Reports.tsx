import { useEffect, useRef, useState } from 'react';
import { api, formatDate, formatDateTime, useApi, type Me, type ProjectDetail } from '../../lib';
import { Empty, ErrorBox, Loading, Markdown, useAction, useToast } from '../../ui';
import { Recipients, type MailInfo } from './Updates';

type Kind = 'parcial' | 'final';

interface Report {
  id: number;
  kind: Kind;
  title: string;
  from: string | null;
  to: string | null;
  context: string;
  includePayments: boolean;
  body: string;
  ai: boolean;
  status: 'borrador' | 'publicado';
  publishedAt: string | null;
  emailedAt: string | null;
  emailedTo: string;
  createdAt: string;
  updatedAt: string;
}

interface ReportsData {
  reports: Report[];
  defaults: { from: string; to: string; status: string } | null;
}

const KIND_LABEL: Record<Kind, string> = { parcial: 'Informe parcial', final: 'Informe de cierre' };
const day = (iso: string | null) => (iso ? formatDate(`${iso}T12:00:00`) : '—');
const printUrl = (id: number) => `/api/reports/${id}/print`;

const CONTEXT_HINT: Record<Kind, string> = {
  parcial: 'Ej.: destacar que el CRM ya está en uso por el equipo comercial; mencionar que la integración con el ERP se movió a la siguiente quincena por demora del proveedor.',
  final:
    'Ej.: accesos y credenciales entregados el 15/11 a Ana; garantía de 30 días por errores; capacitación hecha al equipo; recomendación de una fase 2 con la app móvil; agradecer a Alejandro y Lu por su acompañamiento.',
};

/** Crear un informe: tipo, periodo e información para la IA. Lo redacta y queda como borrador. */
function NewReport({ me, project, defaults, onCreated }: { me: Me; project: ProjectDetail; defaults: NonNullable<ReportsData['defaults']>; onCreated: (r: Report) => void }) {
  const [kind, setKind] = useState<Kind>(project.status === 'finalizado' ? 'final' : 'parcial');
  const approved = project.approvedAt.slice(0, 10);
  const [from, setFrom] = useState(kind === 'final' ? approved : defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [context, setContext] = useState('');
  const [payments, setPayments] = useState(false);
  const { busy, run } = useAction();
  const toast = useToast();

  const pick = (k: Kind) => {
    setKind(k);
    setFrom(k === 'final' ? approved : defaults.from);
    setTo(defaults.to);
  };

  const create = () =>
    run(async () => {
      const r = await api<{ report: Report; warning: string | null }>('POST', `projects/${project.id}/reports`, { kind, from, to, context, includePayments: payments });
      if (r.warning) toast(r.warning, true);
      else toast('Borrador listo: revísalo, ajústalo y publícalo.');
      setContext('');
      onCreated(r.report);
    });

  return (
    <div className="card report-new">
      <div className="report-new__head">
        <h2>Nuevo informe</h2>
        <div className="segmented" role="tablist" aria-label="Tipo de informe">
          {(['parcial', 'final'] as Kind[]).map((k) => (
            <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? 'is-active' : ''} onClick={() => pick(k)}>
              {k === 'parcial' ? 'Parcial' : 'De cierre'}
            </button>
          ))}
        </div>
      </div>
      <p className="hint">
        {kind === 'final'
          ? 'Recoge todo el proyecto: lo entregado por fase, reuniones y acuerdos, cambios de alcance, pendientes y siguientes pasos. Al publicarlo puedes dejar el proyecto como finalizado.'
          : 'Resume lo hecho en el periodo: tareas terminadas, reuniones, entregables, lo pendiente del cliente y lo que sigue.'}
      </p>
      <div className="form-grid">
        <label className="field">
          <span className="field__label">Desde</span>
          <span className="input">
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </span>
        </label>
        <label className="field">
          <span className="field__label">Hasta</span>
          <span className="input">
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </span>
        </label>
      </div>
      <label className="field">
        <span className="field__label">Información a tener en cuenta por la IA</span>
        <textarea rows={4} value={context} maxLength={8000} placeholder={CONTEXT_HINT[kind]} onChange={(e) => setContext(e.target.value)} />
      </label>
      {me.role === 'owner' && (
        <label className="scope-check">
          <input type="checkbox" checked={payments} onChange={(e) => setPayments(e.target.checked)} />
          <span>Incluir el estado de pagos (total, pagado y saldo)</span>
        </label>
      )}
      <div className="actions actions--tight">
        <button className="btn btn--primary btn--sm" disabled={busy || !from || !to} onClick={create}>
          {busy ? 'Redactando con IA…' : kind === 'final' ? 'Generar informe de cierre' : 'Generar informe parcial'}
        </button>
        {busy && <small className="hint">Puede tardar unos segundos: la IA revisa todo el proyecto.</small>}
      </div>
    </div>
  );
}

/** Publicar (y enviar por correo): a quién le llega y, si es de cierre, si el proyecto queda finalizado. */
function PublishDialog({ report, project, onDone, onClose }: { report: Report; project: ProjectDetail; onDone: (r: Report, closed: boolean) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const mail = useApi<MailInfo>(`projects/${project.id}/updates/mail`);
  const [info, setInfo] = useState<MailInfo | null>(null);
  const [email, setEmail] = useState(false);
  const [close, setClose] = useState(report.kind === 'final' && project.status !== 'finalizado');
  const [preview, setPreview] = useState<string | null>(null);
  const { busy, run } = useAction();
  const toast = useToast();
  const republish = report.status === 'publicado';

  useEffect(() => {
    ref.current?.showModal();
  }, []);
  useEffect(() => {
    if (mail.data) {
      setInfo(mail.data);
      setEmail(mail.data.canSend);
    }
  }, [mail.data]);

  const showPreview = () =>
    run(async () => {
      const r = await api<{ html: string }>('POST', `reports/${report.id}/mail-preview`, {});
      setPreview(r.html);
    });

  const submit = () =>
    run(async () => {
      if (republish) {
        const r = await api<{ report: Report; emailed: string[] }>('POST', `reports/${report.id}/email`);
        toast(`Informe enviado a ${r.emailed.join(', ')}.`);
        onDone(r.report, false);
      } else {
        const r = await api<{ report: Report; closed: boolean; emailed: string[]; emailError: string | null }>('POST', `reports/${report.id}/publish`, { email, close });
        if (r.emailError) toast(`Publicado, pero el correo no salió: ${r.emailError}`, true);
        else toast(`Informe publicado${r.emailed.length ? ` y enviado a ${r.emailed.join(', ')}` : ''}${r.closed ? '. El proyecto quedó finalizado.' : '.'}`);
        onDone(r.report, r.closed);
      }
      ref.current?.close();
    });

  return (
    <dialog
      ref={ref}
      className="modal modal--send"
      aria-labelledby="report-publish-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) ref.current?.close();
      }}
    >
      <div className="modal__in">
        <header className="modal__head">
          <h2 id="report-publish-title">{republish ? 'Enviar el informe por correo' : 'Publicar el informe'}</h2>
          <button className="icon-btn" onClick={() => ref.current?.close()} aria-label="Cerrar">
            ✕
          </button>
        </header>
        {preview ? (
          <>
            <iframe className="mail-preview" sandbox="" srcDoc={preview} title="Vista previa del correo del informe" />
            <div className="actions actions--tight">
              <button className="btn btn--outline btn--sm" onClick={() => setPreview(null)}>
                ← Volver
              </button>
            </div>
          </>
        ) : (
          <>
            {!republish && <p className="hint">El cliente lo verá en la pestaña Informes de su portal{report.kind === 'final' ? ', con la opción de descargarlo en PDF' : ''}.</p>}
            {mail.loading && !info && <Loading />}
            {info && (
              <div className="report-mail">
                {!republish && (
                  <label className="scope-check">
                    <input type="checkbox" checked={email} disabled={!info.canSend} onChange={(e) => setEmail(e.target.checked)} />
                    <span>Enviarlo también por correo, completo{!info.canSend && info.reason ? <small> · {info.reason}</small> : null}</span>
                  </label>
                )}
                {(email || republish) && info.canSend && <Recipients projectId={project.id} info={info} onChange={setInfo} />}
                {republish && !info.canSend && info.reason && <p className="hint">{info.reason}</p>}
              </div>
            )}
            {!republish && report.kind === 'final' && project.status !== 'finalizado' && (
              <label className="scope-check">
                <input type="checkbox" checked={close} onChange={(e) => setClose(e.target.checked)} />
                <span>Dejar el proyecto como finalizado</span>
              </label>
            )}
            <div className="actions actions--tight">
              <button className="btn btn--primary btn--sm" disabled={busy || !info || (republish && !info.canSend)} onClick={submit}>
                {busy ? 'Un momento…' : republish ? 'Enviar' : email ? 'Publicar y enviar' : 'Publicar'}
              </button>
              {(email || republish) && info?.canSend && (
                <button className="btn btn--outline btn--sm" disabled={busy} onClick={showPreview}>
                  Ver el correo
                </button>
              )}
              <button className="btn btn--outline btn--sm" disabled={busy} onClick={() => ref.current?.close()}>
                Cancelar
              </button>
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}

function ReportItem({
  report,
  staff,
  focused,
  onChange,
  onDelete,
  onPublish,
}: {
  report: Report;
  staff: boolean;
  focused: boolean;
  onChange: (r: Report) => void;
  onDelete: () => void;
  onPublish: () => void;
}) {
  const [open, setOpen] = useState(focused || report.status === 'borrador');
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(report.title);
  const [body, setBody] = useState(report.body);
  const [context, setContext] = useState(report.context);
  const [regen, setRegen] = useState(false);
  const { busy, run } = useAction();
  const toast = useToast();
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focused]);

  const save = () =>
    run(async () => {
      const r = await api<Report>('PATCH', `reports/${report.id}`, { title, body });
      onChange(r);
      setEditing(false);
      toast('Informe guardado.');
    });

  const regenerate = () =>
    run(async () => {
      if (context !== report.context) await api('PATCH', `reports/${report.id}`, { context });
      const r = await api<{ report: Report; warning: string | null }>('POST', `reports/${report.id}/regenerate`);
      if (r.warning) toast(r.warning, true);
      else toast('Informe redactado de nuevo.');
      setBody(r.report.body);
      setRegen(false);
      onChange(r.report);
    });

  const remove = () => {
    if (!confirm(`¿Eliminar «${report.title}»?${report.status === 'publicado' ? ' El cliente dejará de verlo en el portal.' : ''}`)) return;
    run(async () => {
      await api('DELETE', `reports/${report.id}`);
      onDelete();
    });
  };

  return (
    <article ref={ref} className={`card report${report.kind === 'final' ? ' report--final' : ''}${focused ? ' is-focused' : ''}`}>
      <header className="report__head">
        <button className="report__toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          <span className="report__kind">
            {KIND_LABEL[report.kind]}
            {staff && <span className={`report__status report__status--${report.status}`}>{report.status === 'publicado' ? 'Publicado' : 'Borrador'}</span>}
          </span>
          <strong>{report.title}</strong>
          <small>
            {report.from && report.to ? `Del ${day(report.from)} al ${day(report.to)}` : ''}
            {report.publishedAt ? ` · publicado el ${formatDate(report.publishedAt)}` : ''}
            {staff && report.emailedAt ? ` · enviado a ${report.emailedTo} (${formatDateTime(report.emailedAt)})` : ''}
          </small>
        </button>
        <a className="btn btn--outline btn--sm" href={printUrl(report.id)} target="_blank" rel="noopener">
          PDF
        </a>
      </header>

      {open && (
        <>
          {editing ? (
            <div className="report__edit">
              <label className="field">
                <span className="field__label">Título</span>
                <span className="input">
                  <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
                </span>
              </label>
              <label className="field">
                <span className="field__label">Informe (Markdown: ## títulos, - viñetas, **negrita**)</span>
                <textarea className="report__textarea mono" rows={22} value={body} onChange={(e) => setBody(e.target.value)} />
              </label>
              <div className="actions actions--tight">
                <button className="btn btn--primary btn--sm" disabled={busy} onClick={save}>
                  Guardar
                </button>
                <button
                  className="btn btn--outline btn--sm"
                  disabled={busy}
                  onClick={() => {
                    setEditing(false);
                    setTitle(report.title);
                    setBody(report.body);
                  }}
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <div className="report__body prose">
              <Markdown text={report.body} />
            </div>
          )}

          {staff && regen && (
            <div className="report__regen">
              <label className="field">
                <span className="field__label">Información a tener en cuenta por la IA</span>
                <textarea rows={4} value={context} maxLength={8000} placeholder={CONTEXT_HINT[report.kind]} onChange={(e) => setContext(e.target.value)} />
              </label>
              <div className="actions actions--tight">
                <button className="btn btn--primary btn--sm" disabled={busy} onClick={regenerate}>
                  {busy ? 'Redactando…' : 'Redactar de nuevo'}
                </button>
                <button className="btn btn--outline btn--sm" disabled={busy} onClick={() => setRegen(false)}>
                  Cancelar
                </button>
                <small className="hint">Reemplaza el texto actual con los datos de hoy.</small>
              </div>
            </div>
          )}

          {staff && !editing && !regen && (
            <div className="actions actions--tight report__actions">
              <button className="btn btn--primary btn--sm" disabled={busy} onClick={onPublish}>
                {report.status === 'publicado' ? 'Enviar por correo' : 'Publicar…'}
              </button>
              <button className="btn btn--outline btn--sm" disabled={busy} onClick={() => setEditing(true)}>
                Editar
              </button>
              <button className="btn btn--outline btn--sm" disabled={busy} onClick={() => setRegen(true)}>
                ✦ Redactar de nuevo
              </button>
              <button className="btn btn--outline btn--sm report__delete" disabled={busy} onClick={remove}>
                Eliminar
              </button>
            </div>
          )}
        </>
      )}
    </article>
  );
}

/** Pestaña Informes: parciales y de cierre. El equipo los genera con IA y los publica; el cliente ve los publicados. */
export function ReportsPanel({ me, project, focusId, onProjectChange }: { me: Me; project: ProjectDetail; focusId: number | null; onProjectChange: () => void }) {
  const staff = me.role !== 'client';
  const { data, error, loading, reload, setData } = useApi<ReportsData>(`projects/${project.id}/reports`);
  const [publishing, setPublishing] = useState<Report | null>(null);
  const [created, setCreated] = useState<number | null>(null);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return null;

  const replace = (r: Report) => setData({ ...data, reports: data.reports.map((x) => (x.id === r.id ? r : x)) });
  const hasFinal = data.reports.some((r) => r.kind === 'final' && r.status === 'publicado');

  return (
    <div className="reports">
      {staff && project.status === 'finalizado' && !hasFinal && (
        <p className="callout">El proyecto está finalizado y aún no tiene informe de cierre: genéralo aquí y envíalo al cliente.</p>
      )}
      {staff && data.defaults && (
        <NewReport
          me={me}
          project={project}
          defaults={data.defaults}
          onCreated={(r) => {
            setData({ ...data, reports: [r, ...data.reports] });
            setCreated(r.id);
          }}
        />
      )}
      {!data.reports.length ? (
        <Empty>{staff ? 'Aún no hay informes. Genera el primero arriba.' : 'Aún no hay informes publicados. Cuando DeerSystems publique uno, lo verás aquí.'}</Empty>
      ) : (
        data.reports.map((r) => (
          <ReportItem
            key={r.id}
            report={r}
            staff={staff}
            focused={r.id === focusId || r.id === created}
            onChange={replace}
            onDelete={() => setData({ ...data, reports: data.reports.filter((x) => x.id !== r.id) })}
            onPublish={() => setPublishing(r)}
          />
        ))
      )}
      {publishing && (
        <PublishDialog
          report={publishing}
          project={project}
          onClose={() => setPublishing(null)}
          onDone={(r, closed) => {
            replace(r);
            if (closed) onProjectChange();
          }}
        />
      )}
    </div>
  );
}
