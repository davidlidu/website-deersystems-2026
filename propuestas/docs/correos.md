# Correos con la marca

**Correos** (menú del administrador) envía un mensaje con el diseño de DeerSystems a varios destinatarios: renovaciones de dominio y hosting, avisos, recordatorios.

- **Cada destinatario recibe su propio correo:** nadie ve a los demás. Sale desde la cuenta de Google conectada en Configuración.
- **Datos de cada destinatario:** `{nombre}` (el primer nombre), `{empresa}`, `{correo}` y los que agregues en *Datos de cada destinatario* (p. ej. `{dominio}`, `{vence}`, `{valor}`). Cada dato es una columna en la tabla de destinatarios.
- **Destinatarios:**
  - *Elegir clientes:* los correos de tus clientes (cuenta del portal, contacto y otros correos), con búsqueda y «Marcar todos».
  - *Pegar lista:* una línea por persona, desde Excel o Google Sheets, en el orden correo, nombre, empresa y tus datos.
  - *Agregar a mano.* Hasta 500 por envío.
- **Mensaje:** asunto, antetítulo, título, mensaje en Markdown simple (negritas, enlaces, viñetas, títulos), botón opcional y nota al pie.
- **Plantillas:** viene *Renovación de dominio y hosting* (datos `dominio`, `vence`, `valor`). Puedes guardar cambios en ella o guardar el mensaje como plantilla nueva (sin los destinatarios).
- **Vista previa** con los datos de cada destinatario (*Como lo ve*). Avisa si a alguien le falta un dato que usa el mensaje.
- **Enviarme una prueba:** llega a tu correo con «[Prueba]» y los datos del destinatario que estás viendo.
- **Envío:** se envía en segundo plano, uno por uno, y se ve el avance. En *Enviados* queda el historial con el resultado de cada correo (y el error, si alguno falló).

Tablas: `mail_templates` y `mail_campaigns`. API: `GET/POST /api/mail-campaigns`, `GET /api/mail-campaigns/:id`, `POST /api/mail-campaigns/preview` y `/test`, `POST/PUT/DELETE /api/mail-templates`.
