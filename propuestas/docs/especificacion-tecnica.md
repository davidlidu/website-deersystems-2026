# Especificación técnica completa

Estado al **21 de noviembre de 2026** (commit `897075d`). Reúne en un solo lugar todo lo que está implementado: arquitectura, datos, API, procesos, integraciones e interfaz. Al final hay una guía de **qué tocar para hacer una versión para otro cliente**.

Los demás archivos de `docs/` explican cada área para quien la usa. Este explica cómo está construida.

---

## 1. Resumen

Un solo servidor Node (sin framework) atiende dos subdominios desde un contenedor y los distingue por el encabezado `Host`:

| Subdominio | Qué es | Código |
|---|---|---|
| `propuestas.` | Publicación de propuestas comerciales en HTML (con versiones y conteo de visitas) y su panel `/admin` | `src/server.ts`, `src/proposals.ts`, `src/storage.ts`, `public/` |
| `partners.` | Portal de clientes: proyectos, tareas, reuniones, archivos, pagos, facturación, avisos, IA | `src/partners/*`, interfaz en `web/` |

Ambos comparten la base de datos SQLite y los módulos de IA, Google, correo y cifrado.

**Tamaño:** unos 14.000 líneas de servidor (TypeScript) y 18.500 de interfaz (React). Hay 190 rutas de API y 28 tablas.

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
      auth.ts             scrypt, cookie firmada, límite de intentos, Viewer
      common.ts           Permisos (requireOwner, requireStaff, visibleProject, seesMoney, clientSees, taskView)
      db.ts               Esquema y consultas del núcleo: clientes, cuentas, proyectos, fases, tareas, notas, bitácora, avisos, ajustes
      indexes.ts          19 índices creados al arrancar + PRAGMA optimize
      approvals.ts        Aprobación pública desde /{slug}/aprobar, opciones, plan con IA en segundo plano
      extract.ts          Propuesta HTML → texto → plan con IA; ajuste del plan antes de crear el proyecto
      planAdjust.ts       Ajuste con IA del plan de un proyecto en marcha (vista previa → aplicar)
      scope.ts            Retirar del alcance una opción o fase aprobada
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

## 5. Servidor HTTP

### Ruteo (`src/server.ts`)

1. Si `Host === PARTNERS_HOST` → `handlePartners` (`partners/routes.ts`):
   - `/auth/*` → login con contraseña, Google, recuperación, desarrollo.
   - `POST /api/webhooks/wompi` → webhook sin sesión ni `Origin`.
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

### `Viewer` (quién mira)

```ts
{ kind: 'owner', email }
{ kind: 'team', account, name, email }
{ kind: 'client', account, clientId, billing: boolean, projects: Set<number> | null, … }
```

Varias personas del mismo cliente pueden tener cuenta (`accounts.client_id`). Cada una tiene estos permisos:

- `all_projects`: si es 0, solo ve los proyectos que tenga en `account_projects`.
- `billing`: ve valores, pagos y cuentas de cobro.
- `is_primary`: es la cuenta principal (recibe los correos principales).

### Reglas (`partners/common.ts`)

| Función | Regla |
|---|---|
| `requireOwner` | Solo el administrador (403 si no) |
| `requireStaff` | Administrador o equipo |
| `visibleProject(id, v)` | Un cliente solo ve sus proyectos (`clientSees`). Si el proyecto es ajeno, recibe 404, igual que si no existiera |
| `seesMoney(v)` | Administrador, o persona del cliente con `billing` |
| `taskView(t, v)` | Lo que cada rol ve de una tarea |
| Estados que el cliente puede poner | `pendiente`, `en_progreso`, `en_revision`. Nunca `completada` |

Lo que nunca recibe el equipo, filtrado en el servidor: `pricing`, la URL de la propuesta, pagos, facturación y valores.

Lo que nunca recibe el cliente:
- Notas y archivos internos.
- Borradores de resúmenes e informes.
- Lo generado con IA mientras no esté aprobado o publicado.
- La TRM y los datos del Gestor.

