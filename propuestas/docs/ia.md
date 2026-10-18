# Inteligencia artificial

Todo pasa por `src/ai.ts`: `complete()` / `completeJson()` con un **perfil**, un **propósito** (para el consumo), el prompt del sistema y el del usuario.

## Perfiles

| Perfil | Se usa en | Recomendación |
|---|---|---|
| **Propuestas** | Detectar opciones A/B, armar el plan, ajustar el plan, sugerir pagos | Puede ir a modelos gratuitos o que entrenan con datos: la propuesta y los valores son tuyos |
| **Reuniones** | Resumen, acuerdos y tareas a partir de la transcripción | Dejarlo **privado**: lleva lo que dice el cliente |

Cada perfil tiene:
- **Un modelo principal y uno de respaldo**, de Gemini u OpenRouter. Si el principal falla, se intenta el de respaldo, y si los dos fallan, el error muestra ambos motivos.
- **Solo proveedores privados** (OpenRouter): envía `provider.data_collection: "deny"`, así que solo responden proveedores que no guardan ni entrenan con los datos. Algunos modelos `:free` no tienen proveedor privado; en ese caso OpenRouter devuelve un error que la pantalla explica.

El valor por defecto de los dos perfiles es `gemini-flash-latest`.

## Proveedores

- **Gemini:** `generateContent` con `x-goog-api-key`, en modo JSON cuando se pide JSON.
- **OpenRouter:** `chat/completions`. La pantalla lista los modelos disponibles con su precio y marca los gratuitos.
- **Las claves** se guardan cifradas desde *Configuración → IA*. Las variables `GEMINI_API_KEY` / `OPENROUTER_API_KEY` sirven de respaldo; si cargas una clave en el panel, esa manda.

## Prueba de conexión

*Probar* hace una llamada real y corta al modelo principal o al de respaldo de cada perfil, respetando la opción de solo privados. Muestra si respondió, cuánto tardó y el error si lo hubo.

## Consumo

- Cada llamada queda en `ai_usage`: fecha, proveedor, modelo, propósito, tokens de entrada y salida, costo en USD, latencia y error.
- *Configuración → Consumo de IA* muestra costo, tokens y llamadas por modelo y por día de los últimos 30 días, además del saldo y los límites de la clave de OpenRouter.
- El costo de Gemini se calcula con la **tarifa por millón de tokens** que configuras; viene precargada para Flash y conviene ajustarla con la vigente. OpenRouter informa el costo real.
- El **presupuesto mensual** (5 USD por defecto) es una referencia que se compara con el gasto en la pantalla de consumo. **No bloquea llamadas.**

## Qué le pide la plataforma a la IA

| Propósito | Archivo | Entrada | Salida |
|---|---|---|---|
| Opciones | `extract.ts` `detectOptions` | Texto de la propuesta | Alternativas excluyentes (nombre, resumen, precio) |
| Plan | `extract.ts` `extractDraft` | Propuesta, opción aprobada, ajustes y fecha de hoy | Cliente, alcance sin valores, valores, fases, tareas, reuniones de avance y pagos |
| Ajuste del plan | `extract.ts` `adjustPlan` | Plan en pantalla, instrucción y alcance | Plan completo ajustado y lista de cambios |
| Pagos | `payments.ts` `suggestPayments` | Valores del proyecto, fechas, opción y ajustes | Pagos (tipo, %, monto, moneda, fecha) |
| Reunión | `meetings.ts` | Transcripción y asistentes | Resumen en Markdown, acuerdos, tareas por parte |

**Todo lo que devuelve la IA se valida** (`normalizeDraft`, `normalizePayment`…):
- Recorta textos largos.
- Descarta fechas inválidas, tareas sin título y pagos sin monto.
- Lleva el lado de cada tarea a `deersystems` o `cliente`.
- Ubica cada reunión en una fase existente.
- Advierte si el alcance o una tarea menciona valores.
