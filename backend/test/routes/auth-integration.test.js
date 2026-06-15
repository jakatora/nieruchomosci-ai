import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import { users } from '../../src/db/repos.js';

/**
 * Iter 50: Integration tests dla `/auth/*` routes — full request cycle przez Express stack.
 *
 * Strategy: spinujemy app na ephemeral port + fetch(). Czyściejsze niż wywołanie route
 * handler bezpośrednio bo testuje: middleware (cors, requestId, rate limit) + auth + body limit.
 */

let app;
let server;
let baseUrl;

const TEST_EMAIL = 'auth-integration@test.local';
const TEST_PW = 'TestPassword123!';

async function startTestServer() {
  app = createApp();
  server = http.createServer(app).listen(0);
  await new Promise((r) => server.on('listening', r));
  baseUrl = `http://localhost:${server.address().port}`;
}

async function stopTestServer() {
  if (server) await new Promise((r) => server.close(r));
}

async function req(path, opts = {}) {
  const res = await fetch(baseUrl + path, {
    method: opts.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* */ }
  return { status: res.status, body: json, text, headers: res.headers };
}

describe('routes/auth — integration', () => {
  before(async () => {
    await startTestServer();
    // Cleanup test user
    db.prepare('DELETE FROM users WHERE email = ?').run(TEST_EMAIL);
  });

  after(async () => {
    db.prepare('DELETE FROM users WHERE email = ?').run(TEST_EMAIL);
    await stopTestServer();
  });

  beforeEach(() => {
    db.prepare('DELETE FROM users WHERE email = ?').run(TEST_EMAIL);
  });

  describe('POST /auth/register', () => {
    it('201 z {token, user} dla valid input', async () => {
      const { status, body } = await req('/auth/register', {
        method: 'POST',
        body: { email: TEST_EMAIL, password: TEST_PW, user_type: 'consumer', home_city: 'Warszawa' },
      });
      assert.equal(status, 201);
      assert.ok(body.token, 'JWT token returned');
      assert.equal(body.user.email, TEST_EMAIL);
      assert.equal(body.user.user_type, 'consumer');
      assert.equal(body.user.premium_tier, 'free');
      assert.equal(body.user.home_city, 'Warszawa');
      // Security: NIE wyciekać password_hash, stripe_customer_id
      assert.equal(body.user.password_hash, undefined);
    });

    it('400 dla missing fields', async () => {
      const { status, body } = await req('/auth/register', {
        method: 'POST',
        body: { email: 'incomplete@test.local' /* password missing */ },
      });
      assert.equal(status, 400);
      assert.equal(body.error.code, 'BAD_REQUEST');
    });

    it('400 dla nieprawidłowego email', async () => {
      const { status } = await req('/auth/register', {
        method: 'POST',
        body: { email: 'not-an-email', password: TEST_PW, user_type: 'consumer' },
      });
      assert.equal(status, 400);
    });

    it('409 dla duplikatu email', async () => {
      // First create
      await req('/auth/register', {
        method: 'POST',
        body: { email: TEST_EMAIL, password: TEST_PW, user_type: 'consumer' },
      });
      // Drugi raz
      const { status } = await req('/auth/register', {
        method: 'POST',
        body: { email: TEST_EMAIL, password: TEST_PW, user_type: 'consumer' },
      });
      assert.equal(status, 409);
    });
  });

  describe('POST /auth/login', () => {
    beforeEach(async () => {
      await req('/auth/register', {
        method: 'POST',
        body: { email: TEST_EMAIL, password: TEST_PW, user_type: 'consumer' },
      });
    });

    it('200 z {token, user} dla valid creds', async () => {
      const { status, body } = await req('/auth/login', {
        method: 'POST',
        body: { email: TEST_EMAIL, password: TEST_PW },
      });
      assert.equal(status, 200);
      assert.ok(body.token);
      assert.equal(body.user.email, TEST_EMAIL);
    });

    it('401 dla złego hasła', async () => {
      const { status, body } = await req('/auth/login', {
        method: 'POST',
        body: { email: TEST_EMAIL, password: 'WrongPassword' },
      });
      assert.equal(status, 401);
      assert.equal(body.error.code, 'UNAUTHORIZED');
    });

    it('401 dla nieistniejącego email', async () => {
      const { status } = await req('/auth/login', {
        method: 'POST',
        body: { email: 'nobody@test.local', password: 'x' },
      });
      assert.equal(status, 401);
    });

    it('email case-insensitive (lowercase normalized)', async () => {
      const { status } = await req('/auth/login', {
        method: 'POST',
        body: { email: TEST_EMAIL.toUpperCase(), password: TEST_PW },
      });
      assert.equal(status, 200);
    });
  });

  describe('GET /auth/me (authRequired)', () => {
    let token;
    beforeEach(async () => {
      const r = await req('/auth/register', {
        method: 'POST',
        body: { email: TEST_EMAIL, password: TEST_PW, user_type: 'investor' },
      });
      token = r.body.token;
    });

    it('200 z user gdy Bearer token valid', async () => {
      const { status, body } = await req('/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      assert.equal(status, 200);
      assert.equal(body.user.email, TEST_EMAIL);
      assert.equal(body.user.user_type, 'investor');
    });

    it('401 bez Authorization header', async () => {
      const { status } = await req('/auth/me');
      assert.equal(status, 401);
    });

    it('401 dla malformed Bearer', async () => {
      const { status } = await req('/auth/me', {
        headers: { Authorization: 'Bearer not-a-jwt' },
      });
      assert.equal(status, 401);
    });

    it('401 dla "Basic" prefix (nie Bearer)', async () => {
      const { status } = await req('/auth/me', {
        headers: { Authorization: `Basic ${token}` },
      });
      assert.equal(status, 401);
    });
  });

  describe('PATCH /auth/me — update profile', () => {
    let token;
    beforeEach(async () => {
      const r = await req('/auth/register', {
        method: 'POST',
        body: { email: TEST_EMAIL, password: TEST_PW, user_type: 'consumer' },
      });
      token = r.body.token;
    });

    it('200 updates home_city, user_type', async () => {
      const { status, body } = await req('/auth/me', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
        body: { home_city: 'Kraków', user_type: 'investor' },
      });
      assert.equal(status, 200);
      assert.equal(body.user.home_city, 'Kraków');
      assert.equal(body.user.user_type, 'investor');
    });

    it('401 bez auth', async () => {
      const { status } = await req('/auth/me', {
        method: 'PATCH',
        body: { home_city: 'Kraków' },
      });
      assert.equal(status, 401);
    });
  });

  describe('X-Request-Id header propagation (iter 16)', () => {
    it('response zawiera X-Request-Id header', async () => {
      const { headers } = await req('/auth/login', {
        method: 'POST',
        body: { email: 'x@test.local', password: 'x' },
      });
      assert.ok(headers.get('x-request-id'), 'X-Request-Id header obecny');
    });

    it('client X-Request-Id echo-back (jeśli valid)', async () => {
      const customId = 'test-req-12345';
      const { headers } = await req('/auth/login', {
        method: 'POST',
        body: { email: 'x@test.local', password: 'x' },
        headers: { 'X-Request-Id': customId },
      });
      assert.equal(headers.get('x-request-id'), customId, 'echo-back valid id');
    });
  });
});
