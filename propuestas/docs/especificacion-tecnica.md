# Especificación técnica completa

Estado al **22 de noviembre de 2026**. Reúne en un solo lugar todo lo que está implementado: arquitectura, datos, API, procesos, integraciones e interfaz. Al final hay una guía de **qué tocar para hacer una versión para otro cliente**.

Los demás archivos de `docs/` explican cada área para quien la usa. Este explica cómo está construida.

---

## 1. Resumen

Un solo servidor Node (sin framework) atiende dos subdominios desde un contenedor y los distingue por el encabezado `Host`:

| Subdominio | Qué es | Código |
|---|---|---|
| `propuestas.` | Publicación de propuestas comerciales en HTML (con versiones y conteo de visitas) y su panel `/admin` | `src/server.ts`, `src/proposals.ts`, `src/storage.ts`, `public/` |
| `partners.` | Portal de clientes: proyectos, tareas, reuniones, archivos, pagos, facturación, avisos, IA | `src/partners/*`, interfaz en `web/` |

Ambos comparten la base de datos SQLite y los módulos de IA, Google, correo y cifrado.

**Tamaño:** unos 14.000 líneas de servidor (TypeScript) y 18.500 de interfaz (React). Hay unas 200 rutas de API, 30 tablas y un servidor MCP para conectar Claude.

## 2. Stack

| Parte | Tecnología | Notas |
|---|---|---|
| Runtime | Node ≥ 22.18 (imagen `node:24-alpine`) | TypeScript ejecutado directamente (type stripping), sin build del servidor |
| HTTP | `node:http` | Enrutador propio: `"MÉTODO ruta/:id"` en un `switch` |
| Base de datos | `node:sqlite` (`DatabaseSync`), archivo único `DATA_DIR/propuestas.sqlite` | WAL, `synchronous=NORMAL`, claves foráneas activas |
| Dependencia de producción | `fflate` (descomprimir `.zip` de propuestas) | Es la **única** |
| Interfaz | React 19 + Vite 8, sin enrutador externo ni librería de estado | Compila a `public/partners` |
| PDF | jsPDF + html2canvas-pro en el navegador, con carga diferida | Cuentas de cobro, plan de trabajo (Gantt) |
| IA | Gemini y OpenRouter por HTTP (`fetch`) | Dos perfiles, modelo de respaldo, registro de consumo |
| Google | OAuth offline de **una** cuenta: Gmail, Drive, Calendar y Meet | `src/google.ts` |
| Finanzas | API del Gestor financiero (`/integrations/billing-payment`) | Ingresos idempotentes por referencia |
| TRM | Datos abiertos de la Superfinanciera (datos.gov.co, recurso `32sa-8pi3`) | Caché en memoria |
| Pago en línea | Wompi (links de pago y webhook firmado) | Opcional, apagado por defecto |
| Avisos | Campana en la app, correo agrupado y Telegram (solo el administrador) | `notify.ts`, `telegram.ts` |
| Claude | Servidor MCP (Streamable HTTP, JSON) con OAuth 2.1 propio (registro dinámico + PKCE) o token personal | `partners/mcp.ts` |
| Fuentes | Inter, JetBrains Mono y Montserrat servidas desde el propio dominio (woff2 variables) | `web/src/fonts/` |

## 3. Estructura del repositorio

```
propuestas/
  Dockerfile              Multietapa: compila web/ y copia el servidor a una imagen sin devDependencies
  package.json            Scripts: dev, dev:web, build:web, start, typecheck
  src/
    server.ts             Entrada. Propuestas + derivación a partners por Host; arranque de procesos; manejo de errores
    config.ts             Variables de entorno
    http.ts               json() (con ETag opcional), sendFile() con Brotli/gzip en caché, readJson(), HttpError
    db.ts                 Conexión SQLite + tablas de propuestas y correos autorizados del panel
    auth.ts               Login con Google del panel de propuestas
    proposals.ts          Publicar, reemplazar (versión), restaurar, borrar
    storage.ts            Slug, descompresión de .zip, archivos y versiones en disco
    ai.ts                 Perfiles, proveedores, respaldo, consumo, instrucciones propias, prueba
    google.ts             OAuth, Gmail, Drive, Calendar, Meet, Picker; gfetch() con tiempo máximo
    mail.ts               Plantillas de correo con la marca (HTML en línea)
    secrets.ts            AES-256-GCM para claves y tokens guardados
    partners/
      routes.ts           Login, sesión, vistas por rol, proyectos, clientes, cuentas, equipo, propuestas, aprobación, ajustes, despachador
      auth.ts             scrypt, cookie firmada, límite de intentos, Viewer, «Ver como»
      common.ts           Permisos (requireOwner, requireStaff, visibleProject, visibleTask, seesTask, seesMoney, clientSees, taskView)
      db.ts               Esquema y consultas del núcleo: clientes, cuentas, proyectos, fases, tareas, notas, bitácora, avisos, ajustes
      indexes.ts          19 índices creados al arrancar + PRAGMA optimize
      approvals.ts        Aprobación pública desde /{slug}/aprobar, opciones, plan con IA en segundo plano
      extract.ts          Propuesta HTML → texto → plan con IA; ajuste del plan antes de crear el proyecto
      planAdjust.ts       Ajuste con IA del plan de un proyecto en marcha (vista previa → aplicar)
      scope.ts            Retirar del alcance una opción o fase aprobada; agregar un adicional (tareas + cobro + nota); ajustar el alcance con IA
      people.ts           Proyectos compartidos: equipo con habilidades (a mano o desde una reunión grabada) y reparto del trabajo con IA
      images.ts           Capturas e imágenes pegadas en comentarios y notas (guardadas en el servidor)
      reviews.ts          Entregas al cliente: aprobar o pedir ajustes, rondas incluidas, detección con IA
      mcp.ts              Servidor MCP para Claude, OAuth 2.1 y tokens personales
      work.ts             Tareas, fases, notas, bitácora
      updates.ts          Avances diarios con IA, destinatarios, envío automático a las 5:00 p. m.
      reports.ts          Informes parciales y de cierre con IA, PDF imprimible, envío
      meetings.ts         Reuniones: agendar con Meet, sincronizar, transcripción, resumen IA, aprobación, ventas
      availability.ts     Horarios ocupados (Calendar + reuniones) y siguiente horario libre
      files.ts            Adjuntos en Drive, selector, enlace compartido, páginas HTML en sandbox
      payments.ts         Plan de pagos del proyecto (USD/COP); cuota pagada → abono
      billing.ts          Cuentas de cobro, abonos, estado de cuenta, reportes, perfil del emisor, «Poner al día»
      finance.ts          Gestor financiero y TRM
      online-payments.ts  Wompi
      import-smartbilling.ts  Migración desde SmartBilling
      proposalMail.ts     Enviar una o varias propuestas en un correo comercial
      scheduled.ts        Correos programados (propuesta, resumen, cuenta de cobro)
      notify.ts           Catálogo de avisos, preferencias, campana, resumen por correo, Telegram
      telegram.ts         Bot propio del administrador
  public/                 Panel de propuestas sin build (admin.html/js), login, 404, logo
  web/
    index.html            Precarga Inter; monta la SPA
    vite.config.ts        outDir ../public/partners; proxy de /api y /auth en desarrollo
    src/
      main.tsx            Enrutador propio, Shell, menú, campana, tour, límites de error, carga diferida
      lib.ts              Tipos, cliente api() con tiempo máximo, useApi(), formatos
      ui.tsx              Componentes comunes (Link, Loading, toasts, Markdown, Modal…)
      Bell.tsx Tour.tsx Schedule.tsx picker.ts sound.ts vitals.ts
      pages/              Una pantalla por archivo (ver §11)
      pages/project/      Pestañas y vistas del proyecto
      pages/billing/      Facturación
      fonts/              woff2 propios
  docs/                   Documentación
```

## 4. Configuración

### Variables de entorno (`src/config.ts`)

| Variable | Obligatoria | Por defecto | Uso |
|---|---|---|---|
| `PUBLIC_URL` | Sí | `http://localhost:{PORT}` | URL del subdominio de propuestas |
| `PARTNERS_URL` | Sí | `http://partners.localhost:{PORT}` | URL del portal. Su host decide el ruteo y es el único `Origin` aceptado |
| `SESSION_SECRET` | Sí en producción | aleatorio | Firma de cookies. Sin ella, el proceso no arranca en producción |
| `ENCRYPTION_KEY` | Recomendada | `SESSION_SECRET` | Cifra claves guardadas. Si cambia, hay que volver a cargarlas y reconectar Google |
| `SUPERADMIN_EMAIL` | Sí | `ceo@deersystems.net` | Único administrador (entra con Google) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Sí | — | Cliente OAuth web |
| `DATA_DIR` | No | `./data` (`/data` en Docker) | SQLite, versiones de propuestas y páginas HTML |
| `PORT` | No | `3000` | |
| `HOME_URL` | No | `https://deersystems.net` | Redirección de la raíz de propuestas |
| `GEMINI_API_KEY` / `OPENROUTER_API_KEY` | No | — | Respaldo: las del panel tienen prioridad |
| `MAX_UPLOAD_MB` | No | `100` | Tamaño de una propuesta. Lo descomprimido admite 4 veces eso |
| `DEV_LOGIN` | Solo local | — | `1` habilita `/auth/dev` si no es producción y ambas URL son `localhost` |
| `NODE_ENV` | — | — | `production` exige `SESSION_SECRET` |

