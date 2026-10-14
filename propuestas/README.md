# Propuestas · propuestas.deersystems.net

Panel para publicar las propuestas comerciales en HTML. Cada propuesta queda en una URL que sale del nombre del archivo, y se puede reemplazar el contenido sin que la URL cambie.

- `PROP-2026-014 Acmé.html` → `https://propuestas.deersystems.net/prop-2026-014-acme`
- Acepta un `.html` suelto o un `.zip` con assets (`index.html` en la raíz, o dentro de una única carpeta).
- No hay listado público: la raíz redirige a deersystems.net (o al panel si tienes sesión) y cualquier ruta que no exista devuelve el mismo 404.
- Las propuestas salen con `noindex` y sin caché, así que un reemplazo se ve de inmediato.
- El panel (`/admin`) entra con Google. `SUPERADMIN_EMAIL` siempre tiene acceso y es quien autoriza otros correos.
- Cada propuesta muestra cuántas veces se abrió (no cuenta tus visitas con sesión ni las vistas previas de WhatsApp).

El mismo servidor atiende también **`partners.deersystems.net`**, el portal de clientes (ver abajo). Lo distingue por el `Host`.

Las propuestas también se gestionan desde partners (*Propuestas*), con el enlace siempre en `propuestas.deersystems.net`. **Cada reemplazo guarda una versión nueva y conserva las anteriores.** Desde partners se ven en `/historial/{id}/{versión}/` (solo el administrador) y se pueden restaurar; restaurar publica esa versión como una nueva, sin perder nada. Las propuestas que ya generaron proyectos no se pueden eliminar, solo pausar.

Es un servidor Node sin framework: `node:http`, `node:sqlite` y `fflate` para los `.zip`. Node ejecuta el TypeScript directamente. Solo la interfaz de partners (React + Vite, en `web/`) tiene paso de build.

```
src/
  server.ts       Rutas de propuestas; deriva a partners según el Host
  http.ts         Utilidades HTTP compartidas (JSON, archivos, errores)
  auth.ts         Login con Google del panel de propuestas
  db.ts           SQLite: propuestas y correos autorizados
  storage.ts      Slug, descompresión y archivos en disco
  ai.ts           IA configurable (Gemini / OpenRouter), consumo y prueba de conexión
  google.ts       "Conectar Google" (OAuth offline) y envío por Gmail
  mail.ts         Correos con el sistema de diseño de la marca
  secrets.ts      Cifrado AES-GCM de claves y tokens guardados
  partners/
    routes.ts     API y login del portal; permisos por rol
    auth.ts       Contraseñas (scrypt), sesión, límite de intentos
    db.ts         Clientes, cuentas, proyectos, fases, tareas, ajustes, consumo de IA
    extract.ts    Propuesta HTML → plan de trabajo con IA
    work.ts       Tareas, fases, notas, avances y bitácora
    files.ts      Adjuntos en Google Drive
    notify.ts     Avisos en la campana y por correo
    meetings.ts   Reuniones: Calendar, transcripciones de Meet, resumen con IA y aprobación
public/           Panel de propuestas, login y 404 (HTML/CSS/JS sin build)
web/              Interfaz de partners (React + Vite) → se compila a public/partners
```

Los datos viven en `DATA_DIR`: `propuestas.sqlite` y `files/{id}/v{versión}/`.

## Portal de clientes · partners.deersystems.net

| Rol | Cómo entra | Qué ve |
|---|---|---|
| Administrador (`SUPERADMIN_EMAIL`) | Google | Todo: propuestas, precios, equipo, configuración |
| Equipo | Correo y contraseña | Clientes, proyectos y tareas. **Nunca precios** ni la propuesta original |
| Cliente | Correo y contraseña | Solo sus proyectos (en curso e historial), su alcance y sus valores. Solo cambia el estado de sus tareas, sin poder completarlas |

**Flujo:** en el panel de propuestas, *Propuesta aprobada* → la IA lee la propuesta y sugiere cliente, alcance (sin valores), valores, fases, tareas de cada parte y fechas → lo revisas y confirmas → se crean el cliente, su cuenta y el proyecto, y se le envía la contraseña por Gmail. Si el cliente ya existe, el proyecto se suma a su historial.

El **% de avance** es tareas completadas / total. Los estados son fijos: Pendiente, En progreso, En revisión, Bloqueada y Completada.

**En cada proyecto:**
- **Tareas** en cuatro vistas:
  - **Lista** por fase.
  - **Tablero** por estado: se arrastra la tarea de una columna a otra.
  - **Semana** y **Calendario** por fecha de entrega: el equipo arrastra una tarea a otro día y se conserva su duración.
