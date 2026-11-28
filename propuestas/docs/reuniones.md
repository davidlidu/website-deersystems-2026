# Reuniones (Calendar + Meet)

## Ciclo de una reunión

```
programada ─(termina)→ esperando ─(hay transcripción)→ borrador ─(apruebas)→ aprobada
                            └─(no hay)→ sin_transcripcion → pegas notas → borrador
                                                     error de IA → error → reintentar
                                                     también: descartada
```

## 1. Agendar desde la plataforma

Se agenda en **Clientes → Reuniones** o en la pestaña *Reuniones* del proyecto:

- Eliges el proyecto en marcha, la fecha y hora, la duración y la agenda.
- Eliges a quién invitar: el cliente, tu equipo y otros correos.
- Se crea en tu Google Calendar con Meet (`conferenceData`) y Google envía las invitaciones (`sendUpdates=all`). El cliente recibe además un aviso en la campana.
- O **solo reservas el horario** para que el cliente lo confirme (ver *Reuniones por confirmar*).
- El evento lleva una marca privada (`extendedProperties.private.dsPartners = 1` y el id del proyecto).
- **Cancelar** borra el evento y Google avisa a los invitados.

Las reuniones de avance que se agendan al aprobar una propuesta usan este mismo camino. Ver [Aprobación](./aprobacion.md).

### Reuniones por confirmar (el cliente responde desde el portal)

Al agendar puedes **solo reservar el horario**: queda en tu Calendar con «Por confirmar ·» y el cliente todavía no recibe la invitación.

- **Aviso al cliente:** le llega a la campana (y por correo, si está encendido) «Confirma la reunión…». Al entrar al portal ve en la cabecera una **línea delgada y comprimida** («Tienes 2 reuniones por confirmar · Ver») para no generar ruido; con un clic se expande y muestra cada reunión y el botón **Confirmar reuniones** (si la deja abierta, se recuerda mientras dure la sesión del navegador).
- **Página *Reuniones por confirmar*** (`/reuniones-por-confirmar`): cada reunión con proyecto, día y hora (Colombia), duración y quién va por DeerSystems. Dos opciones:
  - **Confirmar día y hora:** la reserva pasa a reunión y Google le envía la invitación con Meet. Te llega un aviso.
  - **Proponer otro día y hora:** fecha, hora y una nota opcional. Se revisa que el horario esté libre en tu agenda (sin mostrar con qué se cruza) y, si está ocupado, se sugiere el siguiente libre. Te llega un aviso; la reserva sigue por confirmar y el cliente puede cambiar su propuesta o confirmar el horario original.
- **Tú:** en la reunión (y en la pestaña *Reuniones* del proyecto) ves el horario propuesto con **Aceptar horario propuesto** (mueve la reunión y envía la invitación). También puedes confirmar el original o editar la fecha: con otra fecha, el cliente la vuelve a ver por confirmar con el horario nuevo. En tu cabecera aparece una franja cuando un cliente propuso otro horario.
- Solo responden las personas del cliente que ven el proyecto; quien solo ve sus tareas, si está entre los invitados.
- **En el inicio del cliente** (ya no en una franja fija de la cabecera: esa queda solo para ti), la sección **Reuniones** sale **contraída**: un recuadro naranja «Tienes N reuniones por confirmar · la próxima…» y otro «Próximas reuniones (N) · la siguiente…»; con un clic se despliegan. Muestra arriba, resaltadas en naranja, las que debe confirmar (con *Confirmar* y *Otro horario* ahí mismo) y debajo sus **próximas reuniones** con *Unirse a Meet* y *Reagendar*.
- **Reagendar una reunión confirmada:** el cliente propone otro día y hora (con nota); la reunión sigue igual hasta que la aceptes. Te llega «pide reagendar…» y en la reunión ves **Aceptar el horario propuesto**: se mueve y Google avisa a los invitados. El cliente puede cancelar su solicitud.

## 2. Sincronización

Cada 10 minutos, o con *Sincronizar ahora*, se lee el calendario.

- **Por defecto, solo se siguen las reuniones agendadas desde la plataforma.** Las que agendas directamente en Calendar con un cliente para otros temas no entran.
- La opción *Importar también las reuniones con clientes agendadas directamente en Google Calendar* las incluye.

## 3. Transcripción

Cuando la reunión termina, se busca su transcripción en la API de Meet (`conferenceRecords` → `transcripts` → `entries`).