### Ajustes guardados en la base (tabla `settings`, clave → JSON)

| Clave | Contenido | Se edita en |
|---|---|---|
| `ai` | Perfiles (`propuestas`, `reuniones`): modelo principal, respaldo, `privateOnly`; presupuesto mensual; precios; claves cifradas | Configuración → IA |
| `ai_instructions` | Instrucciones propias por tarea de IA (`plan`, `ajuste`, `pagos`, `avance`, `reunion`, `correo`) | Configuración → Instrucciones |
| `ai_prompt_last:{tarea}` | Último prompt usado por cada tarea (para que la IA reescriba instrucciones con contexto) | Automático |
| `google` | Cuenta conectada, refresh token cifrado, scopes | Configuración → Google |
| `google_picker` | Clave de API del selector de Drive (cifrada) | Configuración → Google |
| `drive` | Carpeta raíz *DeerSystems Partners* | Automático |
| `meetings` / `meetings_sync` | Opciones de reuniones / última sincronización | Reuniones |
| `notifications` | Canales por tipo de aviso (`app`, `email`, `telegram`), `teamEmail`, `digestMinutes` | Configuración → Avisos |
| `telegram` | Token del bot (cifrado), `botUsername`, `chatId`, `chatName`, `linkCode` | Configuración → Avisos |
| `finanzas` | URL del Gestor, clave cifrada, correo del usuario del Gestor | Configuración → Finanzas |
| `billing_profile` | Emisor de las cuentas de cobro: datos, forma de pago, QR, logo, firma | Configuración → Finanzas |
| `billing_catch_up` | Modo «Poner al día» (`enabled`, `since`) | Facturación |
| `online_payments` | Wompi: llaves, secreto de eventos, ambiente, activado | Configuración → Finanzas |
| `auto_updates_day` | Último día en que corrió el envío automático de avances | Automático |
| `update_recipients:{proyecto}` / `update_extra_emails:{proyecto}` | Destinatarios de los avances del proyecto | Pestaña Avances |
| `owner_tour_done` | El administrador terminó el tour | Automático |
| `reviews` | `revisionRounds`: rondas de ajustes incluidas por defecto (0 = sin límite; 2 si no se ha configurado) | Configuración → Entregas y ajustes |

## 5. Servidor HTTP

### Ruteo (`src/server.ts`)

1. Si `Host === PARTNERS_HOST` → `handlePartners` (`partners/routes.ts`):
   - `/auth/*` → login con contraseña, Google, recuperación, desarrollo.
   - `POST /api/webhooks/wompi` → webhook sin sesión ni `Origin`.
   - `/mcp`, `/oauth/*` y `/.well-known/oauth-*` → conector MCP y su autorización (token Bearer, sin cookies; ver §10, Claude).
   - `/api/*` → API con sesión.
   - `/historial/{id}/{versión}/…` → versión antigua de una propuesta (solo el administrador).
   - `/paginas/{token}/…` → página HTML subida como entrega, en sandbox.
   - `/assets/*` → archivos de Vite con `Cache-Control: public, max-age=31536000, immutable`.
   - Cualquier otra ruta GET → `index.html` de la SPA con `no-store`.
2. Cualquier otro host → propuestas:
   - `/` → `/admin` con sesión, o `HOME_URL`.
   - `/admin` y `/admin/api/*` → panel.
   - `/{slug}` → la propuesta. `/{slug}/aprobar` → formulario público de aprobación.

La API normaliza la ruta reemplazando los ids numéricos por `:id`: `PATCH /api/tasks/42` se convierte en `"PATCH tasks/:id"`. Después, `handleApi` prueba cada módulo (`handleWork`, `handleMeetings`, `handleBilling`…), y cada uno devuelve `true` si atendió la ruta.

### Respuestas

- **`json(res, status, body, { etag })`:** comprime con Brotli o gzip el JSON de más de 1 KB y responde con `Cache-Control: no-store`. Con `etag: true` calcula un ETag (sha1) sobre la respuesta completa, contesta `304` si coincide y usa `private, no-cache` con `Vary: Accept-Encoding, Cookie`. Hoy solo lo usa `GET notifications`, el sondeo de la campana.
- **`sendFile`:** comprime JS, CSS, HTML y SVG una sola vez y los guarda en memoria.
- **Errores:** `HttpError(status, mensaje)` responde `{ error }`. Un error inesperado responde `500 Error interno.` y se registra como `[500] partners METHOD /api/projects/:id/...`, con la ruta sin ids ni datos.

### Encabezados del portal

`Cache-Control: no-store`, `X-Frame-Options: DENY`, `X-Robots-Tag: noindex, nofollow` y `Referrer-Policy: strict-origin-when-cross-origin` (lo necesita el selector de Drive).

### Estabilidad

- `unhandledRejection` → se registra y el proceso sigue.
- `uncaughtException` → se registra, se envían los avisos en cola (`flushAll`) y el proceso sale con código 1 para que Docker lo reinicie.
- `SIGTERM` / `SIGINT` (en cada despliegue) → `flushAll()` y salida, con un máximo de 8 s.
- Todo lo externo tiene tiempo máximo:

  | Llamada | Tiempo máximo |
  |---|---|
  | Google (`gfetch`) | 30 s hasta recibir los encabezados; la subida a Drive, 180 s. Las descargas que se transmiten al navegador no se cortan |
  | Intercambio de token de Google | 15 s |
  | IA | 180 s; listado de modelos, 20 s |
  | Telegram | 10 s |
  | En el navegador, GET | 45 s |

- **Al arrancar:**
  1. `ensureIndexes()`.
  2. `pruneNotifications()`.
  3. `linkOrphanMeetings()`: liga las reuniones del plan que quedaron sin tarea.
  4. Se marcan como error las aprobaciones que quedaron en `generando` y los correos programados que quedaron en `enviando`. No se reenvían solos.
- **Esquema:** cada módulo crea sus tablas con `CREATE TABLE IF NOT EXISTS` y añade columnas con `ALTER TABLE` si faltan, comprobándolo con `PRAGMA table_info`. No hay herramienta de migraciones: el esquema se pone al día solo al arrancar.

### Procesos en segundo plano

| Proceso | Archivo | Frecuencia | Qué hace |
|---|---|---|---|
| Sincronizar reuniones | `meetings.ts` `startScheduler` | 30 s después de arrancar y luego cada 10 min (si Google está conectado) | Lee Calendar. Cuando una reunión termina, busca la transcripción de Meet, genera el resumen con IA y lo deja en `borrador`. Si no hay transcripción 3 h después del final, la marca `sin_transcripcion` |
| Avances automáticos | `updates.ts` `startUpdatesScheduler` | Revisa cada 5 min; publica una vez al día desde las 17:00 (Bogotá) | En los proyectos con `auto_updates = 1`, genera y publica el avance del día y lo envía por correo |
| Correos programados | `scheduled.ts` `startScheduledMails` | Cada 60 s | Envía los que ya llegaron a su hora (`pendiente → enviando → enviado/error`) |
| Arreglo de enlaces de Drive | `files.ts` `startShareFixer` | Cada hora | Da acceso por enlace a los archivos compartidos que aún no lo tienen |
| Resumen de avisos por correo | `notify.ts` | Al juntarse avisos (`digestMinutes`, 3 por defecto) | Agrupa avisos en un correo por persona |
| Limpieza de avisos | `db.ts` `pruneNotifications` | Al arrancar | Borra avisos viejos |

Todos los temporizadores usan `.unref()`.

## 6. Autenticación, roles y permisos

### Sesión (`partners/auth.ts`)

- **Cookie `dp_session`:** `base64url(JSON {k, …, exp}) + "." + HMAC-SHA256(clave "partners:" + SESSION_SECRET)`. Es `HttpOnly`, `SameSite=Lax` y `Secure` con HTTPS, y dura 14 días.
- **Tipos de sesión (`k`):**
  - `owner`: correo de Google igual a `SUPERADMIN_EMAIL`.
  - `account`: id y `session_version` de la cuenta.
- **Invalidación:** cambiar la contraseña o desactivar la cuenta incrementa `session_version`, y todas las sesiones de esa persona caen.
- **Contraseñas:** `scrypt$sal$hash` (base64url), mínimo 10 caracteres. La recuperación usa un token de un solo uso válido 1 hora (`password_resets`, se guarda solo el hash).
- **Límite de intentos:** 8 por clave cada 15 minutos (login y recuperación), en memoria.
- **Login con Google:** `state` en una cookie de 10 minutos. `GET /auth/google` sirve para entrar y `GET /auth/google/connect` para conectar Gmail, Drive y Calendar.
- **CSRF:** toda petición no GET a `/api` y los POST de `/auth` exigen `Origin === PARTNERS_URL`.
- **Conector MCP:** `/mcp` solo acepta `Authorization: Bearer` (nunca la cookie). Los tokens son de dos tipos, ambos guardados como hash SHA-256 en `mcp_tokens`:
  - **Personal:** lo crea el administrador en Configuración → Claude (MCP), se muestra una vez y no vence.
  - **OAuth:** lo obtiene Claude al agregar el conector. Acceso de 8 h y renovación de 90 días, que rota en cada uso.

  Cualquiera de los dos actúa como el administrador.

