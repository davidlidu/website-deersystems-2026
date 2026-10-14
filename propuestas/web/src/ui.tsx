import { createContext, useCallback, useContext, useRef, useState, type AnchorHTMLAttributes, type ReactNode } from 'react';
import { navigate, STATUS, type Progress, type TaskStatus } from './lib';

// ───────── Enlaces internos ─────────

export function Link({ to, ...props }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      href={to}
      {...props}
      onClick={(e) => {
        props.onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        navigate(to);
      }}
    />
  );
}

// ───────── Avisos ─────────

type Toast = { message: string; error: boolean } | null;
const ToastContext = createContext<(message: string, error?: boolean) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast>(null);
  const timer = useRef<number>(undefined);
  const show = useCallback((message: string, error = false) => {
    setToast({ message, error });
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), error ? 7000 : 3500);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className={`toast${toast ? ' is-on' : ''}${toast?.error ? ' is-error' : ''}`} role="status">
        {toast?.message}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

/** Ejecuta una acción, bloquea mientras corre y muestra el error si falla. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
      setBusy(true);
      try {
        return await action();
      } catch (err) {
        toast((err as Error).message, true);
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );
  return { busy, run };
}

// ───────── Piezas visuales ─────────

export function ProgressBar({ progress, size = 'md' }: { progress: Progress; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <div className={`progress progress--${size}`} title={`${progress.done} de ${progress.total} tareas completadas`}>
      <div className="progress__track">
        <div className="progress__fill" style={{ width: `${progress.percent}%` }} />
      </div>
      <span className="progress__value">{progress.percent}%</span>
    </div>
  );
}

export function StatusPill({ status }: { status: TaskStatus }) {
  return <span className={`pill pill--${status}`}>{STATUS[status]}</span>;
}

export function Loading({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="loading__dot" /> {label}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="alert" role="alert">
      {message}
      {onRetry && (
        <button className="btn btn--outline btn--sm" onClick={onRetry}>
          Reintentar
        </button>
      )}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty card">{children}</div>;
}

export function PageHead({ eyebrow, title, children }: { eyebrow: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="page__head">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      {children}
    </div>
  );
}

/** Contraseña recién generada: se ve una sola vez, con botón para copiar. */
export function SecretBox({ label, value, note }: { label: string; value: string; note?: ReactNode }) {
  const toast = useToast();
  return (
    <div className="secret card">
      <span className="field__label">{label}</span>
      <div className="secret__row">
        <code>{value}</code>
        <button
          className="btn btn--outline btn--sm"
          type="button"
          onClick={() => navigator.clipboard.writeText(value).then(() => toast('Copiado.'))}
        >
          Copiar
        </button>
      </div>
      {note && <p className="secret__note">{note}</p>}
    </div>
  );
}

// ───────── Markdown básico (títulos, listas, negritas, enlaces) ─────────

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const key = out.length;
    if (t.startsWith('**')) out.push(<strong key={key}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith('`')) out.push(<code key={key}>{t.slice(1, -1)}</code>);
    else if (t.startsWith('[')) {
      const [, label, href] = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(t)!;
      out.push(
        <a key={key} href={href} target="_blank" rel="noopener noreferrer">
          {label}
        </a>,
      );
    } else out.push(<em key={key}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push(<p key={blocks.length}>{inline(para.join(' '))}</p>);
    para = [];
    if (list) {
      const items = list.items.map((it, i) => <li key={i}>{inline(it)}</li>);
      blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
    }
    list = null;
  };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    const ul = /^[-*•]\s+(.*)$/.exec(line);
    const ol = /^\d+[.)]\s+(.*)$/.exec(line);
    if (!line) flush();
    else if (h) {
      flush();
      const level = Math.min(h[1].length + 2, 5);
      const Tag = `h${level}` as 'h3';
      blocks.push(<Tag key={blocks.length}>{inline(h[2])}</Tag>);
    } else if (ul || ol) {
      if (para.length) {
        blocks.push(<p key={blocks.length}>{inline(para.join(' '))}</p>);
        para = [];
      }
      const ordered = !!ol;
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push((ul ?? ol)![1]);
    } else {
      if (list) flush();
      para.push(line);
    }
  }
  flush();
  return <div className="md">{blocks}</div>;
}
