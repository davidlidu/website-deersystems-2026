# Roles, acceso y seguridad

## Roles

| | Administrador | Equipo | Cliente |
|---|---|---|---|
| Quién es | `SUPERADMIN_EMAIL` (ceo@deersystems.net) | Hasta las personas que invites | Una cuenta por cliente (su correo personal o de empresa) |
| Cómo entra | Google | Correo y contraseña | Correo y contraseña |
| Propuestas | Publica, reemplaza, versiones | — | Solo su enlace, dentro del proyecto |
| Aprobar y crear proyectos | Sí | — | — |
| Proyectos | Todos | Todos | Solo los suyos: en curso e historial |
| Tareas | Crea, edita, borra, cualquier estado | Igual que tú | Cambia el estado de **sus** tareas a Pendiente, En progreso o En revisión. Nunca las completa |
| Notas | Compartidas e internas | Compartidas e internas | Solo las compartidas; deja las suyas |
| Archivos | Todos; enlaza desde su Drive; cambia compartido/interno | Todos; sube compartidos o internos | Solo los compartidos; sube los suyos |
| Reuniones | Agenda, cancela, revisa transcripciones y aprueba resúmenes | Ve las del proyecto | Ve las próximas (con Meet) y los resúmenes aprobados |
| Alcance aprobado | Sí | Sí | Sí |
| **Propuesta y valores** | Sí | **Nunca** | Sí |
| **Pagos** | Edita, marca pagado, sincroniza | **Nunca** | Ve fechas, montos y estado (sin TRM ni datos del Gestor) |
| **Facturación** (cuentas de cobro, abonos, reportes) | Todo | **Nunca** | Ve y descarga sus cuentas de cobro (no anuladas), su saldo y cómo pagar; paga en línea si se lo activas |
| Equipo y Configuración | Sí | — | — |
| Mis avisos y contraseña | — | Sí | Sí |

Los permisos se aplican **en el servidor** (`partners/common.ts`, `requireOwner`, `requireStaff`, `visibleProject`, `visibleTask`), no solo en la interfaz:

- Al equipo, el servidor nunca le manda `pricing` ni la URL de la propuesta.
- Un cliente que pida un proyecto ajeno recibe el mismo 404 que si el proyecto no existiera.

## Cuentas de cliente y del equipo

- **Al aprobar una propuesta** se crea la cuenta del cliente con una contraseña aleatoria, que se le envía por Gmail en el correo de bienvenida. Si Google no está conectado, la contraseña se muestra una sola vez en pantalla para compartirla a mano.
- **Si el cliente ya existe**, el proyecto se suma a su cuenta y recibe el aviso de «nuevo proyecto», sin contraseña nueva.
- **Al equipo lo invitas** desde *Configuración → Equipo*. Recibe su contraseña por correo y puedes desactivarlo o generarle una nueva.
- **Recuperar contraseña:** *¿Olvidaste tu contraseña?* envía un enlace válido por **1 hora**, de un solo uso.
- **Las contraseñas** tienen mínimo 10 caracteres y se guardan con **scrypt** y sal. Al cambiarla, se cierran las otras sesiones de esa persona.

## Sesión

- Cookie `dp_session` `HttpOnly`, `SameSite=Lax` y `Secure` en producción. Dura **14 días**.
- Va firmada con HMAC (`SESSION_SECRET`).
- Las cuentas con contraseña llevan un `session_version`: cambiar la contraseña o desactivar la cuenta invalida todas sus sesiones.
- El administrador entra con Google (OAuth con `state` en cookie de 10 minutos). Solo se acepta `SUPERADMIN_EMAIL`.

## Protecciones

| Riesgo | Protección |
|---|---|
| Fuerza bruta | Máximo 8 intentos fallidos por clave en 15 minutos (login y recuperación) |
| CSRF | Toda petición que no sea GET a `/api` exige `Origin` igual a `PARTNERS_URL`; los POST de `/auth` también |
| Clickjacking | `X-Frame-Options: DENY` |
| Indexación | `X-Robots-Tag: noindex, nofollow` en el portal; `noindex` en las propuestas |
| Caché de datos privados | `Cache-Control: no-store` |
| Referrer | `strict-origin-when-cross-origin`: solo el origen sale a terceros (lo necesita el selector de Drive) |
| Claves guardadas | Claves de IA, token de Google, clave del selector de Drive y clave del Gestor financiero, cifradas con **AES-256-GCM** (`ENCRYPTION_KEY`, o `SESSION_SECRET` si no hay). En pantalla solo se muestra un fragmento |
| HTML de correos en la vista previa | `<iframe sandbox="">` sin permisos |
| Archivos subidos | Solo se muestran en el navegador imágenes y PDF; lo demás se descarga, porque un `.html` o `.svg` podría ejecutar código |
| Acceso a Drive | `drive.file`: el portal solo toca los archivos que crea o que eliges en el selector |
| Login de desarrollo | `DEV_LOGIN=1` solo funciona fuera de producción y con URLs `localhost` |
| HTML de los ítems de la cuenta de cobro | Lista blanca de etiquetas (negrita, listas…) sin atributos, al guardar y al importar |
| Webhook de Wompi | Sin sesión, pero se rechaza si la firma SHA-256 (secreto de eventos) no coincide; idempotente por transacción |

## Privacidad con la IA

- Los textos se envían al proveedor que elijas: las propuestas y su plan, las transcripciones de reuniones y los valores para armar los pagos.
- En OpenRouter puedes exigir **solo proveedores que no guardan ni entrenan con los datos** (`data_collection: deny`).
- El perfil *Propuestas* puede ser más permisivo, porque esos datos son tuyos. El de *Reuniones* conviene dejarlo privado, porque lleva lo que dice el cliente. Ver [IA](./ia.md).
