import { useState } from 'react';

/**
 * Lista desplegable que siempre muestra todas las opciones (un <datalist> filtra por lo escrito y obliga a borrar),
 * más «Otro…» para escribir un valor propio. Un valor que no está en la lista (p. ej. importado) aparece como opción.
 */
export function Choice({ value, options, onChange, label }: { value: string; options: string[]; onChange: (v: string) => void; label: string }) {
  const known = options.includes(value) || value === '';
  const [typing, setTyping] = useState(false);
  const list = known ? options : [value, ...options];
  if (typing) {
    return (
      <span className="choice">
        <span className="input">
          <input autoFocus value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} placeholder="Escribe…" />
        </span>
        <button type="button" className="btn btn--outline btn--sm" onClick={() => setTyping(false)} title="Volver a la lista">
          Lista
        </button>
      </span>
    );
  }
  return (
    <span className="input">
      <select
        value={value}
        aria-label={label}
        onChange={(e) => {
          if (e.target.value === '__otro') {
            onChange('');
            setTyping(true);
          } else onChange(e.target.value);
        }}
      >
        {list.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        <option value="__otro">Otro…</option>
      </select>
    </span>
  );
}
