import cron from 'node-cron';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { runDailyMatch } from './dailyMatch.js';
import { runBackup } from '../services/backup.js';

/**
 * Cron scheduler — orchestruje 2 wewnętrzne zadania:
 *
 *   1. `LISTINGS_FETCH_CRON` (default "0 7 * * *" — 7am codziennie) — daily match pipeline:
 *      fetch ze źródeł → match scoring → push notifications.
 *
 *   2. `BACKUP_CRON` (default "0 3 * * *" — 3am codziennie) — hot backup SQLite + upload do
 *      Backblaze B2 (gdy skonfigurowany; inaczej local-only). Działa nawet bez B2 — daje
 *      lokalne snapshoty.
 *
 * Granularność cron'a `node-cron` dopuszcza wyrażenia 6-polowe (z sekundami) lub 5-polowe.
 * Default w env.js to 5-polowe (POSIX).
 *
 * Wyłączanie via kill-switch: `cron.daily` (w `kill_switches`) wyłącza pipeline matchowy
 * bez zatrzymywania cron-a — sprawdzanie wewnątrz `runDailyMatch`.
 */

let _dailyJob = null;
let _backupJob = null;

export function startScheduler() {
  if (env.NODE_ENV === 'test') {
    logger.info('Scheduler pominięty w NODE_ENV=test');
    return;
  }

  if (cron.validate(env.LISTINGS_FETCH_CRON)) {
    _dailyJob = cron.schedule(env.LISTINGS_FETCH_CRON, async () => {
      logger.info({ cron: env.LISTINGS_FETCH_CRON }, 'Cron: daily match start');
      try {
        await runDailyMatch();
      } catch (err) {
        logger.error({ err: err.message, stack: err.stack }, 'Cron: daily match failed');
      }
    }, { scheduled: true });
    logger.info({ cron: env.LISTINGS_FETCH_CRON }, 'Scheduler: daily match aktywny');
  } else {
    logger.error({ cron: env.LISTINGS_FETCH_CRON }, 'LISTINGS_FETCH_CRON nieprawidłowy — daily wyłączony');
  }

  if (cron.validate(env.BACKUP_CRON)) {
    _backupJob = cron.schedule(env.BACKUP_CRON, async () => {
      logger.info({ cron: env.BACKUP_CRON }, 'Cron: backup start');
      try {
        await runBackup();
      } catch (err) {
        logger.error({ err: err.message }, 'Cron: backup failed');
      }
    }, { scheduled: true });
    logger.info({ cron: env.BACKUP_CRON }, 'Scheduler: backup aktywny');
  } else {
    logger.error({ cron: env.BACKUP_CRON }, 'BACKUP_CRON nieprawidłowy — backup wyłączony');
  }
}

export function stopScheduler() {
  if (_dailyJob) { _dailyJob.stop(); _dailyJob = null; logger.info('Scheduler: daily zatrzymany'); }
  if (_backupJob) { _backupJob.stop(); _backupJob = null; logger.info('Scheduler: backup zatrzymany'); }
}
