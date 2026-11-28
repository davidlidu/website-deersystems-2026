# Pregúntale a la IA sobre un cliente

En la **ficha del cliente** (solo el administrador) está **✨ Pregúntale a la IA sobre este cliente**: escribes una pregunta (o usas una sugerida: estado del cliente, última reunión, pendientes del cliente, pagos pendientes) y la IA responde con lo guardado en su espacio, citando de dónde sale cada dato ([Reunión «…» · fecha], [Formulario «…»], [Tarea], [Pagos]). Si algo no está registrado, lo dice.

## Qué lee
Armado en `src/partners/ask.ts` (`clientContext`), de lo más reciente a lo más antiguo y recortado a ~90.000 caracteres:
- Datos del cliente.
- Cada proyecto: estado, fechas, avance, opción aprobada, notas de la aprobación, extracto del alcance, tareas pendientes (estado, a quién le toca, fecha) y últimas completadas.
- Reuniones: las próximas (y si están por confirmar) y las 12 últimas con su resumen y acuerdos; de las 2 más recientes, un extracto de la transcripción (inicio y final).
- Formularios y onboardings con sus respuestas.
- Avances publicados y la bitácora reciente.
- Pagos: plan de pagos (total, pagado, pendiente y pagos pendientes) y cuentas de cobro.

## Cómo responde
- Perfil de IA **Reuniones** (solo proveedores privados), propósito `cliente`. Sus instrucciones propias se ajustan en Configuración → IA → «Pregúntale a la IA sobre un cliente».
- Recuerda las últimas 4 preguntas de la conversación (para seguir preguntando «¿y de eso qué falta?»). La conversación no se guarda: se pierde al recargar.
- Muestra el modelo, el tiempo y el costo de cada respuesta.

API: `POST /api/clients/:id/ask { question, history }` (solo administrador).
