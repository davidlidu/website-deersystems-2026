# Arquitectura

## Stack

| Parte | Tecnología |
|---|---|
| Servidor | Node 22+ sin framework: `node:http`, `node:sqlite` (`DatabaseSync`), TypeScript ejecutado directamente (sin build) |
| Base de datos | Un archivo SQLite en `DATA_DIR/propuestas.sqlite` |
| Archivos de propuestas | Disco, en `DATA_DIR/files/{id}/v{versión}/` |
| Archivos de proyectos | Google Drive, en la carpeta *DeerSystems Partners / Cliente / Proyecto* |
| Panel de propuestas | HTML, CSS y JS sin build, en `public/` |
| Portal partners | React 19 + Vite (`web/`), compilado a `public/partners` |
| `.zip` de propuestas | `fflate` |
| IA | Gemini y OpenRouter, por HTTP |
| Google | OAuth offline de una cuenta (`ceo@`): Gmail, Drive, Calendar, Meet |
| Finanzas | API del Gestor financiero (`/integrations/billing-payment`) |
| PDF de cuentas de cobro | jsPDF + html2canvas-pro en el navegador (carga diferida) |
| Pago en línea (opcional) | Wompi: links de pago y eventos firmados |
| TRM | Datos abiertos de la Superfinanciera (datos.gov.co, recurso `32sa-8pi3`) |

## Un contenedor, dos subdominios

`src/server.ts` mira el encabezado `Host` de cada petición:

- **`PARTNERS_HOST`** (partners.deersystems.net) → `handlePartners` (`src/partners/routes.ts`). Sirve la SPA y la API en `/api/*`.
- **Cualquier otro host** → el panel y las propuestas públicas:
  - `/admin`: el panel.
  - `/{slug}`: cada propuesta.
  - `/`: redirige a `HOME_URL` o al panel.

Los dos comparten base de datos y módulos: propuestas, IA, Google, correo y cifrado. Así, una propuesta subida desde partners queda publicada en `propuestas.deersystems.net/{slug}`.

## Carpetas

```
src/
  server.ts        Entrada; rutas de propuestas; deriva a partners según el Host; tareas programadas
  config.ts        Variables de entorno
  http.ts          JSON, archivos, errores, lectura de cuerpos
  auth.ts          Login con Google del panel de propuestas
  db.ts            Propuestas, correos autorizados
  proposals.ts     Publicar, reemplazar (con versión), restaurar, borrar
  storage.ts       Slug, descompresión, archivos y versiones en disco
  ai.ts            Perfiles de IA, proveedores, respaldo, consumo, prueba de conexión
  google.ts        OAuth, Gmail, Drive, Calendar, Meet, Picker
  mail.ts          Plantillas de correo con el diseño de la marca
  secrets.ts       Cifrado AES-256-GCM de claves y tokens
  partners/
    routes.ts      Login, sesión, proyectos, clientes, equipo, propuestas, aprobación, ajustes
    auth.ts        Contraseñas (scrypt), sesiones firmadas, límite de intentos
    common.ts      Permisos y vistas compartidas (qué ve cada rol de una tarea o nota)
    db.ts          Esquema y consultas: clientes, cuentas, proyectos, fases, tareas, notas, bitácora…
    extract.ts     Texto de la propuesta → plan con IA; ajuste del plan con IA
    work.ts        Tareas, fases, notas, avances, bitácora
    files.ts       Adjuntos en Drive, selector de Drive, compartir por enlace
    meetings.ts    Reuniones: agendar, sincronizar, transcripción, resumen, aprobación
    payments.ts    Plan de pagos del proyecto (cada cuota pagada es un abono)
    billing.ts     Cuentas de cobro, abonos, estado de cuenta, reportes, perfil del emisor
    finance.ts     Gestor financiero (ingresos por referencia) y TRM oficial
    import-smartbilling.ts  Migración desde SmartBilling (vista previa, coincidencias, cuadre)
    online-payments.ts      Pago en línea opcional con Wompi (links y webhook firmado)
    notify.ts      Avisos: catálogo, preferencias, campana, resumen por correo
public/            Panel de propuestas, login y 404
web/src/           Interfaz de partners
  main.tsx         Enrutador, encabezado, campana, tour
  lib.ts           Tipos, cliente de la API, formatos
  ui.tsx           Componentes comunes (Link, Loading, toasts, Markdown…)
  Tour.tsx         Recorrido guiado
  Bell.tsx         Campana de avisos
  sound.ts         Beep espacial (WebAudio)
  picker.ts        Selector de Google Drive
  pages/           Inicio, proyecto, aprobación, propuestas, reuniones, equipo, configuración, cuenta…
  pages/project/   Vistas de tareas, Gantt, detalle de tarea, notas, archivos, reuniones, pagos
  pages/billing/   Facturación: cuentas de cobro (formulario, documento, PDF), abonos, reportes, importación
```

## Procesos en segundo plano

Arrancan con el servidor (`startScheduler`, `startShareFixer`, `pruneNotifications`):

| Proceso | Frecuencia | Qué hace |
|---|---|---|
| Sincronización de reuniones | Cada 10 min | Lee Google Calendar. Cuando una reunión termina, busca la transcripción de Meet y le pide el resumen a la IA |
| Arreglo de enlaces de Drive | Cada hora | Da acceso por enlace a los archivos compartidos que aún no lo tienen |
| Resumen de avisos por correo | Al juntarse avisos | Agrupa varios avisos de unos minutos en un solo correo. Antes de apagarse (`SIGTERM`) envía los pendientes |
| Limpieza de avisos | Al arrancar | Borra avisos viejos |

## Decisiones de diseño

- **Sin build en el servidor ni dependencias pesadas.** Node ejecuta el TypeScript directamente y SQLite viene incluido en Node. La imagen es pequeña y respaldar es copiar `/data`.
- **SQLite en lugar de Supabase/Postgres.** Un solo dueño, poco volumen y un VPS propio: no hace falta un servicio aparte. Si en el futuro hay muchos usuarios concurrentes o varias instancias, la capa `db.ts` es la que se cambiaría.
- **Google con una sola cuenta.** Todo sale de `ceo@`: correos, Drive, Calendar y Meet. Ni los clientes ni el equipo necesitan cuenta de Google.
- **La IA propone y tú apruebas.** El plan, los resúmenes de reuniones y los pagos llegan como borrador; nada llega al cliente sin que lo confirmes.
- **Los valores nunca llegan al equipo.** La propuesta original, los valores y los pagos se filtran en el servidor, no solo en la interfaz.
