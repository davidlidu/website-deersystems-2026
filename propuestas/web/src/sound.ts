/**
 * "Beep espacial" para avisos nuevos, sintetizado con Web Audio (sin archivos de audio):
 * dos destellos que suben de tono, con un eco corto. Se puede silenciar desde la campana.
 */

const KEY = 'ds:sound';
let ctx: AudioContext | null = null;

export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setSoundEnabled(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* sin almacenamiento: vale solo para esta visita */
  }
}

// Los navegadores solo dejan sonar audio después de una interacción del usuario: se prepara en el primer clic.
function unlock() {
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
}
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', unlock, { once: true, capture: true });
  window.addEventListener('keydown', unlock, { once: true, capture: true });
}

export function playSpaceBeep(): void {
  if (!soundEnabled() || !ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime;
  const out = ctx.createGain();
  out.gain.value = 0.16;

  // Eco corto: le da el aire "espacial".
  const delay = ctx.createDelay();
  delay.delayTime.value = 0.11;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.32;
  delay.connect(feedback).connect(delay);
  out.connect(ctx.destination);
  out.connect(delay);
  delay.connect(ctx.destination);

  const blip = (start: number, from: number, to: number, length: number) => {
    const osc = ctx!.createOscillator();
    const gain = ctx!.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(from, start);
    osc.frequency.exponentialRampToValueAtTime(to, start + length);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(1, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
    osc.connect(gain).connect(out);
    osc.start(start);
    osc.stop(start + length + 0.02);
  };
  blip(t, 660, 1320, 0.12);
  blip(t + 0.13, 990, 1980, 0.18);
}