### `Viewer` (quién mira)

```ts
{ kind: 'owner', email }
{ kind: 'team', account, name, email }
{ kind: 'client', account, clientId, billing: boolean, projects: Set<number> | null, … }  // account.own_tasks: solo sus tareas
```

Varias personas del mismo cliente pueden tener cuenta (`accounts.client_id`). Cada una tiene estos permisos:

- `all_projects`: si es 0, solo ve los proyectos que tenga en `account_projects`.
- `billing`: ve valores, pagos y cuentas de cobro.
- `is_primary`: es la cuenta principal (recibe los correos principales).
- `own_tasks`: solo ve sus tareas (el equipo del cliente en un proyecto compartido). Una tarea es suya si su `client_assignee` es su nombre o el de la persona del equipo del proyecto ligada a su cuenta (`projects.people[].accountId`). Ve, comenta y sube archivos solo en esas tareas; las demás (y sus comentarios, archivos, imágenes e historial) responden 404. No ve los informes y solo le llegan los avisos de sus tareas. Sí ve las notas y archivos del proyecto (no de tareas) y los avances.

### Ver como (`partners/auth.ts`)

El administrador puede mirar el portal con los permisos de una persona del equipo o del cliente, sin su contraseña:

- Va en una cookie firmada aparte (`dp_viewas`, 8 horas); la sesión del administrador no cambia. Solo vale si la sesión es la del administrador: con cualquier otra sesión, o sin sesión, se ignora.
- `viewer(req)` devuelve el `Viewer` de esa persona con `preview: true`; `sessionViewer(req)` es siempre quien inició sesión (lo usan la conexión con Google, el historial de propuestas y la autorización del conector MCP).
- Es de solo lectura: con `preview`, el despachador rechaza con 403 todo lo que no sea `GET` (salvo `POST vitals`). No se guarda nada ni se avisa a nadie. `GET me` devuelve `preview: true` y no muestra el tour.
- Rutas (solo el administrador real, aunque esté viendo como otra persona): `GET view-as/options` (equipo activo y personas activas de cada cliente, con lo que ven), `POST view-as` `{accountId}` para entrar o cambiar de persona, `DELETE view-as` para salir. Cerrar sesión también sale de la vista.
- En la interfaz: el botón del ojo en la barra (y «Ver como» en las personas de cada cliente) abre el selector; mientras dura, una franja fija dice a quién estás viendo, con «Cambiar persona» y «Salir de la vista».

### Reglas (`partners/common.ts`)

| Función | Regla |
|---|---|
| `requireOwner` | Solo el administrador (403 si no) |
| `requireStaff` | Administrador o equipo |
| `visibleProject(id, v)` | Un cliente solo ve sus proyectos (`clientSees`). Si el proyecto es ajeno, recibe 404, igual que si no existiera |
| `visibleTask(id, v)`, `seesTask`, `seesTaskId` | Además del proyecto, la persona con `own_tasks` solo ve sus tareas (`accountOwnsTask`); lo de otras tareas responde 404 o no se lista |
| `seesMoney(v)` | Administrador, o persona del cliente con `billing` |
| `taskView(t, v)` | Lo que cada rol ve de una tarea |
| Estados que el cliente puede poner | `pendiente`, `en_progreso`, `en_revision`. Nunca `completada` |

Lo que nunca recibe el equipo, filtrado en el servidor: `pricing`, la URL de la propuesta, pagos, facturación y valores.

Lo que nunca recibe el cliente:
- Notas y archivos internos.
- Borradores de resúmenes e informes.
- Lo generado con IA mientras no esté aprobado o publicado.
- La TRM y los datos del Gestor.

## 7. Modelo de datos (31 tablas)

Todas las fechas son texto ISO. Los JSON se guardan como `TEXT`.

### Propuestas (subdominio `propuestas.`)

| Tabla | Para qué | Columnas clave |
|---|---|---|
| `proposals` | Propuesta publicada | `slug` (único), `title`, `filename`, `has_assets`, `version`, `active`, `views`, `last_viewed_at`, `client_id` (cliente vinculado) |
| `proposal_versions` | Versiones anteriores | `proposal_id`, `version`, `note`, `created_by` |
| `users` | Correos autorizados en el panel de propuestas | `email`, `added_by` |
| `proposal_sends` | Envíos por correo de propuestas | `proposal_id`, `to_emails`, `subject`, `sent_at` |
| `proposal_approvals` | Aprobaciones desde el enlace público | `proposal_id`, `version`, `option_id`/`option_name`/`option_summary`, datos de quien aprueba (`name`, `email`, `company`, `phone`, `notes`, `ip`, `user_agent`), `status` (`generando`→`listo`/`error`→`convertida`/`descartada`), `draft` (plan IA en JSON), `ai`, `project_id`, `client_id` |

Los archivos de las propuestas están en disco, en `DATA_DIR/files/{id}/v{versión}/`.

### Clientes y personas

| Tabla | Para qué | Columnas clave |
|---|---|---|
| `clients` | Cliente (empresa o persona) | `name`, `contact_name`, `email` (único, puede faltar), `phone`, `doc_type`, `doc_number`, `city`, `address`, `extra_emails` (JSON), `drive_folder_id`, `sb_id` (SmartBilling) |
| `accounts` | Cuentas con contraseña (equipo o cliente) | `email` (único), `name`, `role` (`team`/`client`), `client_id`, `password_hash`, `active`, `session_version`, `all_projects`, `billing`, `is_primary`, `own_tasks` (solo sus tareas), `notify_prefs` (JSON), `tour_done`, `last_login_at` |
| `account_projects` | Proyectos de una cuenta de cliente con `all_projects = 0` | `account_id`, `project_id` |
| `password_resets` | Recuperación de contraseña | `token_hash`, `account_id`, `expires_at`, `used` |

### Proyectos y trabajo

| Tabla | Para qué | Columnas clave |
|---|---|---|
| `projects` | Proyecto | `client_id`, `proposal_id`, `name`, `scope` (alcance sin valores, Markdown), `pricing` (valores; nunca al equipo), `status` (`activo`/`pausado`/`finalizado`), `start_date`, `end_date`, `approved_option`, `approval_notes`, `auto_updates`, `drive_folder_id`, `revision_rounds` (null = las de Configuración), `trm`/`trm_date` (TRM fija para los pagos en USD), `people` (JSON del equipo del proyecto compartido: `key`, `name`, `side`, `skills`, `accountId`, `lead`; `key='yo'` = DeerSystems, el orquestador; `accountId` liga a alguien del equipo o, en las personas del cliente, a su cuenta del portal) |
| `phases` | Fases del plan | `project_id`, `name`, `position` |
| `tasks` | Tareas y reuniones del cronograma | `phase_id`, `title`, `description`, `status` (`pendiente`/`en_progreso`/`en_revision`/`bloqueada`/`completada`), `side` (`deersystems`/`cliente`), `assignee_id`, `start_date`, `due_date`, `position`, `source` (`propuesta`/`manual`/`reunion`), `kind` (`tarea`/`reunion`: la reunión se pinta con franja naranja), `completed_at`, `client_delivery` (entrega que revisa el cliente), `revision_round` (rondas de ajustes pedidas), `approved_at`/`approved_by`, `client_assignee` (persona del cliente a cargo en proyectos compartidos; solo en tareas del cliente) |
| `notes` | Comentarios y avances | `task_id` (null = del proyecto), `kind` (`nota`/`avance`), `visibility` (`shared`/`internal`), autor, `body` (Markdown), `ai` (lo generó la IA), `emailed_at` |
| `activity` | Bitácora | `type`, `data` (JSON), `actor_*`, `internal` |
| `attachments` | Archivos en Drive | `task_id`, `drive_file_id`, `drive_url`, `name`, `mime`, `size`, `visibility`, `link_shared`, `linked` (elegido del Drive propio, no subido), `page_token` (página HTML publicada en `/paginas/{token}`) |
| `images` | Capturas pegadas en comentarios y notas | `project_id`, `task_id`, `file` (nombre aleatorio en `DATA_DIR/images/`), `mime` (leído de los primeros bytes: PNG, JPG, GIF o WebP), `size`, autor |
| `scope_changes` | Cambios del alcance: retiros, adicionales y ajustes | `kind` (`retiro`/`adicional`/`ajuste`), `detail` (JSON del adicional: tareas, valor, descuento, pago; del ajuste: `changes`, `scopeChanged`), `option_id`/`option_name`, `amount`, `currency`, `reason`, `label_before`/`label_after`, `phases` (JSON), `tasks_removed`, `payments` (JSON) |
| `project_reports` | Informes | `kind` (`parcial`/`final`), `title`, `period_from`/`period_to`, `context`, `include_payments`, `body`, `ai`, `status` (`borrador`/`publicado`), `published_at`, `emailed_at`, `emailed_to` |

### Reuniones

`meetings` es una sola tabla para todos los tipos:

- **`kind`:**
  - `proyecto`: reunión de avance de un proyecto.
  - `discovery`: llamada de descubrimiento con un prospecto.
  - `proposal`: presentación de la propuesta.
  - `cliente`: reunión con un cliente sin proyecto.
- **`status`:**
  - `programada` → `esperando` (buscando transcripción) → `borrador` (resumen listo para revisar) → `aprobada`.
  - Desvíos: `sin_transcripcion`, `error`, `descartada`.
