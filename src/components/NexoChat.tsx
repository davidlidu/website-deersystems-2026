import { useEffect, useRef, useState, type FormEvent } from 'react';
import { whatsappLink } from '../data/content';
import { Icon } from './Icons';

// Momentos (segundos desde que abre la página) en que aparece el globo "¿Hablamos?".
// 5, 15, 30, 60 y luego se duplica: 120, 240, 480…
const FIRST_TIMES = [5, 15, 30, 60];
const BUBBLE_MS = 6000;

function nextTime(i: number) {
  if (i < FIRST_TIMES.length) return FIRST_TIMES[i];
  return FIRST_TIMES[FIRST_TIMES.length - 1] * 2 ** (i - FIRST_TIMES.length + 1);
}

const QUICK = [
  'Quiero automatizar mi negocio',
  'Necesito un sitio web',
  'Quiero una tienda online',
  'Servidores, dominios o correo',
  'Soporte para mi sitio',
];

type Msg = { from: 'nexo' | 'user'; text: string };

const GREETING: Msg[] = [
  { from: 'nexo', text: '¡Hola! Soy Nexo 👋, el asistente de DeerSystems.' },
  { from: 'nexo', text: '¿En qué te puedo ayudar hoy? Elige una opción o escríbeme.' },
];

/**
 * Chat flotante de Nexo. WhatsApp no permite mostrarse dentro de un iframe, así que la
 * conversación empieza aquí, sin salir del sitio, y continúa en WhatsApp en una pestaña nueva.
 */
export function NexoChat() {
  const [open, setOpen] = useState(false);
  const [bubble, setBubble] = useState(false);
  const [text, setText] = useState('');
  const [messages, setMessages] = useState<Msg[]>(GREETING);
  const openRef = useRef(open);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    openRef.current = open;
    // El globo se oculta por CSS mientras el chat está abierto.
    if (open) inputRef.current?.focus();
  }, [open]);

  // Globo "¿Hablamos?" escalonado.
  useEffect(() => {
    const start = performance.now();
    let i = 0;
    let showTimer = 0;
    let hideTimer = 0;
    const schedule = () => {
      const wait = nextTime(i) * 1000 - (performance.now() - start);
      showTimer = window.setTimeout(() => {
        if (!openRef.current) {
          setBubble(true);
          hideTimer = window.setTimeout(() => setBubble(false), BUBBLE_MS);
        }
        i += 1;
        schedule();
      }, Math.max(0, wait));
    };
    schedule();
    return () => {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const send = (value: string) => {
    const msg = value.trim();
    if (!msg) return;
    window.open(whatsappLink(`Hola Nexo 👋 ${msg}`), '_blank', 'noopener');
    setMessages((m) => [
      ...m,
      { from: 'user', text: msg },
      {
        from: 'nexo',
        text: 'Abrí WhatsApp en una pestaña nueva con tu mensaje listo para enviar. David te responderá pronto. Puedes seguir viendo el sitio.',
      },
    ]);
    setText('');
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(text);
  };

  return (
    <div className={`nexo-chat ${open ? 'nexo-chat--open' : ''}`}>
      <div
        className="nexo-chat__panel"
        role="dialog"
        aria-modal="false"
        aria-label="Chat con Nexo, asistente de DeerSystems"
        aria-hidden={!open}
        inert={!open}
      >
        <header className="nexo-chat__head">
          <img src="/img/nexo-icon.webp" alt="" width={40} height={40} />
          <div>
            <strong>Nexo</strong>
            <small>
              <i /> Asistente de DeerSystems
            </small>
          </div>
          <button className="nexo-chat__close" onClick={() => setOpen(false)} aria-label="Cerrar chat">
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="nexo-chat__body" ref={listRef}>
          {messages.map((m, i) => (
            <p key={i} className={`nexo-chat__msg nexo-chat__msg--${m.from}`}>
              {m.text}
            </p>
          ))}
          {messages.length === GREETING.length && (
            <div className="nexo-chat__quick">
              {QUICK.map((q) => (
                <button key={q} type="button" className="chip" onClick={() => send(q)}>
                  {q}
                </button>
              ))}
            </div>
          )}
        </div>

        <form className="nexo-chat__form" onSubmit={onSubmit}>
          <textarea
            ref={inputRef}
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send(text);
              }
            }}
            placeholder="Escribe tu mensaje…"
            aria-label="Tu mensaje"
          />
          <button type="submit" className="nexo-chat__send" aria-label="Enviar por WhatsApp" disabled={!text.trim()}>
            <Icon name="arrow" size={18} />
          </button>
        </form>
        <p className="nexo-chat__note">
          <Icon name="whatsapp" size={14} /> La conversación continúa en WhatsApp
        </p>
      </div>

      <button
        className="nexo-chat__launcher"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? 'Cerrar chat con Nexo' : 'Abrir chat con Nexo'}
      >
        <span className={`nexo-chat__bubble ${bubble ? 'is-on' : ''}`} aria-hidden="true">
          ¿Hablamos? 👋
        </span>
        <img src="/img/nexo-icon.webp" alt="" width={64} height={64} />
      </button>
    </div>
  );
}
