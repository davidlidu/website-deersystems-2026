# DeerSystems · Sitio web 2026

Sitio de DeerSystems: **Sistemas que conectan, soluciones que simplifican.**

Una sola página en React + Vite + TypeScript con:

- **Loader y hero con orbe de vidrio líquido.** Es una adaptación del *Liquid Orb Editor* (MIT) a la marca. Usa WebGPU/WGSL, pasa a WebGL2 si WebGPU no está disponible y a un orbe estático en CSS como último recurso.
- **Sistema de diseño** basado en el `DESIGN.md` de VoltAgent ([awesome-design-md](https://github.com/voltagent/awesome-design-md)), adaptado al Manual de Identidad DeerSystems. Ver [`DESIGN.md`](./DESIGN.md).
- Secciones: Servicios, Automatización, Nexo (agentes de IA), Sectores, Portafolio (12 proyectos), Proceso, Sobre mí y Contacto. El formulario abre WhatsApp, cambia el ejemplo según el servicio elegido y pide aceptar la política de privacidad.
- Páginas legales: `/privacidad.html` (Ley 1581 de 2012) y `/terminos.html`.

## Desarrollo

```bash
npm install
npm run dev       # servidor local
npm run build     # compila a /dist (sitio estático)
npm run preview   # sirve /dist
npm run lint
```

`/dist` es estático y se puede publicar en Netlify, Vercel, Cloudflare Pages, cPanel o cualquier VPS con Nginx.

## Estructura

```
src/
  orb/            Orbe líquido: presets, shaders WGSL/GLSL, renderers, componente React
  components/     Loader, Header, Hero, secciones, marca (isotipo SVG) e iconos
  data/content.ts Proyectos, stack, sectores y WhatsApp
  legal/          Política de privacidad y Términos y condiciones (privacidad.html, terminos.html)
  styles.css      Tokens y estilos
brand-src/        Originales de marca (logos, Nexo, foto)
scripts/          prepare-images.mjs → genera /public/img optimizadas
```

### Orbe líquido

```tsx
<LiquidOrb preset="nexo" interactive />          // hero
<LiquidOrb preset="innovacion" />                 // loader
<LiquidOrb preset="violetaIA" params={{ glow: .6 }} />
```

Parámetros de cada preset (`src/orb/presets.ts`): `colorA`, `colorB`, `colorC`, `speed`, `wobble`, `refraction` y `glow`.
Para probar cada renderizador, agrega `?orb=webgl` o `?orb=static` a la URL.
El orbe se pausa cuando sale de pantalla y respeta `prefers-reduced-motion`.

### Imágenes

```bash
node scripts/prepare-images.mjs
```

Recorta a Nexo desde la ficha de personaje, le quita el fondo blanco y genera versiones WebP, el favicon y la imagen Open Graph.

Las capturas del portafolio se cargan en vivo desde `api.microlink.io`, igual que en la propuesta comercial. Si una captura falla, la tarjeta muestra un respaldo con la marca.
