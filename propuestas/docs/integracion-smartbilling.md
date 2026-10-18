# Integración con SmartBilling: análisis y plan

> **Estado: implementado.** Con tus decisiones (persona natural, cuenta de cobro; clientes importados sin acceso; reportes y abonos tal cual; misma numeración; pago en línea opcional). Cómo funciona y cómo hacer la migración: [Facturación](./facturacion.md).

**Objetivo:** tener en **un solo lugar** todo lo que tiene que ver con cada cliente: propuesta, proyecto, cuentas de cobro, pagos y lo que entra al Gestor financiero. Hoy eso está repartido en tres sistemas.

## 1. Situación actual

| Sistema | Qué guarda | Stack |
|---|---|---|
| **Partners** (este) | Propuestas, clientes con acceso, proyectos, tareas, reuniones, archivos, **plan de pagos por proyecto** | Node + SQLite, `partners.deersystems.net` |
| **SmartBilling** | Clientes de facturación (NIT/CC, ciudad, dirección), **cuentas de cobro** con ítems (COP o USD con TRM), **pagos por cliente**, perfil del remitente (NIT, banco, firma) | React + Express + MySQL, `facturador.lidutech.net` / `api.facturador.lidutech.net` |
| **Gestor financiero** | Ingresos y gastos (solo COP) | React + Express + Postgres, `api.finanzas.lidutech.net` |

Tanto SmartBilling como Partners envían ingresos al Gestor por el mismo endpoint (`/integrations/billing-payment/:referencia`). Solo cambia la referencia:

| Origen | Referencia en el Gestor |
|---|---|
| SmartBilling | El UUID del pago |
| Partners | `deersystems-pago-{id}` |

### Cómo está modelado SmartBilling (leído del código)

- **`clients`:** `id` (UUID), `nitOrCc` (único), `name`, `city`, `phone`, `address`. **No tiene correo.**
- **`invoices`:**
  - Campos: `invoiceNumber` (único), `date`, `clientId`, `notes` (texto enriquecido: datos bancarios, condiciones), `currency` (COP/USD), `exchangeRate`, y `totalAmount` (**siempre en COP**).
  - Cada cuenta de cobro tiene sus ítems en **`line_items`**: `description`, `quantity`, `unit` y `unitPrice`.
- **`payments`:** `clientId`, `amount`, `date`, `method`, `notes`, `proofUrl`.
  - **Van ligados al cliente, no a una cuenta de cobro.** El saldo de un cliente es el total de sus cuentas de cobro menos sus pagos.
  - Al crear, editar o borrar un pago, se sincroniza con el Gestor en *best-effort*: si falla, solo queda en el log.
- **`sender_profile`:** nombre, NIT, tipo (persona natural), logo, dirección, teléfono, correo, datos bancarios y firma (nombre, CC e imagen).

### ⚠️ Antes de cualquier cosa: seguridad de SmartBilling

Revisando el código encontré dos problemas que conviene corregir **ya**, aunque después se migre:

1. **La API no exige sesión.** Las rutas `/api/clients`, `/api/invoices`, `/api/payments` y `/api/settings` no tienen middleware de autenticación: el login emite un token, pero ninguna ruta lo verifica. La comprobé con una petición inofensiva: `GET https://api.facturador.lidutech.net/api/invoices/next-number` responde **200 sin token**.
   - Por la misma vía, cualquiera que conozca la URL podría leer o modificar clientes (NIT/CC, teléfonos, direcciones), cuentas de cobro y pagos.
   - Peor aún: un pago creado así **se registraría como ingreso en el Gestor**.
   - El CORS no protege: solo lo respetan los navegadores.
2. **El login devuelve el objeto `user` completo**, incluido el hash de la contraseña.

**Arreglo mínimo:**
- Un middleware `jwt.verify` en todas las rutas salvo `/api/auth/login`.
- Responder solo `{ id, username }` en el login.
- Si el repositorio es público, rotar `JWT_SECRET` y `GESTOR_SERVICE_KEY`.

## 2. Cómo lo resuelven otras agencias de software

Las herramientas que usan las agencias (Productive, Accelo, Scoro, SuiteDash, Bonsai, HoneyBook, Assembly) siguen el mismo patrón, conocido como *quote-to-cash*:

1. **Un solo registro de cliente** del que cuelga todo: contactos, propuestas, proyectos, facturas, pagos y archivos. Esa es la *ficha 360* del cliente.
2. **La propuesta aprobada se convierte** en proyecto **y** en **plan de facturación**: anticipo, hitos, contra entrega o mensualidad (*retainer*). Las facturas o cuentas de cobro salen de ese plan cuando llega cada hito, no se arman a mano desde cero.
3. **Facturas y pagos se separan.**
   - La factura es lo que se cobra.
   - El pago (abono) es lo que entra, y se **aplica** a una o varias facturas.
   - El saldo del cliente es el *estado de cuenta*.
