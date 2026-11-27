# Formularios y onboardings

**Clientes → Formularios** crea formularios u onboardings, los envía a un cliente con un enlace propio y guarda lo que responde en su espacio.

## Crear
- **+ Nuevo formulario** o **✨ Crear con IA** (describes para qué es y qué información necesitas; la IA arma secciones y preguntas y tú las ajustas).
- Tipos de campo: título de sección, texto corto, párrafo, correo, teléfono, número, fecha, enlace (URL), selección única, selección múltiple, lista desplegable, sí/no, escala de 1 a 5 y subir archivo. Cada pregunta puede ser obligatoria y llevar una ayuda.
- **El cliente puede subir archivos:** activa una sección de archivos al final. Los campos «Subir archivo» piden un archivo concreto (logo, catálogo…).
- **Archivos permitidos:** solo PNG, JPG, PDF, Excel (.xls, .xlsx) y Word (.doc, .docx), hasta 15 MB cada uno y 40 por formulario. Se revisa el contenido, no solo la extensión.
- **Sección de comentarios** al final (se puede quitar).
- **Vista previa** antes de guardar. **Duplicar** para hacer variantes.

## Enviar
- **Enviar a un cliente:** eliges el cliente y, opcionalmente, el proyecto; puedes enviarlo por correo (con la marca y el botón «Llenar el formulario») o solo crear el enlace para compartirlo por WhatsApp.
- Cada envío guarda una copia del formulario: editarlo después no cambia lo que ya se envió.
- Con proyecto, al cliente también le llega el aviso en el portal (y por push si lo activó).

## El cliente lo llena
- Abre su enlace (`/f/…`) **sin iniciar sesión**. Se guarda solo mientras escribe: puede dejarlo y seguir después con el mismo enlace.
- No puede enviarlo con preguntas obligatorias sin responder. Al enviarlo queda bloqueado; tú lo puedes **Reabrir**.
- En su portal ve sus formularios en **Formularios** (los pendientes arriba).

## Dónde quedan las respuestas
- En **Clientes → Formularios → Enviados a clientes** y en la **ficha del cliente** (sección *Formularios y onboardings*): estado, avance, respuestas, archivos y comentarios.
- Te llega el aviso «Cliente envió «…»» (campana, correo y push).
- Los archivos se guardan en el servidor (`/data/form-files`), no en Drive; solo los descargan tú y el cliente dueño.

## Para la IA
Las respuestas quedan ligadas al cliente, junto con sus reuniones, transcripciones, resúmenes, tareas y avances. El conector de Claude (MCP) tiene la herramienta **get_client_forms** para leerlas. La consulta «pregúntale a la IA por el cliente» desde Partners es la siguiente fase.

Tablas: `forms`, `form_links`, `form_files`.