- **Google:** `event_id` (Calendar, único), `meet_code`, `meet_url`, `calendar_url`, `attendees` (JSON), `pending_attendees`, `tentative`.
- **Relaciones:** `client_id`, `project_id`, `phase_id`, `plan_task_id` (la tarea `kind='reunion'` que la representa en el cronograma; se mantienen sincronizadas en título, fecha, fase y estado).
- **Contenido:** `transcript`, `transcript_source` (`meet`/`drive`/`manual`), `transcript_url`, `summary`, `agreements` (JSON), `proposed_tasks` (JSON), `proposed_changes` (JSON: ajustes que pidió el cliente sobre entregas), `task_ids` (tareas creadas al aprobar), `ai`, `error`, `approved_at`/`approved_by`, `sent_to`.
- **Ventas:** `prospect` (JSON: empresa, contacto, correo), `proposal_id`, `proposal_sent_at`, `proposal_sent_to`.

### Dinero

| Tabla | Para qué | Columnas clave |
|---|---|---|
| `payments` | Plan de pagos del proyecto | `label`, `percent`, `amount`, `currency` (`USD`/`COP`), `due_date`, `paid`, `paid_at`, `amount_cop`, `trm`, `invoice_id`, `sync_*` |
| `invoices` | Cuentas de cobro | `number` (único, sigue la numeración de SmartBilling), `kind`, `date`, `due_date`, `currency`, `exchange_rate`, `total`, `total_cop`, `notes`, `status` (`emitida`/`anulada`), `sent_at`, `online_link_id`/`url`, `sb_id` |
| `invoice_items` | Ítems | `description` (HTML con lista blanca: negrita, listas, tablas, imágenes), `quantity`, `unit`, `unit_price`, `position` |
| `receipts` | Abonos (cada uno es un ingreso del Gestor) | `client_id`, `project_id`, `invoice_id`, `payment_id` (único: la cuota que lo originó), `amount`, `currency`, `trm`, `amount_cop`, `date`, `method`, `proof_url`, `finance_ref` (única, la referencia en el Gestor), `finance_category`, `finance_description`, `sync_status`/`sync_error`/`synced_at`, `skip_finance`, `catch_up`, `finance_group`, `sb_id` |
| `receipt_invoices` | Un abono repartido entre varias cuentas de cobro | `receipt_id`, `invoice_id`, `amount_cop` |
| `finance_groups` | Varios abonos unidos en un solo ingreso del Gestor | `ref`, `client_id`, `date`, `description` |

### Sistema

| Tabla | Para qué |
|---|---|
| `settings` | Clave → JSON (ver §4) |
| `notifications` | Campana: `recipient_kind` (`owner`/`account`), `recipient_id`, `project_id`, `task_id`, `type`, `title`, `body`, `link`, `read_at` |
| `scheduled_mails` | Correos programados: `kind` (`proposal`/`summary`/`invoice`), `ref_id`, `send_at`, `mail` (el correo completo con adjuntos, ya armado), `meta`, `status`, `error`, `sent_at` |
| `ai_usage` | Cada llamada a la IA: proveedor, modelo, `purpose`, tokens, `cost_usd`, `latency_ms`, `ok`, `error` |
| `mcp_clients` | Clientes OAuth registrados por Claude (registro dinámico): `id`, `name`, `redirect_uris` (JSON), `secret_hash` (si pidió secreto). Los que nunca se autorizaron se borran a los 7 días |
| `mcp_tokens` | Conexiones de Claude: `kind` (`personal`/`oauth`), `name`, `client_id`, `token_hash`, `expires_at`, `refresh_hash`, `refresh_expires_at`, `last_used_at` |

### Índices

Hay 19 índices en `partners/indexes.ts` (más los que crea cada módulo). Cubren:
- Las consultas frecuentes: fases por proyecto, tareas por fase o responsable, reuniones por tarea, cliente o fase, cuentas por cliente.
- Todas las claves foráneas con borrado `CASCADE` o `SET NULL`.

Se crean al arrancar con `IF NOT EXISTS` y después se ejecuta `PRAGMA optimize=0x10002`.

## 8. API (unas 200 rutas)

Todas cuelgan de `/api/` en `partners.`, salvo las de `/auth/`. La tabla indica quién puede usar cada grupo: **A** = administrador, **E** = equipo, **C** = cliente.

### Sesión y cuenta (`routes.ts`)

| Ruta | Quién |
|---|---|
| `POST /auth/login`, `POST /auth/logout`, `POST /auth/forgot`, `POST /auth/reset` | Público |
| `GET /auth/google`, `GET /auth/google/connect`, `GET /auth/google/callback`, `GET /auth/dev` | A |
| `GET me`, `POST me/password`, `POST me/tour`, `GET/PUT me/notifications` | Todos |
| `POST vitals` | Todos (métricas Web Vitals malas; se registran anonimizadas como `[vitals]`) |

### Proyectos, clientes y equipo (`routes.ts`)

| Ruta | Quién |
|---|---|
| `GET projects`, `GET projects/:id` | A E C (filtrado) |
| `PATCH/DELETE projects/:id`, `POST projects` | A |
| `GET deliveries` | A E C: calendario general de entregas (`?all=1` incluye finalizados) |
| `GET/POST clients`, `GET/PATCH clients/:id`, `POST clients/:id/access`, `POST clients/:id/password` | A (lectura también E) |
| `POST clients/:id/accounts`, `PATCH/DELETE client-accounts/:id`, `POST client-accounts/:id/primary`, `POST client-accounts/:id/password` | A |
| `GET/POST team`, `PATCH/DELETE team/:id`, `POST team/:id/password` | A |

### Propuestas y aprobación (`routes.ts`, `proposalMail.ts`, `approvals.ts`, `extract.ts`)

| Ruta | Qué hace |
|---|---|
| `GET/POST proposals`, `PUT proposals/:id/file`, `PATCH/DELETE proposals/:id` | Publicar, reemplazar (crea versión), renombrar o activar, borrar |
| `GET proposals/:id/versions`, `POST proposals/:id/versions/:id/restore` | Historial |
| `POST proposals/:id/options` | Detectar con IA las opciones de la propuesta |
| `POST proposals/:id/draft` | Plan de trabajo con IA (opción y notas) |
| `POST proposals/:id/plan` | Ajustar el plan con una instrucción |
| `POST proposals/:id/welcome-preview` | Vista previa del correo de bienvenida |
| `GET proposals/:id/approvals/:id`, `POST …/retry`, `POST …/discard` | Aprobaciones que llegaron desde el enlace público |
| `POST proposals/send/preview`, `POST proposals/send` | Enviar una o varias propuestas en un solo correo comercial |

La creación del proyecto a partir del plan aprobado usa `POST projects`. Puede crear un proyecto nuevo o sumar la aprobación a uno existente.

### Trabajo (`work.ts`, `planAdjust.ts`, `scope.ts`)

| Ruta | Qué hace |
|---|---|
| `POST projects/:id/tasks`, `PATCH/DELETE tasks/:id` | Tareas. El cliente solo cambia el estado de las suyas |
| `POST projects/:id/phases`, `PATCH/DELETE phases/:id` | Fases |
| `GET/POST projects/:id/notes`, `PATCH/DELETE notes/:id` | Comentarios y avances. Los comentarios y notas se escriben con el editor visual y pueden llevar capturas: `![captura](/api/images/{id})`. En los avisos y la bitácora la imagen se cambia por «[imagen]» |
| `POST projects/:id/images?taskId=`, `GET images/:id` | Subir una captura (pegada, arrastrada o elegida; máx. 10 MB) y verla. La ve quien ve el proyecto y, si es de una tarea, quien ve esa tarea |
| `GET projects/:id/activity` | Bitácora |
| `POST projects/:id/plan/adjust` → `POST projects/:id/plan/apply` | Ajuste con IA: vista previa y luego aplicar. Mueve también los eventos de Calendar |
| `POST projects/:id/plan/adjust` con `allowWeekends` | Por defecto la IA no pone tareas en sábado ni domingo; con la casilla «Permitir fin de semana» sí (las reuniones siguen siendo entre semana) |
| `GET projects/:id/scope`, `POST projects/:id/scope/remove` | Retirar una opción o fase del alcance |
| `POST projects/:id/scope/add/suggest`, `POST projects/:id/scope/add` | Adicional: la IA arma las tareas a partir del pedido; al confirmar se crean la fase «Adicional: X», sus tareas, el pago con descuento (al aprobar, al entregar o en una fecha), la nota en `pricing`, el registro en `scope_changes` y, si se elige, una nota para el cliente. Solo mueve la entrega del proyecto si el adicional termina después |
| `POST projects/:id/scope/adjust/suggest`, `POST projects/:id/scope/adjust` | Ajuste del alcance con IA: con una instrucción, la IA devuelve el texto del alcance reescrito (solo cambia lo pedido, sin precios) y, si se pide, los cambios del plan (crear, cambiar o eliminar tareas pendientes; nunca reuniones ni completadas). No guarda nada. Al aplicar se guarda el texto (editable), los cambios del plan que se dejaron marcados (con `applyPlan` de `planAdjust.ts`), el registro `ajuste` en `scope_changes`, la actividad `scope_adjusted` (el cliente no ve el resumen) y, si se elige, una nota para el cliente |
| `GET people/meetings`, `POST meetings/:id/people`, `POST people/distribute`, `PUT projects/:id/people` | Proyecto compartido: reuniones con transcripción (primero las del cliente o la propuesta), perfiles desde una reunión, reparto de tareas con IA y equipo del proyecto. El ajuste del plan con IA también conoce el equipo y puede reasignar (`assigneeId`, `clientAssignee`) |
| `POST tasks/:id/review` | `{decision: 'approve'\|'changes', note}`: el cliente aprueba o pide ajustes; el equipo registra lo que dijo el cliente o reabre una completada. Solo para entregas al cliente (409 en tareas operativas) |
| `PUT projects/:id/reviews`, `GET/PUT settings/reviews` | Rondas de ajustes incluidas, por proyecto o por defecto (0–20; 0 = sin límite) |
| `POST projects/:id/deliveries/detect`, `PUT projects/:id/deliveries` | La IA propone qué tareas del equipo son entregas al cliente; se guarda la lista confirmada |

