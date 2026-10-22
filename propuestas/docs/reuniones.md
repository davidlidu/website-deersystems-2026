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
- El evento lleva una marca privada (`extendedProperties.private.dsPartners = 1` y el id del proyecto).
- **Cancelar** borra el evento y Google avisa a los invitados.

Las reuniones de avance que se agendan al aprobar una propuesta usan este mismo camino. Ver [Aprobación](./aprobacion.md).

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

