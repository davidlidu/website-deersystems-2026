# Propuestas

Las propuestas comerciales se publican como páginas HTML en `propuestas.deersystems.net`. Se gestionan desde el panel clásico (`/admin`) o desde **partners → Propuestas**; las dos vistas usan los mismos datos.

## Publicar

- Se sube un `.html` suelto o un `.zip` con sus assets. El `index.html` puede estar en la raíz o dentro de una única carpeta. El tamaño máximo es `MAX_UPLOAD_MB` (100 MB por defecto).
- La URL sale del nombre del archivo: `PROP-2026-014 Acmé.html` → `https://propuestas.deersystems.net/prop-2026-014-acme`.
- La raíz no lista nada: redirige a `HOME_URL` o al panel si tienes sesión. Cualquier ruta inexistente devuelve el mismo 404.
- Las propuestas salen con `noindex, nofollow, noarchive` y sin caché, así que un reemplazo se ve de inmediato.
- **Visitas:** cada propuesta cuenta cuántas veces se abrió y cuándo fue la última. No cuenta tus visitas con sesión ni las vistas previas de WhatsApp, Slack, Telegram, bots o `curl`.
- Una propuesta se puede **pausar**: deja de verse sin perder nada.

## Plantillas de propuestas

En **Propuestas → Plantillas** están las propuestas prediseñadas, guardadas como datos (tabla `proposal_templates`):

- **Para agencias:** los planes de agencias.deersystems.net (WordPress A/B/C, Shopify Básico/Estándar/Avanzado, Email y SMS, Mantenimiento Básico/Premium y Ajustes por horas) y **Chatbot Grupo Oral Flex Click Lab** (instalación y setup $1.000.000 pago único; IA $70.000/mes hasta 800 chats; servidor $850.000/año; opcionales: soporte $200.000/mes y sincronización de agenda $250.000). Se crean una vez; si eliminas una, no vuelve.
- **Personalizadas:** las que armas con **+ Propuesta personalizada**, con **Duplicar** o con **✨ Crear con IA** (describes servicio, cliente y valores; perfil *Propuestas*). Todas quedan guardadas para volver a usarlas.
- Cada plantilla tiene título, a quién va (cliente o agencia y cliente final), introducción, ítems con valor y cobro (pago único, mensual, anual o por hora), opcionales (no suman en los totales), qué incluye y condiciones. Si una condición menciona «50 %», el pago único se muestra 50 % anticipo y 50 % contra entrega.
- **Usar:** eliges el cliente (opcional), a quién va y la URL; se publica como cualquier propuesta (versiones, visitas, botón de aprobar) y desde ahí la envías por correo.
- **Diseño:** se publica con la plantilla del **Cotizador 2026** (`src/partners/plantilla-propuesta.html`, la misma de `generar_propuesta.py`): portada con ficha, contexto, alcance, inversión y forma de pago, adicionales, medios de pago con QR, trayectoria y cierre. Lleva `meta.aprobacion` para que el plan de pagos llegue exacto al aprobar. Si cambias la plantilla en el Drive, reemplaza ese archivo.

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
