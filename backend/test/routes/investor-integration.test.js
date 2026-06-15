import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import { users } from '../../src/db/repos.js';
import { signToken } from '../../src/middleware/auth.js';

/**
 * Iter 53: Integration tests dla `/investor/analysis` (dashboard + CSV).
 *
 * Pokrywa: paywall (tylko investor tier), 401/403 ścieżki, sorty + limit + filter
 * min_yield_net, CSV export (Content-Type + BOM + headers PL), empty pool → summary.note.
 */

let app, server, baseUrl;
let consumerToken, investorToken, freeToken;
const TEST_LISTING_SOURCE = 'investor-integration-test';
const TEST_CITY = 'InvestorTestCity';

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
  const ct = res.headers.get('content-type') || '';
  const text = await res.text();
  let body = text;
  if (ct.includes('application/json')) {
    try { body = text ? JSON.parse(text) : null; } catch { /* */ }
  }
  return { status: res.status, body, text, headers: res.headers };
}

function makeListing(idx, overrides = {}) {
  const id = `${TEST_LISTING_SOURCE}-${idx}`;
  db.prepare(`
    INSERT OR REPLACE INTO listings (id, source, source_id, url, title, price_pln, area_m2, price_per_m2,
                          city, district, photos, raw_data, fetched_at, published_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', '{}', ?, ?, 'active')
  `).run(
    id, TEST_LISTING_SOURCE, `src-${idx}`,
    `https://test/${idx}`, overrides.title || `Investor test ${idx}`,
    overrides.price ?? 500_000, overrides.area ?? 50,
    Math.round((overrides.price ?? 500_000) / (overrides.area ?? 50)),
    overrides.city ?? TEST_CITY, overrides.district ?? 'Centrum',
    new Date().toISOString(), new Date().toISOString(),
  );
  return id;
}

