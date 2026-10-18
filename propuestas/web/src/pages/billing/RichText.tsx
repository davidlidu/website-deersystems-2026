import { useEffect, useRef } from 'react';

/**
 * Editor mínimo para la descripción de los ítems (negrita, cursiva, subrayado y listas), como el de SmartBilling.
 * El servidor guarda el HTML con una lista blanca de etiquetas.
 */
export function RichText({ value, onChange, placeholder, label }: { value: string; onChange: (html: string) => void; placeholder?: string; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // Sin control total: solo se reescribe si el valor cambió desde fuera (no mientras se escribe).
  useEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el && el.innerHTML !== value) el.innerHTML = value;
  }, [value]);
  const cmd = (name: string) => {
    ref.current?.focus();
    document.execCommand(name);
    onChange(ref.current?.innerHTML ?? '');
  };
  return (
    <div className="rich">
      <div className="rich__bar" role="toolbar" aria-label={`Formato de ${label}`}>
        {(
          [
            ['bold', 'N', 'Negrita'],
            ['italic', 'K', 'Cursiva'],
            ['underline', 'S', 'Subrayado'],
            ['insertUnorderedList', '•', 'Lista'],
          ] as const
        ).map(([c, text, title]) => (
          <button key={c} type="button" title={title} aria-label={title} onMouseDown={(e) => e.preventDefault()} onClick={() => cmd(c)} className={`rich__btn rich__btn--${c}`}>
            {text}
          </button>
        ))}
      </div>
      <div
        ref={ref}
        className="rich__area"
        contentEditable
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        data-placeholder={placeholder}
        onInput={(e) => onChange((e.target as HTMLDivElement).innerHTML)}
        onPaste={(e) => {
          // Se pega como texto: el formato de otras páginas no entra.
          e.preventDefault();
          document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
        }}
        suppressContentEditableWarning
      />
    </div>
  );
}
