# Pagos y Gestor financiero

## El plan de pagos

- **Al aprobar la propuesta,** la IA lee los valores y la forma de pago de la opción aprobada y propone los pagos: anticipo, cuotas, contra entrega o mensualidades. Las fechas van coherentes con el cronograma. Se revisan en la sección **Pagos** de la aprobación.
- **En el proyecto,** la pestaña **Pagos** lista cada pago con estos campos: **tipo de abono**, **%** del total, **monto**, **moneda** (USD o COP) y **fecha de pago**.
  - Todo se edita en la misma fila y se guarda al salir del campo.
  - **+ Pago** agrega uno a mano.
  - **Sugerir desde la propuesta (IA)** vuelve a leer los valores guardados del proyecto y propone una lista para revisar antes de agregarla.
- **Arriba aparecen los totales por moneda:** total, pagado y pendiente, con una barra.
- **Estados:** Pendiente, **Vencido** (pasó la fecha sin pagarse) y *Pagado el…*.

| Quién | Qué puede |
|---|---|
| Tú | Todo |
| Cliente | Ver tipo, %, monto, fecha y estado. No ve los pesos recibidos, la TRM ni el estado de sincronización |
| Equipo | No ve la pestaña ni la API (403) |

## Marcar como pagado → Gestor financiero

La casilla **Pagado** abre un recuadro con estos datos:

- **Fecha del pago.** Por defecto, hoy.
- **Si es en USD:** la **TRM** del día (oficial, de datos.gov.co) y los **pesos recibidos**, calculados como monto × TRM. Los dos se editan, para registrar lo que realmente llegó a la cuenta.

**Registrar pago** marca la cuota como pagada y crea su **abono** (ver [Facturación](./facturacion.md)), que es el que va al Gestor financiero como **ingreso**. Si la cuota generó una cuenta de cobro, el abono queda aplicado a ella:

```http
PUT {URL}/integrations/billing-payment/deersystems-pago-{id}
x-api-key: {SERVICE_API_KEY}

{ "amount": 3000000, "date": "2026-10-14", "clientName": "Panadería La Espiga",
  "description": "Tienda en línea — Anticipo · 50%", "paymentMethod": "transfer" }
```

- **Categoría:** el Gestor usa `clientName` como categoría de ingreso y la crea si no existe. Es la empresa del cliente.
- **Descripción:** proyecto — tipo de abono · %. En USD se agrega, por ejemplo, «USD 1.500 a TRM 4.000,5».
- **Monto:** siempre en **COP**, porque el Gestor no maneja moneda. En USD se envían los pesos recibidos.
- **Idempotente:** se usa `PUT`, que en el Gestor crea o actualiza, con una referencia fija por pago. Reintentar nunca duplica.

| Acción en el portal | En el Gestor |
|---|---|
| Marcar pagado | Crea el ingreso |
| Editar un pago ya pagado (monto, tipo, %) | Actualiza el ingreso |
| Desmarcar | Borra el ingreso |
| Borrar el pago | Primero borra el ingreso; si el Gestor falla, el pago no se borra, para no dejar un ingreso huérfano |

Cada cuota tiene además **Generar cuenta de cobro**: abre la cuenta de cobro ya armada y la deja ligada. La pestaña también lista las cuentas de cobro del proyecto y, para el cliente, *Cómo pagar*.

Si el Gestor no responde o rechaza la clave, el pago queda marcado igual y muestra **⚠ No se registró en el Gestor** con **Reintentar**. Los pagos marcados antes de conectar el Gestor muestran **Registrar**.

## Configuración

En *Configuración → Finanzas*:

- **URL de la API:** por defecto `https://api.finanzas.lidutech.net/api`. `finanzas.lidutech.net` solo sirve la página web; la API vive en `api.`.
- **Clave de servicio:** la variable `SERVICE_API_KEY` del servicio del Gestor en Dokploy. Se guarda cifrada.
- **Estado:** al abrir la pantalla se comprueba la conexión y se muestra *● Conectado* u *○ Sin conectar* con el motivo.
- **Probar conexión:** borra una referencia que no existe (`deersystems-prueba-conexion`). Es inofensivo y confirma la URL y la clave.

## Límites del Gestor a tener en cuenta

- **Solo pesos.** Por eso los pagos en USD se convierten.
- **La columna `amount` es `NUMERIC(10,2)`:** como máximo unos 99.999.999 COP por ingreso. Un pago mayor sería rechazado, y habría que ampliar esa columna en el Gestor.
- **`paymentMethod`** solo acepta `transfer` o `cash`. El portal envía `transfer`.
