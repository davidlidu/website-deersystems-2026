import { useEffect, useRef, useState, type ClipboardEvent, type ReactNode } from 'react';

/**
 * Editor WYSIWYG de avances y notas. Se ve con formato (negrita, cursiva, enlaces, listas) pero guarda Markdown,
 * el mismo que ya leen el portal y los correos. Trae variables (cliente, proyecto, avance…) y enlaces directos
 * a tareas y reuniones del proyecto.
 */

export interface InsertItem {
  title: string;
  url: string;
  hint?: string;
}

export interface InsertGroup {
  label: string;
  items: InsertItem[];
}

export interface Variable {
  label: string;
  value: string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inlineHtml(text: string): string {
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g;
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out += esc(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('**')) out += `<b>${esc(t.slice(2, -2))}</b>`;
    else if (t.startsWith('`')) out += esc(t.slice(1, -1));
    else if (t.startsWith('[')) {
      const [, label, href] = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(t)!;
      out += `<a href="${esc(href)}">${esc(label)}</a>`;
    } else out += `<i>${esc(t.slice(1, -1))}</i>`;
    last = m.index + t.length;
  }
  return out + esc(text.slice(last));
}

/** Markdown → HTML para editar (mismas reglas que el componente Markdown del portal). */
export function mdToHtml(md: string): string {
  const out: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(`<p>${inlineHtml(para.join(' '))}</p>`);
    para = [];
    if (list) {
      const tag = list.ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${list.items.map((it) => `<li>${inlineHtml(it)}</li>`).join('')}</${tag}>`);
    }
    list = null;
  };
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    const h = /^#{1,4}\s+(.*)$/.exec(line);
    const ul = /^[-*•]\s+(.*)$/.exec(line);
    const ol = /^\d+[.)]\s+(.*)$/.exec(line);
    if (!line) flush();
    else if (h) {
      flush();
      out.push(`<p><b>${inlineHtml(h[1])}</b></p>`);
    } else if (ul || ol) {
      if (para.length) {
        out.push(`<p>${inlineHtml(para.join(' '))}</p>`);
        para = [];
      }
      if (list && list.ordered !== !!ol) flush();
      list ??= { ordered: !!ol, items: [] };
      list.items.push((ul ?? ol)![1]);
    } else {
      if (list) flush();
      para.push(line);
    }
  }
  flush();
  return out.join('');
}

const BLOCK = new Set(['DIV', 'P', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE']);

/** HTML del editor → Markdown. Cada línea (div o p) es un párrafo; las listas quedan como viñetas. */
export function htmlToMd(root: HTMLElement): string {
  const inline = (n: Node): string => {
    if (n.nodeType === Node.TEXT_NODE) return (n.textContent ?? '').replace(/\s+/g, ' ');
    if (n.nodeType !== Node.ELEMENT_NODE) return '';
    const el = n as HTMLElement;
    const inner = [...el.childNodes].map(inline).join('');
    const wrap = (mark: string) => {
      const t = inner.trim();
      if (!t) return inner;
      // Los espacios quedan por fuera de las marcas: "**hola** mundo", no "**hola **mundo".
      const lead = inner.match(/^\s*/)![0];
      const trail = inner.match(/\s*$/)![0];
      return `${lead}${mark}${t.replace(/\*+/g, '')}${mark}${trail}`;
    };
    switch (el.tagName) {
      case 'B':
      case 'STRONG':
        return wrap('**');
      case 'I':
      case 'EM':
        return wrap('*');
      case 'A': {
        const href = el.getAttribute('href') ?? '';
        const t = inner.trim().replace(/[[\]]/g, '');
        return /^https?:\/\//.test(href) && t ? `[${t}](${href.replace(/[()\s]/g, encodeURIComponent)})` : inner;
      }
      case 'BR':
        return '\n';
      default:
        return inner;
    }
  };

  const blocks: string[] = [];
  let line = '';
  const pushLine = () => {
    for (const l of line.split('\n')) if (l.trim()) blocks.push(l.trim());
    line = '';
  };
  const walk = (parent: Node) => {
    parent.childNodes.forEach((n) => {
      const el = n as HTMLElement;
      if (n.nodeType === Node.ELEMENT_NODE && (el.tagName === 'UL' || el.tagName === 'OL')) {
        pushLine();
        const items = [...el.children]
          .filter((li) => li.tagName === 'LI')
          .map((li, i) => `${el.tagName === 'OL' ? `${i + 1}.` : '-'} ${inline(li).replace(/\s*\n\s*/g, ' ').trim()}`)
          .filter((x) => !/^(-|\d+\.)\s*$/.test(x));
        if (items.length) blocks.push(items.join('\n'));
      } else if (n.nodeType === Node.ELEMENT_NODE && BLOCK.has(el.tagName)) {
        pushLine();
        // Un bloque con bloques adentro (Chrome a veces anida la lista en el div): se recorre.
        if ([...el.children].some((c) => BLOCK.has(c.tagName))) walk(el);
        else {
          line = inline(el);
          pushLine();
        }
      } else line += inline(n);
    });
  };
  walk(root);
  pushLine();
  return blocks.join('\n\n');
}

function Dropdown({ label, icon, children, open, onToggle }: { label: string; icon?: ReactNode; children: ReactNode; open: boolean; onToggle: () => void }) {
  return (
    <span className="md-editor__menu">
      <button type="button" className={`md-editor__btn md-editor__btn--text${open ? ' is-active' : ''}`} aria-expanded={open} onMouseDown={(e) => e.preventDefault()} onClick={onToggle}>
        {icon}
        {label}
        <span aria-hidden="true" className="md-editor__caret">
          ▾
        </span>
      </button>
      {open && <div className="md-editor__pop">{children}</div>}
    </span>
  );
}

const IconLink = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
    <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
  </svg>
);
const IconUl = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <path d="M9 6h11M9 12h11M9 18h11" />
    <circle cx="4.5" cy="6" r="1" fill="currentColor" />
    <circle cx="4.5" cy="12" r="1" fill="currentColor" />
    <circle cx="4.5" cy="18" r="1" fill="currentColor" />
  </svg>
);
const IconOl = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <path d="M10 6h10M10 12h10M10 18h10" />
    <path d="M4 5h1.5v3.5M3.5 8.5h3M3.5 13.5c0-1 2.8-1.2 2.8.2 0 1-2.8 1.6-2.8 2.8h3" strokeWidth="1.3" />
  </svg>
);
const IconClip = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m21 11-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8l9-9a3.7 3.7 0 0 1 5.2 5.2l-9 9a1.8 1.8 0 0 1-2.6-2.6L15.5 6" />
  </svg>
);

export function MdEditor({
  value,
  onChange,
  label,
  placeholder,
  variables,
  links,
  rows = 5,
  onSubmit,
}: {
  value: string;
  onChange: (md: string) => void;
  label: string;
  placeholder?: string;
  variables?: Variable[];
  links?: InsertGroup[];
  rows?: number;
  /** Cmd/Ctrl + Enter. */
  onSubmit?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const emitted = useRef<string | null>(null);
  const range = useRef<Range | null>(null);
  const [menu, setMenu] = useState<null | 'vars' | 'links'>(null);
  const [find, setFind] = useState('');

  // Solo se reescribe el contenido si el valor cambió desde fuera (borrador de la IA, publicar y limpiar).
  useEffect(() => {
    const el = ref.current;
    if (el && value !== emitted.current) {
      el.innerHTML = mdToHtml(value);
      emitted.current = value;
    }
  }, [value]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.md-editor__menu')) setMenu(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  const emit = () => {
    const md = ref.current ? htmlToMd(ref.current) : '';
    emitted.current = md;
    onChange(md);
  };
  const remember = () => {
    const sel = window.getSelection();
    if (sel?.rangeCount && ref.current?.contains(sel.anchorNode)) range.current = sel.getRangeAt(0).cloneRange();
  };
  /** Devuelve el foco al editor donde estaba el cursor (los menús se lo quitan). */
  const restore = () => {
    const el = ref.current!;
    el.focus();
    const sel = window.getSelection();
    if (range.current && sel) {
      sel.removeAllRanges();
      sel.addRange(range.current);
    } else if (sel) {
      sel.selectAllChildren(el);
      sel.collapseToEnd();
    }
  };
  const cmd = (name: string, arg?: string) => {
    restore();
    document.execCommand(name, false, arg);
    emit();
    remember();
  };
  const insertLink = (text: string, url: string) => {
    restore();
    const sel = window.getSelection();
    const selected = sel && !sel.isCollapsed ? sel.toString() : '';
    if (selected) document.execCommand('createLink', false, url);
    else document.execCommand('insertHTML', false, `<a href="${esc(url)}">${esc(text)}</a>&nbsp;`);
    emit();
    remember();
    setMenu(null);
  };
  const addUrl = () => {
    remember();
    const url = prompt('Pega la URL (Google Docs, Drive, Meet, Figma…):', 'https://');
    if (!url || !/^https?:\/\/\S+$/.test(url.trim())) return;
    // Con texto seleccionado, ese texto se vuelve el enlace; si no, se pide.
    const text = range.current && !range.current.collapsed ? '' : (prompt('Texto del enlace:', '') ?? '').trim();
    insertLink(text || url.trim(), url.trim());
  };
  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    // Se pega como texto: sin estilos de otra página. Una URL sola sobre texto seleccionado lo vuelve enlace.
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    const sel = window.getSelection();
    if (/^https?:\/\/\S+$/.test(text.trim()) && sel && !sel.isCollapsed) document.execCommand('createLink', false, text.trim());
    else document.execCommand('insertText', false, text);
    emit();
  };

  const q = find.trim().toLowerCase();
  const groups = (links ?? []).map((g) => ({ ...g, items: g.items.filter((it) => !q || it.title.toLowerCase().includes(q)) })).filter((g) => g.items.length);

  return (
    <div className="md-editor">
      <div className="md-editor__bar" role="toolbar" aria-label={`Formato de ${label}`}>
        <button type="button" className="md-editor__btn md-editor__btn--b" title="Negrita (Ctrl+B)" aria-label="Negrita" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('bold')}>
          B
        </button>
        <button type="button" className="md-editor__btn md-editor__btn--i" title="Cursiva (Ctrl+I)" aria-label="Cursiva" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('italic')}>
          I
        </button>
        <span className="md-editor__sep" aria-hidden="true" />
        <button type="button" className="md-editor__btn md-editor__btn--text" onMouseDown={(e) => e.preventDefault()} onClick={addUrl}>
          {IconLink}
          Insertar URL
        </button>
        <span className="md-editor__sep" aria-hidden="true" />
        <button type="button" className="md-editor__btn" title="Lista con viñetas" aria-label="Lista con viñetas" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('insertUnorderedList')}>
          {IconUl}
        </button>
        <button type="button" className="md-editor__btn" title="Lista numerada" aria-label="Lista numerada" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('insertOrderedList')}>
          {IconOl}
        </button>
        {!!variables?.length && (
          <>
            <span className="md-editor__sep" aria-hidden="true" />
            <Dropdown label="Variables" open={menu === 'vars'} onToggle={() => setMenu(menu === 'vars' ? null : 'vars')}>
              <ul className="md-editor__list">
                {variables.map((v) => (
                  <li key={v.label}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        cmd('insertText', v.value);
                        setMenu(null);
                      }}
                    >
                      <span>{v.label}</span>
                      <small>{v.value}</small>
                    </button>
                  </li>
                ))}
              </ul>
            </Dropdown>
          </>
        )}
        {!!links?.length && (
          <Dropdown label="Insertar tarea/reunión" icon={IconClip} open={menu === 'links'} onToggle={() => setMenu(menu === 'links' ? null : 'links')}>
            <span className="input input--search md-editor__find">
              <input autoFocus placeholder="Buscar…" value={find} onChange={(e) => setFind(e.target.value)} aria-label="Buscar tarea o reunión" />
            </span>
            <div className="md-editor__groups">
              {groups.length ? (
                groups.map((g) => (
                  <div key={g.label}>
                    <small className="md-editor__group">{g.label}</small>
                    <ul className="md-editor__list">
                      {g.items.slice(0, 40).map((it) => (
                        <li key={it.url + it.title}>
                          <button type="button" onClick={() => insertLink(it.title, it.url)}>
                            <span>{it.title}</span>
                            {it.hint && <small>{it.hint}</small>}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              ) : (
                <p className="hint">Nada coincide.</p>
              )}
            </div>
          </Dropdown>
        )}
      </div>
      <div
        ref={ref}
        className="md-editor__area"
        style={{ minHeight: `${rows * 1.6 + 1.4}em` }}
        contentEditable
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        data-placeholder={placeholder}
        onInput={() => {
          emit();
          remember();
        }}
        onPaste={onPaste}
        onSelect={remember}
        onKeyUp={remember}
        onMouseUp={remember}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && onSubmit) {
            e.preventDefault();
            onSubmit();
          }
        }}
        suppressContentEditableWarning
      />
    </div>
  );
}
