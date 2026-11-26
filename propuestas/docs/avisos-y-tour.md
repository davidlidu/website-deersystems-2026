# Avisos y tour guiado

## Campana

- La campana del encabezado muestra el número de avisos sin leer. Cada aviso lleva a la tarea o a la pestaña exacta.
- Al llegar uno nuevo suena un **beep espacial** corto, generado con WebAudio sin archivos de audio. El sonido se apaga por navegador desde la campana o en *Mi cuenta*.
- En celular el panel ocupa el ancho de la pantalla.
- Los cambios de estado repetidos del cliente sobre la misma tarea se juntan en un solo aviso.

## Catálogo de avisos

| Aviso | Le llega a | Plataforma | Correo |
|---|---|---|---|
| El cliente comenta una tarea o deja una nota | Tú y el equipo | ✓ | ✓ |
| El cliente cambia el estado de una tarea | Tú y el equipo | ✓ | ✓ |
| El cliente sube un archivo | Tú y el equipo | ✓ | ✓ |
| Le asignan una tarea a alguien del equipo | Esa persona | ✓ | ✓ |
| Hay una tarea nueva para el cliente | Cliente | ✓ | ✓ |
| DeerSystems publica un avance | Cliente | ✓ | ✓ |
| DeerSystems comenta o deja una nota compartida | Cliente | ✓ | ✓ |
| DeerSystems comparte un archivo | Cliente | ✓ | — |
| Se agenda una reunión (además de la invitación de Calendar) | Cliente | ✓ | — |
| Hay una reunión reservada para que el cliente la confirme o proponga otro horario | Cliente | ✓ | ✓ |
| El cliente confirma una reunión o propone otro horario | Tú | ✓ | ✓ |
| Hay un resumen de reunión listo para revisar | Tú | ✓ | ✓ |
| Se aprueba el resumen de una reunión (además del correo) | Cliente | ✓ | — |
| Llega un pago en línea (Wompi) | Tú | ✓ | ✓ |

La tabla muestra los valores por defecto. Quien genera la acción no recibe su propio aviso.

## Dos niveles de control

1. **Configuración → Avisos (tú):** enciende o apaga cada aviso para todos, en la plataforma y por correo.
2. **Mi cuenta → Mis avisos (cada cliente y cada persona del equipo):** la misma tabla con frases pensadas para ellos, por ejemplo «Tengo una tarea nueva por hacer».
   - **Cada persona solo puede apagar lo suyo.**
   - Lo que tú desactivaste aparece bloqueado y no se puede encender.

## Correos de aviso

- Los avisos de unos minutos se juntan en **un solo correo** con el diseño de la marca, con un enlace a cada novedad.
- Al reiniciar el servidor (`SIGTERM`) se envían los que estaban en cola.

## Tour guiado

Aparece **al iniciar sesión** hasta que la persona lo termina. Resalta cada parte de la pantalla con una explicación y se maneja con el teclado (← → y Esc).

**Cliente:**
1. Bienvenida y sus proyectos.
2. **Abre su proyecto**, el que esté en curso con más tareas, y recorre:
   - El avance.
   - «Lo que depende de ti»: se salta si no tiene tareas pendientes.
   - Las pestañas.
   - Las cuatro vistas.
   - Los filtros.
   - Sus tareas: estados, comentarios y archivos.
3. Campana, Mi cuenta y el botón **?**.

**Equipo:** lo mismo, con su proyecto, más lo que el cliente ve y lo que no.

**Tú:** Propuestas, Clientes y proyectos, el recorrido dentro de un proyecto (estado, nueva tarea, arrastrar en el cronograma), Reuniones, Equipo, Configuración y la campana.

**Cómo se cierra:**
- **Terminar tour (no volver a mostrar):** se guarda en la cuenta (`accounts.tour_done`; para ti, el ajuste `owner_tour_done`) y no vuelve en ningún navegador ni dispositivo.
- **Ver después:** lo cierra hasta el próximo inicio de sesión (`sessionStorage`).
- **El botón ?** del encabezado lo repite cuando quieras.

Si la persona no tiene proyectos, los pasos del proyecto se omiten.

## Notificaciones push

Los avisos «en la plataforma» (los de la campana) también llegan como **notificación del dispositivo**, aunque la app esté cerrada, en cada dispositivo donde la persona las active.

- **Dónde se activan:** *Configuración → Avisos → Notificaciones push* (tú) o *Mi cuenta* (equipo y clientes), con **Activar notificaciones**. Se pide el permiso del navegador y llega una notificación de prueba. Se activan por dispositivo: celular, iPad y Mac por separado.
- **iPhone y iPad:** solo con la app agregada a la pantalla de inicio (Safari → Compartir → Agregar a inicio) e iOS/iPadOS 16.4 o más reciente. Se activan desde la app abierta desde el ícono.
- **Mac:** en Safari (o en la app agregada al Dock), Chrome o Edge.
- **Qué llega:** lo mismo que la campana, con las mismas preferencias: si alguien apaga un aviso «en la plataforma», tampoco le llega por push. Al tocar la notificación se abre la pantalla del aviso.
- **Técnica:** Web Push con claves VAPID que se crean solas la primera vez (setting `push_vapid`); suscripciones en `push_subscriptions`; service worker en `/sw.js`. Los dispositivos que ya no existen se borran solos. API: `GET /api/push/key`, `POST /api/push/subscribe`, `/unsubscribe` y `/test`.
