# Base de datos

Un solo archivo SQLite (`DATA_DIR/propuestas.sqlite`, modo WAL). Las tablas se crean y migran solas al arrancar:
- `CREATE TABLE IF NOT EXISTS`.
- `addColumn` para las columnas nuevas.

No hay migraciones que correr a mano. La de `clients` (correo opcional) reconstruye la tabla con las llaves foráneas apagadas para no tocar proyectos, y verifica `PRAGMA foreign_key_check`. Las importaciones de SmartBilling se guardan como instantánea en `DATA_DIR/imports/`.

## Propuestas

| Tabla | Columnas |
|---|---|
| `proposals` | id, slug, title, filename, has_assets, version, size, active, views, last_viewed_at, created_at, updated_at, updated_by |
| `proposal_versions` | id, proposal_id, version, filename, has_assets, size, note, created_at, created_by |
| `users` | email, added_by, created_at (correos autorizados en el panel clásico) |

## Portal

| Tabla | Columnas | Notas |
|---|---|---|
| `clients` | id, name, contact_name, email (opcional), phone, doc_type, doc_number, city, address, sb_id, created_at, drive_folder_id | Una empresa o persona cliente. Sin `email` = solo facturación (sin acceso) |
| `accounts` | id, email, name, role (`team`/`client`), client_id, password_hash, active, session_version, last_login_at, created_at, notify_prefs, tour_done | Cuentas con contraseña. El administrador no tiene cuenta: entra con Google |
| `password_resets` | token_hash, account_id, expires_at, used | Enlaces de recuperación (hash, 1 h) |
| `projects` | id, client_id, proposal_id, name, scope, pricing, status, start_date, end_date, approved_at, approved_by, approved_option, approval_notes, drive_folder_id, auto_updates, created_at, updated_at | `pricing` nunca sale hacia el equipo |
| `phases` | id, project_id, name, position | |
| `tasks` | id, project_id, phase_id, title, description, status, side, assignee_id, start_date, due_date, position, source (`propuesta`/`manual`/`reunion`), kind (`tarea`/`reunion`), completed_at, created_at, updated_at | `kind = reunion` pinta la franja naranja |
| `notes` | id, project_id, task_id, kind (`nota`/`avance`), visibility (`shared`/`internal`), author_kind, author_id, author_name, body, ai, created_at, updated_at | Con `task_id`, es un comentario. `ai` = avance redactado por la IA |
| `activity` | id, project_id, task_id, actor_kind, actor_name, type, data (JSON), internal, created_at | Bitácora |
| `notifications` | id, recipient_kind, recipient_id, project_id, task_id, type, title, body, link, read_at, created_at | Campana |
| `attachments` | id, project_id, task_id, drive_file_id, drive_url, name, mime, size, visibility, link_shared, linked, author_kind, author_id, author_name, created_at | `linked = 1`: enlazado desde tu Drive |
| `meetings` | id, event_id, client_id, project_id, title, start_at, end_at, meet_code, meet_url, calendar_url, attendees, status, transcript, transcript_source, transcript_url, summary, agreements, proposed_tasks, task_ids, ai, error, approved_at, approved_by, sent_to, created_at, updated_at | Listas guardadas como JSON |
| `payments` | id, project_id, label, percent, amount, currency (`USD`/`COP`), due_date, position, paid, paid_at, amount_cop, trm, invoice_id, created_at, updated_at (+ columnas de sincronización históricas) | Plan de pagos del proyecto. Pagada → su abono en `receipts` |
| `invoices` | id, client_id, project_id, number (único), kind, date, due_date, currency, exchange_rate, total, total_cop, notes, status (`emitida`/`anulada`), sent_at, sb_id, online_link_id, online_link_url, created_at, updated_at | Cuentas de cobro. `total_cop` siempre en pesos |
| `invoice_items` | id, invoice_id, description (HTML saneado), quantity, unit, unit_price, position | |
| `receipts` | id, client_id, project_id, invoice_id, payment_id, amount_cop, currency, amount, trm, date, method, notes, proof_url, finance_ref (único), finance_category, finance_description, sync_status, sync_error, synced_at, sb_id, skip_finance, created_at, updated_at | Abonos: cada uno es un ingreso en el Gestor con `finance_ref` |
| `ai_usage` | id, at, provider, model, purpose, input_tokens, output_tokens, cost_usd, latency_ms, ok, error | Consumo de IA |
| `settings` | key, value (JSON) | Ver abajo |

## Ajustes (`settings`)

| Clave | Contenido |
|---|---|
| `ai` | Perfiles, claves cifradas, tarifas, presupuesto |
| `google` | Correo conectado, refresh token cifrado, permisos |
| `drive` | Carpeta raíz *DeerSystems Partners* |
| `google_picker` | Clave de API del selector, cifrada |
| `notifications` | Avisos encendidos o apagados para todos |
| `meetings` | `importExternal` |
| `meetings_sync` | Estado de la última sincronización |
| `finanzas` | URL del Gestor y clave cifrada |
| `billing_profile` | Datos del emisor de la cuenta de cobro (logo, firma y QR como data URL) |
| `online_payments` | Pago en línea (Wompi): encendido, ambiente, llaves cifradas |
| `owner_tour_done` | El administrador terminó el tour |