## 7. Modelo de datos (28 tablas)

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
| `accounts` | Cuentas con contraseña (equipo o cliente) | `email` (único), `name`, `role` (`team`/`client`), `client_id`, `password_hash`, `active`, `session_version`, `all_projects`, `billing`, `is_primary`, `notify_prefs` (JSON), `tour_done`, `last_login_at` |
| `account_projects` | Proyectos de una cuenta de cliente con `all_projects = 0` | `account_id`, `project_id` |
| `password_resets` | Recuperación de contraseña | `token_hash`, `account_id`, `expires_at`, `used` |

### Proyectos y trabajo

| Tabla | Para qué | Columnas clave |
|---|---|---|
| `projects` | Proyecto | `client_id`, `proposal_id`, `name`, `scope` (alcance sin valores, Markdown), `pricing` (valores; nunca al equipo), `status` (`activo`/`pausado`/`finalizado`), `start_date`, `end_date`, `approved_option`, `approval_notes`, `auto_updates`, `drive_folder_id` |
| `phases` | Fases del plan | `project_id`, `name`, `position` |
| `tasks` | Tareas y reuniones del cronograma | `phase_id`, `title`, `description`, `status` (`pendiente`/`en_progreso`/`en_revision`/`bloqueada`/`completada`), `side` (`deersystems`/`cliente`), `assignee_id`, `start_date`, `due_date`, `position`, `source` (`propuesta`/`manual`/`reunion`), `kind` (`tarea`/`reunion`: la reunión se pinta con franja naranja), `completed_at` |
| `notes` | Comentarios y avances | `task_id` (null = del proyecto), `kind` (`nota`/`avance`), `visibility` (`shared`/`internal`), autor, `body` (Markdown), `ai` (lo generó la IA), `emailed_at` |
| `activity` | Bitácora | `type`, `data` (JSON), `actor_*`, `internal` |
| `attachments` | Archivos en Drive | `task_id`, `drive_file_id`, `drive_url`, `name`, `mime`, `size`, `visibility`, `link_shared`, `linked` (elegido del Drive propio, no subido), `page_token` (página HTML publicada en `/paginas/{token}`) |
| `scope_changes` | Retiros del alcance | `option_id`/`option_name`, `amount`, `currency`, `reason`, `label_before`/`label_after`, `phases` (JSON), `tasks_removed`, `payments` (JSON) |
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
- **Contenido:** `transcript`, `transcript_source` (`meet`/`drive`/`manual`), `transcript_url`, `summary`, `agreements` (JSON), `proposed_tasks` (JSON), `task_ids` (tareas creadas al aprobar), `ai`, `error`, `approved_at`/`approved_by`, `sent_to`.
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

### Índices

Hay 19 índices en `partners/indexes.ts` (más los que crea cada módulo). Cubren:
- Las consultas frecuentes: fases por proyecto, tareas por fase o responsable, reuniones por tarea, cliente o fase, cuentas por cliente.
- Todas las claves foráneas con borrado `CASCADE` o `SET NULL`.

Se crean al arrancar con `IF NOT EXISTS` y después se ejecuta `PRAGMA optimize=0x10002`.

## 8. API (190 rutas)

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
| `GET/POST projects/:id/notes`, `PATCH/DELETE notes/:id` | Comentarios y avances |
| `GET projects/:id/activity` | Bitácora |
| `POST projects/:id/plan/adjust` → `POST projects/:id/plan/apply` | Ajuste con IA: vista previa y luego aplicar. Mueve también los eventos de Calendar |
| `GET projects/:id/scope`, `POST projects/:id/scope/remove` | Retirar una opción o fase del alcance |

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
| `PATCH/DELETE payments/:id`, `POST payments/:id/paid`, `POST payments/:id/sync` | Marcar pagado crea el abono y lo lleva al Gestor |
| `POST projects/:id/payments/together` | Pago conjunto: una transferencia repartida entre varias cuotas |
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
| `GET/PUT settings/ai`, `GET settings/ai/models`, `POST settings/ai/test`, `GET settings/ai/usage` | IA |
| `GET/PUT settings/ai/instructions`, `POST settings/ai/instructions/suggest` | Instrucciones propias, redactadas a mano o con la IA |
| `GET settings/google`, `POST settings/google/disconnect`, `POST settings/google/test-mail`, `GET settings/mail-preview` | Google y plantillas |

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
- **Retirar del alcance:** se borran las tareas pendientes y los pagos sin pagar de esa opción o fase, y se recalcula la etiqueta de lo aprobado. Lo terminado se queda y el retiro queda registrado en `scope_changes`. La opción vuelve a estar disponible para aprobarse después.
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
- **Ventas (`discovery`/`proposal`):** la reunión tiene un prospecto sin cliente. Tras la llamada, la IA redacta el correo con el enlace de la propuesta (tarea `correo`).
- **Reunión con cliente (`cliente`):** cliente sin proyecto. Al aprobarla no se crean tareas ni bitácora. El correo lleva el enlace al portal solo si el cliente tiene cuenta.