### Avances e informes (`updates.ts`, `reports.ts`)

| Ruta | Qué hace |
|---|---|
| `POST projects/:id/updates/draft` | Avance del día con IA (o plantilla si la IA falla) |
| `GET projects/:id/updates/mail`, `PUT projects/:id/updates/recipients` | Destinatarios: personas del portal más correos extra |
| `POST projects/:id/updates/mail-preview`, `POST notes/:id/email` | Vista previa y envío del avance por correo |
| `PUT projects/:id/updates/auto` | Encender el avance diario automático |
| `GET/POST projects/:id/reports`, `PATCH/DELETE reports/:id` | Informes parciales y de cierre |
| `POST reports/:id/regenerate`, `POST reports/:id/publish`, `POST reports/:id/email`, `POST reports/:id/mail-preview` | Regenerar, publicar (el de cierre puede finalizar el proyecto), enviar |
| `GET reports/:id/print` | HTML para imprimir o guardar como PDF (logo incrustado, sin recursos externos) |

### Reuniones (`meetings.ts`)

| Ruta | Qué hace |
|---|---|
| `GET meetings`, `POST meetings/sync`, `PUT meetings/settings` | Lista general (sin transcripciones), sincronizar, opciones |
| `POST calendar/check` | Revisar horarios contra Calendar y otras reuniones |
| `POST meetings/sales` | Agendar `discovery`, `proposal` o `cliente` (sin proyecto) |
| `POST meetings/:id/proposal/preview`, `/send`, `/message` | Tras la llamada: enviar la propuesta con un mensaje redactado por la IA |
| `POST projects/:id/meetings/schedule`, `GET/POST projects/:id/meetings`, `GET projects/:id/contacts` | Reuniones del proyecto |
| `GET tasks/:id/meeting` | La reunión de una tarea `kind='reunion'` |
| `GET/PATCH meetings/:id`, `POST meetings/:id/update`, `POST meetings/:id/confirm`, `POST meetings/:id/cancel` | Ver, editar (mueve el evento), confirmar una tentativa, cancelar |
| `POST meetings/:id/lookup`, `POST meetings/:id/transcript/drive`, `POST meetings/:id/transcript` | Buscar la transcripción en Meet, importarla de Drive o pegarla |
| `POST meetings/:id/generate`, `POST meetings/:id/preview`, `POST meetings/:id/discard`, `POST meetings/:id/approve` | Resumen con IA → vista previa del correo → aprobar (crea tareas, envía; con `kind='cliente'` sin proyecto no crea tareas) |

### Archivos (`files.ts`)

| Ruta | Qué hace |
|---|---|
| `GET/POST projects/:id/attachments` | Subir a Drive (carpeta *Raíz / Cliente / Proyecto*) |
| `POST projects/:id/attachments/drive` | Enlazar archivos elegidos con el selector de Drive |
| `PATCH/DELETE attachments/:id`, `GET attachments/:id/download` | Compartido o interno, descargar (solo se muestran en línea las imágenes y los PDF) |
| `GET/PUT settings/google/picker` | Clave del selector |
| `/paginas/{token}/…` | Entregas en HTML (`.zip`) servidas con `Content-Security-Policy: sandbox …`: un origen aparte, sin cookies ni acceso a la API |

### Pagos y facturación (`payments.ts`, `billing.ts`, `finance.ts`, `online-payments.ts`, `import-smartbilling.ts`)

| Ruta | Qué hace |
|---|---|
| `GET/POST projects/:id/payments`, `POST projects/:id/payments/suggest` | Plan de pagos (sugerido con IA) |
| `PATCH/DELETE payments/:id`, `POST payments/:id/paid`, `POST payments/:id/sync` | Marcar pagado crea el abono y lo lleva al Gestor. Si cambia el monto o la moneda de una cuota, el `%` de todas las cuotas del proyecto en esa moneda se recalcula sobre su total |
| `POST projects/:id/payments/together` | Pago conjunto: una transferencia repartida entre varias cuotas |
| `PUT projects/:id/trm` | TRM fija del proyecto: un valor (`trm`), la oficial de hoy (`today: true`) o quitarla (`trm: null`). Queda en la bitácora interna (`trm_set`) |
| `GET/POST invoices`, `GET invoices/search`, `GET invoices/next-number`, `GET/PUT/PATCH/DELETE invoices/:id` | Cuentas de cobro |
| `POST invoices/:id/send` | Enviar por Gmail con el PDF y adjuntos (se puede programar) |
| `POST invoices/:id/settle`, `POST invoices/settle` | Saldar una o varias |
| `GET/PUT billing/catch-up` | Modo «Poner al día»: abonos que no van al Gestor |
| `GET/POST receipts`, `PATCH/DELETE receipts/:id`, `POST receipts/:id/sync` | Abonos |
| `POST receipts/group`, `POST receipts/ungroup` | Unir abonos en un solo ingreso del Gestor |
| `GET clients/:id/statement` | Estado de cuenta |
| `GET billing/report`, `GET/PUT billing/profile` | Reportes y perfil del emisor |
| `GET trm`, `GET/PUT settings/finanzas`, `GET settings/finanzas/status`, `POST settings/finanzas/test` | TRM y conexión con el Gestor |
| `GET/PUT settings/online-payments`, `POST invoices/:id/online`, `POST /api/webhooks/wompi` | Wompi |
| `POST import/smartbilling/preview`, `/upload`, `/apply` | Migración |

### Correos programados, avisos y ajustes

| Ruta | Qué hace |
|---|---|
| `GET scheduled-mails`, `POST scheduled-mails/:id/send-now`, `POST scheduled-mails/:id/cancel` | Cola de correos programados |
| `GET notifications` (con ETag), `POST notifications/read` | Campana |
| `GET/PUT settings/notifications` | Canales por tipo de aviso |
| `GET/PUT settings/telegram`, `POST settings/telegram/link`, `/test`, `/disconnect` | Bot de Telegram |
| `GET settings/mcp`, `POST settings/mcp/tokens`, `DELETE settings/mcp/connections/:id` | Conexiones de Claude: dirección del conector, crear un token personal, desconectar |
| `GET/PUT settings/ai`, `GET settings/ai/models`, `POST settings/ai/test`, `GET settings/ai/usage` | IA |
| `GET/PUT settings/ai/instructions`, `POST settings/ai/instructions/suggest` | Instrucciones propias, redactadas a mano o con la IA |
| `GET settings/google`, `POST settings/google/disconnect`, `POST settings/google/test-mail`, `GET settings/mail-preview` | Google y plantillas |

### Conector MCP y OAuth (`mcp.ts`, sin `/api/`)

| Ruta | Qué hace |
|---|---|
| `POST /mcp` | JSON-RPC: `initialize`, `ping`, `tools/list`, `tools/call` (también lotes). Sin token responde 401 con `WWW-Authenticate: Bearer resource_metadata=…`. `GET`/`DELETE` → 405 (no hay flujo SSE ni sesiones) |
| `GET /.well-known/oauth-protected-resource[/mcp]`, `GET /.well-known/oauth-authorization-server`, `/.well-known/openid-configuration` | Metadatos (RFC 9728 y 8414) |
| `POST /oauth/register` | Registro dinámico (RFC 7591). Destinos https, o http solo en localhost. Máximo 8 cada 15 min por IP |
| `GET/POST /oauth/authorize` | Pantalla «Conectar Claude». Sin sesión guarda el destino en la cookie `dp_next` y manda a `/login`; al volver del login con Google regresa ahí. Solo el administrador puede permitir. Exige PKCE S256 |
| `POST /oauth/token` | `authorization_code` (código de un solo uso, 5 min, en memoria) y `refresh_token` (rota). Reconectar el mismo cliente reemplaza su conexión anterior |
| `POST /oauth/revoke` | Revoca un acceso OAuth |

### Panel de propuestas (`server.ts`, host `propuestas.`)

`GET me`, `GET/POST proposals`, `PUT proposals/:id/file`, `PATCH/DELETE proposals/:id`, `GET/POST users`, `DELETE users/:id`, bajo `/admin/api/`.

## 9. Flujos principales

### Propuesta → proyecto

