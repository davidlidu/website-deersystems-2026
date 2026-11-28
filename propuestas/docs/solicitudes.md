# Solicitudes de cotización del correo

Partners revisa tu bandeja de Gmail y la IA marca los correos en los que alguien pide una cotización. Te avisa, generas la propuesta y respondes desde Partners **en el mismo hilo del correo**, con el enlace de la propuesta. No hace falta escribir un correo aparte.

## Cómo funciona

1. **Revisión.** Cada 10 minutos, empezando un minuto después de arrancar el servidor, se leen los correos de la bandeja principal de los últimos 3 días. Quedan fuera los que mandas tú, las promociones, las redes sociales, las notificaciones y los foros:
   `in:inbox newer_than:3d -from:me -category:promotions -category:social -category:updates -category:forums`.
   Se procesan hasta 12 correos nuevos por ronda. Los remitentes automáticos (no-reply, mailer-daemon y parecidos) se descartan sin pasar por la IA.
2. **Clasificación.** La IA, con el perfil `propuestas` (solo proveedores privados), decide si el correo es una solicitud de cotización. Si lo es, extrae la empresa, el contacto, el servicio, un resumen y la lista de requerimientos. Si la IA falla, la ronda se detiene y ese correo se reintenta en la siguiente.
3. **Aviso.** Por cada solicitud llega el aviso `quote_request` a la app y por push, con un enlace a *Propuestas → Solicitudes del correo*. Este aviso nunca se manda por correo.
4. **Respuesta.** En la solicitud usas **Responder con propuesta**, eliges una o varias propuestas publicadas y revisas el correo. Sale desde tu Gmail como respuesta en el mismo hilo: el asunto lleva «Re:», va con el `threadId` y lleva las cabeceras `In-Reply-To` y `References`. La solicitud queda como *Respondida*, con las propuestas enviadas.

Los correos que la IA marca como «no es cotización» se borran a los 30 días. Solo se guardan para no volver a revisarlos.

## Estados

| Estado | Significado |
|---|---|
| Nueva | Llegó y nadie la ha atendido |
| En proceso | Estás preparando la propuesta |
| Respondida | Ya enviaste la propuesta en el hilo |
| Descartada | No la vas a cotizar. Con «Reabrir» vuelve a Nueva |

**No es cotización** sirve para corregir a la IA: el correo sale de la lista.

## Activarlo

1. En *Configuración → Google y correo*, vuelve a conectar Google y acepta el permiso nuevo para leer Gmail (`gmail.readonly`).
2. En Google Cloud Console, en la pantalla de consentimiento, agrega el alcance `gmail.readonly`. Con la app en tipo *Interno* no hace falta verificación.
3. En *Propuestas → Solicitudes del correo* debe estar marcado **Revisar automáticamente**, que viene activo por defecto. **Revisar ahora** fuerza una ronda en el momento.

## API (solo el dueño)

| Ruta | Para qué |
|---|---|
| `GET /api/quote-requests` | Lista y estado de la bandeja (conectada, permiso, última revisión, último error) |
| `GET /api/quote-requests/:id` | Una solicitud con el texto completo del correo |
| `PATCH /api/quote-requests/:id` | `{status}` o `{notQuote: true}` |
| `POST /api/quote-requests/scan` | Revisar ahora |
| `PUT /api/inbox/settings` | `{enabled}` |
| `POST /api/proposals/send` con `requestId` | Responde la solicitud en su hilo y la marca como respondida |

Datos: tabla `quote_requests` (en `src/partners/inbox.ts`).
