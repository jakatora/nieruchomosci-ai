import { db } from '../db/index.js';
import { newId, nowIso } from './ids.js';
import { logger } from './logger.js';

let _stmt = null;
const stmt = () => (_stmt ||= db.prepare(
  `INSERT INTO audit_logs (id, user_id, action, detail, ip_address, created_at)
   VALUES (?, ?, ?, ?, ?, ?)`,
));

/**
 * Zapisuje wpis audytu (RODO). Nigdy nie rzuca wyjątkiem — błąd audytu
 * nie może wywrócić właściwej operacji.
 */
export function audit({ userId = null, action, detail = null, ip = null }) {
  try {
    stmt().run(
      newId(), userId, action,
      detail ? JSON.stringify(detail) : null,
      ip ?? null, nowIso(),
    );
  } catch (err) {
    logger.error({ err }, 'Nie udało się zapisać wpisu audytu');
  }
}
