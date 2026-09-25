import { useEffect, useState } from 'react';
import { LiquidOrb } from '../orb/LiquidOrb';
import { Wordmark } from './Brand';

const MIN_MS = 1500;
const STEPS = ['Analizando', 'Conectando sistemas', 'Automatizando', 'Listo'];

/** Pantalla de carga con el orbe líquido (preset "innovacion"). */
export function Loader({ onDone }: { onDone: () => void }) {
  const [progress, setProgress] = useState(0);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const t0 = performance.now();
    let loaded = document.readyState === 'complete';
    const onLoad = () => (loaded = true);
    window.addEventListener('load', onLoad);
    const fontsReady = document.fonts?.ready.catch(() => undefined);
    let fontsDone = false;
    fontsReady?.then(() => (fontsDone = true));

    let raf = 0;
    let shown = 0;
    const tick = () => {
      const elapsed = performance.now() - t0;
      // Avanza con el tiempo, pero no pasa del 90% hasta que la página cargó.
      const ready = loaded && (fontsDone || elapsed > 2500);
      const target = ready ? 100 : Math.min(90, (elapsed / MIN_MS) * 90);
      shown += (target - shown) * 0.08 + (ready ? 0.6 : 0);
      shown = Math.min(shown, target);
      setProgress(Math.round(shown));
      if (shown >= 100 && elapsed >= MIN_MS) {
        setLeaving(true);
        window.setTimeout(onDone, 800);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('load', onLoad);
    };
  }, [onDone]);

  const step = STEPS[Math.min(STEPS.length - 1, Math.floor(progress / 34))];

  return (
    <div className={`loader ${leaving ? 'loader--leaving' : ''}`} role="status" aria-live="polite">
      <div className="loader__orb">
        <LiquidOrb preset="innovacion" />
      </div>
      <div className="loader__meta">
        <Wordmark size={26} />
        <div className="loader__bar" aria-hidden="true">
          <span style={{ transform: `scaleX(${progress / 100})` }} />
        </div>
        <div className="loader__row">
          <span className="mono">{step}…</span>
          <span className="mono loader__pct">{String(progress).padStart(3, '0')}%</span>
        </div>
      </div>
    </div>
  );
}
