import { useState, type FormEvent } from "react";
import {
  api,
  formatDate,
  formatMeetingTime,
  navigate,
  STATUS,
  useApi,
  type Me,
  type Meeting,
  type ProjectDetail,
  type Task,
} from "../../lib";
import {
  Empty,
  ErrorBox,
  Link,
  Loading,
  Markdown,
  useAction,
  useToast,
} from "../../ui";
import { MeetingStatusPill } from "../Meetings";
import { EditMeeting, ScheduleMeeting } from "./Schedule";

/** Reuniones del proyecto: las próximas (con enlace de Meet) y los resúmenes aprobados con sus tareas. */
export function ProjectMeetings({
  me,
  project,
  onOpenTask,
}: {
  me: Me;
  project: ProjectDetail;
  onOpenTask: (t: Task) => void;
}) {
  const { data, error, loading, reload } = useApi<Meeting[]>(
    `projects/${project.id}/meetings`,
  );
  const [adding, setAdding] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const toast = useToast();
  const { busy, run } = useAction();
  const owner = me.role === "owner";

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  const list = data!;
  const upcoming = list.filter((m) => m.status === "programada").reverse();
  const approved = list.filter((m) => m.status === "aprobada");
  const inReview = list.filter(
    (m) => !["programada", "aprobada", "descartada"].includes(m.status),
  );

  const addManual = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    run(async () => {
      const m = await api<Meeting>("POST", `projects/${project.id}/meetings`, {
        title: fd.get("title"),
        startAt: fd.get("startAt"),
        transcript: fd.get("transcript"),
      });
      navigate(`/reuniones/${m.id}`);
    });
  };

  return (
    <div className="stack">
      {owner && (
        <div className="toolbar">
          <div className="actions actions--tight">
            <button
              className="btn btn--primary btn--sm"
              onClick={() => {
                setScheduling(!scheduling);
                setAdding(false);
              }}
            >
              {scheduling ? "Cerrar" : "+ Agendar reunión"}
            </button>
            <button
              className="btn btn--outline btn--sm"
              onClick={() => {
                setAdding(!adding);
                setScheduling(false);
              }}
            >
              {adding ? "Cancelar" : "Registrar reunión sin Meet"}
            </button>
          </div>
          <Link className="hint" to="/reuniones">
            Ver todas las reuniones
          </Link>
        </div>
      )}
      {scheduling && (
        <ScheduleMeeting
          projectId={project.id}
          projectName={project.name}
          onDone={() => {
            setScheduling(false);
            reload();
          }}
        />
      )}
      {adding && (
        <form className="card form-section" onSubmit={addManual}>
          <h2>Reunión fuera del calendario</h2>
          <p className="hint">
            Para llamadas, Zoom o reuniones presenciales: pega la transcripción
            o tus notas y la IA arma el resumen.
          </p>
          <div className="form-grid">
            <label className="field">
              <span className="field__label">Título</span>
              <span className="input">
                <input
                  name="title"
                  required
                  defaultValue="Reunión de seguimiento"
                />
              </span>
            </label>
            <label className="field">
              <span className="field__label">Fecha y hora</span>
              <span className="input">
                <input name="startAt" type="datetime-local" required />
              </span>
            </label>
          </div>
          <label className="field">
            <span className="field__label">Transcripción o notas</span>
            <textarea name="transcript" rows={8} required minLength={50} />
          </label>
          <button className="btn btn--primary" disabled={busy}>
            {busy ? "Generando resumen…" : "Generar resumen"}
          </button>
        </form>
      )}

      {owner && inReview.length > 0 && (
        <section>
          <h3 className="subhead">En proceso</h3>
          <div className="table card">
            {inReview.map((m) => (
              <Link
                key={m.id}
                to={`/reuniones/${m.id}`}
                className="table__row table__row--meeting"
              >
                <span>
                  <strong>{m.title}</strong>
                </span>
                <span className="mono">{formatMeetingTime(m.startAt)}</span>
                <span>
                  <MeetingStatusPill status={m.status} />
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="subhead">Próximas</h3>
        {upcoming.length ? (
          <div className="meeting-list">
            {upcoming.map((m) =>
              editing === m.id ? (
                <EditMeeting
                  key={m.id}
                  meeting={m}
                  onCancel={() => setEditing(null)}
                  onDone={() => {
                    setEditing(null);
                    reload();
                  }}
                />
              ) : (
                <article key={m.id} className="meeting card">
                  <div>
                    <strong>{m.title}</strong>
                    <span className="mono">{formatMeetingTime(m.startAt)}</span>
                  </div>
                  <div className="actions actions--tight">
                    {m.meetUrl && (
                      <a
                        className="btn btn--primary btn--sm"
                        href={m.meetUrl}
                        target="_blank"
                        rel="noopener"
                      >
                        Unirse a Meet
                      </a>
                    )}
                    {owner && (
                      <button
                        className="btn btn--outline btn--sm"
                        disabled={busy}
                        onClick={() => setEditing(m.id)}
                      >
                        Editar
                      </button>
                    )}
                    {owner && (
                      <button
                        className="btn btn--outline btn--sm btn--danger"
                        disabled={busy}
                        onClick={() => {
                          if (
                            !confirm(
                              `¿Cancelar «${m.title}»? Google avisará a los invitados.`,
                            )
                          )
                            return;
                          run(async () => {
                            await api("POST", `meetings/${m.id}/cancel`);
                            toast("Reunión cancelada.");
                            await reload();
                          });
                        }}
                      >
                        Cancelar
                      </button>
                    )}
                  </div>
                </article>
              ),
            )}
          </div>
        ) : (
          <Empty>No hay reuniones agendadas.</Empty>
        )}
      </section>

      <section>
        <h3 className="subhead">Resúmenes</h3>
        {approved.length ? (
          approved.map((m) => {
            const tasks = (m.taskIds ?? [])
              .map((id) => project.tasks.find((t) => t.id === id))
              .filter((t): t is Task => !!t);
            return (
              <article key={m.id} className="meeting-summary card">
                <header>
                  <div>
                    <p className="eyebrow">{formatDate(m.startAt)}</p>
                    <h3>{m.title}</h3>
                  </div>
                  {owner && (
                    <Link className="linklike" to={`/reuniones/${m.id}`}>
                      Detalle
                    </Link>
                  )}
                </header>
                <Markdown text={m.summary ?? ""} />
                {!!m.agreements?.length && (
                  <>
                    <h4>Acuerdos</h4>
                    <ul className="md-list">
                      {m.agreements.map((a, i) => (
                        <li key={i}>{a}</li>
                      ))}
                    </ul>
                  </>
                )}
                {tasks.length > 0 && (
                  <>
                    <h4>Tareas</h4>
                    <ul className="meeting-tasks">
                      {tasks.map((t) => (
                        <li key={t.id}>
                          <button
                            className="linklike"
                            onClick={() => onOpenTask(t)}
                          >
                            {t.title}
                          </button>
                          <span className={`side side--${t.side}`}>
                            {t.side === "cliente"
                              ? "Cliente"
                              : (t.assigneeName ?? "DeerSystems")}
                          </span>
                          <span className={`pill pill--${t.status}`}>
                            {STATUS[t.status]}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </article>
            );
          })
        ) : (
          <Empty>
            Aquí aparecerán los resúmenes de las reuniones, con los acuerdos y
            las tareas de cada parte.
          </Empty>
        )}
      </section>
    </div>
  );
}
