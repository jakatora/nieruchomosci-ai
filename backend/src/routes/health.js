import { Router } from 'express';
import { env, features, sourcesEnabled } from '../config/env.js';
import { db } from '../db/index.js';
import { logger } from '../lib/logger.js';

const router = Router();

const STARTED_AT = new Date().toISOString();

/**
 * GET /health — liveness + readiness + ops snapshot.
 *
 * Używane przez:
 *   - UptimeRobot ping (zwraca 200 gdy DB żyje, 503 gdy nie)
 *   - Railway healthcheck (auto-restart gdy 5xx)
 *   - Mobile app on startup (feature flags discovery)
 *   - Admin dashboard (ops snapshot)
 *
 * Endpoint NIE wymaga auth — daje tylko publiczne metadane (NIE wartości env vars).
 */
router.get('/', (_req, res) => {
  // DB readiness check — `SELECT 1` to lightweight ping.
  let dbHealthy = false;
  let dbStats = null;
  try {
    db.prepare('SELECT 1').get();
    dbHealthy = true;
    // Tylko gdy DB żyje — wyciąg rozsądnych stats (zero-cost queries z indexami).
    dbStats = {
      listings_active: db.prepare("SELECT COUNT(*) AS n FROM listings WHERE status = 'active'").get().n,
      users_total: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
      matches_last_24h: db.prepare(`SELECT COUNT(*) AS n FROM matches WHERE created_at >= datetime('now','-1 day')`).get().n,
      ai_calls_this_month: db.prepare(
        `SELECT COUNT(*) AS n FROM ai_usage WHERE created_at >= datetime('now','start of month')`,
      ).get().n,
    };
  } catch (err) {
    logger.error({ err: err.message }, '/health: DB check failed');
  }

  // Last successful daily cron — sygnał czy automation faktycznie działa.
  let lastCronAt = null;
  if (dbHealthy) {
    try {
      const row = db.prepare(
        `SELECT created_at FROM audit_logs
          WHERE action = 'daily_cron_completed'
          ORDER BY created_at DESC LIMIT 1`,
      ).get();
      lastCronAt = row?.created_at ?? null;
    } catch { /* ignore */ }
  }

  // Status code: 200 gdy core (DB) zdrowe, 503 gdy DB padło.
  const statusCode = dbHealthy ? 200 : 503;
  res.status(statusCode).json({
    status: dbHealthy ? 'ok' : 'degraded',
    app: env.APP_NAME,
    env: env.NODE_ENV,
    uptime_seconds: Math.round((Date.now() - new Date(STARTED_AT).getTime()) / 1000),
    started_at: STARTED_AT,
    db_healthy: dbHealthy,
    db_stats: dbStats,
    last_daily_cron_at: lastCronAt,
    features: {
      ai: features.ai,
      stripe: features.stripe,
      stripe_standard: features.stripeStandard,
      stripe_investor: features.stripeInvestor,
      email: features.email,
      email_dry_run: features.emailDryRun,
      maps: features.maps,
      sentry: features.sentry,
      backups: features.backups,
    },
    sources_enabled: sourcesEnabled,
    time: new Date().toISOString(),
  });
});

export default router;