1. Se sube un `.html` o `.zip` y se publica en `propuestas./{slug}`. Reemplazarla guarda una versión. Las visitas se cuentan sin bots ni vistas previas.
2. Las propuestas generadas por `generar_propuesta.py` traen sus datos en `<script type="application/json" id="propuesta">`: opciones, valores y forma de pago. Sin ese bloque, la propuesta se trata como una sola oferta.
3. La aprobación puede llegar por dos caminos:
   - **Desde el panel** (`/propuestas/:id/aprobar`).
   - **Desde el enlace público** (`/{slug}/aprobar`): el cliente elige una o varias opciones y acepta. Si la propuesta está vinculada a un cliente existente, no se le piden datos y su correo se muestra enmascarado. Queda una `proposal_approval` y la IA genera el plan en segundo plano; se avisa con `proposal_approved`.
4. La IA (perfil *propuestas*, tarea `plan`) devuelve un borrador: cliente, alcance sin valores, fases, tareas con fechas y lado, reuniones de avance y pagos. Las reuniones que chocan con la agenda se mueven al siguiente horario libre (`availability.placeMeetings`).
5. «Ajustar con IA» modifica el borrador con una instrucción, en la vista previa.
   - **TRM fija:** si hay pagos en USD, se propone la TRM oficial de hoy (editable) y queda en el proyecto para toda la propuesta. Si se suma a un proyecto que ya tiene TRM, se conserva la suya.
   - **Proyecto compartido:** se define el equipo (DeerSystems orquesta y lleva la mayor carga; personas del cliente y del equipo con sus habilidades). Los perfiles se pueden sacar de una reunión con transcripción (`POST meetings/:id/people`). «Repartir el trabajo con IA» (`POST people/distribute`) asigna cada tarea: a una persona del cliente (tarea del cliente con `client_assignee`), a alguien del equipo (`assignee_id`) o al orquestador. El equipo queda en `projects.people`.
6. Al crear el proyecto se hace todo esto:
   - Se crea o reutiliza el cliente y su cuenta (con contraseña aleatoria, enviada en el correo de bienvenida).
   - Se crean las fases, las tareas y los pagos.
   - Se agendan las reuniones en Calendar con Meet, ligadas a su tarea `kind='reunion'`.
   - Se crea la carpeta en Drive.
   - Se envía el correo de bienvenida (o el de «nuevo proyecto» si el cliente ya existía).

   También se puede **sumar la aprobación a un proyecto existente**: sus tareas, reuniones y pagos se integran a ese proyecto.

### Proyecto en marcha

- **Pestañas:**
  - Avances.
  - Plan de trabajo, con varias vistas: Lista, Tablero, Calendario, Reuniones y Cronograma (Gantt, exportable a PDF).
  - Documentación.
  - Alcance y propuesta.
  - Pagos.
  - Informes.
- **Ajuste con IA del plan:** propone operaciones sobre las tareas existentes (mover, cambiar fechas o fase, reprogramar reuniones). Se revisan antes de aplicarlas, y aplicarlas mueve también los eventos de Calendar sin cruces.
- **Adicionales:** «Agregar adicional» (pestaña Alcance) registra en un paso un pedido extra del cliente: tareas (la IA las propone), cobro con descuento y nota. Sirve para excepciones como trabajar el fin de semana sin mover la entrega.
- **Entregas y ajustes:** solo las tareas marcadas como entrega al cliente pasan por su revisión. Al ponerlas «En revisión» se le avisa (`delivery_ready`); el cliente aprueba o pide ajustes desde la tarea (`client_review` al equipo). Cada pedido suma una ronda, devuelve la tarea a «En progreso» y deja el pedido como comentario compartido. Las rondas que pasan de las incluidas se marcan como adicionales. Las tareas operativas las cierra el equipo sin aprobación del cliente. La marca la propone la IA al armar el plan y los adicionales, o en «◆ Entregas al cliente» para proyectos existentes.
- **Ajustar el alcance con IA:** «✦ Ajustar con IA» (pestaña Alcance) reescribe el texto según lo acordado y propone las tareas que cambian; se ve el texto con lo agregado y lo quitado marcado, se puede editar, y cada cambio del plan se desmarca si no va. Lo que tiene valor sigue por «Agregar adicional» o «Retirar del alcance».
- **Retirar del alcance:** se borran las tareas pendientes y los pagos sin pagar de esa opción o fase, y se recalcula la etiqueta de lo aprobado. Lo terminado se queda y el retiro queda registrado en `scope_changes`. La opción vuelve a estar disponible para aprobarse después.
- **Equipo del cliente con acceso:** en un proyecto compartido, cada persona del cliente puede entrar con su correo («Dar acceso» en la tarjeta del equipo, o «Solo ve sus tareas» en las personas del cliente). Ve solo las tareas que tiene asignadas, las comenta (con capturas) y les sube archivos.
- **Avances:** se arman con los hechos del día (tareas completadas o en revisión, reuniones, archivos, próxima reunión) con enlaces internos, y la IA los redacta. Se pueden publicar a mano o automáticamente a las 17:00, y van por correo a los destinatarios elegidos.
- **Informes:**
  - Parcial: cubre un periodo, que por defecto empieza el día siguiente al último informe.
  - De cierre: cubre todo el proyecto y puede finalizarlo.

  Los dos quedan como borrador editable hasta publicarlos.

### Reuniones

- **Agendar:** se revisa la disponibilidad (Calendar más las reuniones del portal), se crea el evento con Meet e invitados, y se avisa con `meeting_scheduled`.
- **Después de la reunión:**
  1. La sincronización encuentra la transcripción de Meet. Si no aparece, se puede importar de Drive o pegar a mano.
  2. La IA (perfil *reuniones*, privado) devuelve resumen, acuerdos y tareas para cada lado.
  3. La reunión queda en `borrador` y se avisa con `meeting_draft`.
  4. Se revisa, se ve la vista previa del correo y se aprueba. Se crean las tareas, se envía el resumen (se puede programar) y se avisa con `meeting_summary`.
  5. Si en la reunión el cliente pidió ajustes sobre entregas ya entregadas, la IA los propone (`proposed_changes`). Al aprobar se registra una ronda en cada una; los que caen sobre tareas operativas o no entregadas se saltan con aviso.
- **Ventas (`discovery`/`proposal`):** la reunión tiene un prospecto sin cliente. Tras la llamada, la IA redacta el correo con el enlace de la propuesta (tarea `correo`).
- **Reunión con cliente (`cliente`):** cliente sin proyecto. Al aprobarla no se crean tareas ni bitácora. El correo lleva el enlace al portal solo si el cliente tiene cuenta.

### Dinero

1. Al marcar una cuota del plan como pagada se crea su abono (`receipts.payment_id`). Ese abono hace `PUT` al Gestor con la referencia `deersystems-pago-{id}`.
   - **Moneda:** si la cuota es en USD, el abono se registra en COP con la TRM fija del proyecto o, si no tiene, la oficial del día (o el valor recibido en pesos que indiques). Las cuentas de cobro y los abonos de un proyecto con TRM fija también la proponen (`GET trm?projectId=`).
   - **Pago conjunto:** una transferencia se reparte entre varias cuotas.
2. **Cuentas de cobro:**
   - La numeración continúa la de SmartBilling.
   - El PDF se genera en el navegador y se envía por Gmail con adjuntos; el envío se puede programar.
   - Un abono puede repartirse entre varias cuentas de cobro (`receipt_invoices`): se cubren en el orden en que se marcan y la última recibe lo que alcance.
   - Varios abonos pueden unirse en un solo ingreso del Gestor (`finance_groups`).
3. **«Poner al día»:** mientras está encendido, los abonos marcan las cuentas de cobro como pagadas sin llevar el ingreso al Gestor (`skip_finance = 1`, `catch_up = 1`).
4. **Wompi (opcional):** crea un link de pago de un solo uso por el saldo. El webhook, validado con la firma SHA-256 e idempotente por transacción, registra el abono aplicado a esa cuenta de cobro.

## 10. Integraciones

### Google (`src/google.ts`)

- **Scopes:** `openid`, `email`, `gmail.send`, `drive.file` (solo los archivos que crea la app o que se eligen en el selector), `calendar.events`, `meetings.space.readonly`.
- **Token:** refresh token cifrado; el access token se guarda en memoria.
- **Gmail:** `sendMail(mail)` arma un MIME con HTML y adjuntos.
- **Drive:** carpetas con `ensureFolder`, `uploadFile`, `downloadFile` (streaming al navegador), `trashFile`, `setLinkSharing`, `fileText`/`exportPdf` para documentos nativos.
- **Calendar:** crear, actualizar, cancelar y listar eventos, con `conferenceData` de Meet.
- **Meet:** `meetTranscript(code, start)` busca la conferencia y su transcripción.
- **Picker:** clave de API, más el número de proyecto sacado de `GOOGLE_CLIENT_ID`.

### IA (`src/ai.ts`)

- **Perfiles:**
  - `propuestas`: Gemini Flash, con respaldo en un modelo gratis de OpenRouter.
  - `reuniones`: Gemini Flash, con respaldo en un modelo de pago y `privateOnly` (OpenRouter `data_collection: deny`).
- **`complete()` / `completeJson()`:** prueban el modelo principal y, si falla, el respaldo (registran `fallbackReason`). Cada llamada queda en `ai_usage` con su costo; OpenRouter informa el costo real y en Gemini se calcula con la tabla de precios.
- **Presupuesto:** 5 USD al mes por defecto, informativo.
- **Tareas con prompt propio y sus `purpose`:**

  | Tarea | `purpose` |
  |---|---|
  | `plan` | `propuesta`, `propuesta-opciones` |
  | `ajuste` | `ajuste del plan`, `ajuste del plan del proyecto` |
  | `pagos` | `pagos` |
  | `avance` | `avance` |
  | `reunion` | `reunion` |
  | `correo` | `propuesta-correo` |

  Las instrucciones propias se suman al final del prompt de sistema.
