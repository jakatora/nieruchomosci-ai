import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import { users } from '../../src/db/repos.js';
import { signToken } from '../../src/middleware/auth.js';

/**
 * Iter 52: Integration tests dla `/searches` CRUD.
 * Pokrywa: free tier paywall (max 1 enabled), validation (min_price > max_price),
 * authorization (cudzy search), update/delete behavior.
 */

let app, server, baseUrl;
let freeToken, freeUserId;
let standardToken, standardUserId;

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
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* */ }
  return { status: res.status, body: json };
}

describe('routes/searches — integration', () => {
  before(async () => {
    await startServer();
    db.prepare("DELETE FROM users WHERE email LIKE 'searches-test-%'").run();

    const free = users.create({
      email: 'searches-test-free@test.local', passwordHash: 'fake', userType: 'consumer',
    });
    freeUserId = free.id;
    freeToken = signToken(free.id);

    const standard = users.create({
      email: 'searches-test-standard@test.local', passwordHash: 'fake', userType: 'consumer',
    });
    users.updatePremium(standard.id, 'standard');
    standardUserId = standard.id;
    standardToken = signToken(standard.id);
  });

  after(async () => {
    db.prepare("DELETE FROM users WHERE email LIKE 'searches-test-%'").run();
    await stopServer();
  });

  beforeEach(() => {
    // Cleanup search per beforeEach
    db.prepare('DELETE FROM searches WHERE user_id IN (?, ?)').run(freeUserId, standardUserId);
  });

  describe('POST /searches — paywall', () => {
    it('201 dla 1-go enabled search (free tier)', async () => {
      const { status, body } = await req('/searches', {
        method: 'POST',
        headers: { Authorization: `Bearer ${freeToken}` },
        body: { name: 'Test 1', city: 'Warszawa', enabled: true },
      });
      assert.equal(status, 201);
      assert.equal(body.search.name, 'Test 1');
      assert.equal(body.search.enabled, true);
    });

    it('409 CONFLICT dla 2-go enabled search (free tier max 1)', async () => {
      // Pierwszy
      await req('/searches', {
        method: 'POST',
        headers: { Authorization: `Bearer ${freeToken}` },
        body: { name: 'First', city: 'Warszawa', enabled: true },
      });
      // Drugi enabled → 409
      const { status, body } = await req('/searches', {
        method: 'POST',
        headers: { Authorization: `Bearer ${freeToken}` },
        body: { name: 'Second', city: 'Kraków', enabled: true },
      });
      assert.equal(status, 409);
      assert.equal(body.error.code, 'CONFLICT');
      assert.equal(body.error.details.upgrade_to, 'standard');
    });

    it('201 dla 2-go disabled search (free tier — disabled nie liczy się)', async () => {
      await req('/searches', {
        method: 'POST',
        headers: { Authorization: `Bearer ${freeToken}` },
        body: { name: 'Active', city: 'Warszawa', enabled: true },
      });
      const { status } = await req('/searches', {
        method: 'POST',
        headers: { Authorization: `Bearer ${freeToken}` },
        body: { name: 'Disabled spare', city: 'Kraków', enabled: false },
      });
      assert.equal(status, 201);
    });

    it('standard tier może mieć >1 enabled search', async () => {
      await req('/searches', {
        method: 'POST',
        headers: { Authorization: `Bearer ${standardToken}` },
        body: { name: '#1', city: 'Warszawa', enabled: true },
      });
      const { status } = await req('/searches', {
        method: 'POST',
        headers: { Authorization: `Bearer ${standardToken}` },
        body: { name: '#2', city: 'Kraków', enabled: true },
      });
      assert.equal(status, 201, 'standard tier bypassuje paywall');
    });
  });

  describe('POST /searches — validation', () => {
    it('400 dla min_price > max_price', async () => {
      const { status, body } = await req('/searches', {
        method: 'POST',
        headers: { Authorization: `Bearer ${freeToken}` },
        body: { name: 'X', city: 'Warszawa', min_price: 1_000_000, max_price: 500_000 },
      });
      assert.equal(status, 400);
      assert.match(body.error.message, /min_price/);
    });

    it('400 dla min_area > max_area', async () => {
      const { status } = await req('/searches', {
        method: 'POST',
        headers: { Authorization: `Bearer ${freeToken}` },
        body: { name: 'X', city: 'Warszawa', min_area: 100, max_area: 50 },
      });
      assert.equal(status, 400);
    });

    it('400 dla missing city', async () => {
      const { status } = await req('/searches', {
        method: 'POST',
        headers: { Authorization: `Bearer ${freeToken}` },
        body: { name: 'No city' },
      });
      assert.equal(status, 400);
    });
  });

  describe('GET /searches — paywall metadata', () => {
    it('zwraca paywall.free_tier_max_enabled + can_add_enabled', async () => {
      const { status, body } = await req('/searches', {
        headers: { Authorization: `Bearer ${freeToken}` },
      });
      assert.equal(status, 200);
      assert.equal(body.paywall.free_tier_max_enabled, 1);
      assert.equal(body.paywall.can_add_enabled, true, '0 enabled = can add');
    });

    it('can_add_enabled=false po dodaniu 1 enabled', async () => {
      await req('/searches', {
        method: 'POST',
        headers: { Authorization: `Bearer ${freeToken}` },
        body: { name: 'X', city: 'Warszawa', enabled: true },
      });
      const { body } = await req('/searches', {
        headers: { Authorization: `Bearer ${freeToken}` },
      });
      assert.equal(body.paywall.can_add_enabled, false);
    });
  });

  describe('PATCH + DELETE /searches/:id', () => {
    let searchId;
    beforeEach(async () => {
      const r = await req('/searches', {
        method: 'POST',
        headers: { Authorization: `Bearer ${freeToken}` },
        body: { name: 'Original', city: 'Warszawa', max_price: 500_000 },
      });
      searchId = r.body.search.id;
    });

    it('PATCH update fields', async () => {
      const { status, body } = await req(`/searches/${searchId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${freeToken}` },
        body: { name: 'Updated', max_price: 1_000_000 },
      });
      assert.equal(status, 200);
      assert.equal(body.search.name, 'Updated');
      assert.equal(body.search.max_price, 1_000_000);
    });

    it('PATCH cudzy search → 403 FORBIDDEN', async () => {
      const { status, body } = await req(`/searches/${searchId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${standardToken}` }, // inny user!
        body: { name: 'Hijack' },
      });
      assert.equal(status, 403);
      assert.equal(body.error.code, 'FORBIDDEN');
    });

    it('DELETE → 200 ok=true', async () => {
      const { status, body } = await req(`/searches/${searchId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${freeToken}` },
      });
      assert.equal(status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.deleted_id, searchId);
    });

    it('DELETE cudzego → 403', async () => {
      const { status } = await req(`/searches/${searchId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${standardToken}` },
      });
      assert.equal(status, 403);
    });

    it('PATCH non-existent → 404', async () => {
      const { status } = await req('/searches/non-existent-id', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${freeToken}` },
        body: { name: 'X' },
      });
      assert.equal(status, 404);
    });
  });
});
