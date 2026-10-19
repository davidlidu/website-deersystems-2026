# Propuestas y DeerSystems Partners

Un servidor Node atiende dos subdominios desde un solo contenedor y los distingue por el `Host`:

- **[propuestas.deersystems.net](https://propuestas.deersystems.net)**: publica las propuestas comerciales en HTML. Cada una tiene su enlace, guarda versiones y cuenta sus visitas.
- **[partners.deersystems.net](https://partners.deersystems.net)**: el portal de clientes.
  1. Aprobada la propuesta, la IA arma el proyecto: tareas, reuniones de avance y plan de pagos.
  2. Desde ahí se sigue todo: tareas con cronograma, reuniones con Meet y resumen con IA, archivos en Drive, avisos, y pagos que llegan al Gestor financiero.

📚 **Documentación completa: [`docs/`](./docs/README.md)**

## Qué hace

| Área | Resumen | Detalle |
|---|---|---|
| Propuestas | `.html` o `.zip` → `propuestas.deersystems.net/{slug}`. Reemplazar guarda versión; se puede restaurar. Visitas sin bots ni vistas previas | [propuestas](./docs/propuestas.md) |
| Aprobación | Opción A/B y ajustes → la IA propone cliente, alcance sin valores, fases, tareas, reuniones y pagos → **ajustar con IA** → vista previa del correo → crear y enviar la bienvenida | [aprobacion](./docs/aprobacion.md) |
| Proyectos | Cinco pestañas: **Avances** (generados con IA, envío diario automático, editor con enlaces a tareas y reuniones), Plan de trabajo (Lista, Tablero, Calendario, reuniones y **Cronograma (Gantt)**), Documentación, Alcance y propuesta, Pagos; **franja naranja** en las reuniones con el cliente | [proyectos-y-tareas](./docs/proyectos-y-tareas.md) |
| Reuniones | Agendar con Meet desde la plataforma → transcripción → resumen, acuerdos y tareas con IA → apruebas y se envía con la marca | [reuniones](./docs/reuniones.md) |
| Archivos | Google Drive por cliente y proyecto; selector de tu Drive; compartido o interno; ver y descargar | [archivos](./docs/archivos.md) |
| Pagos | Plan de pagos desde la propuesta (USD/COP); «Pagado» → abono e ingreso en el Gestor financiero, con USD convertido a la TRM oficial | [pagos-y-finanzas](./docs/pagos-y-finanzas.md) |
| Facturación | Cuentas de cobro (numeración de SmartBilling, PDF, envío por Gmail), abonos, estado de cuenta del cliente, reportes, pago en línea opcional (Wompi) e importador desde SmartBilling | [facturacion](./docs/facturacion.md) |
| Avisos | Campana con beep, correos agrupados; tú decides para todos y cada persona apaga los suyos | [avisos-y-tour](./docs/avisos-y-tour.md) |
| Tour | Recorrido guiado por rol, dentro de un proyecto real; «Terminar tour» no vuelve a salir | [avisos-y-tour](./docs/avisos-y-tour.md) |
| IA | Perfiles *Propuestas* y *Reuniones*, Gemini u OpenRouter, respaldo, solo privados, consumo y prueba | [ia](./docs/ia.md) |

## Roles

Menú del administrador: **Clientes** (y Reuniones) · **Propuestas** · **Facturación** · **Configuración** (y Equipo).

| Rol | Entra con | Ve |
|---|---|---|
| Administrador (`SUPERADMIN_EMAIL`) | Google | Todo |
| Equipo | Correo y contraseña | Clientes, proyectos, tareas, reuniones y archivos. **Nunca valores, propuesta, pagos ni facturación** |
| Cliente | Correo y contraseña | Solo sus proyectos e historial, su alcance, valores, pagos, cuentas de cobro y saldo. Solo mueve sus tareas, sin completarlas |

Los permisos se aplican en el servidor. Ver [roles y seguridad](./docs/roles-y-seguridad.md).

## Estructura

```
src/            Servidor (Node + node:sqlite, TypeScript sin build)
  server.ts     Propuestas; deriva a partners según el Host
  partners/     API del portal: rutas, trabajo, archivos, reuniones, pagos, avisos, IA del plan
public/         Panel de propuestas (sin build) y la interfaz de partners compilada
web/            Interfaz de partners (React 19 + Vite)
docs/           Documentación
```

Más en [arquitectura](./docs/arquitectura.md), [API](./docs/api.md) y [base de datos](./docs/base-de-datos.md).

## Desarrollo

```bash
cp .env.example .env   # PUBLIC_URL=http://localhost:3000, PARTNERS_URL=http://partners.localhost:3000, DEV_LOGIN=1
npm install
npm run dev            # servidor con recarga
npm run build:web      # compila web/ a public/partners
npm run typecheck
```

Con `DEV_LOGIN=1` se entra sin Google en `http://partners.localhost:3000/auth/dev`. Solo funciona en localhost y fuera de producción.

## Despliegue (Dokploy)

- **Dockerfile:** `propuestas/Dockerfile`, con contexto `propuestas` y Watch Paths `propuestas/**`.
- **Volumen** en `/data`, imprescindible.
- **Dominios:** `propuestas.` y `partners.` al puerto `3000`, con HTTPS.
- **Primer arranque:** entra con Google y, en Configuración, conecta Google, carga la IA y conecta el Gestor financiero.

Paso a paso, variables y respaldos en [despliegue](./docs/despliegue.md). Permisos de Google Cloud en [google](./docs/google.md).

## Migración desde SmartBilling

La facturación de SmartBilling (clientes, cuentas de cobro y abonos) ya vive aquí. Para pasar los datos: **Facturación → Importar de SmartBilling** (vista previa, coincidencias, cuadre por cliente). Mientras SmartBilling siga encendido, aplica [`docs/smartbilling-seguridad.patch`](./docs/smartbilling-seguridad.patch): su API respondía sin sesión. Paso a paso en [facturacion](./docs/facturacion.md#migración-desde-smartbilling).
