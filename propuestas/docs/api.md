# API del portal

Todas las rutas del portal viven en `partners.deersystems.net`:
- Las de sesión están en `/auth/*`.
- El resto, en `/api/*`, con JSON y la cookie `dp_session`.
- Las peticiones que no son GET exigen `Origin: https://partners.deersystems.net`.
- `:id` es numérico.

**Permiso:** **A** = administrador · **E** = equipo · **C** = cliente (solo lo suyo) · **·** = sin sesión.

## Sesión

| Ruta | Permiso | Qué hace |
|---|---|---|
| `POST /auth/login` | · | Correo y contraseña (equipo y cliente). Límite de intentos |
| `POST /auth/logout` | todos | Cierra la sesión |
| `POST /auth/forgot` | · | Envía el enlace de recuperación (1 h) |
| `POST /auth/reset` | · | Nueva contraseña con el token |
| `GET /auth/google` · `GET /auth/google/callback` | · | Login del administrador con Google |
| `GET /auth/google/connect` | A | Conectar Google (Gmail, Drive, Calendar, Meet) |
| `GET /auth/dev` | · | Solo en desarrollo |

## Mi cuenta

| Ruta | Permiso | Qué hace |
|---|---|---|
| `GET /api/me` | todos | Rol, nombre, cliente, `tourDone` |
| `POST /api/me/password` | E C | Cambia la contraseña y cierra las otras sesiones |
| `POST /api/me/tour` | todos | `{done:true}`: no volver a mostrar el tour |
| `GET /api/me/notifications` · `PUT` | E C | Mis avisos (solo se puede apagar) |
| `GET /api/notifications` · `POST /api/notifications/read` | todos | Campana |

## Proyectos, clientes y equipo

| Ruta | Permiso | Qué hace |
|---|---|---|
| `GET /api/projects` | todos | Proyectos visibles con su avance |
| `GET /api/projects/:id` | todos | Detalle, fases y tareas. Sin `pricing` para el equipo |
| `PATCH /api/projects/:id` | A E | Estado, fechas, alcance (y valores, solo A) |
| `DELETE /api/projects/:id` | A | Borra el proyecto |
| `POST /api/projects` | A | **Aprobar:** crea cliente, cuenta, proyecto, fases, tareas, reuniones y pagos |
| `GET /api/clients` · `GET /api/clients/:id` | A E | Clientes |
| `POST /api/clients` | A | Cliente solo de facturación (sin acceso) |
| `PATCH /api/clients/:id` | A E | Nombre, contacto, teléfono; datos de facturación y correo (solo A); `active` (solo A) |
| `POST /api/clients/:id/access` | A | Da acceso al portal a un cliente que no lo tiene `{email}` |
| `GET /api/clients/:id/statement` | A C | Estado de cuenta: totales, cuentas de cobro, abonos (C: sin datos del Gestor, con *cómo pagar*) |
| `POST /api/clients/:id/password` | A | Nueva contraseña para el cliente |
| `GET /api/team` · `POST` · `PATCH /:id` · `DELETE /:id` | A (GET también E) | Equipo |
| `POST /api/team/:id/password` | A | Nueva contraseña |

## Propuestas y aprobación

| Ruta | Permiso | Qué hace |
|---|---|---|
| `GET /api/proposals` · `POST` | A | Lista y publica |
| `PUT /api/proposals/:id/file` | A | Reemplaza (versión nueva) |
| `PATCH /api/proposals/:id` · `DELETE` | A | Título, pausar, borrar (si no tiene proyectos) |
| `GET /api/proposals/:id/versions` | A | Versiones |
| `POST /api/proposals/:id/versions/:id/restore` | A | Restaura como versión nueva |
| `POST /api/proposals/:id/options` | A | IA: ¿trae opciones A/B? |
| `POST /api/proposals/:id/draft` | A | IA: borrador del plan `{option, notes}` |
| `POST /api/proposals/:id/plan` | A | IA: ajusta el plan `{instruction, plan, scope, projectName}` → `{plan, changes, warnings}` |
| `POST /api/proposals/:id/welcome-preview` | A | Vista previa del correo de bienvenida `{client, projectName}` |
| `GET /historial/:id/:v/` | A | Ver una versión anterior |

## Trabajo

| Ruta | Permiso | Qué hace |
|---|---|---|
| `POST /api/projects/:id/tasks` | A E | Crea tarea (`isMeeting` para la franja naranja) |
| `PATCH /api/tasks/:id` | todos | Equipo: todo. Cliente: solo `status` de sus tareas, sin completar |
| `DELETE /api/tasks/:id` | A E | Borra |
| `POST /api/projects/:id/phases` · `PATCH /api/phases/:id` · `DELETE` | A E | Fases |
| `GET /api/projects/:id/notes` · `POST` | todos | Notas, comentarios (`taskId`) y avances (`kind: avance`, solo A E) |
| `PATCH /api/notes/:id` · `DELETE` | autor | Editar y borrar |
| `GET /api/projects/:id/activity` | todos | Bitácora (sin entradas internas para el cliente) |

## Archivos