4. **El cliente ve y paga en su portal:** sus facturas, su saldo, el PDF y un botón de pago en línea. El pago se concilia solo (webhook).
5. **Recordatorios automáticos** antes y después del vencimiento.
6. **La contabilidad y la facturación legal viven aparte** y se sincronizan en una sola dirección. La herramienta de la agencia es la fuente de verdad operativa:
   - Afuera usan QuickBooks o Xero.
   - En Colombia, Alegra o Siigo para la **factura electrónica DIAN**.

En Colombia hay un matiz:
- **La cuenta de cobro** sirve como soporte para la persona natural **no responsable de IVA** (art. 616-2 del Estatuto Tributario).
- **La factura electrónica** es obligatoria para todo responsable de IVA. En 2026, quien supere 3.500 UVT de ingresos (unos $183 millones) deja de ser no responsable.

Por eso conviene diseñar el documento de cobro con un **tipo** (`cuenta_cobro` o `factura_electronica`). Si el día de mañana hay que facturar electrónicamente, se conecta un proveedor autorizado sin rehacer nada. Confirma tu caso con tu contador.

## 3. Opciones

| Opción | Cómo | A favor | En contra |
|---|---|---|---|
| **A. Migrar SmartBilling a Partners** (recomendada) | Partners incorpora clientes de facturación, cuentas de cobro, abonos y el perfil del remitente. Se importa todo y se retira SmartBilling | Una sola fuente de verdad; el cliente ve sus cuentas de cobro y saldo en su portal; las cuentas de cobro salen del plan de pagos; un solo login, una sola base y un solo despliegue | Hay que construir la sección de facturación y el PDF (unos días) |
| B. Integrar por API | Partners lee y escribe clientes y pagos en SmartBilling | Menos trabajo inicial | Dos fuentes de verdad, conflictos de edición y duplicados en el Gestor; depende de una API que hoy no tiene autenticación |
| C. Llevar Partners a SmartBilling | — | — | SmartBilling es mucho más pequeño; no tiene sentido |

**Recomendación: opción A.** Partners ya tiene lo difícil: clientes con acceso, proyectos, plan de pagos desde la propuesta, Drive, Gmail y la sincronización con el Gestor. A SmartBilling le aporta lo que le falta (portal del cliente, proyectos, IA) y de SmartBilling solo hay que traer el modelo de cobro.

## 4. Diseño en Partners

### Modelo de datos

```
clients ─┬─ projects ─── payments (plan: cuotas pactadas) ──┐ genera
         │                                                   ▼
         ├─ invoices (cuentas de cobro) ── invoice_items     │
         │        ▲                                          │
         │        └── payment_allocations ──┐                │
         └─ receipts (abonos recibidos) ────┘ → Gestor financiero
```

| Cambio | Detalle |
|---|---|
| `clients` + columnas | `doc_type` (NIT/CC/CE/pasaporte), `doc_number` (único si existe), `city`, `address`, `billing_email` y `sb_id` (UUID de origen, para que la importación sea idempotente). **El correo de acceso pasa a ser opcional:** un cliente de facturación sin acceso al portal existe igual y se le crea la cuenta cuando haga falta |
| `invoices` | `id`, `client_id`, `project_id` (opcional), `number` (único), `kind` (`cuenta_cobro` / `factura_electronica`), `date`, `due_date`, `currency`, `exchange_rate`, `total_cop`, `notes`, `status` (borrador, emitida, pagada parcial, pagada, anulada), `pdf_drive_id`, `sent_at`, `sb_id` |
| `invoice_items` | `invoice_id`, `description`, `quantity`, `unit`, `unit_price`, `position` |
| `receipts` (abonos) | `client_id`, `project_id` (opcional), `amount_cop`, `amount` y `currency` originales, `trm`, `date`, `method`, `notes`, `proof_attachment_id` (Drive), `finance_ref`, `sync_status`, `sb_id` |
| `payment_allocations` | `receipt_id`, `invoice_id`, `amount`: un abono puede cubrir varias cuentas de cobro |
| `payments` (el plan actual) | Se agrega `invoice_id`: cada cuota pactada **genera** su cuenta de cobro. «Marcar pagado» registra un **abono** aplicado a esa cuenta de cobro |
| `settings.billing_profile` | El perfil del remitente de SmartBilling. Logo y firma, en Drive o en `/data` |

**La clave para no duplicar en el Gestor:**
- `receipts.finance_ref` guarda la referencia con la que el ingreso ya existe en el Gestor.
- En los abonos importados, es el **mismo UUID que usaba SmartBilling**. Así, al editarlos desde Partners, se actualiza el mismo ingreso en vez de crear otro.
- En los nuevos, sigue siendo `deersystems-pago-{id}`.

### Pantallas

- **Clientes → ficha del cliente:**
  - Datos de facturación.
  - Proyectos.
  - Cuentas de cobro.
  - Abonos.
  - **Estado de cuenta:** facturado, pagado y saldo, por moneda y en COP.
- **Facturación** (nueva sección del menú):
  - Todas las cuentas de cobro, con filtros por estado y vencidas.
  - **Nueva cuenta de cobro**, en blanco o desde una cuota del plan de pagos de un proyecto, con los ítems ya llenos.
  - Numeración que continúa la de SmartBilling.
  - **PDF** con el diseño actual de SmartBilling (remitente, firma, datos bancarios). Se guarda en Drive y se **envía por Gmail** con la marca.
