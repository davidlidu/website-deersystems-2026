---
name: DeerSystems
description: Lienzo oscuro continuo en Azul Profundo, un único acento eléctrico (Verde Innovación) para CTAs, cian para iconografía y enlaces, tarjetas con hairline, eyebrows mono en mayúsculas. Basado en el DESIGN.md de VoltAgent (awesome-design-md) y en el Manual de Identidad DeerSystems.
colors:
  canvas: "#051923"        # Azul Profundo — fondo principal
  surface: "#1E293B"       # Pizarra Espacial (al 42%) — tarjetas
  primary: "#7ED957"       # Verde Innovación — CTAs, estados activos
  on-primary: "#051923"
  accent: "#00B4D8"        # Cian Tecnológico — iconos, enlaces, degradados
  ai: "#7209B7"            # Violeta Bit — secciones de IA (Nexo)
  ink: "#F2F6F8"
  body: "#B9C6D2"
  mute: "#94A3B8"          # Gris Bruma
  hairline: "rgba(148,163,184,.16)"
  premium: "#FFB703"       # Oro Inteligente (reservado)
  danger: "#EF476F"        # Rojo Coral (reservado)
typography:
  display: Montserrat 700, tracking -0.035em
  heading: Montserrat 600–700
  body: Inter 300–400, 16px / 1.65
  mono: JetBrains Mono — eyebrows, métricas, código
rounded: { sm: 6px (botones), md: 10px (tarjetas), lg: 16px (terminal, foto), pill: 999px (tags, filtros) }
---

## Principios

- **Un solo lienzo oscuro.** Todo el sitio es `canvas`, sin bandas claras. Las secciones se separan con una línea discontinua de 1px, como en VoltAgent.
- **Un acento.** `primary` solo aparece en CTAs, estados activos y puntos "en vivo". El cian se usa para iconografía y el violeta solo en IA.
- **Degradado de marca.** Va de verde a cian (`#7ED957 → #00B4D8`) y se aplica al isotipo y a palabras clave de los titulares. El manual prohíbe otros colores en el ciervo.
- **Tarjetas con hairline.** Borde de 1px, fondo translúcido y sin sombras pesadas. En hover el borde pasa a cian.
- **Eyebrows mono.** Van en mayúsculas con tracking de 0.18em sobre cada titular de sección.
- **Métricas en mono** con cifras tabulares.
- **Botones de 6px de radio** (no pill). El primario lleva texto oscuro sobre verde.
- **Orbe líquido como firma visual.** Aparece en el loader, el hero, Nexo y el contacto.

## Tono

Directo, solucionador y empoderador. Ejemplo: *"En DeerSystems, no solo escribimos código. Creamos sistemas que conectan tus procesos y soluciones que simplifican tu crecimiento."*
