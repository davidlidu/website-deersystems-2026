# Documentación · Propuestas y DeerSystems Partners

Un solo servidor Node atiende dos subdominios:

- **propuestas.deersystems.net**: publica las propuestas comerciales en HTML, cada una con su enlace.
- **partners.deersystems.net**: el portal donde se gestiona cada cliente después de aprobar su propuesta (proyecto, tareas, reuniones, archivos, pagos y avisos).

| Documento | De qué trata |
|---|---|
| [Arquitectura](./arquitectura.md) | Stack, cómo se reparten los subdominios, carpetas, procesos en segundo plano |
| [Roles, acceso y seguridad](./roles-y-seguridad.md) | Quién ve qué, inicio de sesión, contraseñas, sesiones y protecciones |
| [Propuestas](./propuestas.md) | Publicar, reemplazar, versiones, restaurar, visitas |
| [Aprobación y plan de trabajo](./aprobacion.md) | De «Propuesta aprobada» al proyecto: opciones A/B, IA, ajustes, reuniones, pagos, bienvenida |
| [Proyectos y tareas](./proyectos-y-tareas.md) | Vistas (lista, tablero, cronograma, calendario), estados, notas, avances, bitácora |
| [Reuniones](./reuniones.md) | Agendar con Meet, transcripción, resumen con IA y aprobación |
| [Archivos en Drive](./archivos.md) | Subir, enlazar desde tu Drive, compartido o interno, descargas |
| [Pagos y Gestor financiero](./pagos-y-finanzas.md) | Plan de pagos del proyecto, marcar pagado, sincronización, USD y TRM |
| [Facturación](./facturacion.md) | Cuentas de cobro, abonos, estado de cuenta, reportes, pago en línea opcional y migración desde SmartBilling |
| [Avisos y tour guiado](./avisos-y-tour.md) | Campana, correos, preferencias por persona, sonido, recorrido |
| [Inteligencia artificial](./ia.md) | Perfiles, proveedores, privacidad, consumo, qué hace la IA en cada parte |
| [Google Workspace](./google.md) | Conexión, permisos, Gmail, Drive, Calendar, Meet, Picker |
| [Configuración y despliegue](./despliegue.md) | Variables, Dokploy, DNS, primer arranque, respaldos, desarrollo local |
| [API](./api.md) | Todas las rutas del portal con su permiso |
| [Base de datos](./base-de-datos.md) | Tablas y columnas |
| [Historial de cambios](./historial.md) | Qué se construyó y en qué orden |
| [Integración con SmartBilling](./integracion-smartbilling.md) | Análisis y decisiones (ya implementado: ver [Facturación](./facturacion.md)) |

## En una frase por rol

- **Tú (administrador):** publicas la propuesta. Al aprobarla, la IA arma el proyecto con tareas, reuniones de avance y pagos, y tú lo revisas y ajustas. Después sigues todo desde el portal: cuentas de cobro, abonos y saldos, y lo cobrado llega a tu Gestor financiero.
- **Tu equipo:** trabaja las tareas, publica avances, sube archivos y ve todo menos los valores.
- **El cliente:** entra con su correo, ve el avance real, hace sus tareas, comenta, sube archivos y ve reuniones, resúmenes, pagos, sus cuentas de cobro (en PDF), su saldo y cómo pagar.
