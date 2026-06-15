import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { runDailyMatch } from '../../src/jobs/dailyMatch.js';
import { db } from '../../src/db/index.js';
import {
  users, listings, searches, matches, killSwitches, aiUsage,
} from '../../src/db/repos.js';
import { __setTestClient, __resetTestClient } from '../../src/services/ai.js';

/**
 * Iter 49: testy `jobs/dailyMatch.js` — pipeline integration.
 *
 * Strategia:
 *   - `skipFetch: true` — pomijamy fetchAll z zewnętrznych źródeł (testy działają na DB)
 *   - `PUSH_DRY_RUN=1` — push notifications nie idą do Expo
 *   - `__setTestClient(null)` — AI off → wymusza heurystyczny fallback
 *   - Setup: testowy user + search + listings, run pipeline, assert matches w DB
 */

const TEST_EMAIL = 'dailymatch-test@example.test';
const TEST_SOURCE_PREFIX = 'dailymatch-test-listing';

let testUserId;
let testSearchId;

function makeTestListing({ idx, city, district, price, area, fetchedDaysAgo = 0 }) {
  const id = `${TEST_SOURCE_PREFIX}-${idx}`;
  const fetchedAt = new Date(Date.now() - fetchedDaysAgo * 86400_000).toISOString();
  db.prepare(`
    INSERT INTO listings (id, source, source_id, url, title, price_pln, area_m2, price_per_m2,
                          city, district, photos, raw_data, fetched_at, published_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', '{}', ?, ?, 'active')
  `).run(
    id, 'test-dailymatch', `src-${idx}`, `https://test/${idx}`, `Test listing ${idx}`,
    price, area, Math.round(price / area), city, district, fetchedAt, fetchedAt,
  );
  return id;
}

