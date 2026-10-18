# Aprobación y plan de trabajo

Cuando el cliente aprueba, en **Propuestas** pulsas **Propuesta aprobada**. La pantalla *Arma el plan de trabajo* no guarda nada hasta que confirmas.

## 1. ¿Qué opción aprobó?

La IA revisa primero si la propuesta ofrece **alternativas excluyentes**: Opción A/B, planes Básico/Pro, paquetes.

- Si las hay, eliges cuál aprobó el cliente y anotas los **ajustes acordados** ("sin app móvil", "pago en 3 cuotas").
- Si es una oferta única, pasa directo a generar el plan.

La opción y los ajustes quedan en el proyecto (`approved_option`, `approval_notes`). La IA los usa para generar solo lo que corresponde.

## 2. El borrador que propone la IA

Lo genera el perfil de IA *Propuestas* y se edita todo:

| Sección | Qué trae |
|---|---|
| **Cliente** | Empresa, contacto, correo y teléfono. Si el correo ya es de un cliente, se sugiere ese cliente |
| **Proyecto** | Nombre, alcance en Markdown (**sin valores**: lo ve el equipo), valores y forma de pago (solo tú y el cliente), fechas |
| **Fases y tareas** | 3 a 7 fases, 2 a 8 tareas por fase. Cada tarea trae verbo, descripción, lado (DeerSystems o cliente), inicio y entrega en días hábiles. Incluye las tareas del cliente: accesos, insumos, aprobaciones |
| **Reuniones de avance** | 3 a 6 con el cliente: arranque en los primeros 3 días hábiles, una al cierre de cada fase principal y la entrega final. Cada una tiene fase, fecha, hora, duración y propósito |
| **Pagos** | El plan de pagos que trae la propuesta: anticipo, cuotas o contra entrega. Cada pago tiene %, monto, USD/COP y fecha |

Las fases se pueden reordenar, renombrar, agregar y quitar. A las tareas se les asigna responsable del equipo.

Si el alcance o una tarea parece mencionar valores, aparece una advertencia, porque tu equipo los vería.

## 3. Ajustar el plan con IA

Antes de crear el proyecto, el cuadro **Ajustar el plan con IA** recibe instrucciones en lenguaje natural:

> «Arranca el 3 de noviembre, junta Diseño y Maqueta en una sola fase y pon las reuniones a las 3 p. m.»

- Se envía el plan **tal como está en pantalla**, con tus ediciones, junto con el alcance como contexto.
- La IA devuelve el plan completo ajustado y **la lista de cambios** que hizo. Cambia solo lo pedido y sus consecuencias, por ejemplo correr las fechas siguientes.
- Se conservan el **responsable** de cada tarea y si cada reunión se **agenda**, siempre que la tarea o reunión mantenga su título.
- **Deshacer el último ajuste** vuelve al plan anterior. Se puede ajustar varias veces.
- Hay ejemplos de un clic; con Cmd/Ctrl+Enter también se envía.

Ruta: `POST /api/proposals/:id/plan`.

## 4. El correo de bienvenida

Junto a la casilla *Enviar al cliente el correo de bienvenida*, el vínculo **ver el correo** abre una ventana con el asunto, el destinatario y el correo tal como lo recibirá:

- **Cliente nuevo:** bienvenida con su usuario. La contraseña aparece como «(se genera al crear el proyecto)».
- **Cliente existente:** aviso de nuevo proyecto, sin contraseña.

Ruta: `POST /api/proposals/:id/welcome-preview`.

## 5. Crear el proyecto

**Crear proyecto** (`POST /api/projects`), en este orden:

1. **En una transacción:** el cliente (si es nuevo), su cuenta, el proyecto, las fases y las tareas. Las reuniones de avance se guardan como tareas marcadas *reunión*, con la franja naranja.
2. **Los pagos**, en la pestaña Pagos del proyecto.
3. **El correo** de bienvenida o de nuevo proyecto, por Gmail.
4. **Después del correo**, las reuniones marcadas con 📅 se agendan en Google Calendar con Meet y el cliente recibe la invitación. Esto requiere el permiso `calendar.events`. Si Calendar crea el evento pero el portal no logra guardarlo, el evento se cancela para no dejar invitaciones huérfanas.
5. **La pantalla final** muestra la contraseña si no se pudo enviar, cuántas reuniones se agendaron y los errores, si los hubo.

Revisa las fechas de las reuniones antes de confirmar: las invitaciones salen en ese momento.
