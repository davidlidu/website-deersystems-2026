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
- Si no hay transcripción, pegas el texto o tus notas.
- Las reuniones fuera de Meet (llamadas, Zoom, presenciales) se registran desde el proyecto con *Registrar reunión sin Meet*, pegando la transcripción.

## 4. Resumen con IA

El perfil *Reuniones* propone tres cosas: el **resumen**, los **acuerdos** y las **tareas de cada parte** (DeerSystems o cliente, con fecha). Te llega un aviso.

**Solo tú ves el borrador y la transcripción.**

## 5. Revisar, ver el correo y aprobar

- Editas el resumen, los acuerdos y las tareas (cuáles incluir, responsable y fecha).
- Eliges los destinatarios entre los asistentes externos y agregas otros.
- **Vista previa del correo:** un acordeón cerrado antes de enviar, que muestra el correo tal como lo recibirá el cliente con lo que hay en pantalla.
- **Aprobar y enviar** hace cuatro cosas:
  1. Crea las tareas en el proyecto (origen «reunión»).
  2. Las registra en la bitácora.
  3. Envía el correo con el diseño de la marca. Las fechas van en español, por ejemplo «sábado, 17 de octubre».
  4. Muestra el resumen al cliente en la pestaña *Reuniones* del proyecto.
- **Descartar** la saca de la bandeja sin enviar nada.
