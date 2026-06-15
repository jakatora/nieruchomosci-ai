import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../lib/asyncHandler.js';
import { adminRequired } from '../middleware/adminAuth.js';
import { badRequest } from '../lib/errors.js';
import { parseLimit } from '../lib/queryHelpers.js';
import { db } from '../db/index.js';
import {
  users, listings, matches, aiUsage,
  killSwitches, supportTickets,
} from '../db/repos.js';
import { budgetStatus } from '../services/ai.js';
import { audit } from '../lib/audit.js';

const router = Router();

/**
 * Admin endpoints — wymagają `X-Admin-Key` header z wartością `env.ADMIN_API_KEY`.
 *
 * Endpointy:
 *   GET    /admin/stats              — totals (users, listings, matches, AI budget)
 *   GET    /admin/ai-usage           — recent calls (default 50)
 *   GET    /admin/kill-switches      — list (klucze + status)
 *   POST   /admin/kill-switches/:key — toggle (`{enabled: bool, reason?}`)
 *   GET    /admin/support-tickets    — list filtrowanego (status query param)
 *   POST   /admin/support-tickets/:id/status — change status
 *   GET    /admin/listings/recent    — ostatnio pobrane (do diagnozy fetchu)
 *
 * Bezpieczeństwo: `adminRequired` middleware używa timing-safe compare na
 * ADMIN_API_KEY (lokalne `local-dev-admin-key-do-not-use-in-prod` na devie;
 * prod wymaga losowego 32+ char alnum w Railway env).
 */

// ====================================================================
// GET /admin/stats — high-level overview
// ====================================================================

router.get('/stats', adminRequired, ah(async (req, res) => {
  const usersByTier = db.prepare(`
    SELECT premium_tier, COUNT(*) AS n FROM users GROUP BY premium_tier
  `).all().reduce((acc, r) => { acc[r.premium_tier] = r.n; return acc; }, {});

  const usersByType = db.prepare(`
    SELECT user_type, COUNT(*) AS n FROM users GROUP BY user_type
  `).all().reduce((acc, r) => { acc[r.user_type] = r.n; return acc; }, {});

  const listingsBySrc = db.prepare(`
    SELECT source, COUNT(*) AS n FROM listings WHERE status = 'active' GROUP BY source
  `).all().reduce((acc, r) => { acc[r.source] = r.n; return acc; }, {});

  const matchesLast24h = db.prepare(`
    SELECT COUNT(*) AS n FROM matches WHERE created_at >= datetime('now', '-1 day')
  `).get().n;

  res.json({
    users: { total: users.count(), by_tier: usersByTier, by_type: usersByType },
    listings: { total: db.prepare('SELECT COUNT(*) AS n FROM listings').get().n, by_source: listingsBySrc },
    matches: {
      total: db.prepare('SELECT COUNT(*) AS n FROM matches').get().n,
      last_24h: matchesLast24h,
    },
    investor_analysis: db.prepare('SELECT COUNT(*) AS n FROM investor_analysis').get().n,
    ai_budget: budgetStatus(),
    audit_logs_total: db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get().n,
    support_tickets_open: db.prepare(`SELECT COUNT(*) AS n FROM support_tickets WHERE status = 'open'`).get().n,
  });
}));

// ====================================================================
// GET /admin/ai-usage — recent AI calls (cost / tokens)
// ====================================================================

router.get('/ai-usage', adminRequired, ah(async (req, res) => {
  const limit = parseLimit(req.query.limit, { default: 50, max: 500 });
  const rows = db.prepare(`
    SELECT operation, model, input_tokens, output_tokens, cost_usd, created_at
      FROM ai_usage ORDER BY created_at DESC LIMIT ?
  `).all(limit);

  // Agregacja per operation za ostatnie 30 dni.
  const byOp = db.prepare(`
    SELECT operation, COUNT(*) AS calls,
           SUM(input_tokens) AS in_tokens, SUM(output_tokens) AS out_tokens,
           SUM(cost_usd) AS cost_usd
      FROM ai_usage WHERE created_at >= datetime('now', '-30 day')
      GROUP BY operation
  `).all();

  res.json({
    recent: rows,
    last_30d_by_operation: byOp,
    budget: budgetStatus(),
  });
}));

// ====================================================================
// Kill switches — lista + set
// ====================================================================

router.get('/kill-switches', adminRequired, ah(async (req, res) => {
  res.json({ kill_switches: killSwitches.listAll() });
}));

const setKillSwitchSchema = z.object({
  enabled: z.boolean(),
  reason: z.string().max(500).optional(),
});

router.post('/kill-switches/:key', adminRequired, ah(async (req, res) => {
  const parsed = setKillSwitchSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('Wymagane: enabled (bool), opcjonalnie reason');
  killSwitches.set(req.params.key, parsed.data.enabled, parsed.data.reason ?? null);
  audit({ action: 'admin_set_kill_switch',
    detail: { key: req.params.key, enabled: parsed.data.enabled, reason: parsed.data.reason }, ip: req.ip });
  res.json({ key: req.params.key, enabled: parsed.data.enabled, reason: parsed.data.reason ?? null });
}));

// ====================================================================
// Support tickets
// ====================================================================

router.get('/support-tickets', adminRequired, ah(async (req, res) => {
  const status = req.query.status || 'open';
  const limit = parseLimit(req.query.limit, { default: 50, max: 200 });
  res.json({ tickets: supportTickets.listByStatus(status, limit), filter: { status, limit } });
}));

const ticketStatusSchema = z.object({
  status: z.enum(['open', 'in_progress', 'resolved', 'closed']),
});

