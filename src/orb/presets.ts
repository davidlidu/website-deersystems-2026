// Presets del orbe líquido de vidrio (inspirado en Liquid Orb Editor, MIT).
// Todos usan exclusivamente la paleta del Manual de Identidad de DeerSystems.

export type OrbParams = {
  /** Color dominante del líquido interior. */
  colorA: string;
  /** Color secundario (bandas y borde refractado). */
  colorB: string;
  /** Color profundo (núcleo y sombras del líquido). */
  colorC: string;
  /** Velocidad de la animación (1 = normal). */
  speed: number;
  /** Deformación de la superficie (0 = esfera perfecta). */
  wobble: number;
  /** Intensidad de refracción del vidrio. */
  refraction: number;
  /** Intensidad del halo exterior. */
  glow: number;
};

export const BRAND = {
  verde: '#7ED957',
  cian: '#00B4D8',
  azul: '#051923',
  violeta: '#7209B7',
  pizarra: '#1E293B',
  bruma: '#94A3B8',
  oro: '#FFB703',
  nexo: '#0B3D91',
} as const;

export const ORB_PRESETS = {
  /** Hero: el azul de Nexo con astas verdes y cian. */
  nexo: {
    colorA: BRAND.cian,
    colorB: BRAND.verde,
    colorC: BRAND.nexo,
    speed: 0.9,
    wobble: 0.9,
    refraction: 0.75,
    glow: 0.9,
  },
  /** Loader: energía verde → cian, más rápido y deformable. */
  innovacion: {
    colorA: BRAND.verde,
    colorB: BRAND.cian,
    colorC: '#0a3b2f',
    speed: 1.5,
    wobble: 1.25,
    refraction: 0.6,
    glow: 1,
  },
  /** Secciones de IA: Violeta Bit según el manual. */
  violetaIA: {
    colorA: BRAND.violeta,
    colorB: BRAND.cian,
    colorC: '#1a0636',
    speed: 0.8,
    wobble: 1.05,
    refraction: 0.85,
    glow: 0.85,
  },
} satisfies Record<string, OrbParams>;

export type OrbPresetName = keyof typeof ORB_PRESETS;

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
