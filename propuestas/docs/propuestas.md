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
- **Usar:** eliges el cliente (opcional), a quién va y la URL; se publica como cualquier propuesta (versiones, visitas, botón de aprobar) y desde ahí la envías por correo. Si la URL ya tiene una propuesta, se ofrece publicarla como **versión nueva en el mismo enlace** (el cliente ve la actualizada; la anterior queda en el historial).
- **Plazo de implementación:** sale en la ficha de la portada, en «Ten en cuenta», en el cierre y en la página de aprobar.
- **Pago anual de una mensualidad:** marca «Pago anual» en un ítem mensual. La propuesta muestra el valor por año (12 meses) y, al aprobar, el cliente elige mes a mes o anual; la elección queda al inicio de los comentarios de la aprobación y la lee la IA del plan.
- **Aprobar una propuesta de plantilla:** la página de aprobar muestra **Lo que apruebas** (cada concepto con su valor; en las mensualidades con pago anual, el cliente elige mes a mes o anual), los **Adicionales opcionales** para marcar y el **total** por pago único, mensual y anual. Lo elegido queda en la aprobación («Propuesta + Soporte» y el detalle con totales), en el correo de confirmación y en lo que lee la IA del plan. Las propuestas publicadas antes de este cambio se reconstruyen con la inversión y los adicionales (sin pago anual si no lo tenían). La página de aprobar no muestra los conceptos de la inversión como alternativas cuando la propuesta es una sola oferta (`meta.aprobacion.opciones` vacío). Vía agencia, «Empresa» se prellena con la agencia.
- **Pagos del plan (propuesta de plantilla):** salen de lo que el cliente aprobó, no de la propuesta original: un pago con todo lo de pago único (setup más los adicionales de pago único que marcó), o anticipo y contra entrega si la propuesta es 50/50, y el primer cobro de cada concepto recurrente (el primer mes, el año del servidor, o los 12 meses si eligió pago anual). Un aviso recuerda que los meses siguientes se cobran aparte. En el plan, **Volver a armar el plan** lo genera de nuevo con IA (p. ej. para una aprobación hecha antes de esta corrección).
- **Diseño:** se publica con la plantilla del **Cotizador 2026** (`src/partners/plantilla-propuesta.html`, la misma de `generar_propuesta.py`): portada con ficha, contexto, alcance, inversión y forma de pago, adicionales, medios de pago con QR, trayectoria y cierre. Lleva `meta.aprobacion` para que el plan de pagos llegue exacto al aprobar. El original está en la unidad compartida **Documentos Empresa/Cotizador-2026-DeerSystems** (cuenta ceo@deersystems.net). Cuando lo cambies, súbelo en **Propuestas → Plantillas → Diseño de las propuestas → Subir plantilla nueva**: queda en `/data/cotizador/` y tiene prioridad sobre la del código (con «Usar la del sistema» vuelves a la original). Se valida que traiga el bloque de datos `id="propuesta"` y el bloque SEO. Las propuestas ya publicadas no cambian.

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