describe('routes/investor — integration', () => {
  before(async () => {
    await startServer();

    db.prepare("DELETE FROM users WHERE email LIKE 'investor-integration-%'").run();
    const consumer = users.create({
      email: 'investor-integration-consumer@test.local',
      passwordHash: 'fake',
      userType: 'consumer',
    });
    const free = users.create({
      email: 'investor-integration-free@test.local',
      passwordHash: 'fake',
      userType: 'investor',
    });
    const investor = users.create({
      email: 'investor-integration-investor@test.local',
      passwordHash: 'fake',
      userType: 'investor',
    });
    users.updatePremium(investor.id, 'investor');
    consumerToken = signToken(consumer.id);
    freeToken = signToken(free.id);
    investorToken = signToken(investor.id);

    db.prepare("DELETE FROM listings WHERE source = ?").run(TEST_LISTING_SOURCE);
    // Mix: 5 listings z różnymi yield (cena/area) by sort dał ciekawy ranking.
    makeListing(1, { price: 400_000, area: 50, district: 'Centrum' });   // high yield
    makeListing(2, { price: 800_000, area: 60, district: 'Centrum' });   // mid yield
    makeListing(3, { price: 1_500_000, area: 80, district: 'Mokotów' }); // low yield
    makeListing(4, { price: 350_000, area: 45, district: 'Praga' });     // high yield
    makeListing(5, { price: 600_000, area: 55, district: 'Mokotów' });   // mid
  });

  after(async () => {
    db.prepare("DELETE FROM users WHERE email LIKE 'investor-integration-%'").run();
    db.prepare("DELETE FROM listings WHERE source = ?").run(TEST_LISTING_SOURCE);
    await stopServer();
  });

  describe('GET /investor/analysis — paywall', () => {
    it('401 bez auth', async () => {
      const { status } = await req('/investor/analysis');
      assert.equal(status, 401);
    });

    it('403 FORBIDDEN dla consumer (premium_tier=free)', async () => {
      const { status, body } = await req('/investor/analysis', {
        headers: { Authorization: `Bearer ${consumerToken}` },
      });
      assert.equal(status, 403);
      assert.equal(body.error.code, 'FORBIDDEN');
      assert.match(body.error.message, /Investor/);
      assert.match(body.error.message, /149/);
    });

    it('403 FORBIDDEN dla user_type=investor ale free tier', async () => {
      const { status } = await req('/investor/analysis', {
        headers: { Authorization: `Bearer ${freeToken}` },
      });
      assert.equal(status, 403, 'paywall sprawdza premium_tier, nie user_type');
    });

    it('200 dla premium investor tier', async () => {
      const { status, body } = await req(`/investor/analysis?city=${TEST_CITY}`, {
        headers: { Authorization: `Bearer ${investorToken}` },
      });
      assert.equal(status, 200);
      assert.ok(Array.isArray(body.rankings));
      assert.ok(body.summary);
      assert.ok(body.filters_applied);
    });
  });

  describe('GET /investor/analysis — response shape', () => {
    it('rankings zawiera listing + investor_analysis + fairness', async () => {
      const { body } = await req(`/investor/analysis?city=${TEST_CITY}&limit=3`, {
        headers: { Authorization: `Bearer ${investorToken}` },
      });
      assert.ok(body.rankings.length >= 1);
      const first = body.rankings[0];
      assert.ok(first.listing.id);
      assert.ok(first.investor_analysis);
      assert.ok('yield_net_pct' in first.investor_analysis);
      assert.ok('payback_years' in first.investor_analysis);
      assert.ok(first.fairness);
      assert.ok(['below', 'fair', 'above', 'unknown'].includes(first.fairness.label));
    });

    it('summary zawiera median + best + worst + positive_cashflow_count', async () => {
      const { body } = await req(`/investor/analysis?city=${TEST_CITY}`, {
        headers: { Authorization: `Bearer ${investorToken}` },
      });
      assert.ok('total_analyzed' in body.summary);
      assert.ok('median_yield_net_pct' in body.summary);
      assert.ok('best_yield_net_pct' in body.summary);
      assert.ok('worst_yield_net_pct' in body.summary);
      assert.ok('positive_cashflow_count' in body.summary);
      assert.ok(body.summary.best_yield_net_pct >= body.summary.worst_yield_net_pct);
    });

    it('limit=2 zwraca max 2 rankings', async () => {
      const { body } = await req(`/investor/analysis?city=${TEST_CITY}&limit=2`, {
        headers: { Authorization: `Bearer ${investorToken}` },
      });
      assert.ok(body.rankings.length <= 2);
    });

    it('sort_by=yield_net (default) sortuje DESC', async () => {
      const { body } = await req(`/investor/analysis?city=${TEST_CITY}&limit=10`, {
        headers: { Authorization: `Bearer ${investorToken}` },
      });
      for (let i = 1; i < body.rankings.length; i++) {
        assert.ok(
          body.rankings[i].investor_analysis.yield_net_pct
            <= body.rankings[i - 1].investor_analysis.yield_net_pct,
          `yield_net DESC: ranking[${i}] <= ranking[${i - 1}]`,
        );
      }
    });

    it('sort_by=payback sortuje ASC (krótszy lepszy)', async () => {
      const { body } = await req(
        `/investor/analysis?city=${TEST_CITY}&limit=10&sort_by=payback`,
        { headers: { Authorization: `Bearer ${investorToken}` } },
      );
      for (let i = 1; i < body.rankings.length; i++) {
        assert.ok(
          body.rankings[i].investor_analysis.payback_years
            >= body.rankings[i - 1].investor_analysis.payback_years,
          `payback ASC: ranking[${i}] >= ranking[${i - 1}]`,
        );
      }
    });
  });

  describe('GET /investor/analysis — filters', () => {
    it('min_yield_net=100 (nierealnie high) → empty + summary.note', async () => {
      const { body } = await req(
        `/investor/analysis?city=${TEST_CITY}&min_yield_net=100`,
        { headers: { Authorization: `Bearer ${investorToken}` } },
      );
      assert.equal(body.rankings.length, 0);
      assert.equal(body.summary.total_analyzed, 0);
      assert.match(body.summary.note, /Brak/);
    });

    it('400 BAD_REQUEST dla sort_by=invalid', async () => {
      const { status, body } = await req(
        `/investor/analysis?city=${TEST_CITY}&sort_by=invalid`,
        { headers: { Authorization: `Bearer ${investorToken}` } },
      );
      assert.equal(status, 400);
      assert.equal(body.error.code, 'BAD_REQUEST');
    });

    it('400 dla limit > 50 (zod max)', async () => {
      const { status } = await req(
        `/investor/analysis?city=${TEST_CITY}&limit=999`,
        { headers: { Authorization: `Bearer ${investorToken}` } },
      );
      assert.equal(status, 400);
    });

    it('district filter zwraca tylko z tej dzielnicy', async () => {
      const { body } = await req(
        `/investor/analysis?city=${TEST_CITY}&district=Centrum&limit=10`,
        { headers: { Authorization: `Bearer ${investorToken}` } },
      );
      for (const r of body.rankings) {
        assert.equal(r.listing.district, 'Centrum');
      }
    });
  });

  describe('GET /investor/analysis/csv — eksport', () => {
    it('200 z text/csv + BOM (raw bytes EF BB BF) + headers PL', async () => {
      // Direct fetch by sprawdzić raw bytes (fetch.text() strippuje BOM przy decode).
      const res = await fetch(`${baseUrl}/investor/analysis/csv?city=${TEST_CITY}`, {
        headers: { Authorization: `Bearer ${investorToken}` },
      });
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') || '', /text\/csv/);
      const buf = new Uint8Array(await res.arrayBuffer());
      // UTF-8 BOM = EF BB BF
      assert.equal(buf[0], 0xEF, 'BOM byte 1');
      assert.equal(buf[1], 0xBB, 'BOM byte 2');
      assert.equal(buf[2], 0xBF, 'BOM byte 3');
      const text = new TextDecoder('utf-8').decode(buf);
      assert.match(text, /Miasto/);
      assert.match(text, /Yield net %/);
      assert.match(text, /Cena PLN/);
    });

    it('Content-Disposition: attachment + filename z datą', async () => {
      const { headers } = await req(
        `/investor/analysis/csv?city=${TEST_CITY}`,
        { headers: { Authorization: `Bearer ${investorToken}` } },
      );
      const cd = headers.get('content-disposition') || '';
      assert.match(cd, /attachment/);
      assert.match(cd, /nieruchomosciai-analysis-\d{4}-\d{2}-\d{2}\.csv/);
    });

    it('CSV body zawiera ≥1 data row pod headerem', async () => {
      const { text } = await req(
        `/investor/analysis/csv?city=${TEST_CITY}`,
        { headers: { Authorization: `Bearer ${investorToken}` } },
      );
      const lines = text.split('\n');
      assert.ok(lines.length >= 2, 'header + data row');
    });

    it('403 dla consumer (paywall na CSV też)', async () => {
      const { status } = await req(
        `/investor/analysis/csv?city=${TEST_CITY}`,
        { headers: { Authorization: `Bearer ${consumerToken}` } },
      );
      assert.equal(status, 403);
    });
  });
});
