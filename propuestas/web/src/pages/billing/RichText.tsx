import { useEffect, useRef, type ClipboardEvent, type DragEvent } from 'react';

/** Reduce la imagen (máx. 900 px de ancho) para que la cuenta de cobro no pese de más; PNG si es pequeña, JPEG si no. */
async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('No se pudo leer la imagen.'));
      i.src = url;
    });
    const scale = Math.min(1, 900 / img.naturalWidth);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d')!;
    const png = file.type === 'image/png' && file.size < 400_000;
    if (!png) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL(png ? 'image/png' : 'image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

const TOOLS = [
  ['bold', 'N', 'Negrita'],
  ['italic', 'K', 'Cursiva'],
  ['underline', 'S', 'Subrayado'],
  ['insertUnorderedList', '•', 'Lista con viñetas'],
  ['insertOrderedList', '1.', 'Lista numerada'],
] as const;

/**
 * Editor WYSIWYG de la descripción de los ítems, como el de SmartBilling: negrita, cursiva, subrayado, listas e imágenes
 * (botón, pegar o arrastrar). El servidor guarda el HTML con una lista blanca de etiquetas; las imágenes van incrustadas.
 */
export function RichText({ value, onChange, placeholder, label }: { value: string; onChange: (html: string) => void; placeholder?: string; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // Sin control total: solo se reescribe si el valor cambió desde fuera (no mientras se escribe).
  useEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el && el.innerHTML !== value) el.innerHTML = value;
  }, [value]);

  const emit = () => onChange(ref.current?.innerHTML ?? '');
  const cmd = (name: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(name, false, arg);
    emit();
  };
  const insertImages = async (files: File[]) => {
    for (const f of files.filter((x) => /^image\/(png|jpeg|gif|webp)$/.test(x.type))) {
      try {
        cmd('insertImage', await shrink(f));
      } catch {
        /* imagen ilegible: se ignora */
      }
    }
  };
  const pickImage = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/gif,image/webp';
    input.multiple = true;
    input.onchange = () => insertImages([...(input.files ?? [])]);
    input.click();
  };
  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const images = [...e.clipboardData.files];
    if (images.length) return void insertImages(images);
    // El texto se pega sin el formato de otras páginas.
    document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    const images = [...e.dataTransfer.files];
    if (!images.length) return;
    e.preventDefault();
    insertImages(images);
  };

  return (
    <div className="rich">
      <div className="rich__bar" role="toolbar" aria-label={`Formato de ${label}`}>
        {TOOLS.map(([c, text, title]) => (
          <button key={c} type="button" title={title} aria-label={title} onMouseDown={(e) => e.preventDefault()} onClick={() => cmd(c)} className={`rich__btn rich__btn--${c}`}>
            {text}
          </button>
        ))}
        <button type="button" title="Insertar imagen" aria-label="Insertar imagen" onMouseDown={(e) => e.preventDefault()} onClick={pickImage} className="rich__btn rich__btn--img">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <circle cx="9" cy="10" r="2" />
            <path d="m21 16-5-5-9 9" />
          </svg>
        </button>
        <button type="button" title="Quitar formato" aria-label="Quitar formato" onMouseDown={(e) => e.preventDefault()} onClick={() => cmd('removeFormat')} className="rich__btn">
          T̸
        </button>
      </div>
      <div
        ref={ref}
        className="rich__area"
        contentEditable
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        data-placeholder={placeholder}
        onInput={emit}
        onPaste={onPaste}
        onDrop={onDrop}
        suppressContentEditableWarning
      />
    </div>
  );
}
