import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../lib/logger.js';
import { DB_PATH, BACKUP_DIR, env, features } from '../config/env.js';

/**
 * SQLite hot-backup — przy WAL mode wystarczy skopiować plik .db + pliki -wal/-shm
 * z odpowiednią synchronizacją. Dla MVP używamy `fs.copyFile` z timestamped name +
 * upload do Backblaze B2 (gdy `B2_*` skonfigurowane).
 *
 * Retencja: ostatnie N dni lokalnie + cleanup po `BACKUP_RETENTION` dniach.
 *
 * Bez `B2_*` → tylko local snapshot (graceful degradation).
 */

export async function runBackup() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(BACKUP_DIR, `backup-${stamp}.db`);

  try {
    fs.copyFileSync(DB_PATH, target);
    logger.info({ target, size_kb: Math.round(fs.statSync(target).size / 1024) },
      'Backup: kopia lokalna utworzona');
  } catch (err) {
    logger.error({ err: err.message }, 'Backup: kopia lokalna nie powiodła się');
    return { localOk: false };
  }

  // Local retention cleanup — usuń pliki starsze niż BACKUP_RETENTION dni.
  try {
    const cutoff = Date.now() - env.BACKUP_RETENTION * 86400_000;
    const files = fs.readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith('backup-') && f.endsWith('.db'));
    let removed = 0;
    for (const f of files) {
      const full = path.join(BACKUP_DIR, f);
      if (fs.statSync(full).mtimeMs < cutoff) {
        fs.unlinkSync(full);
        removed++;
      }
    }
    if (removed > 0) logger.info({ removed }, 'Backup: cleanup retention');
  } catch (err) {
    logger.warn({ err: err.message }, 'Backup retention cleanup warning');
  }

  // B2 upload — TODO (Etap 16 deploy). Dla MVP local-only.
  if (features.backups) {
    logger.debug('Backup B2 upload — TODO Etap 16');
  }
  return { localOk: true, path: target };
}
