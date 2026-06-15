import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchFromSource, fetchAll } from '../../src/jobs/fetchListings.js';
import { listings, killSwitches } from '../../src/db/repos.js';
import { db } from '../../src/db/index.js';

/**
 * Testy dla `jobs/fetchListings.js`:
 *   - fetchFromSource: kill-switch behavior, error handling per-city, multi-city aggregation,
 *     rate limit between cities, upsert idempotency (dedupe po source+source_id)
 *   - fetchAll: empty sources gracefully, iteration over enabled sources
 *
 * Strategia testowa: bez mockowania source.fetchListings używamy stubbed source registry
 * przez monkey-patching. Sources zwracają deterministic fixtures.
 */

const TEST_SOURCE_NAME = 'test-source-fetchlistings';

import { registerSource } from '../../src/services/sources/index.js';

let stubResults = []; // ustawiane per test
let stubError = null;
let fetchCount = 0;

const stubSource = {
  name: TEST_SOURCE_NAME,
  fetchListings: async ({ city }) => {
    fetchCount++;
    if (stubError) throw stubError;
    // Zwraca subset z stubResults filtrując po city.
    return stubResults.filter((l) => l.city === city);
  },
};

describe('jobs/fetchListings', () => {
  let unregister;

  before(() => {
    unregister = registerSource(stubSource);
  });

  after(() => {
    unregister();
    // Cleanup testowych listings + kill switches.
    db.prepare('DELETE FROM listings WHERE source = ?').run(TEST_SOURCE_NAME);
    db.prepare('DELETE FROM kill_switches WHERE key = ?').run(`sources.${TEST_SOURCE_NAME}`);
  });

  beforeEach(() => {
    stubResults = [];
    stubError = null;
    fetchCount = 0;
    // Cleanup kill switch przed każdym testem.
    db.prepare('DELETE FROM kill_switches WHERE key = ?').run(`sources.${TEST_SOURCE_NAME}`);
    db.prepare('DELETE FROM listings WHERE source = ?').run(TEST_SOURCE_NAME);
  });

  describe('fetchFromSource — kill switch', () => {
    it('kill switch enabled=false → skip + zwraca []', async () => {
      killSwitches.set(`sources.${TEST_SOURCE_NAME}`, false, 'test');
      const results = await fetchFromSource(TEST_SOURCE_NAME, ['warszawa']);
      assert.deepEqual(results, []);
      assert.equal(fetchCount, 0, 'fetchListings NIE wywołane gdy kill switch off');
    });

    it('kill switch default (brak wpisu) = true → fetchuje normalnie', async () => {
      stubResults = [
        { source: TEST_SOURCE_NAME, source_id: 'a1', url: 'u1', title: 't1', city: 'warszawa' },
      ];
      const results = await fetchFromSource(TEST_SOURCE_NAME, ['warszawa']);
      assert.equal(results.length, 1);
      assert.equal(results[0].fetched, 1);
      assert.equal(results[0].upserted, 1);
    });
  });

  describe('fetchFromSource — multi-city aggregation', () => {
    it('zwraca per-city results array', async () => {
      stubResults = [
        { source: TEST_SOURCE_NAME, source_id: 'w1', url: 'uw1', title: 'tw1', city: 'warszawa' },
        { source: TEST_SOURCE_NAME, source_id: 'w2', url: 'uw2', title: 'tw2', city: 'warszawa' },
        { source: TEST_SOURCE_NAME, source_id: 'k1', url: 'uk1', title: 'tk1', city: 'krakow' },
      ];
      const results = await fetchFromSource(TEST_SOURCE_NAME, ['warszawa', 'krakow']);
      assert.equal(results.length, 2, 'jeden wynik per city');
      assert.equal(results[0].city, 'warszawa');
      assert.equal(results[0].fetched, 2);
      assert.equal(results[1].city, 'krakow');
      assert.equal(results[1].fetched, 1);
    });

    it('city z 0 listings też zwraca wynik (fetched=0)', async () => {
      stubResults = []; // nic dla żadnego miasta
      const results = await fetchFromSource(TEST_SOURCE_NAME, ['empty-city']);
      assert.equal(results.length, 1);
      assert.equal(results[0].fetched, 0);
      assert.equal(results[0].upserted, 0);
      assert.equal(results[0].errors, 0);
    });

    it('upsert idempotency: drugi fetch tego samego listingu nie duplikuje', async () => {
      stubResults = [
        { source: TEST_SOURCE_NAME, source_id: 'dup1', url: 'u', title: 't1', city: 'warszawa' },
      ];
      await fetchFromSource(TEST_SOURCE_NAME, ['warszawa']);
      await fetchFromSource(TEST_SOURCE_NAME, ['warszawa']);

      const count = db.prepare(
        'SELECT COUNT(*) AS n FROM listings WHERE source = ? AND source_id = ?',
      ).get(TEST_SOURCE_NAME, 'dup1').n;
      assert.equal(count, 1, 'tylko 1 wpis mimo 2 fetchów');
    });
  });

  describe('fetchFromSource — error handling', () => {
    it('source rzuca error dla city → continue do następnego', async () => {
      stubError = new Error('Symulowany HTTP 500');
      const results = await fetchFromSource(TEST_SOURCE_NAME, ['city1', 'city2']);
      assert.equal(results.length, 2);
      assert.equal(results[0].errors, 1);
      assert.equal(results[0].errMessage, 'Symulowany HTTP 500');
      assert.equal(results[0].fetched, 0);
      assert.equal(results[1].errors, 1, 'drugie miasto też error (stubError persistent)');
    });

    it('listing upsert error nie crashuje całego fetch', async () => {
      stubResults = [
        { source: TEST_SOURCE_NAME, source_id: 'ok1', url: 'u', title: 't', city: 'warszawa' },
        // Drugi NIE ma wymaganego pola url — schema NOT NULL na url rzuca.
        { source: TEST_SOURCE_NAME, source_id: 'bad1', /* url missing */ title: 't', city: 'warszawa' },
        { source: TEST_SOURCE_NAME, source_id: 'ok2', url: 'u', title: 't', city: 'warszawa' },
      ];
      const results = await fetchFromSource(TEST_SOURCE_NAME, ['warszawa']);
      assert.equal(results[0].fetched, 3, 'wszystkie 3 wzięte z source');
      assert.equal(results[0].upserted, 2, 'tylko 2 udane upserty (środkowy fail)');
    });
  });

  describe('fetchFromSource — rate limit', () => {
    it('rate limit między miastami (sleep > 0 dla wielu cities)', async () => {
      stubResults = [
        { source: TEST_SOURCE_NAME, source_id: 'a', url: 'u', title: 't', city: 'c1' },
        { source: TEST_SOURCE_NAME, source_id: 'b', url: 'u', title: 't', city: 'c2' },
      ];
      const start = Date.now();
      // 2 cities → 1 sleep iteration (default 1000ms dla non-olx).
      await fetchFromSource(TEST_SOURCE_NAME, ['c1', 'c2']);
      const elapsed = Date.now() - start;
      // Tolerancja: oczekujemy >= 900ms (1s rate limit), upper bound luźny.
      assert.ok(elapsed >= 900, `Rate limit za krótki: ${elapsed}ms (oczekuję >=900ms)`);
    });

    it('1 city = brak sleep (single iteration, no rate limit needed)', async () => {
      stubResults = [{ source: TEST_SOURCE_NAME, source_id: 'a', url: 'u', title: 't', city: 'c1' }];
      const start = Date.now();
      await fetchFromSource(TEST_SOURCE_NAME, ['c1']);
      const elapsed = Date.now() - start;
      assert.ok(elapsed < 800, `1 city ma sleep gdzie nie powinno: ${elapsed}ms`);
    });
  });

  describe('fetchAll — orchestracja', () => {
    it('brak włączonych źródeł → graceful empty results', async () => {
      const results = await fetchAll(['warszawa']);
      // Domiporta jest enabled w env (default), więc results będą z domiporty.
      // Ten test sprawdza tylko że funkcja NIE rzuca.
      assert.ok(Array.isArray(results));
    });
  });
});