### Dinero

1. Al marcar una cuota del plan como pagada se crea su abono (`receipts.payment_id`). Ese abono hace `PUT` al Gestor con la referencia `deersystems-pago-{id}`.
   - **Moneda:** si la cuota es en USD, el abono se registra en COP con la TRM oficial del día (o el valor recibido en pesos que indiques).
   - **Pago conjunto:** una transferencia se reparte entre varias cuotas.
2. **Cuentas de cobro:**
   - La numeración continúa la de SmartBilling.
   - El PDF se genera en el navegador y se envía por Gmail con adjuntos; el envío se puede programar.
   - Un abono puede repartirse entre varias cuentas de cobro (`receipt_invoices`).
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
| `/configuracion?tab=…` | `Settings.tsx` (IA, instrucciones en `PromptSettings.tsx`, Google, Finanzas, Avisos y Telegram, Equipo en `Team.tsx`) | A |

### Componentes del proyecto (`pages/project/`)

| Archivo | Qué es |
|---|---|
| `Summary.tsx` | Resumen del proyecto |
| `Updates.tsx`, `MdEditor.tsx` | Avances, con un editor Markdown que inserta enlaces a tareas y reuniones |
| `TaskViews.tsx` | Lista, tablero y calendario |
| `Gantt.tsx`, `Schedule.tsx`, `ganttPdf.ts` | Cronograma y su PDF |
| `TaskDrawer.tsx` | Detalle de tarea; muestra y edita la hora de la reunión |
| `Notes.tsx` | Comentarios |
| `Files.tsx` | Archivos |
| `Meetings.tsx` | Reuniones del proyecto |
| `Payments.tsx` | Plan de pagos |
| `Reports.tsx` | Informes |
| `PlanAdjust.tsx` | Ajuste del plan con IA |
| `ScopeAdjust.tsx` | Retirar del alcance |
| `Activity.tsx` | Bitácora |

### Componentes de facturación (`pages/billing/`)

`Billing.tsx`, `InvoiceForm.tsx`, `InvoiceView.tsx`, `InvoiceDocument.tsx` (el documento que se convierte en PDF), `RichText.tsx`, `ReceiptForm.tsx`, `ReceiptDetail.tsx`, `GroupBar.tsx`, `CatchUp.tsx`, `Reports.tsx`, `Import.tsx`, `pdf.ts`.

### Otros componentes

`Tour.tsx` es el recorrido guiado por rol dentro de un proyecto real. `Schedule.tsx` (en la raíz) es el selector de horario con disponibilidad.

## 12. Seguridad (resumen)

| Riesgo | Protección |
|---|---|
| Acceso entre clientes | Permisos en el servidor; un proyecto ajeno responde 404 |
| CSRF | `Origin` obligatorio en peticiones que no son GET |
| Fuerza bruta | 8 intentos cada 15 min |
| Secretos guardados | AES-256-GCM; en pantalla solo se muestra un fragmento (`mask`) |
| Archivos subidos | En línea solo imágenes y PDF; las páginas HTML, en sandbox con un token |
| HTML de ítems de facturación | Lista blanca de etiquetas sin atributos |
| Webhook | Firma de Wompi |
| Registros | Rutas sin ids; ni tokens ni datos personales |
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