- **Filtros** por lado (DeerSystems o cliente), responsable, texto y completadas. **Panel de detalle** de cada tarea con comentarios e historial.
- **Avances**: los publica el equipo para el cliente.
- **Notas**: compartidas, o internas que el cliente nunca ve.
- **Bitácora**: registra cada cambio. El cliente no ve las entradas internas.
- El equipo crea, edita y elimina tareas y fases. El cliente cambia el estado de sus tareas (sin completarlas), comenta y deja notas.
- **Archivos**: se suben a Google Drive, en `DeerSystems Partners / Cliente / Proyecto`, desde el proyecto o desde una tarea.
  - El administrador también los agrega **desde su Drive** con el selector de Google (Google Picker), sin salir de la plataforma. Esos archivos se enlazan, no se copian.
  - Cada archivo es **compartido** o **interno**, y se cambia con un clic.
  - Los compartidos quedan con lectura para quien tenga el enlace, sin aparecer en búsquedas. Así el ojo 👁 abre el visor de Drive incluso para el cliente. La descarga ⬇ pasa por el portal; los Docs, Hojas y Presentaciones se descargan en PDF.
  - Al quitar un archivo subido, va a la papelera de Drive. Al quitar uno enlazado desde tu Drive, el original no se toca.
  - El selector necesita una clave de API con *Google Picker API* habilitada (Configuración → Google y correo).

**Avisos:**
- **Campana del encabezado:** a ti y al equipo les llegan los comentarios, notas, cambios de estado y archivos del cliente. Al cliente le llegan los avances, las tareas nuevas para él, los comentarios y los archivos de DeerSystems. Cada aviso abre la tarea o la pestaña exacta.
- **Correo:** con la marca, enviado desde Gmail. Los avisos de unos minutos se juntan en un solo correo.
- **Configuración → Avisos:** cada tipo de aviso se enciende o apaga en la plataforma y por correo.

**Reuniones (Calendar + Meet):**
1. **Agendas desde la plataforma**, en *Reuniones* o en la pestaña *Reuniones* del proyecto. Eliges el proyecto en marcha, la fecha y hora, la duración, la agenda y a quién invitar (cliente, equipo y otros). Se crea en tu Google Calendar con Meet y Google envía las invitaciones. También se puede cancelar.
   Cada 10 minutos (o con *Sincronizar ahora*) se revisa el calendario. Por defecto **solo se siguen las reuniones agendadas desde la plataforma**: las que agendas directamente en Calendar con un cliente para otros temas no entran, salvo que actives *Importar también…*.
2. Al terminar, se busca la transcripción de Meet: la transcripción debe estar activada en la reunión. Si no hay, puedes pegarla o escribir notas.
3. La IA del perfil *Reuniones* propone el resumen, los acuerdos y las tareas de cada parte, y te avisa. **Solo tú ves el borrador y la transcripción.**
4. Revisas, editas y eliges a quién enviarlo. *Aprobar y enviar* crea las tareas (origen «reunión»), las registra en la bitácora, envía el correo con el diseño de la marca y le muestra el resumen al cliente en la pestaña **Reuniones** del proyecto.
5. Las reuniones fuera de Meet (llamadas, Zoom o presenciales) se registran desde el proyecto, pegando la transcripción o las notas.

**Configuración** (solo administrador):
- **IA:** proveedor y modelo principal y de respaldo, claves (cifradas), privacidad en OpenRouter, tarifas y presupuesto mensual, y prueba de conexión.
- **Consumo de IA:** costo, tokens y llamadas por modelo y por día, y saldo de la clave de OpenRouter.
- **Google:** conecta `ceo@` una sola vez con Gmail, Drive, Calendar y Meet. Incluye correo de prueba y vista previa del diseño.

## Desarrollo

```bash
cp .env.example .env   # deja PUBLIC_URL=http://localhost:3000 y DEV_LOGIN=1
npm install
npm run dev
npm run typecheck
```

Con `DEV_LOGIN=1` se entra sin Google en `http://localhost:3000/auth/dev` (propuestas) y `http://partners.localhost:3000/auth/dev` (partners). Solo funciona en localhost y fuera de producción.

Para la interfaz de partners:

```bash
npm run build:web      # compila web/ a public/partners (lo sirve el servidor)
npm run dev:web        # o Vite con recarga en :5173; pon PARTNERS_URL=http://localhost:5173 en .env
```

## Despliegue en Dokploy

1. **DNS:** registros `A` de `propuestas.deersystems.net` y `partners.deersystems.net` a la IP del VPS.
2. **Google Cloud Console** → APIs y servicios → Credenciales → ID de cliente OAuth (Aplicación web), con las URIs de redirección `https://propuestas.deersystems.net/auth/google/callback` y `https://partners.deersystems.net/auth/google/callback`. Habilita las APIs de Gmail, Drive, Calendar y Meet, con la pantalla de consentimiento en *Interno*.
3. **Dokploy** → nueva Application con este mismo repositorio:
   - Build Type: `Dockerfile` · Docker File: `propuestas/Dockerfile` · Docker Context Path: `propuestas`
   - Watch Paths: `propuestas/**`, para que no se redespliegue con cambios del sitio.
   - Environment: las variables de [`.env.example`](./.env.example).
   - Advanced → Volumes: un **Volume Mount** en `/data`. Sin él, las propuestas se pierden en cada despliegue.
   - Domains: `propuestas.deersystems.net` **y** `partners.deersystems.net`, ambos al puerto `3000`, con HTTPS y Let's Encrypt.
4. Entra a `https://partners.deersystems.net` con Google → **Configuración** → *Conectar Google* y carga las claves de IA.

Para respaldar basta copiar el volumen `/data`.
