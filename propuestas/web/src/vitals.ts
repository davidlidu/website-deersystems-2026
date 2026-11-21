/**
 * Velocidad real de quienes usan el portal, sin librerías: se mide LCP, INP (aproximado con Event Timing), CLS,
 * FCP y TTFB, y solo se reportan las mediciones malas (umbrales «poor» de Web Vitals). Cada línea en los
 * registros del servidor es un problema real que alguien vivió.
 */
const POOR = { LCP: 4000, INP: 500, CLS: 0.25, FCP: 3000, TTFB: 1800 } as const;
type Name = keyof typeof POOR;

function send(name: Name, value: number): void {
  if (!Number.isFinite(value) || value <= POOR[name]) return;
  const nav = navigator as Navigator & { connection?: { effectiveType?: string } };
  const body = JSON.stringify({
    name,
    value,
    path: location.pathname,
    conn: nav.connection?.effectiveType,
    mobile: matchMedia('(max-width: 768px)').matches,
  });
  try {
    if (!navigator.sendBeacon?.('/api/vitals', new Blob([body], { type: 'application/json' }))) {
      void fetch('/api/vitals', { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(() => {});
    }
  } catch {
    /* medir nunca debe romper la app */
  }
}

function observe(type: string, cb: (e: PerformanceEntry) => void, extra: Record<string, unknown> = {}): void {
  try {
    new PerformanceObserver((list) => list.getEntries().forEach(cb)).observe({ type, buffered: true, ...extra } as PerformanceObserverInit);
  } catch {
    /* el navegador no soporta esta medición */
  }
}

export function reportVitals(): void {
  const navEntry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  if (navEntry) send('TTFB', navEntry.responseStart);
  observe('paint', (e) => e.name === 'first-contentful-paint' && send('FCP', e.startTime));

  let lcp = 0;
  observe('largest-contentful-paint', (e) => (lcp = e.startTime));
  // CLS por ventanas de sesión (máx. 5 s, cortes de 1 s), como lo define Web Vitals.
  let cls = 0;
  let windowValue = 0;
  let windowStart = 0;
  let last = 0;
  observe('layout-shift', (e) => {
    const s = e as PerformanceEntry & { value: number; hadRecentInput: boolean };
    if (s.hadRecentInput) return;
    if (windowValue && (s.startTime - last > 1000 || s.startTime - windowStart > 5000)) windowValue = 0;
    if (!windowValue) windowStart = s.startTime;
    windowValue += s.value;
    last = s.startTime;
    cls = Math.max(cls, windowValue);
  });
  let inp = 0;
  observe('event', (e) => (inp = Math.max(inp, e.duration)), { durationThreshold: 40 });

  // LCP, CLS e INP se cierran cuando la persona deja la pestaña.
  let sent = false;
  const flush = (force = false) => {
    if (sent || (!force && document.visibilityState !== 'hidden')) return;
    sent = true;
    send('LCP', lcp);
    send('CLS', cls);
    send('INP', inp);
  };
  document.addEventListener('visibilitychange', () => flush());
  addEventListener('pagehide', () => flush(true));
}