| Ruta | Permiso | Qué hace |
|---|---|---|
| `GET /api/projects/:id/attachments` | todos | `?taskId=` para los de una tarea |
| `POST /api/projects/:id/attachments` | todos | Subida (cuerpo binario; `name`, `taskId`, `visibility` en la URL) |
| `POST /api/projects/:id/attachments/drive` | A | Enlaza archivos elegidos en el selector `{fileIds, taskId, visibility}` |
| `PATCH /api/attachments/:id` | A E | `{visibility}` compartido o interno |
| `GET /api/attachments/:id/download` | todos | Descarga (los nativos de Google en PDF); `?inline=1` para ver |
| `DELETE /api/attachments/:id` | autor o A | Papelera de Drive (o solo desvincula si estaba enlazado) |
| `GET /api/settings/google/picker` · `PUT` | A | Clave y token del selector |

## Reuniones

| Ruta | Permiso | Qué hace |
|---|---|---|
| `GET /api/meetings` | A | Bandeja, estado de sincronización y ajustes |
| `POST /api/meetings/sync` | A | Sincronizar ahora |
| `PUT /api/meetings/settings` | A | `{importExternal}` |
| `GET /api/projects/:id/contacts` | A | Cliente, equipo e invitados sugeridos |
| `POST /api/projects/:id/meetings/schedule` | A | Agenda en Calendar con Meet |
| `POST /api/meetings/:id/cancel` | A | Cancela (Google avisa) |
| `GET /api/projects/:id/meetings` | todos | Próximas y resúmenes (el cliente solo ve los aprobados) |
| `POST /api/projects/:id/meetings` | A | Reunión sin Meet, con transcripción |
| `GET /api/meetings/:id` · `PATCH` | A | Detalle (`?transcript=1`) y edición del borrador |
| `POST /api/meetings/:id/transcript` · `/generate` | A | Pegar transcripción y generar con IA |
| `POST /api/meetings/:id/preview` | A | Vista previa del correo |
| `POST /api/meetings/:id/discard` · `/approve` | A | Descartar o aprobar y enviar |

## Pagos

| Ruta | Permiso | Qué hace |
|---|---|---|
| `GET /api/projects/:id/payments` | A C | Pagos (`finance` solo para A) |
| `POST /api/projects/:id/payments` | A | Uno o varios `{payments: [...]}` |
| `POST /api/projects/:id/payments/suggest` | A | IA: pagos a partir de los valores (no guarda) |
| `PATCH /api/payments/:id` | A | Edita; si está pagado, actualiza el Gestor |
| `POST /api/payments/:id/paid` | A | `{paid, paidAt, trm, amountCop}` → sincroniza |
| `POST /api/payments/:id/sync` | A | Reintenta la sincronización |
| `DELETE /api/payments/:id` | A | Borra (antes quita el ingreso del Gestor) |
| `GET /api/trm?date=YYYY-MM-DD` | A | TRM oficial vigente |

## Facturación

| Ruta | Permiso | Qué hace |
|---|---|---|
| `GET /api/invoices` | A C | Cuentas de cobro (`?clientId`, `?projectId`); C: solo las suyas, sin anuladas |
| `GET /api/invoices/next-number` | A | Siguiente consecutivo |
| `POST /api/invoices` | A | Crea `{clientId, projectId, paymentId, number, date, dueDate, currency, exchangeRate, notes, items}` |
| `GET /api/invoices/:id` | A C | Detalle con ítems, cliente, abonos, perfil del emisor y `payUrl` |
| `PUT /api/invoices/:id` | A | Edita |
| `PATCH /api/invoices/:id` | A | `{status: 'anulada' \| 'emitida'}` |
| `DELETE /api/invoices/:id` | A | Solo sin abonos aplicados |
| `POST /api/invoices/:id/send` | A | Correo con el PDF adjunto `{to, pdf}` (el PDF lo genera el navegador) |
| `POST /api/invoices/:id/online` | A | Pago en línea `{enabled}`: crea o cierra el link de Wompi |
| `GET /api/receipts` · `POST` | A | Abonos (`?clientId`, `?projectId`) · registrar (va al Gestor) |
| `PATCH /api/receipts/:id` · `DELETE` | A | Editar / borrar (no los de cuotas del plan) |
| `POST /api/receipts/:id/sync` | A | Reintentar en el Gestor |
| `GET /api/billing/report` | A | Datos de los reportes |
| `GET /api/billing/profile` · `PUT` | A | Datos del emisor (con logo, firma y QR) |
| `POST /api/import/smartbilling/preview` | A | Lee de la API de SmartBilling `{url, token}` → vista previa |
| `POST /api/import/smartbilling/upload` | A | Lo mismo desde un JSON (cuerpo) |
| `POST /api/import/smartbilling/apply` | A | Importa `{id, matches, profile}` → creado y cuadre |
| `POST /api/webhooks/wompi` | firma | Eventos de Wompi (sin sesión; firma SHA-256 con el secreto de eventos) |

## Configuración

| Ruta | Permiso | Qué hace |
|---|---|---|
| `GET /api/settings/ai` · `PUT` | A | Perfiles, claves, tarifas, presupuesto |
| `GET /api/settings/ai/models` | A | Modelos de OpenRouter con precio |
| `POST /api/settings/ai/test` | A | Prueba de conexión |
| `GET /api/settings/ai/usage` | A | Consumo de 30 días y saldo de OpenRouter |
| `GET /api/settings/notifications` · `PUT` | A | Avisos para todos |
| `GET /api/settings/google` · `POST /disconnect` · `POST /test-mail` | A | Conexión de Google |
| `GET /api/settings/mail-preview` | A | HTML de muestra del diseño de correo |
| `GET /api/settings/finanzas` · `PUT` · `POST /test` | A | Gestor financiero |
| `GET /api/settings/online-payments` · `PUT` | A | Pago en línea (Wompi): encendido, ambiente, llaves |
