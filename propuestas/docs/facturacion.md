# Facturación: cuentas de cobro y abonos

Lo que antes vivía en SmartBilling, ahora en Partners. Está en **Facturación** (menú del administrador) y en la ficha de cada cliente.

Para persona natural no responsable de IVA, el documento de cobro es la **cuenta de cobro**, no la factura electrónica.

## Cuentas de cobro

- **Numeración:** continúa la de SmartBilling. El siguiente número es el mayor usado + 1, contando solo los dígitos, como en SmartBilling. Se puede cambiar a mano; nunca se repite.
- **Campos:**
  - Cliente y, opcionalmente, proyecto.
  - Fecha y fecha límite de pago (opcional; por defecto, la fecha + los *días para pagar* configurados).
  - Moneda: **COP**, o **USD con la TRM del día**. La TRM es la oficial y se puede corregir. El total en COP queda guardado: así cuadran los reportes y los saldos.
  - **Ítems:** descripción WYSIWYG (negrita, cursiva, subrayado, listas con viñetas o numeradas, **tablas** e **imágenes**: botón, pegar o arrastrar; se reducen a 900 px), cantidad, unidad y valor unitario. Al pegar desde Excel, Sheets o Word se conservan tablas, negritas y listas, sin estilos. Las imágenes van incrustadas en la cuenta de cobro; nunca se cargan de internet.
  - **Notas**, impresas debajo del total.
- **Desde una cuota del plan de pagos** (pestaña *Pagos* del proyecto → *Generar cuenta de cobro*):
  - Llega armada con el proyecto, el tipo de abono, el %, el monto, la moneda y la fecha.
  - La cuota queda ligada a su cuenta de cobro. Al marcarla pagada, el abono se aplica a esa cuenta de cobro.
- **Asociar una cuenta de cobro que ya existe:** en cada cuota, el selector *Cuenta de cobro* lista las del cliente. Sirve, por ejemplo, para una cuenta de cobro por el total pagada en cuotas (anticipo 50 % + saldo). Si la cuota ya estaba pagada, su abono pasa a esa cuenta de cobro y se actualiza en el Gestor.
- **El documento** sigue el formato de SmartBilling:
  - Logo y número.
  - Datos del cliente y del emisor.
  - Ítems y total (más TRM y equivalente en COP si es en USD).
  - Notas y **forma de pago**: datos bancarios y, debajo, el texto legal en letra pequeña, con el QR grande a la derecha para que se lea desde el celular.
  - Firma y pie con los datos del emisor.
  - Siempre en blanco. En celular se reduce para caber.
  - **PDF en A4 sin reducir el contenido.** Si no cabe en una página, la forma de pago, la firma y el pie pasan juntos a la siguiente. Con muchos ítems se corta entre filas, o entre párrafos y filas de una tabla dentro de un ítem muy largo; nunca a la mitad de una línea.
- **Acciones:**
  - **Descargar PDF**: se genera en el navegador, como en SmartBilling.
  - **Enviar al cliente**: a uno o varios correos (y copia para ti si quieres). Puedes sumar **archivos adicionales**: desde **Drive** van como enlace en el correo (se comparten como «cualquiera con el enlace», solo lectura) y no se cargan a la app; desde el computador van adjuntos (máx. 5 y 15 MB) y no se guardan en Partners. El correo lleva la marca, el PDF adjunto, tus datos de pago, el **QR de pago** (como imagen en línea, que Gmail sí muestra) y el botón *Pagar en línea* si activaste Wompi para esa cuenta de cobro. El saludo usa el nombre del contacto, o la razón social si no hay contacto.
  - **Registrar abono**, **Editar**.
  - **Anular**: deja de contar en el saldo y el número queda usado.
  - **Borrar**: solo si no tiene abonos aplicados.
- **Estado:** *Pendiente*, *Abono parcial*, *Pagada* (cuando los abonos aplicados a ella la cubren) o *Anulada*. Las importadas de SmartBilling no traen esa relación: allá los pagos eran del cliente, no de cada cuenta de cobro. Por eso su saldo se ve en la ficha del cliente.

- **Filtros** en la lista: estado, búsqueda y fecha (un día, un mes o un rango), con la cantidad y el total de lo filtrado.

## Abonos

Un abono es lo que entró. Va **ligado al cliente** (como en SmartBilling) y, si quieres, a un proyecto y a una cuenta de cobro.

