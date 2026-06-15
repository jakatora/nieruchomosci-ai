import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import { env } from '../../src/config/env.js';
import { killSwitches, supportTickets } from '../../src/db/repos.js';

/**
 * Iter 58: Integration tests dla `/admin/*` — ops endpoints chronione `X-Admin-Key`.
 *
 * Pokrywa: auth (401 bez/zła klucz, 200 valid), stats aggregation, kill-switches CRUD,
 * support tickets, audit-logs filter, listings/recent diagnostics, cleanup dry_run safety.
 */

let app, server, baseUrl;
const ADMIN_KEY = env.ADMIN_API_KEY;

async function startServer() {
  app = createApp();
  server = http.createServer(app).listen(0);
  await new Promise((r) => server.on('listening', r));
  baseUrl = `http://localhost:${server.address().port}`;
}

async function stopServer() {
  if (server) await new Promise((r) => server.close(r));
}

async function adminGet(path) {
  const res = await fetch(baseUrl + path, {
    headers: { 'X-Admin-Key': ADMIN_KEY },
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* */ }
  return { status: res.status, body };
}

async function adminPost(path, payload, opts = {}) {
  const res = await fetch(baseUrl + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Key': opts.key ?? ADMIN_KEY,
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* */ }
  return { status: res.status, body };
}

describe('routes/admin — integration', () => {
  before(async () => { await startServer(); });
  after(async () => { await stopServer(); });

  beforeEach(() => {
    // Cleanup kill-switches używanych w testach
    db.prepare('DELETE FROM kill_switches WHERE key LIKE ?').run('test.admin.%');
  });

  describe('auth — adminRequired middleware', () => {
    it('403 bez X-Admin-Key header', async () => {
      const res = await fetch(`${baseUrl}/admin/stats`);
      assert.equal(res.status, 403);
    });

    it('403 dla wrong key', async () => {
      const res = await fetch(`${baseUrl}/admin/stats`, {
        headers: { 'X-Admin-Key': 'wrong-key' },
      });
      assert.equal(res.status, 403);
    });

    it('200 dla valid X-Admin-Key', async () => {
      const { status } = await adminGet('/admin/stats');
      assert.equal(status, 200);
    });
  });

  describe('GET /admin/stats — high-level overview', () => {
    it('zwraca users/listings/matches/ai_budget shape', async () => {
      const { body } = await adminGet('/admin/stats');
      assert.ok(body.users);
      assert.equal(typeof body.users.total, 'number');
      assert.ok(body.users.by_tier);
      assert.ok(body.users.by_type);
      assert.ok(body.listings);
      assert.ok(body.listings.by_source);
      assert.ok(body.matches);
      assert.equal(typeof body.matches.last_24h, 'number');
      assert.ok(body.ai_budget);
      assert.equal(typeof body.audit_logs_total, 'number');
    });
  });

  describe('GET /admin/ai-usage', () => {
    it('zwraca recent + last_30d_by_operation + budget', async () => {
      const { body } = await adminGet('/admin/ai-usage');
      assert.ok(Array.isArray(body.recent));
      assert.ok(Array.isArray(body.last_30d_by_operation));
      assert.ok(body.budget);
    });

    it('limit query param respektowany', async () => {
      const { body } = await adminGet('/admin/ai-usage?limit=5');
      assert.ok(body.recent.length <= 5);
    });
  });

  describe('kill-switches CRUD', () => {
    it('GET list zwraca array', async () => {
      const { body } = await adminGet('/admin/kill-switches');
      assert.ok(Array.isArray(body.kill_switches));
    });

    it('POST :key set enabled=false → updates DB', async () => {
      const { status, body } = await adminPost('/admin/kill-switches/test.admin.foo', {
        enabled: false, reason: 'admin test',
      });
      assert.equal(status, 200);
      assert.equal(body.key, 'test.admin.foo');
      assert.equal(body.enabled, false);
      // Reload z DB
      assert.equal(killSwitches.isEnabled('test.admin.foo'), false);
    });

    it('POST :key set enabled=true → re-enables', async () => {
      killSwitches.set('test.admin.bar', false, 'init');
      await adminPost('/admin/kill-switches/test.admin.bar', { enabled: true });
      assert.equal(killSwitches.isEnabled('test.admin.bar'), true);
    });

    it('400 BAD_REQUEST gdy enabled missing', async () => {
      const { status } = await adminPost('/admin/kill-switches/test.admin.x', {});
      assert.equal(status, 400);
    });
  });

  describe('support tickets', () => {
    let ticketId;
    before(() => {
      const t = supportTickets.create({
        userId: null,
        email: 'test-support@test.local',
        subject: 'Test ticket',
        body: 'Hello',
      });
      ticketId = t.id;
    });

    after(() => {
      db.prepare('DELETE FROM support_tickets WHERE id = ?').run(ticketId);
    });

    it('GET /admin/support-tickets?status=open zawiera nasz ticket', async () => {
      const { body } = await adminGet('/admin/support-tickets?status=open');
      assert.ok(Array.isArray(body.tickets));
      const ours = body.tickets.find((t) => t.id === ticketId);
      assert.ok(ours, 'nasz ticket w liście open');
    });

    it('POST /admin/support-tickets/:id/status zmienia status', async () => {
      const { status, body } = await adminPost(
        `/admin/support-tickets/${ticketId}/status`,
        { status: 'resolved' },
      );
      assert.equal(status, 200);
      assert.equal(body.status, 'resolved');
      // Verify w DB
      const row = db.prepare('SELECT status FROM support_tickets WHERE id = ?').get(ticketId);
      assert.equal(row.status, 'resolved');
    });

    it('400 dla nieprawidłowego status', async () => {
      const { status } = await adminPost(
        `/admin/support-tickets/${ticketId}/status`,
        { status: 'invalid_status' },
      );
      assert.equal(status, 400);
    });
  });

  describe('GET /admin/audit-logs', () => {
    it('zwraca audit_logs + last_24h_by_action aggregation', async () => {
      const { body } = await adminGet('/admin/audit-logs');
      assert.ok(Array.isArray(body.audit_logs));
      assert.ok(Array.isArray(body.last_24h_by_action));
      assert.ok(body.filter);
    });

    it('limit=5 zwraca max 5 rows', async () => {
      const { body } = await adminGet('/admin/audit-logs?limit=5');
      assert.ok(body.audit_logs.length <= 5);
    });

    it('action filter applied', async () => {
      const { body } = await adminGet('/admin/audit-logs?action=admin_set_kill_switch');
      assert.equal(body.filter.action, 'admin_set_kill_switch');
      // Każdy zwrócony wpis powinien mieć ten action
      for (const log of body.audit_logs) {
        assert.equal(log.action, 'admin_set_kill_switch');
      }
    });
  });

  describe('GET /admin/listings/recent — diagnostics', () => {
    it('zwraca recent + by_source stats', async () => {
      const { body } = await adminGet('/admin/listings/recent');
      assert.ok(Array.isArray(body.recent));
      assert.ok(Array.isArray(body.by_source));
    });

    it('limit query respektowany', async () => {
      const { body } = await adminGet('/admin/listings/recent?limit=3');
      assert.ok(body.recent.length <= 3);
    });
  });

  describe('POST /admin/listings/cleanup', () => {
    it('dry_run=true domyślnie — NIE usuwa', async () => {
      const totalBefore = db.prepare('SELECT COUNT(*) AS n FROM listings').get().n;
      const { status, body } = await adminPost('/admin/listings/cleanup', {});
      assert.equal(status, 200);
      // Domyślnie dry_run=true, nic nie zostało usunięte
      assert.equal(body.dry_run, true);
      const totalAfter = db.prepare('SELECT COUNT(*) AS n FROM listings').get().n;
      assert.equal(totalBefore, totalAfter, 'dry_run nie zmienia count');
    });

    it('400 dla negative max_age_days', async () => {
      const { status } = await adminPost('/admin/listings/cleanup', {
        max_age_days_active: -5,
      });
      assert.equal(status, 400);
    });
  });
});
