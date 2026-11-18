import { api, formatDateTime, useApi } from '../../lib';
import { Link, useAction, useToast } from '../../ui';

/**
 * Modo «Poner al día»: para registrar pagos viejos (cuentas de cobro que ya se pagaron) sin que el ingreso se cuente
 * otra vez en el Gestor financiero. Se enciende mientras pones la cartera al día y se apaga al terminar.
 */
export interface CatchUp {
  enabled: boolean;
  since: string | null;
}

export const useCatchUp = () => useApi<CatchUp>('billing/catch-up');

/** El interruptor, en Configuración → Finanzas. */
export function CatchUpSwitch() {
  const { data, setData } = useCatchUp();
  const { busy, run } = useAction();
  const toast = useToast();
  const on = !!data?.enabled;
  const set = (enabled: boolean) =>
    run(async () => {
      setData(await api<CatchUp>('PUT', 'billing/catch-up', { enabled }));
      toast(enabled ? 'Modo «Poner al día» encendido: los abonos no van al Gestor.' : 'Modo «Poner al día» apagado: todo vuelve a la normalidad.');
    });
  return (
    <section className={`card form-section narrow-col catchup${on ? ' is-on' : ''}`} style={{ marginTop: 16 }}>
      <div className="form-section__head">
        <h2>Poner la cartera al día</h2>
        <label className="switch">
          <input type="checkbox" role="switch" checked={on} disabled={busy || !data} aria-label="Modo poner al día" onChange={(e) => set(e.target.checked)} />
          <span className="switch__track" />
        </label>
      </div>
      <p className="hint">
        Enciéndelo mientras marcas como pagadas cuentas de cobro viejas. Los abonos que registres (y las cuotas que marques pagadas) dejan la cuenta de cobro y el
        saldo del cliente al día, pero <strong>no se envían al Gestor financiero</strong>, porque ese ingreso ya está contado allá. Quedan marcados como
        «Puesta al día». Cuando termines, apágalo: los abonos nuevos vuelven a ir al Gestor como siempre.
      </p>
      {on && (
        <p className="callout callout--warn">
          Encendido{data?.since ? ` desde ${formatDateTime(data.since)}` : ''}. En el estado de cuenta de cada cliente aparece «Marcar pagada» en las cuentas
          pendientes. <Link to="/facturacion">Ir a facturación</Link>
        </p>
      )}
    </section>
  );
}

/** Aviso en facturación mientras el modo está encendido. */
export function CatchUpBanner({ mode }: { mode: CatchUp | null }) {
  if (!mode?.enabled) return null;
  return (
    <p className="callout callout--warn catchup-banner">
      <strong>Modo «Poner al día» encendido:</strong> los abonos que registres solo ponen al día las cuentas de cobro; no van al Gestor financiero.{' '}
      <Link to="/configuracion?tab=finanzas">Apagarlo</Link>
    </p>
  );
}
