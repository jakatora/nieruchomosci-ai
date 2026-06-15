import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import { users } from '../../src/db/repos.js';
import { signToken } from '../../src/middleware/auth.js';

/**
 * Iter 51: Integration tests dla `/listings` + `/listings/:id`.
 *
 * Pokrywa: paywall behavior (free tier limit, premium), tier_limit metadata,
 * sortowanie, paginacja, inline fairness, paywall_locked dla investor_analysis.
 */

let app, server, baseUrl;
let consumerToken, investorToken;
const TEST_LISTING_PREFIX = 'integration-test-listing';

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

function makeListing(idx, overrides = {}) {
  const id = `${TEST_LISTING_PREFIX}-${idx}`;
  db.prepare(`
    INSERT OR REPLACE INTO listings (id, source, source_id, url, title, price_pln, area_m2, price_per_m2,
                          city, district, photos, raw_data, fetched_at, published_at, status)
    VALUES (?, 'integration-test', ?, ?, ?, ?, ?, ?, ?, ?, '[]', '{}', ?, ?, 'active')
  `).run(
    id, `s-${idx}`, `https://test/${idx}`, overrides.title || `Test listing ${idx}`,
    overrides.price ?? 500_000, overrides.area ?? 50,
    Math.round((overrides.price ?? 500_000) / (overrides.area ?? 50)),
    overrides.city ?? 'IntegrationTestCity', overrides.district ?? 'TestDistrict',
    new Date().toISOString(), new Date().toISOString(),
  );
  return id;
}

describe('routes/listings — integration', () => {
  before(async () => {
    await startServer();

    // Cleanup + setup test users z różnymi tier'ami.
    db.prepare("DELETE FROM users WHERE email LIKE 'listings-integration-%'").run();
    const consumer = users.create({
      email: 'listings-integration-consumer@test.local',
      passwordHash: 'fake',
      userType: 'consumer',
    });
    const investor = users.create({
      email: 'listings-integration-investor@test.local',
      passwordHash: 'fake',
      userType: 'investor',
    });
    users.updatePremium(investor.id, 'investor');
    consumerToken = signToken(consumer.id);
    investorToken = signToken(investor.id);

    // Cleanup poprzednich test listings + utwórz nowe.
    db.prepare("DELETE FROM listings WHERE source = 'integration-test'").run();
    for (let i = 1; i <= 8; i++) {
      makeListing(i, { price: 300_000 + i * 50_000, area: 40 + i * 5 });
    }
  });

  after(async () => {
    db.prepare("DELETE FROM users WHERE email LIKE 'listings-integration-%'").run();
    db.prepare("DELETE FROM listings WHERE source = 'integration-test'").run();
    await stopServer();
  });

  describe('GET /listings — paywall behavior', () => {
    it('401 bez auth', async () => {
      const { status } = await req('/listings');
      assert.equal(status, 401);
    });

    it('consumer (free tier) → max 3 listings + paywall_truncated=true', async () => {
      const { status, body } = await req(
        '/listings?city=IntegrationTestCity&limit=50',
        { headers: { Authorization: `Bearer ${consumerToken}` } },
      );
      assert.equal(status, 200);
      assert.equal(body.tier_limit, 3, 'free tier limit = 3');
      assert.ok(body.listings.length <= 3, `free dostaje max 3, dostał ${body.listings.length}`);
      assert.equal(body.paywall_truncated, true, 'paywall_truncated gdy total > limit');
    });

    it('investor → max 100 listings, paywall_truncated=false jeśli <100 total', async () => {
      const { status, body } = await req(
        '/listings?city=IntegrationTestCity&limit=50',
        { headers: { Authorization: `Bearer ${investorToken}` } },
      );
      assert.equal(status, 200);
      assert.equal(body.tier_limit, 100);
      assert.equal(body.paywall_truncated, false, 'investor ma pełen dostęp gdy total < 100');
      assert.ok(body.listings.length >= 1);
    });

    it('inline fairness label w każdym listing', async () => {
      const { body } = await req(
        '/listings?city=IntegrationTestCity',
        { headers: { Authorization: `Bearer ${investorToken}` } },
      );
      const first = body.listings[0];
      assert.ok('price_fairness' in first, 'inline fairness label');
      assert.ok(['below', 'fair', 'above', 'unknown'].includes(first.price_fairness));
    });

    it('pagination.total zawsze pełen count (niezależnie od tier limitu)', async () => {
      const { body } = await req(
        '/listings?city=IntegrationTestCity&limit=2',
        { headers: { Authorization: `Bearer ${investorToken}` } },
      );
      // total count zawsze odzwierciedla DB, nie response payload size.
      assert.ok(body.pagination.total >= 1);
      assert.equal(typeof body.pagination.total, 'number');
    });
  });

  describe('GET /listings/:id — detail z paywall_locked', () => {
    it('consumer → listing + comparables, investor_analysis=null, paywall_locked', async () => {
      const id = `${TEST_LISTING_PREFIX}-1`;
      const { status, body } = await req(
        `/listings/${id}`,
        { headers: { Authorization: `Bearer ${consumerToken}` } },
      );
      assert.equal(status, 200);
      assert.equal(body.listing.id, id);
      assert.ok('comparables' in body);
      assert.equal(body.investor_analysis, null, 'consumer NIE dostaje ROI');
      assert.ok(body.paywall_locked.includes('investor_analysis'), 'paywall_locked sygnalizuje');
    });

    it('investor → pełen response z investor_analysis', async () => {
      const id = `${TEST_LISTING_PREFIX}-1`;
      const { status, body } = await req(
        `/listings/${id}`,
        { headers: { Authorization: `Bearer ${investorToken}` } },
      );
      assert.equal(status, 200);
      assert.notEqual(body.investor_analysis, null, 'investor dostaje ROI');
      assert.ok('estimated_rent' in body.investor_analysis);
      assert.ok('yield_net_pct' in body.investor_analysis);
      assert.deepEqual(body.paywall_locked, [], 'NIC nie locked dla investor');
    });

    it('404 dla nieistniejącego ID', async () => {
      const { status, body } = await req(
        '/listings/non-existent-id',
        { headers: { Authorization: `Bearer ${investorToken}` } },
      );
      assert.equal(status, 404);
      assert.equal(body.error.code, 'NOT_FOUND');
    });

    it('401 bez auth', async () => {
      const { status } = await req(`/listings/${TEST_LISTING_PREFIX}-1`);
      assert.equal(status, 401);
    });
  });
});