- **Todo lo que hace la IA tiene una versión sin IA:** avances e informes usan una plantilla con los mismos datos si la IA no responde.
- **Lo generado con IA no lo ve el cliente** hasta que se aprueba o se publica.

### Gestor financiero (`partners/finance.ts`)

- **Endpoints:** `PUT` y `DELETE {url}/integrations/billing-payment/{referencia}`.
- **Encabezados:** `x-api-key` y `x-user-email`.
- **Cuerpo:** `{ amount, date, clientName, description, paymentMethod: 'cash'|'transfer' }`.
- **URL por defecto:** `https://api.finanzas.lidutech.net/api`.

### Telegram (`partners/telegram.ts`)

1. El administrador crea un bot con @BotFather y pega el token. Se valida con `getMe`, se descartan los mensajes pendientes y se genera `linkCode`.
2. Abre `t.me/{bot}?start={código}` y pulsa «Vincular». El servidor busca `/start {código}` con `getUpdates` (sin webhook) y guarda el `chatId`.
3. `sendAlert({ title, body, path })` envía el mensaje en HTML con el enlace al portal y nunca lanza errores.

Por Telegram solo llegan los avisos de audiencia `owner` o `staff`.

### Claude (`partners/mcp.ts`)

- **Conectar:** en claude.ai (Configuración → Conectores → conector personalizado) con la URL `{PARTNERS_URL}/mcp`, que queda disponible también en la app de escritorio y el móvil. En Claude Code: `claude mcp add --transport http deersystems {PARTNERS_URL}/mcp`, con OAuth o con `--header "Authorization: Bearer {token}"`.
- **Cómo actúa:** cada herramienta llama a la API del propio servidor por `127.0.0.1:{PORT}` con una cookie de administrador de 2 minutos que nunca sale del servidor (`internalOwnerCookie`). Así valida, avisa y deja bitácora igual que la app (a nombre de «DeerSystems»).
- **Herramientas de lectura:** `list_projects`, `list_clients`, `get_project`, `search_tasks` (filtros por proyecto, estado, lado, responsable, fechas, texto, entregas), `get_task` (con comentarios), `list_updates`, `get_activity`, `list_meetings`, `get_meeting` (transcripción opcional), `get_payments`, `get_client_statement`, `list_team`.
- **Herramientas de acción:** `create_task`, `update_task` (estado y campos) y `add_comment` (interno por defecto; `shared: true` lo ve el cliente). No hay herramientas para borrar ni para facturar.
- **Respuestas:** JSON compacto, sin nulos ni campos vacíos.

### Correo (`src/mail.ts`)

- Plantillas HTML en línea con la paleta de la marca (`canvas #051923`, `card #0d2a38`, `verde #7ED957`, `cian #00B4D8`…).
- Plantillas: `welcomeClient`, `newProjectForClient`, `welcomeTeam`, `newPassword`, `passwordReset`, `invoiceForClient`, `notificationDigest`, `projectReport`, `projectUpdate`, `proposalApproved`, `proposalAfterCall`, `meetingSummary`, `proposalsOffer`, `sample`.
- La vista previa usa exactamente el mismo correo que se envía y se muestra en `<iframe sandbox="">`.

### Avisos (`partners/notify.ts`)

**Catálogo (`EVENTS`):** tipo, audiencia y canales por defecto.

| Tipo | Audiencia | App | Correo |
|---|---|---|---|
| `client_comment`, `client_status`, `client_file` | staff | ✓ | ✓ |
| `team_assigned` | team (la persona asignada) | ✓ | ✓ |
| `client_task`, `staff_update`, `staff_comment` | client | ✓ | ✓ |
| `staff_file`, `meeting_scheduled`, `meeting_summary` | client | ✓ | — |
| `client_review` | staff | ✓ | ✓ |
| `delivery_ready` | client | ✓ | ✓ |
| `meeting_draft`, `online_payment`, `proposal_approved` | owner | ✓ | ✓ |
| `scheduled_mail` | owner | ✓ | — |

- Telegram está activado por defecto en todos los de audiencia owner o staff.
- El administrador decide los canales para todos, y cada persona puede apagar los suyos (`accounts.notify_prefs`).
- Los correos se agrupan por persona durante `digestMinutes`.
- La campana sondea `GET notifications` con ETag (304 si nada cambió). Si hay una petición en curso no lanza otra, y emite un beep espacial con WebAudio.

## 11. Interfaz (`web/`)

- **Enrutador propio** (`main.tsx`): `match('/proyectos/:id', path)`, navegación con `history.pushState`. Cada pantalla se carga de forma diferida con `lazy(loadChunk(...))`; `loadChunk` (en `lib.ts`) recarga la página una vez si un chunk ya no existe después de un despliegue.
- **Límites de error:** `PageBoundary` por ruta.
- **Datos:**
  - `api()`: `fetch` con credenciales y un tiempo máximo de 45 s en los GET; los errores se convierten en `ApiError` con mensajes legibles.
  - `useApi(path)`: guarda el estado, descarta respuestas viejas con un contador de secuencia y ofrece `reload`/`setData`.
- **Estilos:** un solo `styles.css` con tokens en `:root` y componentes con nombres tipo BEM (`.notify-row__na`). No usa librería de UI.
- **Métricas:** `vitals.ts` mide LCP, INP, CLS, FCP y TTFB y envía solo los valores malos con `sendBeacon` a `/api/vitals`.

### Rutas de la SPA

| Ruta | Pantalla | Quién |
|---|---|---|
| `/login`, `/recuperar`, `/restablecer` | `Login.tsx` | Público |
| `/` | `Home.tsx`: clientes y proyectos; para el cliente, sus proyectos | Todos |
| `/calendario` | `Calendar.tsx`: calendario general de entregas | Todos |
| `/proyectos/:id` | `Project.tsx` y `pages/project/*` | Todos (filtrado) |
| `/cuenta` | `Account.tsx`: contraseña y avisos propios | E C |
| `/cuentas-de-cobro/:id` | `billing/InvoiceView.tsx` | A C |
| `/clientes/:id` | `Client.tsx` y `ClientPeople.tsx` (cuentas del cliente) | A E |
| `/propuestas`, `/propuestas/:id/aprobar` | `Proposals.tsx`, `Approve.tsx`, `ProposalSend.tsx` | A |
| `/reuniones`, `/reuniones/:id` | `Meetings.tsx` (lista, agendar, revisión del resumen), `SalesCall.tsx` | A |
| `/facturacion`, `/facturacion/nueva`, `/cuentas-de-cobro/:id/editar` | `billing/*` | A |
| `/configuracion?tab=…` | `Settings.tsx` (IA, instrucciones en `PromptSettings.tsx`, Google, Finanzas, Avisos y Telegram, Entregas y ajustes, Claude en `ClaudeMcp.tsx`, Equipo en `Team.tsx`) | A |

### Componentes del proyecto (`pages/project/`)

| Archivo | Qué es |
|---|---|
| `Summary.tsx` | Resumen del proyecto |
| `Updates.tsx`, `MdEditor.tsx` | Avances, con un editor Markdown que inserta enlaces a tareas y reuniones. Con `onImage`, el editor acepta capturas pegadas, arrastradas o elegidas con «Imagen» |
| `TaskViews.tsx` | Lista, tablero y calendario |
| `Gantt.tsx`, `Schedule.tsx`, `ganttPdf.ts` | Cronograma y su PDF |
| `TaskDrawer.tsx` | Detalle de tarea; muestra y edita la hora de la reunión |
| `Notes.tsx` | Comentarios y notas, con el editor visual (`MdEditor`) y capturas |
| `Files.tsx` | Archivos |
| `Meetings.tsx` | Reuniones del proyecto |
| `Payments.tsx` | Plan de pagos. Encabezado de columnas también en los pagos sin guardar (`DraftHead`); al cambiar un monto, `patchDrafts`/`withPercents` recalculan el % de cada pago sobre el total de su moneda (aprobación, sugeridos y nuevo pago) |
| `Reports.tsx` | Informes |
| `PlanAdjust.tsx` | Ajuste del plan con IA |
| `ScopeAdjust.tsx` | Retirar del alcance, agregar adicional e historial de cambios |
| `People.tsx` | Equipo del proyecto compartido: editor, perfiles desde una reunión y tarjeta en Alcance. Desde la tarjeta, «Dar acceso» crea la cuenta de una persona del cliente (solo este proyecto, sin pagos, solo sus tareas) y la liga a la persona |
| `ScopeAi.tsx` | Ajustar el alcance con IA: diferencia línea a línea del texto y selección de los cambios del plan |
| `Review.tsx` | Aprobar o pedir ajustes, etiquetas «◆ Entrega» y «↺ Ajuste N», diálogo «Entregas al cliente» |
| `Activity.tsx` | Bitácora |

### Componentes de facturación (`pages/billing/`)