- **Campos:** fecha, monto, moneda, medio (transferencia, QR, Nequi, PSE, efectivo…) y notas con el detalle del pago.
- **Ver el detalle:** clic en un abono (en *Facturación → Abonos* o en la ficha del cliente) para abrir sus notas, la fecha, el medio, la conversión si es en USD, a qué se aplicó, el origen, el comprobante y su estado en el Gestor con la descripción del ingreso.
- **Editar** (desde el detalle o con ✎), también los importados de SmartBilling: fecha, monto, medio, cuenta de cobro, notas y la **descripción en el Gestor**. Al guardar se actualiza el mismo ingreso en el Gestor (misma referencia, no se duplica). Si dejas la descripción vacía, Partners la arma con el proyecto, la cuenta de cobro y las notas. Los abonos de cuotas del plan se editan desde la pestaña *Pagos* del proyecto.
- **Enviar al Gestor financiero** (interruptor, encendido por defecto): apágalo si ese abono no debe quedar como ingreso. Sigue contando para el saldo del cliente. Si ya estaba en el Gestor, se quita; si el Gestor no responde, queda con *⚠ Reintentar*. En la lista se ve como *No se envía*.
- **En USD:** la TRM del día y los pesos recibidos, que se pueden corregir.
- **Gestor financiero:** cada abono es un ingreso (`PUT /integrations/billing-payment/{referencia}`), con la categoría = cliente y la descripción = proyecto, tipo de abono o cuenta de cobro.
  - Editar el abono actualiza el ingreso; borrarlo lo quita. Si el Gestor no responde, el abono queda con *⚠ Reintentar*.
- **Filtros:** búsqueda y fecha (un día, un mes o un rango), con el total de lo filtrado.
- **Unir varios pagos en una sola entrada del Gestor** (por ejemplo, dos cuotas que el cliente pagó en una sola transferencia):
  - En *Facturación → Abonos*, marca la casilla de cada abono; en la pestaña *Pagos* del proyecto, usa **Pago conjunto**.
  - **Cuotas pendientes (pago conjunto):** en *Pagos → Pago conjunto* eliges las cuotas que se pagaron juntas y escribes la fecha, la TRM (si hay cuotas en USD; viene la oficial del día) y el **total recibido en COP**. El total se reparte entre las cuotas en proporción a lo que vale cada una (USD × TRM o COP); el último lleva el ajuste del redondeo y la lista muestra cuánto le queda a cada una antes de registrar. Las cuotas quedan pagadas y al Gestor va **un solo ingreso** por el total. No se mezclan pendientes y pagadas en la misma selección.
  - La barra muestra cuántos van y la suma. Eliges la fecha de la entrada (por defecto, la del pago más reciente) y, si quieres, la descripción; si la dejas vacía, se arma con lo de cada pago, separado por « + ».
  - Solo se unen pagos del **mismo cliente** que se envían al Gestor. Si uno ya estaba en otra entrada unida, esa se suma a la nueva.
  - En el Gestor se borran los ingresos sueltos y queda **un solo ingreso** por la suma (referencia `deersystems-grupo-{uuid}`). En Partners cada abono sigue igual: su cuota, su cuenta de cobro y el saldo.
  - Se ven con la etiqueta *Unida*. El detalle del abono lista los pagos de la entrada y tiene **Separar la entrada**: cada pago vuelve a ser su propio ingreso.
  - Si editas, borras o desmarcas uno de esos pagos, la entrada se recalcula; si queda uno solo, se separa sola.
- **Las cuotas del plan de pagos** también son abonos: se crean al marcarlas pagadas y se editan desde la pestaña *Pagos* del proyecto.
- **Referencias en el Gestor:**

  | Origen | Referencia |
  |---|---|
  | Cuota del plan | `deersystems-pago-{id}` (la de siempre) |
  | Abono manual | `deersystems-abono-{uuid}` |
  | Pago en línea | `deersystems-wompi-{transacción}` |
  | Importado de SmartBilling | El UUID que ya tenía allá |
  | Entrada unida (varios abonos) | `deersystems-grupo-{uuid}` |

## Estado de cuenta

- **En la ficha del cliente** (administrador): facturado, abonado, saldo (o saldo a favor), sus cuentas de cobro y sus abonos, con botones para crear una cuenta de cobro o registrar un abono.
- **Datos de facturación** en la misma ficha: razón social, NIT/CC/CE, ciudad, dirección, teléfono y correo.
- **El cliente**, en su inicio, ve *Mi estado de cuenta*:
  - Lo facturado, lo pagado y su saldo.
  - Sus cuentas de cobro, que puede ver y descargar.
  - **Cómo pagar**: datos bancarios y QR.
- **En la pestaña *Pagos* de cada proyecto,** el cliente también ve las cuentas de cobro de ese proyecto.

## Clientes solo de facturación

Hay clientes que no entran al portal, como los importados de SmartBilling, que no traían correo. Existen igual, con sus cuentas de cobro y abonos.

- Se crean desde la cuenta de cobro: *+ Cliente nuevo (solo facturación)*.
- **Dar acceso al portal**, en su ficha: les crea la cuenta y les envía la contraseña.
- **Al aprobar una propuesta** para uno de ellos, se pide el correo de acceso.

## Reportes

Son las mismas cifras de SmartBilling: cuentas de cobro (total en COP, sin anuladas) y abonos.

- **Filtros:** año y cliente.
- **Indicadores:** facturado total, total pagado, saldo pendiente y clientes.
- **Facturado y pagado por mes**, con tooltip y tabla mensual de cuentas, facturado, pagado y pendiente.
- **Mejores clientes**, histórico.
- **Exportar CSV** por período: hoy, semana, mes, 3 o 6 meses, año o personalizado.

