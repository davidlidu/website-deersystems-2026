import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createWebGL2Renderer, createWebGPURenderer, type OrbRenderer } from './renderers';
import { hexToRgb, ORB_PRESETS, type OrbParams, type OrbPresetName } from './presets';

type Props = {
  preset?: OrbPresetName;
  /** Sobrescribe parámetros del preset. */
  params?: Partial<OrbParams>;
  className?: string;
  /** La luz especular sigue al puntero. */
  interactive?: boolean;
  /** Aviso cuando el primer frame está listo (o se usa el respaldo estático). */
  onReady?: (kind: OrbRenderer['kind'] | 'static') => void;
  label?: string;
};

const MAX_PIXELS = 1400 * 1400;

export function LiquidOrb({ preset = 'nexo', params, className, interactive = false, onReady, label }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [fallback, setFallback] = useState(false);
  const cfg: OrbParams = { ...ORB_PRESETS[preset], ...params };
  const cfgRef = useRef(cfg);
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    cfgRef.current = cfg;
    onReadyRef.current = onReady;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let renderer: OrbRenderer | null = null;
    let canvas: HTMLCanvasElement | null = null;
    let raf = 0;
    let visible = true;
    let last = performance.now();
    let time = Math.random() * 20;
    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const uniforms = new Float32Array(20);

    const newCanvas = () => {
      canvas?.remove();
      canvas = document.createElement('canvas');
      canvas.setAttribute('aria-hidden', 'true');
      host.appendChild(canvas);
      resize();
      return canvas;
    };

    const resize = () => {
      if (!canvas) return;
      const rect = host.getBoundingClientRect();
      let dpr = Math.min(window.devicePixelRatio || 1, 2);
      const px = rect.width * rect.height * dpr * dpr;
      if (px > MAX_PIXELS) dpr *= Math.sqrt(MAX_PIXELS / px);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
    };

    const draw = () => {
      if (!renderer || !canvas) return;
      const c = cfgRef.current;
      const [ar, ag, ab] = hexToRgb(c.colorA);
      const [br, bg, bb] = hexToRgb(c.colorB);
      const [cr, cg, cb] = hexToRgb(c.colorC);
      pointer.x += (pointer.tx - pointer.x) * 0.06;
      pointer.y += (pointer.ty - pointer.y) * 0.06;
      uniforms.set([time, canvas.width, canvas.height, 0, c.wobble, c.refraction, c.glow, 0]);
      uniforms.set([ar, ag, ab, pointer.x, br, bg, bb, pointer.y, cr, cg, cb, 0], 8);
      renderer.render(uniforms);
    };

    const loop = (now: number) => {
      raf = 0;
      if (disposed) return;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      time += dt * cfgRef.current.speed;
      draw();
      if (visible && !reduced && !document.hidden) raf = requestAnimationFrame(loop);
    };

    const start = () => {
      if (!raf && !disposed) {
        last = performance.now();
        raf = requestAnimationFrame(loop);
      }
    };

    // ?orb=webgl | ?orb=static fuerza un renderizador (útil para depurar).
    const force = new URLSearchParams(window.location.search).get('orb');

    const init = async () => {
      if (!force) {
        try {
          renderer = await createWebGPURenderer(newCanvas());
        } catch {
          renderer = null;
        }
      }
      if (!renderer && !disposed && force !== 'static') {
        try {
          renderer = createWebGL2Renderer(newCanvas());
        } catch {
          renderer = null;
        }
      }
      if (disposed) {
        renderer?.destroy();
        return;
      }
      if (!renderer) {
        canvas?.remove();
        setFallback(true);
        onReadyRef.current?.('static');
        return;
      }
      host.dataset.renderer = renderer.kind;
      draw();
      onReadyRef.current?.(renderer.kind);
      start();
    };
    init();

    const ro = new ResizeObserver(() => {
      resize();
      draw();
    });
    ro.observe(host);

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) start();
    });
    io.observe(host);

    const onVisibility = () => !document.hidden && start();
    document.addEventListener('visibilitychange', onVisibility);

    const onPointer = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      pointer.tx = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
      pointer.ty = Math.max(-1, Math.min(1, -(((e.clientY - r.top) / r.height) * 2 - 1)));
    };
    if (interactive && !reduced) window.addEventListener('pointermove', onPointer, { passive: true });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pointermove', onPointer);
      renderer?.destroy();
      canvas?.remove();
    };
  }, [interactive]);

  return (
    <div
      ref={hostRef}
      className={`liquid-orb ${fallback ? 'liquid-orb--static' : ''} ${className ?? ''}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={
        {
          '--orb-a': cfg.colorA,
          '--orb-b': cfg.colorB,
          '--orb-c': cfg.colorC,
        } as CSSProperties
      }
    />
  );
}
