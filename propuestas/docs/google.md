# Google Workspace

La plataforma usa **una sola cuenta**: `ceo@deersystems.net`, con Business Standard. La conectas una vez en *Configuración → Google y correo → Conectar Google*. Es un OAuth *offline*: se guarda el *refresh token* cifrado y se renueva solo.

## Permisos que pide

| Permiso | Para qué |
|---|---|
| `gmail.send` | Correos de bienvenida, contraseñas, avisos, resúmenes de reuniones |
| `drive.file` | Crear la carpeta del cliente y del proyecto, subir, compartir por enlace y exportar a PDF. Solo toca lo que el portal crea o lo que eliges en el selector |
| `calendar.events` | Crear y cancelar reuniones con Meet; leer los eventos para la sincronización |
| `meetings.space.readonly` | Leer las transcripciones de Meet |

Si una función nueva necesita un permiso que la conexión actual no tiene, la pantalla muestra **Faltan permisos** y pide reconectar. Por ejemplo, agendar con `calendar.events`, que reemplazó a `calendar.readonly`.

## Configurar en Google Cloud Console

1. **APIs y servicios → Biblioteca:** habilita Gmail API, Google Drive API, Google Calendar API, Google Meet API y Google Picker API.
2. **Pantalla de consentimiento:** tipo *Interno*. Solo cuentas de deersystems.net.
3. **Credenciales → ID de cliente OAuth (Aplicación web)**, con las URIs de redirección:
   - `https://propuestas.deersystems.net/auth/google/callback`
   - `https://partners.deersystems.net/auth/google/callback`
4. **Credenciales → Clave de API** para el selector de Drive:
   - Del **mismo proyecto** que el ID de cliente. La pantalla muestra el número de proyecto, que sale del prefijo de `GOOGLE_CLIENT_ID`.
   - Restringida a *Google Picker API*.
   - La restricción por sitio web (`https://partners.deersystems.net/*`) es opcional, porque Brave elimina el *referrer*.

## Correo

- **Plantillas** en `src/mail.ts`, con el sistema de diseño de la marca: fondo oscuro, verde y cian, Montserrat e Inter, y tarjetas de datos.
- **Versión en texto plano** de cada correo, para clientes de correo sin HTML.
- **Desde Configuración** se puede enviar un correo de prueba a tu bandeja y abrir la vista previa del diseño.
- **Plantillas disponibles:**
  - Bienvenida del cliente y nuevo proyecto.
  - Bienvenida del equipo.
  - Nueva contraseña y recuperación.
  - Resumen de avisos y resumen de reunión.
