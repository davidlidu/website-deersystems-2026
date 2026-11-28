import { useState } from 'react';
import { api } from '../lib';
import { Loading, Markdown, useAction } from '../ui';

/**
 * Pregúntale a la IA sobre este cliente (ficha del cliente, solo el administrador): responde con lo guardado en su
 * espacio (proyectos y tareas, reuniones con resúmenes y transcripciones, formularios, avances y pagos), citando de
 * dónde sale cada dato.
 */
export function AskAi({ clientId }: { clientId: number }) {
  const [question, setQuestion] = useState('');
  const [chat, setChat] = useState<{ q: string; a: string; meta: string }[]>([]);
  const [open, setOpen] = useState(false);
  const { busy, run } = useAction();
  const QUICK = ['¿En qué estado está el cliente?', '¿Qué se habló en la última reunión?', '¿Qué tiene pendiente el cliente?', '¿Qué pagos están pendientes?'];
  const ask = (q: string) => {
    const text = q.trim();
    if (!text) return;
    setOpen(true);
    run(async () => {
      const r = await api<{ answer: string; ai: { model: string; costUsd: number; latencyMs: number } }>('POST', `clients/${clientId}/ask`, {
        question: text,
        history: chat.slice(-4).map((c) => ({ q: c.q, a: c.a })),
      });
      setChat((c) => [...c, { q: text, a: r.answer, meta: `${r.ai.model} · ${(r.ai.latencyMs / 1000).toFixed(1)} s${r.ai.costUsd ? ` · US$${r.ai.costUsd.toFixed(4)}` : ''}` }]);
      setQuestion('');
    });
  };
  return (
    <section className="section ask">
      <div className="ask__card card">
        <div className="ask__head">
          <h2>✨ Pregúntale a la IA sobre este cliente</h2>
          {chat.length > 0 && (
            <button className="btn btn--outline btn--sm" onClick={() => setOpen(!open)}>
              {open ? 'Ocultar' : `Ver conversación (${chat.length})`}
            </button>
          )}
        </div>
        <p className="hint">Responde con lo guardado en su espacio: proyectos y tareas, reuniones (resúmenes, acuerdos y transcripciones), formularios, avances y pagos.</p>
        <div className="ask__quick">
          {QUICK.map((q) => (
            <button key={q} className="mail-var" disabled={busy} onClick={() => ask(q)}>
              {q}
            </button>
          ))}
        </div>
        <form
          className="ask__form"
          onSubmit={(e) => {
            e.preventDefault();
            ask(question);
          }}
        >
          <span className="input">
            <input value={question} maxLength={1500} onChange={(e) => setQuestion(e.target.value)} placeholder="Ej.: ¿qué acordamos sobre la integración con WhatsApp?" />
          </span>
          <button className="btn btn--primary btn--sm" disabled={busy || question.trim().length < 3}>
            {busy ? 'Pensando…' : 'Preguntar'}
          </button>
        </form>
        {open && (chat.length > 0 || busy) && (
          <div className="ask__chat">
            {chat.map((c, i) => (
              <div key={i} className="ask__turn">
                <p className="ask__q">{c.q}</p>
                <div className="ask__a prose">
                  <Markdown text={c.a} />
                </div>
                <p className="hint mono">{c.meta}</p>
              </div>
            ))}
            {busy && <Loading label="Revisando el espacio del cliente…" />}
          </div>
        )}
      </div>
    </section>
  );
}