describe('jobs/dailyMatch — pipeline integration', () => {
  before(() => {
    // PUSH_DRY_RUN żeby nie spamować Expo
    process.env.PUSH_DRY_RUN = '1';

    // Setup testowego usera (idempotent — może już istnieć)
    let u = users.findByEmail(TEST_EMAIL);
    if (!u) {
      u = users.create({
        email: TEST_EMAIL,
        userType: 'consumer',
        homeCity: 'TestCityDailyMatch',
        searchRadiusKm: 5,
      });
    }
    testUserId = u.id;

    // AI off — heurystyczny fallback
    __setTestClient(null);
  });

  after(() => {
    __resetTestClient();
    delete process.env.PUSH_DRY_RUN;

    // Cleanup
    db.prepare('DELETE FROM matches WHERE user_id = ?').run(testUserId);
    db.prepare('DELETE FROM searches WHERE user_id = ?').run(testUserId);
    db.prepare('DELETE FROM users WHERE id = ?').run(testUserId);
    db.prepare("DELETE FROM listings WHERE source = 'test-dailymatch'").run();
    db.prepare('DELETE FROM kill_switches WHERE key IN (?, ?)').run('cron.daily', 'ai.matching');
  });

  beforeEach(() => {
    // Cleanup poprzedniego testu (matches + listings + searches dla scope)
    db.prepare('DELETE FROM matches WHERE user_id = ?').run(testUserId);
    db.prepare('DELETE FROM searches WHERE user_id = ?').run(testUserId);
    db.prepare("DELETE FROM listings WHERE source = 'test-dailymatch'").run();
    db.prepare('DELETE FROM kill_switches WHERE key IN (?, ?)').run('cron.daily', 'ai.matching');

    // Setup default search dla testowego usera
    const s = searches.create(testUserId, {
      name: 'Test daily match search',
      city: 'TestCityDailyMatch',
      districts: [],
      minPrice: 100_000,
      maxPrice: 1_000_000,
      minArea: 30,
      maxArea: 100,
      rooms: [],
      enabled: true,
    });
    testSearchId = s.id;
  });

  describe('kill switch behavior', () => {
    it('cron.daily disabled → status="skipped_killswitch", brak matches', async () => {
      killSwitches.set('cron.daily', false, 'test');
      makeTestListing({ idx: 1, city: 'TestCityDailyMatch', district: 'A', price: 500_000, area: 50 });

      const result = await runDailyMatch({ skipFetch: true });

      assert.equal(result.status, 'skipped_killswitch');
      const matchCount = db.prepare('SELECT COUNT(*) AS n FROM matches WHERE user_id = ?')
        .get(testUserId).n;
      assert.equal(matchCount, 0, 'żadne matches utworzone gdy kill switch off');
    });

    it('ai.matching disabled → używa heurystyki, ale matches się tworzą', async () => {
      killSwitches.set('ai.matching', false, 'test');
      makeTestListing({ idx: 1, city: 'TestCityDailyMatch', district: 'A', price: 500_000, area: 50 });

      const result = await runDailyMatch({ skipFetch: true });

      assert.equal(result.ai_used, false);
      assert.ok(result.matches_created >= 1, 'matches utworzone heurystyką');

      const m = db.prepare(
        'SELECT scorer FROM matches WHERE user_id = ?',
      ).get(testUserId);
      assert.equal(m.scorer, 'heuristic', 'scorer = heuristic gdy AI off');
    });
  });

  describe('pipeline orchestration', () => {
    it('match scoring + insert + summary stats', async () => {
      makeTestListing({ idx: 1, city: 'TestCityDailyMatch', district: 'A', price: 400_000, area: 45 });
      makeTestListing({ idx: 2, city: 'TestCityDailyMatch', district: 'A', price: 800_000, area: 80 });

      const result = await runDailyMatch({ skipFetch: true });

      assert.equal(typeof result.duration_ms, 'number');
      assert.ok(result.duration_ms >= 0);
      assert.ok(result.matches_created >= 1, `oczekuję ≥1 match, dostałem ${result.matches_created}`);
      assert.ok(typeof result.ai_used === 'boolean');
      assert.ok(result.ai_budget, 'ai_budget obecny w summary');
    });

    it('idempotency: drugi run tego samego dnia NIE duplikuje match-y', async () => {
      makeTestListing({ idx: 1, city: 'TestCityDailyMatch', district: 'A', price: 500_000, area: 50 });

      const r1 = await runDailyMatch({ skipFetch: true });
      const matchesAfterRun1 = db.prepare('SELECT COUNT(*) AS n FROM matches WHERE user_id = ?')
        .get(testUserId).n;

      const r2 = await runDailyMatch({ skipFetch: true });
      const matchesAfterRun2 = db.prepare('SELECT COUNT(*) AS n FROM matches WHERE user_id = ?')
        .get(testUserId).n;

      assert.equal(matchesAfterRun1, matchesAfterRun2,
        'drugi run nie powinien dodać nowych matches (idempotent)');
      assert.equal(r2.matches_created, 0, 'r2 nie tworzy nowych match-y');
    });

    it('listing poza filtrami search (price > max_price) → NIE matches', async () => {
      // Search ma max_price 1_000_000, dodaję listing za 2M
      makeTestListing({ idx: 1, city: 'TestCityDailyMatch', district: 'A', price: 2_000_000, area: 100 });

      const result = await runDailyMatch({ skipFetch: true });

      // Nie powinno być match z tym listing.
      assert.equal(result.matches_created, 0, 'too-expensive listing NIE matches');
    });

    it('user bez enabled search → skipped', async () => {
      // Disable search
      db.prepare('UPDATE searches SET enabled = 0 WHERE id = ?').run(testSearchId);
      makeTestListing({ idx: 1, city: 'TestCityDailyMatch', district: 'A', price: 500_000, area: 50 });

      const result = await runDailyMatch({ skipFetch: true });

      assert.equal(result.matches_created, 0, 'disabled search → no matches dla usera');
    });
  });

  describe('summary shape', () => {
    it('zwraca summary z fetchStats + matches_created + push + ai_budget', async () => {
      const result = await runDailyMatch({ skipFetch: true });

      assert.ok('duration_ms' in result);
      assert.ok('fetch' in result);
      assert.equal(typeof result.fetch.fetched, 'number');
      assert.equal(typeof result.fetch.upserted, 'number');
      assert.equal(typeof result.fetch.errors, 'number');
      assert.ok('matches_created' in result);
      assert.ok('users_with_new_matches' in result);
      assert.ok('push' in result);
      assert.ok('ai_used' in result);
      assert.ok('ai_budget' in result);
    });
  });
});
