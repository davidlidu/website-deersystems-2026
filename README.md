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

## Despliegue en Dokploy

El repositorio incluye todo lo necesario:

| Archivo | Qué hace |
|---|---|
| `Dockerfile` | Compila con Node 22 y sirve `/dist` con Nginx. La imagen final pesa unos 75 MB y no incluye Node. |
| `deploy/nginx.conf` | Gzip, caché larga para `/assets` e imágenes, HTML sin caché, URLs limpias (`/privacidad`, `/terminos`) y `/healthz`. |
| `deploy/security-headers.conf` | Cabeceras de seguridad (`nosniff`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`). |
| `docker-compose.yml` | Alternativa si prefieres el tipo *Docker Compose*. |

### Opción recomendada: Application + Dockerfile

1. En Dokploy: **Create Service → Application**.
2. **Provider:** GitHub → repositorio `davidlidu/website-deersystems-2026` y la rama que quieras publicar.
3. **Build Type:** `Dockerfile`, con Docker File `Dockerfile` y Docker Context Path `.`.
4. Pulsa **Deploy**.
5. En **Domains**: agrega tu dominio (por ejemplo `deersystems.com` y `www.deersystems.com`), con **Container Port `80`**, **HTTPS** activado y certificado **Let's Encrypt**.
6. En tu proveedor de DNS: crea un registro **A** que apunte a la IP del servidor de Dokploy (y otro para `www`, o un CNAME).
7. Opcional: activa **Auto Deploy** para que cada `git push` a esa rama publique el sitio automáticamente.

### Opción alternativa: Docker Compose

**Create Service → Compose**, con el mismo repositorio y Compose Path `./docker-compose.yml`. En **Domains**, elige el servicio `web` y el puerto `80`.

### Si Docker Hub limita las descargas (error 429)

En **Build Args** (en *Advanced* de la aplicación) define:

```
NODE_IMAGE=public.ecr.aws/docker/library/node:22-alpine
NGINX_IMAGE=public.ecr.aws/docker/library/nginx:1.27-alpine
```

Son las mismas imágenes oficiales, pero descargadas desde el espejo de AWS.

### Probar la imagen localmente

```bash
docker build -t deersystems-web .
docker run --rm -p 8080:80 deersystems-web
# http://localhost:8080  ·  http://localhost:8080/healthz
```

## Estructura

```
src/
  orb/            Orbe líquido: presets, shaders WGSL/GLSL, renderers, componente React
  components/     Loader, Header, Hero, secciones, marca (isotipo SVG) e iconos
  data/content.ts Proyectos, stack, sectores y WhatsApp
  legal/          Política de privacidad y Términos y condiciones (privacidad.html, terminos.html)
  styles.css      Tokens y estilos
brand-src/        Originales de marca (logos, Nexo, foto)
propuestas/       App aparte para propuestas.deersystems.net (ver propuestas/README.md)
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
