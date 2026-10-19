# Historial de cambios

## Octubre 2026: propuestas

- Publicación de propuestas HTML o `.zip` con una URL a partir del nombre del archivo, reemplazo sin cambiar la URL, `noindex` y conteo de visitas.
- Panel `/admin` con Google; `SUPERADMIN_EMAIL` autoriza otros correos.
- Despliegue en Dokploy con volumen `/data`.

## 14 oct 2026: portal partners

### Fase 1: base del portal
- Segundo subdominio en el mismo contenedor, con routing por `Host`.
- Roles: administrador (Google), equipo y cliente (correo y contraseña scrypt).
- **Propuesta aprobada**: la IA lee la propuesta y arma el borrador con cliente, alcance sin valores, valores, fases, tareas y fechas. Se revisa y crea cliente, cuenta, proyecto y correo de bienvenida.
- **Opciones A/B**: detecta alternativas excluyentes y guarda la opción aprobada y los ajustes acordados.
- **IA configurable**: Gemini u OpenRouter, con claves cifradas, consumo medido y prueba de conexión.
  - Después: **dos perfiles** (*Propuestas* y *Reuniones*), cada uno con modelo de respaldo y opción de solo proveedores privados.
- Lectura de propuestas hechas con React o Babel: datos JSON embebidos y texto dentro del código.

### Fase 2: trabajo del proyecto
- Tareas con estados fijos, % por tareas completadas, y vistas lista, tablero, semana y calendario con arrastrar y soltar.
- Detalle de tarea con comentarios e historial.
- Notas compartidas o internas, avances para el cliente y bitácora.

### Fase 3: archivos y avisos
- Adjuntos en Google Drive (*DeerSystems Partners / Cliente / Proyecto*).
- Campana de avisos en el encabezado y correos agrupados.
- Configuración para encender o apagar cada aviso.

### Fase 4: reuniones
- Sincronización con Google Calendar, transcripción de Meet y resumen, acuerdos y tareas con IA.
- Aprobación antes de enviar, tareas en el proyecto, bitácora y correo con la marca.
- Vista previa del correo del resumen en acordeón.

### Ajustes del mismo día
- **Propuestas desde partners**, con el enlace en `propuestas.deersystems.net` e **historial de versiones** con restaurar.
- **Agendar reuniones** con cliente, equipo e invitados desde la plataforma. Por defecto solo se siguen las agendadas desde aquí.
- **Beep espacial** en los avisos; ancho de la campana corregido en celular.
- **Detalle de tarea**: pestañas corregidas.
- **Archivos**: ojo (visor de Drive) y descarga; **selector de Drive** sin salir de la plataforma; **compartido o interno** con un clic.
- `Referrer-Policy: strict-origin-when-cross-origin` para que el selector valide la clave.
- **Mis avisos**: cada cliente y persona del equipo elige los suyos en *Mi cuenta*.
- **Cronograma tipo Gantt** en lugar de la vista semana: zoom, línea de hoy, arrastrar para mover o estirar.
- **Reuniones de avance al aprobar**: quedan como tareas en su fase y se agendan en Calendar con Meet.
- **Tour guiado** por rol. «Terminar tour» no lo vuelve a mostrar; el botón **?** lo repite. Después recorre un proyecto real: avance, pestañas, vistas, filtros y tareas.
- **Ajustar el plan con IA** antes de crear el proyecto (con deshacer) y **vista previa del correo de bienvenida** en una ventana emergente.
- **Franja naranja** en las tareas que son reuniones con el cliente, en las cuatro vistas, y casilla para marcar cualquier tarea.
- **Pagos**: plan de pagos desde la propuesta, pestaña *Pagos* y sincronización con el Gestor financiero al marcar pagado (USD convertido con la TRM oficial).

## 17 oct 2026: facturación (SmartBilling dentro de Partners)

- **Cuentas de cobro** con ítems con formato, COP o USD con TRM, numeración que continúa la de SmartBilling, PDF igual al de SmartBilling, envío por Gmail con el PDF adjunto, anular y borrar.
- **Abonos** ligados al cliente (y opcionalmente a proyecto y cuenta de cobro), cada uno como ingreso en el Gestor. Las cuotas pagadas del plan de pagos pasan a ser abonos, con la misma referencia en el Gestor.
- **Estado de cuenta** en la ficha del cliente y en el inicio del cliente, con *cómo pagar* (datos bancarios y QR).
- **Clientes solo de facturación** (sin correo) y *Dar acceso al portal*.
- **Reportes** con las cifras de SmartBilling y exportación CSV.
- **Datos del emisor** (logo, firma, QR, forma de pago, notas y días para pagar).
- **Importador desde SmartBilling** con vista previa, coincidencias por NIT o nombre, idempotencia y cuadre por cliente.
- **Pago en línea opcional** con Wompi, apagado por defecto y activado por cuenta de cobro.
- **Parche de seguridad** para SmartBilling (la API respondía sin sesión).

## 17 oct 2026: documentación

- Documentación completa en `docs/` y README reorganizado.
- Análisis de la [integración con SmartBilling](./integracion-smartbilling.md).

## 19 oct 2026: proyecto en cinco pestañas

- De nueve pestañas a cinco: **Avances** (principal), **Plan de trabajo** (Tareas · Calendario de reuniones · Cronograma), **Documentación** (Archivos y Notas, con filtro compartido/interno), **Alcance y propuesta** y **Pagos**. La bitácora técnica se abre desde Avances. Los enlaces viejos (`?tab=notas`, etc.) siguen funcionando.
- **Generador de avances con IA:** el avance del día con enlaces a tareas y reuniones; **envío automático diario** a las 5:00 p. m. por proyecto.
- **Editor WYSIWYG** para avances y notas: negrita, cursiva, URL, listas, variables e *Insertar tarea/reunión*. Guarda Markdown.
- Avances *Solo equipo*, marca **Generado por IA**, vista previa y *Copiar enlace* a cada avance.