router.post('/support-tickets/:id/status', adminRequired, ah(async (req, res) => {
  const parsed = ticketStatusSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('Status musi być open|in_progress|resolved|closed');
  db.prepare(`UPDATE support_tickets SET status = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(parsed.data.status, req.params.id);
  audit({ action: 'admin_ticket_status',
    detail: { ticket_id: req.params.id, status: parsed.data.status }, ip: req.ip });
  res.json({ id: req.params.id, status: parsed.data.status });
}));

// ====================================================================
// Audit logs — ops visibility (incident response, RODO art. 15-22)
// ====================================================================

router.get('/audit-logs', adminRequired, ah(async (req, res) => {
  const limit = parseLimit(req.query.limit, { default: 50, max: 500 });
  const userId = req.query.user_id;
  const action = req.query.action;

  const where = [];
  const params = [];
  if (userId) { where.push('user_id = ?'); params.push(userId); }
  if (action) { where.push('action = ?'); params.push(action); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = db.prepare(
    `SELECT id, user_id, action, detail, ip_address, created_at
       FROM audit_logs ${whereSql} ORDER BY created_at DESC LIMIT ?`,
  ).all(...params, limit);

  // Agregacja per action za ostatnie 24h — pokazuje wzorce użycia + ataki.
  const byAction24h = db.prepare(`
    SELECT action, COUNT(*) AS n FROM audit_logs
     WHERE created_at >= datetime('now', '-1 day')
     GROUP BY action ORDER BY n DESC
  `).all();

  res.json({
    audit_logs: rows,
    last_24h_by_action: byAction24h,
    filter: { user_id: userId ?? null, action: action ?? null, limit },
  });
}));

// ====================================================================
// Listings diagnostics
// ====================================================================

router.get('/listings/recent', adminRequired, ah(async (req, res) => {
  const limit = parseLimit(req.query.limit, { default: 20, max: 100 });
  const rows = db.prepare(`
    SELECT source, source_id, city, district, price_pln, area_m2, fetched_at
      FROM listings ORDER BY fetched_at DESC LIMIT ?
  `).all(limit);

  // Stats per source.
  const bySource = db.prepare(`
    SELECT source, COUNT(*) AS total,
           MAX(fetched_at) AS last_fetch
      FROM listings GROUP BY source
  `).all();

  res.json({ recent: rows, by_source: bySource });
}));

// ====================================================================
// Listings cleanup — Iter 43 (op hygiene + DB size control)
// ====================================================================

const cleanupSchema = z.object({
  // dry_run: tylko zlicza, NIE usuwa (default true dla bezpieczeństwa)
  dry_run: z.boolean().optional().default(true),
  // Maksymalny wiek listings ACTIVE (w dniach). Default 180 (6 miesięcy).
  max_age_days_active: z.coerce.number().int().positive().optional().default(180),
  // Maksymalny wiek listings EXPIRED/SOLD/REMOVED (w dniach). Default 60.
  max_age_days_inactive: z.coerce.number().int().positive().optional().default(60),
});

router.post('/listings/cleanup', adminRequired, ah(async (req, res) => {
  const parsed = cleanupSchema.safeParse(req.body || {});
  if (!parsed.success) throw badRequest('Błąd walidacji parametrów cleanup');
  const { dry_run, max_age_days_active, max_age_days_inactive } = parsed.data;

  const activeCutoff = new Date(Date.now() - max_age_days_active * 86400_000).toISOString();
  const inactiveCutoff = new Date(Date.now() - max_age_days_inactive * 86400_000).toISOString();

  // SELECT do statystyk (zawsze, niezależnie od dry_run).
  const candidatesActive = db.prepare(
    `SELECT COUNT(*) AS n FROM listings
       WHERE status = 'active' AND fetched_at < ?`,
  ).get(activeCutoff).n;

  const candidatesInactive = db.prepare(
    `SELECT COUNT(*) AS n FROM listings
       WHERE status IN ('expired', 'sold', 'removed') AND fetched_at < ?`,
  ).get(inactiveCutoff).n;

  let deleted = 0;
  if (!dry_run && (candidatesActive + candidatesInactive) > 0) {
    // CASCADE: matches z tymi listings również zostaną usunięte (ON DELETE CASCADE z schema).
    const activeRes = db.prepare(
      `DELETE FROM listings WHERE status = 'active' AND fetched_at < ?`,
    ).run(activeCutoff);
    const inactiveRes = db.prepare(
      `DELETE FROM listings
         WHERE status IN ('expired', 'sold', 'removed') AND fetched_at < ?`,
    ).run(inactiveCutoff);
    deleted = activeRes.changes + inactiveRes.changes;

    // Sprzątanie investor_analysis dla orphaned listings (jeśli CASCADE nie ogarnęło).
    db.prepare(
      `DELETE FROM investor_analysis WHERE listing_id NOT IN (SELECT id FROM listings)`,
    ).run();
  }

  audit({
    action: 'admin_listings_cleanup',
    detail: { dry_run, max_age_days_active, max_age_days_inactive,
              candidates_active: candidatesActive, candidates_inactive: candidatesInactive,
              deleted },
    ip: req.ip,
  });

  res.json({
    dry_run,
    candidates: {
      active_older_than_days: max_age_days_active,
      inactive_older_than_days: max_age_days_inactive,
      to_delete_active: candidatesActive,
      to_delete_inactive: candidatesInactive,
      total_candidates: candidatesActive + candidatesInactive,
    },
    deleted,
    message: dry_run
      ? 'Dry run — nic nie usunięte. Wyślij {"dry_run": false} by faktycznie usunąć.'
      : `Usunięto ${deleted} listings (+ CASCADE matches/investor_analysis).`,
  });
}));

export default router;
