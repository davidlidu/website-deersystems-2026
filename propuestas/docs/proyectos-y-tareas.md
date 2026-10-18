# Proyectos y tareas

## Inicio

- **Tú y tu equipo:** clientes y proyectos en marcha, cada uno con su barra de avance.
- **El cliente:** *En curso* e *Historial* (proyectos finalizados).

## Encabezado del proyecto

- **Avance:** tareas completadas / total, con su porcentaje.
- **Fechas y estado:** inicio, entrega estimada y estado. El estado puede ser Activo, Pausado o Finalizado; solo el equipo lo cambia.
- **Para el cliente,** un recuadro con cuántas tareas dependen de él (sin contar las que ya envió a revisión).

## Pestañas

| Pestaña | Quién la ve | Contenido |
|---|---|---|
| Tareas | Todos | Las cuatro vistas, filtros y detalle |
| Reuniones | Todos | Próximas con enlace de Meet y resúmenes aprobados ([Reuniones](./reuniones.md)) |
| Avances | Todos | Publicaciones del equipo para el cliente |
| Notas | Todos | Compartidas; las internas solo las ve el equipo |
| Archivos | Todos | Drive ([Archivos](./archivos.md)) |
| Pagos | Tú y el cliente | Plan de pagos ([Pagos](./pagos-y-finanzas.md)) |
| Bitácora | Todos | Cada cambio; el cliente no ve las entradas internas |
| Alcance aprobado | Todos | El alcance sin valores |
| Propuesta y valores | Tú y el cliente | Enlace a la propuesta y valores pactados |

Los avisos llevan directo a una pestaña (`?tab=avances`) o a una tarea (`?tarea=12`).

## Estados de tarea

Pendiente → En progreso → En revisión → Completada, y Bloqueada.

- El **cliente** solo mueve sus propias tareas entre Pendiente, En progreso y En revisión. El equipo revisa y completa.
- Cada cambio queda en la bitácora y, si lo hace el cliente, te avisa.
- **Tareas vencidas:** se marcan las que pasaron su entrega sin completarse.

## Vistas (se recuerda la última por navegador)

- **Lista:** por fase, con el selector de estado en cada fila. El equipo agrega, renombra y elimina fases desde aquí.
- **Tablero:** columnas por estado; se arrastra la tarjeta. Las columnas que el cliente no puede usar aparecen bloqueadas para él.
- **Cronograma (Gantt):**
  - Muestra barras de inicio a entrega agrupadas por fase. Cada fase tiene una barra resumen con su progreso.
  - Tiene línea de hoy, escala de **días, semanas o meses**, botón *Hoy* y leyenda.
  - **El equipo arrastra una barra** para moverla, conservando su duración, o **estira sus bordes** para cambiar inicio o entrega.
  - Las tareas sin fecha aparecen aparte.
- **Calendario:** por fecha de entrega. El equipo arrastra una tarea a otro día y se conserva su duración.

**Reuniones con el cliente:** las tareas marcadas como reunión llevan una **franja naranja a la derecha** en las cuatro vistas, y la leyenda del cronograma la incluye. Quedan marcadas solas:

- Las reuniones de avance que propone la IA.
- En proyectos anteriores, las tareas de la propuesta cuyo título empieza por «Reunión».

Cualquier otra tarea se marca con la casilla *Es una reunión con el cliente* en su detalle.

## Filtros

- Lado: Todas, DeerSystems, o Cliente (para el cliente, «Mías»).
- Responsable (equipo).
- Ocultar completadas.
- Búsqueda por texto.

## Detalle de la tarea

Es un panel lateral con tres pestañas: **Comentarios**, **Archivos** e **Historial**.

**El equipo edita:**
- Título, descripción y criterio de terminado.
- Fase, lado, responsable, inicio y entrega. Las fechas se validan: la entrega no puede ser antes del inicio, aunque cambies una sola.
- La marca de reunión.

**El cliente** cambia el estado de sus tareas, comenta y adjunta.

## Notas y avances

- **Nota:** compartida con el cliente o **interna**. Se edita y se borra.
- **Avance:** publicación del equipo para el cliente, que le llega como aviso.
- **El cliente** deja notas compartidas.

## Bitácora

Registra con autor y fecha:
- Creación y cambio de estado del proyecto.
- Tareas creadas, editadas (fechas incluidas), con cambio de estado o borradas.
- Fases creadas, renombradas o borradas.
- Notas, comentarios y avances.
- Archivos agregados, quitados o con cambio de visibilidad.
- Reuniones agendadas, canceladas y resúmenes aprobados.

Las entradas internas, como las notas internas, no le aparecen al cliente.
