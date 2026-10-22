# Proyectos y tareas

## Inicio

- **Tú y tu equipo:** clientes y proyectos en marcha, cada uno con su barra de avance.
- **El cliente:** *En curso* e *Historial* (proyectos finalizados).

## Encabezado del proyecto

- **Avance:** tareas completadas / total, con su porcentaje.
- **Fechas y estado:** inicio, entrega estimada y estado. El estado puede ser Activo, Pausado o Finalizado; solo el equipo lo cambia.
- **Para el cliente,** un recuadro con cuántas tareas dependen de él (sin contar las que ya envió a revisión).

## Pestañas

Cinco, para orientarse de un vistazo:

| Pestaña | Quién la ve | Contenido |
|---|---|---|
| **Avances** (la principal) | Todos | Generador de avances con IA, editor y historial; desde aquí se abre la bitácora técnica |
| **Plan de trabajo** | Todos | Interruptor *Tareas* (Lista, Tablero, Calendario) · *Cronograma* (Gantt) · *Calendario de reuniones* ([Reuniones](./reuniones.md)), agrupadas por fase |
| **Documentación** | Todos | *Archivos* ([Archivos](./archivos.md)) y *Notas* con formato. El equipo filtra: Todo · Compartido con el cliente · Interno |
| **Alcance y propuesta** | Todos (valores: tú y el cliente) | Alcance aprobado con la opción y los ajustes; debajo, propuesta y valores pactados. El equipo la ve como *Alcance* |
| **Pagos** | Tú y el cliente | Plan de pagos ([Pagos](./pagos-y-finanzas.md)) |

Los avisos llevan directo a una pestaña (`?tab=avances`), a un avance (`?tab=avances&avance=5`) o a una tarea (`?tarea=12`). Los enlaces de antes siguen funcionando: `?tab=tareas`, `reuniones`, `cronograma`, `notas`, `archivos`, `bitacora`, `alcance` y `comercial` abren su nuevo lugar.

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

## Avances

- **Generar avance del día con IA:** recopila lo de hoy (tareas completadas, tareas enviadas a revisión, reuniones, archivos compartidos y la próxima reunión) y la IA redacta el avance con el enlace de cada cosa. Usa el perfil *Reuniones* (solo proveedores privados). Si la IA no responde, se arma con los mismos datos; si no hubo movimientos, deja una base para escribir. Nada se publica sin que lo revises.
- **Automatizar envíos diarios** (por proyecto): todos los días a las **5:00 p. m.** (hora de Colombia) se publica solo el avance del día, si el proyecto está activo, hubo movimientos y nadie publicó uno ese día.
- **Editor WYSIWYG:** negrita, cursiva, **Insertar URL** (Google Docs, Drive, Meet, Figma…; con texto seleccionado lo vuelve enlace), listas, **Variables** (cliente, proyecto, % de avance, tareas completadas, fecha, entrega estimada, próxima reunión) e **Insertar tarea/reunión**, con buscador. Guarda Markdown, el mismo que leen el portal y los correos.
- **Visibilidad:** *Compartido con el cliente* (le llega el aviso) o *Solo equipo*. **Vista previa** muestra cómo lo verá el cliente.
- **Historial:** cada avance dice si lo **generó la IA** o quién lo redactó, y tiene *Editar* (también la visibilidad), *Copiar enlace*, *Ver bitácora técnica* y *Borrar*. Los enlaces a tareas y reuniones abren dentro del portal.

## Notas

- **Nota:** compartida con el cliente o **interna**, con el mismo editor (sin variables). Se edita y se borra.
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
