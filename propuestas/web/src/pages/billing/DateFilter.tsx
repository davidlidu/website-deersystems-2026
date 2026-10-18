import type { DateRange } from '../../lib';

/** Filtro por fecha: todas, un día, un mes o un rango. */
export function DateFilter({ value, onChange }: { value: DateRange; onChange: (r: DateRange) => void }) {
  const set = (p: Partial<DateRange>) => onChange({ ...value, ...p });
  return (
    <span className="date-filter">
      <span className="input input--chip">
        <select value={value.mode} onChange={(e) => set({ mode: e.target.value as DateRange['mode'] })} aria-label="Filtrar por fecha">
          <option value="todas">Todas las fechas</option>
          <option value="dia">Un día</option>
          <option value="mes">Un mes</option>
          <option value="rango">Rango</option>
        </select>
      </span>
      {value.mode === 'dia' && (
        <span className="input input--chip">
          <input type="date" value={value.day} onChange={(e) => set({ day: e.target.value })} aria-label="Día" />
        </span>
      )}
      {value.mode === 'mes' && (
        <span className="input input--chip">
          <input type="month" value={value.month} onChange={(e) => set({ month: e.target.value })} aria-label="Mes" />
        </span>
      )}
      {value.mode === 'rango' && (
        <>
          <span className="input input--chip">
            <input type="date" value={value.from} onChange={(e) => set({ from: e.target.value })} aria-label="Desde" />
          </span>
          <span className="hint">a</span>
          <span className="input input--chip">
            <input type="date" value={value.to} min={value.from || undefined} onChange={(e) => set({ to: e.target.value })} aria-label="Hasta" />
          </span>
        </>
      )}
    </span>
  );
}
