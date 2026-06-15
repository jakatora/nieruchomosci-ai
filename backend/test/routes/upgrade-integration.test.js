import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import { users } from '../../src/db/repos.js';
import { createUpgradeLink } from '../../src/services/magicLink.js';

/**
 * Iter 57: Integration tests dla `/upgrade/*` (DEC-009 backend-served HTML).
 *
 * Pokrywa: GET / entry page (walidacja query + status user), POST /checkout
 * konsumuje magic link, GET /success + /cancel pages, HTML safety (escapeHtml).
 *
 * Notka: Stripe Checkout creation testujemy tylko w "isStripeEnabled=false" path
 * (zwraca 503), bo prawdziwy POST do Stripe wymaga API key + side effects.
 */

let app, server, baseUrl;
let userId;

async function startServer() {
  app = createApp();
  server = http.createServer(app).listen(0);
  await new Promise((r) => server.on('listening', r));
  baseUrl = `http://localhost:${server.address().port}`;
}

async function stopServer() {
  if (server) await new Promise((r) => server.close(r));
}

async function get(path) {
  const res = await fetch(baseUrl + path);
  const text = await res.text();
  return { status: res.status, text, headers: res.headers };
}

async function post(path, body) {
  const res = await fetch(baseUrl + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* */ }
  return { status: res.status, body: json, text };
}

describe('routes/upgrade — integration (DEC-009 backend-served HTML)', () => {
  before(async () => {
    await startServer();
    db.prepare("DELETE FROM users WHERE email LIKE 'upgrade-test-%'").run();
    const u = users.create({
      email: 'upgrade-test-' + Date.now() + '@test.local',
      passwordHash: 'fake',
      userType: 'consumer',
    });
    userId = u.id;
  });

  after(async () => {
    db.prepare("DELETE FROM users WHERE email LIKE 'upgrade-test-%'").run();
    db.prepare('DELETE FROM magic_links WHERE user_id = ?').run(userId);
    await stopServer();
  });

  beforeEach(() => {
    users.updatePremium(userId, 'free');
    db.prepare('DELETE FROM magic_links WHERE user_id = ?').run(userId);
  });

  describe('GET /upgrade — entry page validation', () => {
    it('400 HTML gdy brak query params', async () => {
      const { status, text } = await get('/upgrade');
      assert.equal(status, 400);
      assert.match(text, /Nieprawidłowy link/);
    });

    it('400 gdy plan=invalid', async () => {
      const { status } = await get(
        `/upgrade?user_id=${userId}&token=xxx&plan=premium-galaxy`,
      );
      assert.equal(status, 400);
    });

    it('404 gdy user_id wskazuje na nieistniejącego usera', async () => {
      const { status, text } = await get(
        '/upgrade?user_id=non-existent-user&token=xxx&plan=standard',
      );
      assert.equal(status, 404);
      assert.match(text, /Konto nie istnieje/);
    });

    it('200 z message "już aktywny" gdy user ma już ten plan', async () => {
      users.updatePremium(userId, 'investor');
      const { token } = createUpgradeLink(userId, 'investor');
      const { status, text } = await get(
        `/upgrade?user_id=${encodeURIComponent(userId)}&token=${token}&plan=investor`,
      );
      assert.equal(status, 200);
      assert.match(text, /już aktywny/);
    });

    it('200 z entry page i CTA button gdy valid token + free user', async () => {
      const { token } = createUpgradeLink(userId, 'standard');
      const { status, text } = await get(
        `/upgrade?user_id=${encodeURIComponent(userId)}&token=${token}&plan=standard`,
      );
      assert.equal(status, 200);
      assert.match(text, /Aktywuj plan/);
      assert.match(text, /Standard/);
      assert.match(text, /39 PLN/);
    });

    it('HTML escape — user email z special chars nie injektuje XSS', async () => {
      const xssUser = users.create({
        email: 'upgrade-test-xss-<script>@test.local',
        passwordHash: 'fake',
        userType: 'consumer',
      });
      const { token } = createUpgradeLink(xssUser.id, 'standard');
      const { text } = await get(
        `/upgrade?user_id=${encodeURIComponent(xssUser.id)}&token=${token}&plan=standard`,
      );
      // Nie ma raw <script> w output — escaped do &lt;script&gt;
      assert.ok(!text.includes('upgrade-test-xss-<script>'));
      assert.match(text, /&lt;script&gt;/);
      db.prepare('DELETE FROM users WHERE id = ?').run(xssUser.id);
    });
  });

  describe('POST /upgrade/checkout — magic link consumption', () => {
    it('400 BAD_REQUEST gdy brak fields w body', async () => {
      const { status, body } = await post('/upgrade/checkout', {});
      assert.equal(status, 400);
      assert.equal(body.error.code, 'BAD_REQUEST');
    });

    it('404 gdy user_id nie istnieje', async () => {
      const { status, body } = await post('/upgrade/checkout', {
        user_id: 'non-existent', token: 'xxx', plan: 'standard',
      });
      assert.equal(status, 404);
      assert.equal(body.error.code, 'NOT_FOUND');
    });

    it('400 gdy plan jest już aktywny', async () => {
      users.updatePremium(userId, 'standard');
      const { token } = createUpgradeLink(userId, 'standard');
      const { status, body } = await post('/upgrade/checkout', {
        user_id: userId, token, plan: 'standard',
      });
      assert.equal(status, 400);
      assert.match(body.error.message, /już aktywny/);
    });

    it('400 gdy token nieprawidłowy / nie pasuje do planu', async () => {
      const { token } = createUpgradeLink(userId, 'standard');
      const { status, body } = await post('/upgrade/checkout', {
        user_id: userId, token, plan: 'investor', // mismatch plan
      });
      assert.equal(status, 400);
      assert.match(body.error.message, /nieprawidłowy|zużyty/);
    });

    it('400 dla zużytego tokena (consume idempotent)', async () => {
      const { token } = createUpgradeLink(userId, 'standard');
      // Pierwsze użycie (zużyje token — może 503 jeśli Stripe off, ale token CONSUMED)
      await post('/upgrade/checkout', { user_id: userId, token, plan: 'standard' });
      // Drugie użycie tego samego tokena → 400 "zużyty"
      const { status } = await post('/upgrade/checkout', {
        user_id: userId, token, plan: 'standard',
      });
      assert.equal(status, 400);
    });
  });

  describe('GET /upgrade/cancel — anulowanie', () => {
    it('200 HTML z message "Płatność anulowana"', async () => {
      const { status, text, headers } = await get('/upgrade/cancel');
      assert.equal(status, 200);
      assert.match(headers.get('content-type') || '', /text\/html/);
      assert.match(text, /Płatność anulowana/);
      assert.match(text, /nieruchomosciai:\/\//);
    });
  });

  describe('GET /upgrade/success — po Stripe redirect', () => {
    it('200 HTML nawet gdy brak session_id (graceful)', async () => {
      const { status, text } = await get('/upgrade/success');
      assert.equal(status, 200);
      assert.match(text, /Subskrypcja aktywna/);
    });

    it('zawiera deep link do mobile app', async () => {
      const { text } = await get('/upgrade/success');
      assert.match(text, /nieruchomosciai:\/\/upgrade-complete/);
    });
  });
});
