import { db as sqlite } from '../db.ts';

/**
 * Índices para las consultas frecuentes y para las claves foráneas con borrado en cascada o SET NULL
 * (sin índice, cada borrado del padre recorre la tabla hija entera). Se crean al arrancar, después de que
 * cada módulo creó sus tablas; IF NOT EXISTS los hace seguros de repetir. En SQLite son rápidos de crear
 * con este volumen de datos, pero bloquean escrituras unos instantes mientras se crean la primera vez.
 */
const INDEXES = [
  // Fases y tareas del proyecto (plan, cronograma, retirar del alcance).
  'CREATE INDEX IF NOT EXISTS phases_project ON phases(project_id, position)',
  'CREATE INDEX IF NOT EXISTS tasks_phase ON tasks(phase_id) WHERE phase_id IS NOT NULL',
  'CREATE INDEX IF NOT EXISTS tasks_assignee ON tasks(assignee_id) WHERE assignee_id IS NOT NULL',
  // Reuniones: la tarea del plan que la muestra (detalle de tarea) y el cliente (filtro y borrado).
  'CREATE INDEX IF NOT EXISTS meetings_plan_task ON meetings(plan_task_id) WHERE plan_task_id IS NOT NULL',
  'CREATE INDEX IF NOT EXISTS meetings_client ON meetings(client_id)',
  'CREATE INDEX IF NOT EXISTS meetings_phase ON meetings(phase_id) WHERE phase_id IS NOT NULL',
  // Cuentas del cliente (cuenta principal, destinatarios de correos).
  'CREATE INDEX IF NOT EXISTS accounts_client ON accounts(client_id, role, is_primary)',
  'CREATE INDEX IF NOT EXISTS password_resets_account ON password_resets(account_id)',
  'CREATE INDEX IF NOT EXISTS account_projects_project ON account_projects(project_id)',
  // Comentarios y archivos de una tarea (borrado en cascada / SET NULL al borrar la tarea).
  'CREATE INDEX IF NOT EXISTS notes_task ON notes(task_id) WHERE task_id IS NOT NULL',
  'CREATE INDEX IF NOT EXISTS attachments_task ON attachments(task_id) WHERE task_id IS NOT NULL',
  'CREATE INDEX IF NOT EXISTS notifications_project ON notifications(project_id) WHERE project_id IS NOT NULL',
  // Facturación: abonos de una cuenta de cobro, grupos de finanzas y claves foráneas al proyecto.
  'CREATE INDEX IF NOT EXISTS receipts_invoice ON receipts(invoice_id) WHERE invoice_id IS NOT NULL',
  'CREATE INDEX IF NOT EXISTS receipts_group ON receipts(finance_group) WHERE finance_group IS NOT NULL',
  'CREATE INDEX IF NOT EXISTS receipts_project ON receipts(project_id) WHERE project_id IS NOT NULL',
  'CREATE INDEX IF NOT EXISTS invoices_project ON invoices(project_id) WHERE project_id IS NOT NULL',
  'CREATE INDEX IF NOT EXISTS payments_invoice ON payments(invoice_id) WHERE invoice_id IS NOT NULL',
  // Propuestas: versiones y aprobaciones que ya generaron proyecto.
  'CREATE INDEX IF NOT EXISTS proposal_versions_proposal ON proposal_versions(proposal_id, version)',
  'CREATE INDEX IF NOT EXISTS proposal_approvals_project ON proposal_approvals(project_id) WHERE project_id IS NOT NULL',
];

export function ensureIndexes(): void {
  for (const sql of INDEXES) {
    try {
      sqlite.exec(sql);
    } catch (err) {
      // Una tabla o columna que no existe en esta versión no debe impedir el arranque.
      console.error(`No se pudo crear el índice (${sql.split(' ON ')[0].split(' ').pop()}):`, (err as Error).message);
    }
  }
  // Estadísticas para el planificador de consultas (barato: solo analiza lo que lo necesita).
  sqlite.exec('PRAGMA optimize=0x10002');
}
