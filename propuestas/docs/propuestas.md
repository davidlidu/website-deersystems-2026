# Propuestas

Las propuestas comerciales se publican como páginas HTML en `propuestas.deersystems.net`. Se gestionan desde el panel clásico (`/admin`) o desde **partners → Propuestas**; las dos vistas usan los mismos datos.

## Publicar

- Se sube un `.html` suelto o un `.zip` con sus assets. El `index.html` puede estar en la raíz o dentro de una única carpeta. El tamaño máximo es `MAX_UPLOAD_MB` (100 MB por defecto).
- La URL sale del nombre del archivo: `PROP-2026-014 Acmé.html` → `https://propuestas.deersystems.net/prop-2026-014-acme`.
- La raíz no lista nada: redirige a `HOME_URL` o al panel si tienes sesión. Cualquier ruta inexistente devuelve el mismo 404.
- Las propuestas salen con `noindex, nofollow, noarchive` y sin caché, así que un reemplazo se ve de inmediato.
- **Visitas:** cada propuesta cuenta cuántas veces se abrió y cuándo fue la última. No cuenta tus visitas con sesión ni las vistas previas de WhatsApp, Slack, Telegram, bots o `curl`.
- Una propuesta se puede **pausar**: deja de verse sin perder nada.

## Versiones

- **Cada reemplazo guarda una versión nueva y conserva las anteriores**, en `files/{id}/v{n}/`, con fecha, autor, tamaño y nota.
- Desde partners, el administrador abre cualquier versión en `/historial/{id}/{versión}/`.
- **Restaurar** copia esa versión como una nueva. No se pierde nada y el enlace público sigue siendo el mismo.
- Las propuestas que ya generaron proyectos **no se pueden eliminar**, solo pausar, porque el proyecto guarda de cuál salió.

## De dónde saca el texto la IA

Para armar el plan, `extract.ts` convierte la propuesta en texto en este orden:

1. **Datos embebidos** en `<script type="application/json">`, si existen (propuestas hechas con React o Babel).
2. **El HTML visible**, sin scripts ni estilos.
3. **El texto que vive en el código** (cadenas y JSX), cuando el HTML casi no trae texto visible.

Si aun así quedan menos de 200 caracteres, la aprobación se detiene con un aviso, sin gastar una llamada a la IA.