- La transcripción **debe estar activada** en la reunión de Meet, y Business Standard la permite.
- **Notas de Gemini:** con «Tomar notas con Gemini», Meet guarda en *Drive → Meet Recordings* un documento con dos pestañas, *Las notas* y *Transcripción*. Esa transcripción puede no salir por la API de Meet y la reunión queda *Sin transcripción*: impórtala desde Drive. La grabación (video) no sirve: no tiene texto.
- **La causa se muestra** en la reunión: Meet no encontró la reunión con ese código (se hizo en otro enlace u otra cuenta), la encontró sin transcripción, o la transcripción salió vacía.
- **Importar desde Drive:** abre el selector de tu Drive; eliges el documento de las notas de Gemini o de la transcripción (no el video) y la IA arma el resumen. Se leen **todas las pestañas** con la API de Google Docs, empezando por *Transcripción*; si esa API no está habilitada en tu proyecto de Google Cloud, se usa la exportación de Drive, que solo trae la primera pestaña (*Las notas*). No necesita permisos nuevos: con `drive.file` solo se lee el documento que elijas.
- **Buscar de nuevo en Meet:** vuelve a consultar la API al instante, por si la transcripción tardó más de las 3 horas de espera.
- O pegas el texto o tus notas.
- Las reuniones fuera de Meet (llamadas, Zoom, presenciales) se registran desde el proyecto con *Registrar reunión sin Meet*, pegando la transcripción.

## 4. Resumen con IA

El perfil *Reuniones* propone tres cosas: el **resumen**, los **acuerdos** y las **tareas de cada parte** (DeerSystems o cliente, con fecha). Te llega un aviso.

**Solo tú ves el borrador y la transcripción.**

## 5. Revisar, ver el correo y aprobar

- Editas el resumen, los acuerdos y las tareas (cuáles incluir, responsable y fecha).
- **Destinatarios con selector:** aparecen la **cuenta principal** del cliente, su correo de contacto (si es distinto) y todos los participantes de la reunión, cada uno con su etiqueta. Vienen marcados la cuenta principal, el contacto y los participantes externos; tu equipo aparece sin marcar. Desmarca a quien no deba recibirlo o agrega más correos con *+ Agregar*. Sin nadie marcado, se aprueba sin enviar correo.
- **Vista previa del correo:** un acordeón cerrado antes de enviar, que muestra el correo tal como lo recibirá el cliente con lo que hay en pantalla.
- **Aprobar y enviar** hace cuatro cosas:
  1. Crea las tareas en el proyecto (origen «reunión»).
  2. Las registra en la bitácora.
  3. Envía el correo con el diseño de la marca. Las fechas van en español, por ejemplo «sábado, 17 de octubre».
  4. Muestra el resumen al cliente en la pestaña *Reuniones* del proyecto.
- **Descartar** la saca de la bandeja sin enviar nada.

## Fases y navegación

- **Reunión ligada a una fase:** en *Plan de trabajo → Calendario de reuniones*, cada reunión (próxima o con resumen) tiene el selector *Fase*. Las reuniones se agrupan por fase, en el orden del proyecto; las que no tienen fase quedan aparte, en *Fuera de las fases*. Si ninguna tiene fase, se ve la lista normal. Al cambiar la reunión de proyecto, sale de su fase.
- **Breadcrumb:** dentro de una reunión se ve *Reuniones / Cliente / Reunión*. El cliente lleva a **Reuniones** filtrado por ese cliente (`/reuniones?cliente=3`); también hay un selector *Todos los clientes* en esa página.

## Llamadas comerciales: Discovery Call y Proposal Call

Desde **Reuniones → + Agendar reunión**, eliges el tipo: *Seguimiento de proyecto*, **Discovery Call** o **Proposal Call**.

- **Con quién:** un cliente que ya existe o un **prospecto nuevo** (empresa, contacto y correo; no necesita cuenta ni proyecto).
- **Título automático:** «Discovery Call - Empresa (Contacto)» o «Proposal Call - Empresa (Contacto)». Se puede cambiar.
- Se crea en tu Calendar con Meet, como cualquier reunión, e invita al contacto, a tu equipo y a otros correos.
- **Proposal Call:** le asignas una propuesta ya subida en *Propuestas* (o la eliges después).
- Al terminar, la transcripción se busca igual que en las demás reuniones (o la importas desde Drive) y la IA resume la llamada. No hay que aprobarla ni se crean tareas: todavía no hay proyecto.

### Enviar la propuesta al terminar

En la reunión aparece **Enviar la propuesta**:

1. **Propuesta:** la asignada, o eliges otra. Botón para verla.
2. **¿Cambios según la conversación?** Sube una versión nueva (.html o .zip) con una nota de lo que cambió: se publica en el **mismo enlace** y la anterior queda en el historial.
3. **Para:** el contacto y los participantes, con selector; puedes agregar más.
4. **Mensaje:** viene con un copy que agradece el espacio, conecta con lo que quieren lograr y muestra la experiencia de DeerSystems. **Personalizar con IA según la conversación** lo reescribe con 2 o 3 puntos concretos de la llamada (necesita la transcripción o el resumen; usa el perfil *Reuniones*, solo proveedores privados). Lo puedes editar todo.
5. **Vista previa** y **Enviar al cliente**. El correo lleva el botón a la propuesta. Queda registrado cuándo y a quién se envió, y se puede volver a enviar.