- **El cliente en su portal:** pestaña *Pagos* con sus cuentas de cobro (PDF), sus abonos y su saldo.
- **Abonos:** registrar un abono (con comprobante en Drive) y aplicarlo a una o varias cuentas de cobro. Al registrarlo, va al Gestor.

## 5. Migración

Se migra **una sola vez**, con un importador que se puede repetir sin duplicar (idempotente por `sb_id`).

1. **Asegurar SmartBilling** (sección 1) y ponerlo en solo lectura: no crear ni editar más durante la migración.
2. **Exportar:** un `mysqldump` de `clients`, `invoices`, `line_items`, `payments` y `sender_profile`, o un JSON desde la API ya autenticada.
3. **Simulacro:** `npm run import:smartbilling -- export.json --dry-run` genera un informe con:
   - **Clientes:** cuáles se unen a uno existente en Partners, por NIT o por nombre normalizado (por ejemplo «Panadería La Espiga» = «PANADERIA LA ESPIGA S.A.S.»), y cuáles quedan nuevos. Los dudosos se marcan para que **los confirmes tú**.
   - **Cuentas de cobro, ítems y abonos:** cuántos se importan.
   - **Totales por cliente**, facturado y pagado, para cuadrarlos contra SmartBilling.
4. **Importar** con el informe aprobado:
   - Los abonos llegan **sin aplicar** a ninguna cuenta de cobro, porque en SmartBilling no lo estaban. El saldo por cliente queda igual.
   - Opcionalmente, se aplican en orden de antigüedad (FIFO) para marcar qué cuentas de cobro quedaron pagadas.
   - Los comprobantes (`proofUrl`) se copian a la carpeta de Drive del cliente.
5. **Verificar:** el informe compara, cliente por cliente, el saldo en SmartBilling con el saldo en Partners. **Deben coincidir al peso.**
6. **Cambiar el origen del Gestor:**
   - Quitar `GESTOR_API_URL` y `GESTOR_SERVICE_KEY` del backend de SmartBilling, para que no pueda volver a escribir.
   - Desde ahí, solo Partners sincroniza. Los ingresos viejos siguen siendo los mismos, porque se conservan sus referencias.
7. **Convivencia:** dejar SmartBilling en solo lectura uno o dos meses como respaldo, y luego apagarlo. Antes, guardar el dump.

### Mapeo de campos

| SmartBilling | Partners |
|---|---|
| `clients.nitOrCc` | `clients.doc_number` (+ `doc_type` deducido: con dígito de verificación → NIT) |
| `clients.name` · `city` · `phone` · `address` | `name` · `city` · `phone` · `address` |
| `clients.id` | `clients.sb_id` |
| `invoices.invoiceNumber` · `date` · `notes` | `invoices.number` · `date` · `notes` |
| `invoices.currency` · `exchangeRate` · `totalAmount` | `currency` · `exchange_rate` · `total_cop` |
| `line_items.*` | `invoice_items.*` |
| `payments.amount` · `date` · `method` · `notes` | `receipts.amount_cop` · `date` · `method` · `notes` |
| `payments.id` | `receipts.sb_id` **y** `receipts.finance_ref` |
| `payments.proofUrl` | Archivo en Drive → `proof_attachment_id` |
| `sender_profile.*` | `settings.billing_profile` |

## 6. Plan por fases

| Fase | Qué | Esfuerzo aprox. |
|---|---|---|
| 0 | Cerrar la API de SmartBilling y rotar claves | ½ día |
| 1 | Modelo de datos en Partners: clientes extendidos, cuentas de cobro, ítems, abonos, aplicación, perfil del remitente | 1 día |
| 2 | Facturación en Partners: lista, crear desde cuota o en blanco, PDF, envío por Gmail, abonos con comprobante, sincronización con el Gestor, ficha y estado de cuenta del cliente | 3–4 días |
| 3 | Importador con simulacro, informe de cuadre y confirmación de clientes dudosos | 1–2 días |
| 4 | Corte: importar, cuadrar, apagar la sincronización de SmartBilling, solo lectura | ½ día |
| 5 (opcional) | Pagos en línea con link de Wompi, Bold o Mercado Pago y conciliación automática por webhook; recordatorios de vencimiento; factura electrónica con Alegra, Siigo o Factus si llegas a ser responsable de IVA | según alcance |

## 7. Decisiones que necesito de ti

1. **¿Facturas como persona natural no responsable de IVA (cuenta de cobro)?** ¿O ya necesitas factura electrónica? Esto define si la fase 5 entra o no.
2. **Clientes de SmartBilling sin correo:** ¿se importan solo como clientes de facturación, sin acceso al portal hasta que les crees la cuenta? Es lo recomendado.
3. **Abonos viejos:** ¿se dejan sin aplicar (el saldo cuadra igual) o se aplican por antigüedad a las cuentas de cobro?
4. **Numeración:** ¿se continúa el consecutivo de SmartBilling (la recomendación) o empieza uno nuevo con prefijo?
5. **Pagos en línea:** ¿te interesa que el cliente pague desde el portal? ¿Con qué pasarela?
