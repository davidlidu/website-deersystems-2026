# Propuestas · propuestas.deersystems.net

Panel para publicar las propuestas comerciales en HTML. Cada propuesta queda en una URL que sale del nombre del archivo, y se puede reemplazar el contenido sin que la URL cambie.

- `PROP-2026-014 Acmé.html` → `https://propuestas.deersystems.net/prop-2026-014-acme`
- Acepta un `.html` suelto o un `.zip` con assets (`index.html` en la raíz, o dentro de una única carpeta).
- No hay listado público: la raíz redirige a deersystems.net (o al panel si tienes sesión) y cualquier ruta que no exista devuelve el mismo 404.
- Las propuestas salen con `noindex` y sin caché, así que un reemplazo se ve de inmediato.
- El panel (`/admin`) entra con Google. `SUPERADMIN_EMAIL` siempre tiene acceso y es quien autoriza otros correos.
- Cada propuesta muestra cuántas veces se abrió (no cuenta tus visitas con sesión ni las vistas previas de WhatsApp).

Es un servidor Node sin framework: `node:http`, `node:sqlite` y `fflate` para los `.zip`. Node ejecuta el TypeScript directamente, no hay paso de build.

```
src/
  server.ts    Rutas: propuestas públicas, panel, API y login
  auth.ts      OAuth de Google y cookie de sesión firmada
  db.ts        SQLite: propuestas y correos autorizados
  storage.ts   Slug, descompresión y archivos en disco
public/        Panel, login y 404 (HTML/CSS/JS sin build)
```

Los datos viven en `DATA_DIR`: `propuestas.sqlite` y `files/{id}/v{versión}/`.

## Desarrollo

```bash
cp .env.example .env   # deja PUBLIC_URL=http://localhost:3000 y DEV_LOGIN=1
npm install
npm run dev
npm run typecheck
```

Con `DEV_LOGIN=1` se entra sin Google en `http://localhost:3000/auth/dev`. Solo funciona en localhost y fuera de producción.

## Despliegue en Dokploy

1. **DNS:** registro `A` de `propuestas.deersystems.net` a la IP del VPS.
2. **Google Cloud Console** → APIs y servicios → Credenciales → Crear ID de cliente OAuth (Aplicación web), con URI de redirección `https://propuestas.deersystems.net/auth/google/callback`.
3. **Dokploy** → nueva Application con este mismo repositorio:
   - Build Type: `Dockerfile` · Docker File: `propuestas/Dockerfile` · Docker Context Path: `propuestas`
   - Watch Paths: `propuestas/**`, para que no se redespliegue con cambios del sitio.
   - Environment: las variables de [`.env.example`](./.env.example).
   - Advanced → Volumes: un **Volume Mount** en `/data`. Sin él, las propuestas se pierden en cada despliegue.
   - Domains: `propuestas.deersystems.net`, puerto `3000`, HTTPS con Let's Encrypt.

Para respaldar basta copiar el volumen `/data`.
