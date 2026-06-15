import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../../src/app.js';

/**
 * Iter 56: Integration tests dla `/health` (ops snapshot) + `/legal/*` (RODO + regulamin).
 *
 * /health: status code dependant DB, features flags, sources_enabled, no env vars leak.
 * /legal: HTML response, proper CSP allowlist (cdn.tailwindcss.com), Polish content,
 *         Apple/Google compliance markers.
 */

let app, server, baseUrl;

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
  const ct = res.headers.get('content-type') || '';
  const text = await res.text();
  let body = text;
  if (ct.includes('application/json')) {
    try { body = JSON.parse(text); } catch { /* */ }
  }
  return { status: res.status, body, text, headers: res.headers };
}

describe('routes/health + /legal — integration', () => {
  before(async () => { await startServer(); });
  after(async () => { await stopServer(); });

  describe('GET /health — readiness snapshot', () => {
    it('200 z status=ok gdy DB żyje', async () => {
      const { status, body } = await get('/health');
      assert.equal(status, 200);
      assert.equal(body.status, 'ok');
      assert.equal(body.db_healthy, true);
    });

    it('zawiera uptime_seconds, started_at, time', async () => {
      const { body } = await get('/health');
      assert.equal(typeof body.uptime_seconds, 'number');
      assert.ok(body.uptime_seconds >= 0);
      assert.ok(body.started_at);
      assert.ok(body.time);
    });

    it('db_stats zawiera listings/users/matches/ai_calls counts', async () => {
      const { body } = await get('/health');
      assert.ok(body.db_stats);
      assert.equal(typeof body.db_stats.listings_active, 'number');
      assert.equal(typeof body.db_stats.users_total, 'number');
      assert.equal(typeof body.db_stats.matches_last_24h, 'number');
      assert.equal(typeof body.db_stats.ai_calls_this_month, 'number');
    });

    it('features flags eksponowane (booleans), bez wartości env', async () => {
      const { body } = await get('/health');
      assert.equal(typeof body.features.ai, 'boolean');
      assert.equal(typeof body.features.stripe, 'boolean');
      assert.equal(typeof body.features.email, 'boolean');
      // Security: NIE wyciekamy wartości env
      assert.equal(body.STRIPE_SECRET_KEY, undefined);
      assert.equal(body.ANTHROPIC_API_KEY, undefined);
    });

    it('sources_enabled jest lista', async () => {
      const { body } = await get('/health');
      assert.ok(Array.isArray(body.sources_enabled));
    });

    it('NIE wymaga auth (publiczny endpoint)', async () => {
      const { status } = await get('/health');
      assert.equal(status, 200);
    });
  });

  describe('GET /legal/privacy — Polityka prywatności (RODO)', () => {
    it('200 z text/html', async () => {
      const { status, headers } = await get('/legal/privacy');
      assert.equal(status, 200);
      assert.match(headers.get('content-type') || '', /text\/html/);
    });

    it('zawiera kluczowe sekcje RODO', async () => {
      const { text } = await get('/legal/privacy');
      assert.match(text, /Polityka prywatności/);
      assert.match(text, /Administrator danych/);
      assert.match(text, /RODO/);
      assert.match(text, /PUODO/);
      assert.match(text, /uodo\.gov\.pl/);
      assert.match(text, /privacy@nieruchomosciai\.pl/);
    });

    it('wymienia wszystkich kluczowych procesorów (Stripe/Anthropic/Resend)', async () => {
      const { text } = await get('/legal/privacy');
      assert.match(text, /Stripe/);
      assert.match(text, /Anthropic/);
      assert.match(text, /Resend/);
      assert.match(text, /Railway/);
    });

    it('zawiera CSP allowlist dla cdn.tailwindcss.com', async () => {
      const { headers } = await get('/legal/privacy');
      const csp = headers.get('content-security-policy') || '';
      // Strona inline'uje skrypt Tailwind z CDN → CSP musi go zezwolić
      assert.match(csp, /tailwindcss\.com/, `CSP allowlist: ${csp}`);
    });
  });

  describe('GET /legal/terms — Regulamin', () => {
    it('200 z text/html', async () => {
      const { status, headers } = await get('/legal/terms');
      assert.equal(status, 200);
      assert.match(headers.get('content-type') || '', /text\/html/);
    });

    it('zawiera kluczowe paragrafy regulaminu (§3 płatności + §4 odstąpienie + §5 disclaimer AI)', async () => {
      const { text } = await get('/legal/terms');
      assert.match(text, /Subskrypcja i płatności/);
      assert.match(text, /Prawo odstąpienia/);
      assert.match(text, /14 dni/);
      assert.match(text, /Disclaimer AI/);
      assert.match(text, /halucynować/);
    });

    it('zawiera cennik 39 PLN + 149 PLN', async () => {
      const { text } = await get('/legal/terms');
      assert.match(text, /39 PLN/);
      assert.match(text, /149 PLN/);
    });

    it('zawiera ODR link (UE rozwiązywanie sporów)', async () => {
      const { text } = await get('/legal/terms');
      assert.match(text, /ec\.europa\.eu\/consumers\/odr/);
    });
  });

  describe('Security headers (helmet)', () => {
    it('/legal/privacy ma X-Content-Type-Options: nosniff', async () => {
      const { headers } = await get('/legal/privacy');
      assert.equal(headers.get('x-content-type-options'), 'nosniff');
    });

    it('/health ma standard helmet headers', async () => {
      const { headers } = await get('/health');
      assert.ok(headers.get('x-content-type-options'));
    });
  });
});