> SmartBilling ubicaba en el mes anterior lo fechado el día 1: leía las fechas como UTC y en Colombia se corrían un día. Aquí se usa la fecha tal cual. Los totales y los saldos son iguales; solo puede cambiar en qué mes aparece algo fechado el 1.

## Datos del emisor

En *Configuración → Finanzas → Datos de la cuenta de cobro*:

- Nombre, documento, régimen, dirección, ciudad, celular y correo.
- **Forma de pago** (texto) y **QR de pago**: Bre-B, Bancolombia, Nequi…
- **Texto legal**: por ejemplo, el del art. 616-2 del ET. Sale en letra pequeña debajo de la forma de pago, solo en la cuenta de cobro (no en el portal ni en el correo).
- Logo, firma y nombre/documento de quien firma.
- Notas por defecto y días para pagar.

Las imágenes se guardan en la base (máx. 1,5 MB cada una).

## Pago en línea (opcional, apagado por defecto)

Todas las pasarelas cobran comisión, también por PSE. La transferencia o el QR a tu cuenta (con Bre-B, el QR interbancario) no cobran nada. Por eso **lo normal es la transferencia**, y el pago en línea se activa **solo en la cuenta de cobro de un cliente que lo pida**.

- **Proveedor: Wompi.** Según comparativas de 2026, es la tarifa más baja: ≈2,65 % + $700 + IVA. Acepta PSE, Nequi, botón Bancolombia y tarjetas. Confirma la tarifa vigente en su sitio.
- **Configuración** (*Configuración → Finanzas → Pago en línea*):
  - Encender la opción.
  - Ambiente: pruebas o producción.
  - Llave pública, llave privada y secreto de eventos (cifrados).
  - La **URL de eventos**, que se configura en el panel de Wompi: `https://partners.deersystems.net/api/webhooks/wompi`.
- **En la cuenta de cobro:** *Activar pago en línea* crea un **link de pago de un solo uso por el saldo**, en COP. El cliente lo ve como **Pagar en línea**, en el portal y en el correo.
- **Cuando Wompi aprueba el pago:**
  - El webhook llega firmado (SHA-256 con el secreto de eventos) y se rechaza si la firma no coincide.
  - Se crea el abono aplicado a esa cuenta de cobro (medio «Wompi · PSE», por ejemplo) y se envía al Gestor.
  - El link se cierra y te llega el aviso *Llega un pago en línea*.
  - Si el evento se repite, no se duplica nada.
- El abono se registra por el **valor bruto** que pagó el cliente. La comisión de Wompi es un gasto aparte en tu Gestor.

## Migración desde SmartBilling

En **Facturación → Importar de SmartBilling**:

1. **Leer los datos:** URL de su API (`https://api.facturador.lidutech.net/api`) y, si ya la protegiste, la clave `EXPORT_API_KEY`. También se puede subir un JSON con `{ clients, invoices (con lineItems), payments, profile }`.
2. **Revisar:**
   - Totales y posibles problemas, como números que chocan o pagos de clientes que no vinieron.
   - Para cada cliente de SmartBilling, si es uno que **ya existe aquí** o uno **nuevo**. Se sugiere solo: por NIT/CC, por nombre normalizado (sin tildes ni S.A.S./LTDA) o *nombre parecido: revisa*.
   - Si usas su perfil de remitente.
3. **Importar** (idempotente: repetirla no duplica):
   - Los clientes nuevos quedan solo para facturación.
   - Las cuentas de cobro se traen con su total en COP original y sus ítems con formato (saneados), incluidas sus tablas.
   - Si ya importaste antes, marca *Volver a traer los ítems…* para recuperar las tablas y el formato de esas cuentas de cobro, sin tocar totales ni abonos.
   - Los pagos se traen como abonos, con su referencia, categoría y descripción del Gestor: «Abono factura - Cliente». No se reenvían, porque ya están allá.
4. **Cuadre:** por cliente, lo facturado, pagado y el saldo en SmartBilling contra Partners. **Debe dar ✓ en todos.**
5. **Terminar el cambio:**
   - Quitar `GESTOR_API_URL` y `GESTOR_SERVICE_KEY` del backend de SmartBilling.
   - Dejarlo en solo lectura uno o dos meses.
   - Apagarlo, con un respaldo de su base.

### Seguridad de SmartBilling (mientras siga encendido)

Su API respondía sin sesión. [`smartbilling-seguridad.patch`](./smartbilling-seguridad.patch) lo corrige:

- **Backend:** exige el token en todas las rutas salvo el login.
- **Login:** deja de devolver el hash de la contraseña.
- **Frontend:** envía el token en cada petición y conserva la sesión al recargar.
- **Exportación:** acepta `EXPORT_API_KEY` solo para lecturas, para la importación.

Para aplicarlo:

```bash
cd SmartBilling-App && git apply ../smartbilling-seguridad.patch
```

En Dokploy, define `JWT_SECRET` (si no, usa uno por defecto inseguro) y, para importar, `EXPORT_API_KEY`. Quítala al terminar.

**Orden sugerido:** importar primero, aprovechando que la API aún responde, y luego aplicar el parche. O aplicar el parche ya y usar `EXPORT_API_KEY` en la importación.
