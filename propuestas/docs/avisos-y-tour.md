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
