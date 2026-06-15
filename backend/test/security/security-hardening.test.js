import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import { users } from '../../src/db/repos.js';
import { signToken } from '../../src/middleware/auth.js';

/**
 * Iter 60: Security hardening tests — adversarial probes na common attack vectors:
 *   - SQL injection w query params (zod walidacja + prepared statements)
 *   - XSS w HTML pages (escapeHtml)
 *   - Auth bypass attempts (manipulated JWT, missing header, wrong prefix)
 *   - IDOR (Insecure Direct Object Reference) — cudzy zasób
 *   - Mass assignment — modyfikacja read-only fields w PATCH /auth/me
 *   - Path traversal w params
 */

let app, server, baseUrl;
let userAToken, userAId;
let userBToken, userBId;

async function startServer() {
  app = createApp();
  server = http.createServer(app).listen(0);
  await new Promise((r) => server.on('listening', r));
  baseUrl = `http://localhost:${server.address().port}`;
}

async function stopServer() {
  if (server) await new Promise((r) => server.close(r));
}

async function req(path, opts = {}) {
  const res = await fetch(baseUrl + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body, text };
}

describe('security — adversarial hardening probes', () => {
  before(async () => {
    await startServer();
    db.prepare("DELETE FROM users WHERE email LIKE 'security-test-%'").run();
    const userA = users.create({
      email: 'security-test-a@test.local', passwordHash: 'fake', userType: 'consumer',
    });
    const userB = users.create({
      email: 'security-test-b@test.local', passwordHash: 'fake', userType: 'consumer',
    });
    userAId = userA.id;
    userBId = userB.id;
    userAToken = signToken(userA.id);
    userBToken = signToken(userB.id);
  });

  after(async () => {
    db.prepare("DELETE FROM users WHERE email LIKE 'security-test-%'").run();
    await stopServer();
  });

  describe('SQL injection — query params', () => {
    it('city param z SQL injection payload → bezpiecznie obsłużone', async () => {
      const payloads = [
        "Warszawa'; DROP TABLE users; --",
        "Warszawa' OR '1'='1",
        "Warszawa UNION SELECT * FROM users",
      ];
      for (const payload of payloads) {
        const { status } = await req(
          `/listings?city=${encodeURIComponent(payload)}&limit=5`,
          { headers: { Authorization: `Bearer ${userAToken}` } },
        );
        // 200 (potraktowane jako legit string), NIE 5xx ani DB exception
        assert.ok([200, 400].includes(status), `status ${status} dla payload "${payload}"`);
      }
      // Verify users table nadal istnieje
      const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
      assert.ok(count > 0, 'users table nadal istnieje');
    });

    it('sort_by z SQL keyword → 400 (zod enum guard)', async () => {
      const investorUser = users.create({
        email: 'security-test-investor@test.local',
        passwordHash: 'fake', userType: 'investor',
      });
      users.updatePremium(investorUser.id, 'investor');
      const tk = signToken(investorUser.id);
      const { status } = await req(
        '/investor/analysis?sort_by=yield_net; DROP TABLE users--',
        { headers: { Authorization: `Bearer ${tk}` } },
      );
      assert.equal(status, 400, 'zod enum odrzuca');
    });
  });

  describe('XSS — HTML pages escape user input', () => {
    it('user email z <script> tag → escaped w upgrade page', async () => {
      const xssUser = users.create({
        email: 'security-test-<img src=x onerror=alert(1)>@test.local',
        passwordHash: 'fake', userType: 'consumer',
      });
      const { createUpgradeLink } = await import('../../src/services/magicLink.js');
      const { token } = createUpgradeLink(xssUser.id, 'standard');

      const { text } = await req(
        `/upgrade?user_id=${encodeURIComponent(xssUser.id)}&token=${token}&plan=standard`,
      );
      // Raw HTML chars NIE pojawiają się w output
      assert.ok(!text.includes('<img src=x'), 'raw <img> nie injektowany');
      // Escaped forma TAK
      assert.match(text, /&lt;img/);
      db.prepare('DELETE FROM users WHERE id = ?').run(xssUser.id);
    });
  });

  describe('Auth bypass — JWT manipulation', () => {
    it('401 dla tokena z manipulated payload (sygnatura mismatch)', async () => {
      // Valid token + zmieniona część po sygnaturze
      const tampered = userAToken.slice(0, -10) + 'XXXXXXXXXX';
      const { status } = await req('/auth/me', {
        headers: { Authorization: `Bearer ${tampered}` },
      });
      assert.equal(status, 401);
    });

    it('401 dla tokena z innego env (różny JWT_SECRET)', async () => {
      // Token wygenerowany z innym secretem
      const fakeToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmYWtlIn0.fakesig';
      const { status } = await req('/auth/me', {
        headers: { Authorization: `Bearer ${fakeToken}` },
      });
      assert.equal(status, 401);
    });

    it('401 dla "null" jako token', async () => {
      const { status } = await req('/auth/me', {
        headers: { Authorization: 'Bearer null' },
      });
      assert.equal(status, 401);
    });

    it('401 dla algorithm=none attack (manipulated alg)', async () => {
      // {alg: "none"} JWT (security exploit z 2015)
      const noneAlgToken = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJoYWNrZXIifQ.';
      const { status } = await req('/auth/me', {
        headers: { Authorization: `Bearer ${noneAlgToken}` },
      });
      assert.equal(status, 401);
    });
  });

  describe('IDOR — Insecure Direct Object Reference', () => {
    let userAsearchId;
    before(async () => {
      const r = await req('/searches', {
        method: 'POST',
        headers: { Authorization: `Bearer ${userAToken}` },
        body: { name: 'IDOR test', city: 'Warszawa' },
      });
      userAsearchId = r.body.search.id;
    });

    it('userB NIE może PATCH userA search → 403', async () => {
      const { status, body } = await req(`/searches/${userAsearchId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${userBToken}` },
        body: { name: 'Hijacked' },
      });
      assert.equal(status, 403);
      assert.equal(body.error.code, 'FORBIDDEN');
    });

    it('userB NIE może DELETE userA search → 403', async () => {
      const { status } = await req(`/searches/${userAsearchId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${userBToken}` },
      });
      assert.equal(status, 403);
    });
  });

  describe('Mass assignment — PATCH /auth/me NIE pozwala podnieść tier', () => {
    it('user NIE może upgrade premium_tier przez PATCH /me', async () => {
      const before = users.findById(userAId).premium_tier;
      const { status } = await req('/auth/me', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${userAToken}` },
        body: { premium_tier: 'investor' }, // adversarial
      });
      // Akceptuje request (200) ale IGNORUJE pole — zod schema nie ma premium_tier
      assert.equal(status, 200);
      const after = users.findById(userAId).premium_tier;
      assert.equal(before, after, 'premium_tier NIE zmieniony przez self-PATCH');
    });

    it('user NIE może zmienić password_hash przez PATCH /me', async () => {
      const before = users.findById(userAId).password_hash;
      await req('/auth/me', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${userAToken}` },
        body: { password_hash: 'pwned-hash', stripe_customer_id: 'cus_pwned' },
      });
      const after = users.findById(userAId);
      assert.equal(after.password_hash, before, 'password_hash NIE zmieniony');
      assert.notEqual(after.stripe_customer_id, 'cus_pwned',
        'stripe_customer_id NIE zmieniony przez self-PATCH');
    });
  });

  describe('Path traversal w params', () => {
    it('listing ID z "../" → 404 (no path escaping)', async () => {
      const { status } = await req('/listings/../../../etc/passwd', {
        headers: { Authorization: `Bearer ${userAToken}` },
      });
      assert.ok([404, 401].includes(status));
    });
  });

  describe('Rate limit signaling', () => {
    it('/auth/login retransmissions NIE crashuje serwera (smoke)', async () => {
      // Smoke test — wysyłamy 20 łapek
      const promises = Array.from({ length: 20 }, () => req('/auth/login', {
        method: 'POST',
        body: { email: 'nobody@test.local', password: 'x' },
      }));
      const results = await Promise.all(promises);
      // Wszystkie powinny zwracać 401 (bad creds) lub 429 (rate limited), NIE 5xx
      for (const r of results) {
        assert.ok([401, 429, 400].includes(r.status), `unexpected status ${r.status}`);
      }
    });
  });
});
