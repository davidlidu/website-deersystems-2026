# Configuración y despliegue

## Variables de entorno

| Variable | Obligatoria | Uso |
|---|---|---|
| `PUBLIC_URL` | Sí | `https://propuestas.deersystems.net` (sin barra final) |
| `PARTNERS_URL` | Sí | `https://partners.deersystems.net`. Define el host del portal y el origen permitido |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Sí | Cliente OAuth (aplicación web). Ver [Google](./google.md) |
| `SESSION_SECRET` | Sí | Firma de sesiones. `openssl rand -hex 32`. Si cambia, todos deben volver a entrar |
| `SUPERADMIN_EMAIL` | Sí | `ceo@deersystems.net`: el administrador |
| `ENCRYPTION_KEY` | Recomendada | Cifra las claves guardadas. Si no está, se usa `SESSION_SECRET`. **Si cambia, hay que volver a guardar las claves (IA, selector de Drive, Gestor) y reconectar Google** |
| `DATA_DIR` | No | Por defecto `./data`; en Docker, `/data` |
| `PORT` | No | Por defecto `3000` |
| `GEMINI_API_KEY` / `OPENROUTER_API_KEY` | No | Respaldo; las del panel tienen prioridad |
| `MAX_UPLOAD_MB` | No | Tamaño máximo de una propuesta (100) |
| `HOME_URL` | No | A dónde redirige la raíz de propuestas |
| `DEV_LOGIN` | Solo local | `1` habilita `/auth/dev` fuera de producción y en localhost |

No hay variables para el Gestor financiero: la URL y la clave se cargan en *Configuración → Finanzas*.

## Despliegue en Dokploy

1. **DNS:** registros `A` de `propuestas.deersystems.net` y `partners.deersystems.net` a la IP del VPS.
2. **Google Cloud Console:** credenciales y APIs. Ver [Google](./google.md).
3. **Dokploy → Application** con este repositorio:
   - **Build Type:** `Dockerfile`.
     - Docker File: `propuestas/Dockerfile`.
     - Docker Context Path: `propuestas`.
   - **Watch Paths:** `propuestas/**`, para que los cambios del sitio web no lo redespliegan.
   - **Environment:** las variables de arriba.
   - **Advanced → Volumes:** un *Volume Mount* en `/data`. **Sin él, todo se pierde en cada despliegue.**
   - **Domains:** `propuestas.deersystems.net` y `partners.deersystems.net`, ambos al puerto `3000`, con HTTPS y Let's Encrypt.
4. **Primer arranque:**
   1. Entra a `https://partners.deersystems.net` con Google.
   2. **Configuración → Google y correo → Conectar Google**. Envía un correo de prueba.
   3. **Configuración → IA:** claves, modelos de cada perfil y *Probar*.
   4. **Configuración → Google y correo:** la clave del selector de Drive.
   5. **Configuración → Finanzas:** datos de la cuenta de cobro (emisor, forma de pago, QR, logo, firma), la `SERVICE_API_KEY` del Gestor y *Probar conexión*. Pago en línea solo si lo vas a usar (URL de eventos en Wompi: `https://partners.deersystems.net/api/webhooks/wompi`).
   6. **Facturación → Importar de SmartBilling** (una vez). Ver [Facturación](./facturacion.md).
   7. **Configuración → Avisos:** revisa qué se envía.

El `Dockerfile` es multietapa:
1. Compila la interfaz (`npm run build:web`).
2. Copia el servidor y `public/` a una imagen de Node sin dependencias de desarrollo.

## Respaldos

Todo el estado está en `/data`:
- `propuestas.sqlite`, con sus archivos `-wal` y `-shm`.
- `files/`, las versiones de las propuestas.

Los archivos de los proyectos están en Google Drive. Para respaldar, copia el volumen, idealmente con el contenedor detenido o usando `sqlite3 .backup`.

## Desarrollo local

```bash
cp .env.example .env   # PUBLIC_URL=http://localhost:3000, PARTNERS_URL=http://partners.localhost:3000, DEV_LOGIN=1
npm install
npm run dev            # servidor con recarga
npm run build:web      # compila la interfaz a public/partners
npm run dev:web        # o Vite en :5173 (pon PARTNERS_URL=http://localhost:5173)
npm run typecheck      # servidor y web
```

- **Propuestas:** `http://localhost:3000/auth/dev`.
- **Partners:** `http://partners.localhost:3000/auth/dev`. Entra como administrador sin Google.
