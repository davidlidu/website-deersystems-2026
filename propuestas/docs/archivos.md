# Archivos en Google Drive

Los archivos de cada proyecto viven en el Drive de `ceo@`, en **DeerSystems Partners / Cliente / Proyecto**. El cliente los ve y descarga desde el portal sin cuenta de Google.

## Subir

- Desde la pestaña *Archivos* del proyecto o desde una tarea, arrastrando o eligiendo los archivos. Cada uno pesa máximo 50 MB.
- El equipo elige si lo sube **compartido con el cliente** o **interno**.
- El cliente sube los suyos, que quedan compartidos, y te avisa.

## Desde mi Drive (solo administrador)

**Desde mi Drive** abre el selector de Google (Google Picker) dentro de la plataforma.

- Los archivos elegidos **se enlazan, no se copian**. Al quitarlos del proyecto, el original no se toca.
- Para que funcione necesita tres cosas:
  1. La API *Google Picker API* habilitada en el mismo proyecto de Google Cloud del login.
  2. Una clave de API de ese proyecto, en *Configuración → Google y correo*. La pantalla muestra el número de proyecto para compararlo.
  3. Que el navegador no bloquee las cookies de terceros de Google. En Brave hay que bajar los escudos para el sitio.
- El portal envía `Referrer-Policy: strict-origin-when-cross-origin` para que Google valide la clave.

## Compartido o interno

Cada archivo muestra un chip **Compartido** o **Interno**, que cambia con un clic previa confirmación.

- **Compartido:** el archivo queda con **lectura para quien tenga el enlace**, sin aparecer en búsquedas. Así el ojo 👁 abre el visor de Drive incluso para el cliente, y el cliente recibe un aviso.
- **Interno:** se quita el acceso por enlace y el cliente deja de verlo.
- Cada hora, un proceso revisa que todos los compartidos tengan su enlace activo.

## Ver y descargar

- **👁 Ver:** abre el visor de Drive. Tú siempre lo tienes. Los demás lo tienen si el archivo es compartido; si no, el portal muestra las imágenes y los PDF directamente.
- **⬇ Descargar:** pasa por el portal. Los Docs, Hojas y Presentaciones de Google se descargan convertidos a PDF.
- **Quitar:** un archivo subido va a la papelera de Drive, donde queda 30 días. Uno enlazado solo se desvincula.
- Cada archivo lleva una etiqueta de tipo con color: PDF, DOC, HOJA, PPT, IMG, ZIP, VID…