`Billing.tsx`, `InvoiceForm.tsx`, `InvoiceView.tsx`, `InvoiceDocument.tsx` (el documento que se convierte en PDF), `RichText.tsx`, `ReceiptForm.tsx`, `ReceiptDetail.tsx`, `GroupBar.tsx`, `CatchUp.tsx`, `Reports.tsx`, `Import.tsx`, `pdf.ts`.

### Otros componentes

`ViewAs.tsx`: botón y selector de «Ver como» y la franja mientras se ve como otra persona.


`Tour.tsx` es el recorrido guiado por rol dentro de un proyecto real. `Schedule.tsx` (en la raíz) es el selector de horario con disponibilidad.

## 12. Seguridad (resumen)

| Riesgo | Protección |
|---|---|
| Acceso entre clientes | Permisos en el servidor; un proyecto ajeno responde 404 |
| CSRF | `Origin` obligatorio en peticiones que no son GET |
| Fuerza bruta | 8 intentos cada 15 min |
| Secretos guardados | AES-256-GCM; en pantalla solo se muestra un fragmento (`mask`) |
| Archivos subidos | En línea solo imágenes y PDF; las páginas HTML, en sandbox con un token. Las capturas de comentarios se validan por sus primeros bytes y se sirven con `nosniff` y `sandbox` |
| HTML de ítems de facturación | Lista blanca de etiquetas sin atributos |
| Webhook | Firma de Wompi |
| Conector MCP | Solo Bearer (sin cookies, así no aplica CSRF); tokens guardados como hash; OAuth con PKCE S256, códigos de un solo uso y destinos registrados; solo el administrador autoriza; las herramientas no borran ni facturan |
| Registros | Rutas sin ids; ni tokens ni datos personales |
| Ver como | Cookie firmada aparte que solo vale con la sesión del administrador; solo lectura (403 a todo lo que no sea GET); lo sensible del administrador usa `sessionViewer` |
| Clickjacking e indexación | `X-Frame-Options: DENY`, `noindex` |

## 13. Despliegue

- **Dokploy, tipo Application con Dockerfile:**
  - `propuestas/Dockerfile`, con contexto `propuestas`.
  - Watch Paths `propuestas/**`.
  - Volumen en `/data` (imprescindible).
  - Dominios `propuestas.` y `partners.` al puerto 3000, con HTTPS.
- **Healthcheck:** `GET /healthz`.
- **Imagen:** etapa 1 con `npm ci` y `build:web`; etapa 2 con `npm ci --omit=dev`, `src/`, `public/` y el build. Corre como usuario `node`.
- **Respaldos:** copiar `/data` (`propuestas.sqlite` más `-wal`/`-shm`, `files/` y las páginas), o usar `sqlite3 .backup`. Los archivos de los proyectos están en Drive.
- **Desarrollo:**
  - `npm run dev`: servidor con `--watch` y `.env`.
  - `npm run dev:web`: Vite en :5173 con proxy.
  - `npm run build:web`.
  - `npm run typecheck`: servidor y web.
  - Con `DEV_LOGIN=1` se entra sin Google en `/auth/dev`.

---

## 14. Guía para una versión de otro cliente

Hoy el sistema es de **un solo dueño**: un administrador, una cuenta de Google, una marca y una empresa en Colombia. Para otro cliente lo más simple es **desplegar una instancia aparte** (otro contenedor, otro volumen, otros dominios) con estos cambios.

### Se cambia sin tocar código

- **Variables de entorno:**
  - `PUBLIC_URL`, `PARTNERS_URL`, `HOME_URL`, `SUPERADMIN_EMAIL`.
  - `SESSION_SECRET` y `ENCRYPTION_KEY` nuevos.
  - Un cliente OAuth de Google propio, con su pantalla de consentimiento y las APIs Gmail, Drive, Calendar, Meet y Picker.
- **Desde Configuración:**
  - Claves de IA y modelos.
  - Instrucciones propias de cada tarea de IA (tono, duración de las reuniones, reglas del plan).
  - Perfil del emisor de las cuentas de cobro: datos, QR, logo y firma.
  - Gestor financiero o ninguno: sin configurarlo, `financeCall` responde «El Gestor financiero no está conectado» y el abono queda guardado con `sync_status = 'error'`. El resto funciona igual.
  - Wompi o nada.
  - Bot de Telegram propio.
  - Avisos.

### Marca e identidad (en el código)

| Qué | Dónde |
|---|---|
| Nombre «DeerSystems» en textos | Unas 130 apariciones. Las principales: `src/mail.ts` (30), `partners/meetings.ts` (12), `partners/reports.ts`, `partners/notify.ts`, `partners/updates.ts`, `partners/files.ts`, `partners/telegram.ts`, `partners/extract.ts` (prompts), `google.ts` (nombre de la carpeta raíz de Drive), `web/src/Tour.tsx`, `pages/project/ganttPdf.ts`, `pages/Settings.tsx`. **Conviene centralizarlo** en una constante `BRAND_NAME` en `config.ts` (y otra en `web/src/lib.ts`) antes de duplicar el proyecto |
| Colores de los correos | Objeto de colores al inicio de `src/mail.ts` |
| Colores y tipografías del portal | Tokens `:root` en `web/src/styles.css` (dos bloques: claro y oscuro), `@font-face` y `web/index.html` |
| Logos | `public/brand/deersystems-horizontal.png` (lo usan los informes), `public/favicon.svg`, el encabezado de `main.tsx` (logo `/favicon.svg` y la palabra «DeerSystems Partners»), el `<title>` de `web/index.html` y `billing_profile` para las cuentas de cobro |
| Valor `'deersystems'` en `tasks.side` | Es un **dato** (`Side = 'deersystems' \| 'cliente'`) que se compara en el servidor y en la interfaz. Lo más seguro es dejarlo como identificador interno y cambiar solo la etiqueta que se muestra. Si se renombra, hay que migrar las filas |
| Referencia del Gestor `deersystems-pago-{id}` | `payments.ts`/`billing.ts`. Cámbiala si el otro cliente comparte Gestor, para que no choquen las referencias |
| Textos de la página pública de aprobación | `partners/approvals.ts` (HTML generado en el servidor) |

### Supuestos regionales (Colombia)

| Supuesto | Dónde está |
|---|---|
| Zona horaria `America/Bogota` y offset fijo `-05:00` | `availability.ts`, `updates.ts`, `meetings.ts`, `reports.ts` y formatos en `web/src/lib.ts`. Si el cliente está en otra zona con horario de verano, el offset fijo de `availability.ts` hay que cambiarlo por un cálculo con `Intl` |
| Horario laboral L–V de 8:00 a 18:00 para sugerir reuniones | `availability.ts` (`WORK_FROM`, `WORK_TO`) |
| Avance automático a las 17:00 | `updates.ts` (`AUTO_HOUR`) |
| Monedas USD/COP, TRM de la Superfinanciera, «cuenta de cobro», tipos de documento colombianos | `payments.ts`, `finance.ts`, `billing.ts`, `InvoiceForm.tsx` |
| Formato `es-CO` | Servidor e interfaz |
| Wompi (pasarela colombiana) | `online-payments.ts` |

### Módulos que se pueden quitar con poco riesgo

- **`import-smartbilling.ts`**: solo sirvió para migrar. Hay que quitar su ruta, la pantalla `billing/Import.tsx` y las columnas `sb_id` (pueden quedarse vacías).
- **`online-payments.ts`** (Wompi): ya viene apagado por defecto.
- **`telegram.ts`**: sin bot configurado no hace nada.
- **`mcp.ts`**: sin conexiones creadas, `/mcp` solo responde 401. Para quitarlo, borrar su línea en `handlePartners` y la pestaña Claude de Configuración.
- **Gestor financiero**: si el cliente no lo usa, `finance.ts` puede devolver «no configurado» y la interfaz ocultar el estado de sincronización.
- **Reuniones de ventas** (`discovery`/`proposal`) y **envío comercial de propuestas**, si el cliente no vende con propuestas.

### Si se quiere una sola instalación para varios clientes (multi-tenant)

**No es recomendable sin un rediseño:**
- Hay un solo `SUPERADMIN_EMAIL`, una sola conexión de Google y una sola tabla `settings` global.
- Ninguna tabla tiene `tenant_id`.

Haría falta:
- Una tabla `tenants` y la columna en cada tabla.
- Filtrar todas las consultas.
- Guardar la conexión de Google y los ajustes por tenant.
- Resolver el tenant por dominio.

Con SQLite y este volumen, **una instancia por cliente** es más simple y aísla mejor los datos.

### Lista de verificación para la nueva instancia

1. Crear la marca centralizada (`BRAND_NAME`, colores, logos) y reemplazar los textos.
2. Ajustar la zona horaria y el horario laboral si aplica.
3. Revisar los prompts de `extract.ts`, `meetings.ts`, `updates.ts`, `reports.ts` y `payments.ts` (`PAYMENTS_PROMPT`): mencionan la empresa y su forma de trabajar.
4. Cambiar el nombre de la carpeta raíz de Drive (`google.ts` `rootFolder`).
5. Proyecto de Google Cloud y cliente OAuth nuevos. Mientras la app no esté verificada, agregar la cuenta del cliente como usuario de prueba.
6. Nueva aplicación en Dokploy con su volumen y sus dominios.
7. Primer arranque: conectar Google → IA → selector de Drive → perfil de facturación → avisos.
8. Ejecutar `npm run typecheck` y `npm run build:web`, y probar en local con `DEV_LOGIN=1`.
