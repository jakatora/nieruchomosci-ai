import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../src/db/index.js';
import { listings as listingsRepo } from '../../src/db/repos.js';
import {
  median,
  classifyFairness,
  computePriceFairness,
  computeBatch,
  MIN_SAMPLE_SIZE,
  FAIRNESS_BELOW_THRESHOLD,
  FAIRNESS_ABOVE_THRESHOLD,
} from '../../src/services/pricing-comparables.js';
import { nowIso } from '../../src/lib/ids.js';

/**
 * Test infrastructure: testy używają TEJ SAMEJ DB co dev (nie tworzymy fresh).
 * Wstawiamy fixture listings z deterministycznym source ('test'), usuwamy po sobie
 * w `after`. Każdy `describe` block ma własny `beforeEach` cleanup tylko dla swoich
 * test-listings (po source = 'test-comparables').
 */
const TEST_SOURCE = 'test-comparables';

function makeTestListing({ id, city, district, areaM2, pricePerM2, daysAgo = 1 }) {
  const price = Math.round(pricePerM2 * areaM2);
  const publishedAt = new Date(Date.now() - daysAgo * 86400_000).toISOString();
  listingsRepo.upsert({
    id,
    source: TEST_SOURCE,
    source_id: id,
    url: `https://test/${id}`,
    title: `Test ${id}`,
    city,
    district,
    area_m2: areaM2,
    price_pln: price,
    price_per_m2: pricePerM2,
    photos: [],
    raw_data: {},
    published_at: publishedAt,
    fetched_at: nowIso(),
    status: 'active',
  });
  return listingsRepo.findBySource(TEST_SOURCE, id);
}

function cleanup() {
  db.prepare(`DELETE FROM listings WHERE source = ?`).run(TEST_SOURCE);
}

describe('services/pricing-comparables', () => {
  before(cleanup);
  after(cleanup);

  describe('median (utility)', () => {
    it('nieparzyste: middle element', () => {
      assert.equal(median([1, 3, 5]), 3);
    });
    it('parzyste: średnia dwóch środkowych', () => {
      assert.equal(median([1, 2, 3, 4]), 2.5);
    });
    it('jeden element', () => {
      assert.equal(median([42]), 42);
    });
    it('pusta lista → null', () => {
      assert.equal(median([]), null);
      assert.equal(median(null), null);
    });
    it('ignoruje NaN/Infinity', () => {
      assert.equal(median([1, 2, NaN, 3]), 2);
    });
  });

  describe('classifyFairness (thresholds)', () => {
    it('delta = -10% → below (okazja)', () => {
      assert.equal(classifyFairness(-10), 'below');
    });
    it('delta = -3% → fair (w widełkach)', () => {
      assert.equal(classifyFairness(-3), 'fair');
    });
    it('delta = +5% → fair', () => {
      assert.equal(classifyFairness(5), 'fair');
    });
    it('delta = +12% → above', () => {
      assert.equal(classifyFairness(12), 'above');
    });
    it('threshold dokładnie -5% → fair (NIE below — granica)', () => {
      assert.equal(classifyFairness(FAIRNESS_BELOW_THRESHOLD), 'fair');
    });
    it('threshold dokładnie +10% → fair', () => {
      assert.equal(classifyFairness(FAIRNESS_ABOVE_THRESHOLD), 'fair');
    });
    it('null/NaN → unknown', () => {
      assert.equal(classifyFairness(null), 'unknown');
      assert.equal(classifyFairness(NaN), 'unknown');
    });
  });

  describe('computePriceFairness — district match', () => {
    beforeEach(cleanup);

    it('sample >= 5 w district → result z source="district"', () => {
      // 6 comparables w Warszawa/Mokotów, ~50m², ~15000 PLN/m²
      for (let i = 1; i <= 6; i++) {
        makeTestListing({
          id: `cmp-${i}`, city: 'TestCityAlpha', district: 'TestMokotow',
          areaM2: 48 + i, pricePerM2: 15000 + i * 100,
        });
      }
      // Target: 50m², 15500 PLN/m² — blisko mediany comparables
      const target = makeTestListing({
        id: 'target-1', city: 'TestCityAlpha', district: 'TestMokotow',
        areaM2: 50, pricePerM2: 15500,
      });

      const r = computePriceFairness(target);
      assert.equal(r.source, 'district');
      assert.equal(r.sampleSize, 6);
      assert.equal(r.fairnessLabel, 'fair');
      assert.ok(Math.abs(r.deltaPct) < 10);
    });

    it('cena 15% poniżej mediany → "below"', () => {
      for (let i = 1; i <= 6; i++) {
        makeTestListing({
          id: `cmp-b-${i}`, city: 'TestCityAlpha', district: 'TestWola',
          areaM2: 50, pricePerM2: 16000,
        });
      }
      const target = makeTestListing({
        id: 'target-below', city: 'TestCityAlpha', district: 'TestWola',
        areaM2: 50, pricePerM2: 13500, // ~15.6% below
      });
      const r = computePriceFairness(target);
      assert.equal(r.fairnessLabel, 'below');
      assert.ok(r.deltaPct < FAIRNESS_BELOW_THRESHOLD);
    });

    it('cena 20% powyżej → "above"', () => {
      for (let i = 1; i <= 6; i++) {
        makeTestListing({
          id: `cmp-a-${i}`, city: 'TestCityAlpha', district: 'TestUrsynow',
          areaM2: 60, pricePerM2: 12000,
        });
      }
      const target = makeTestListing({
        id: 'target-above', city: 'TestCityAlpha', district: 'TestUrsynow',
        areaM2: 60, pricePerM2: 14500, // ~20.8% above
      });
      const r = computePriceFairness(target);
      assert.equal(r.fairnessLabel, 'above');
      assert.ok(r.deltaPct > FAIRNESS_ABOVE_THRESHOLD);
    });
  });

  describe('computePriceFairness — fallback do city-only', () => {
    beforeEach(cleanup);

    it('< 5 w district + ≥ 5 w mieście (różne districts) → source="city"', () => {
      // 3 w Mokotów (target district)
      makeTestListing({ id: 'm-1', city: 'TestCityAlpha', district: 'TestMokotow', areaM2: 50, pricePerM2: 14000 });
      makeTestListing({ id: 'm-2', city: 'TestCityAlpha', district: 'TestMokotow', areaM2: 52, pricePerM2: 14200 });
      makeTestListing({ id: 'm-3', city: 'TestCityAlpha', district: 'TestMokotow', areaM2: 48, pricePerM2: 13800 });
      // 4 w innych districts Warszawy (różne ceny)
      makeTestListing({ id: 'w-1', city: 'TestCityAlpha', district: 'TestWola', areaM2: 55, pricePerM2: 13500 });
      makeTestListing({ id: 'w-2', city: 'Warszawa', district: 'Praga-Południe', areaM2: 50, pricePerM2: 11000 });
      makeTestListing({ id: 'w-3', city: 'TestCityAlpha', district: 'TestUrsynow', areaM2: 50, pricePerM2: 12500 });
      makeTestListing({ id: 'w-4', city: 'Warszawa', district: 'Bemowo', areaM2: 50, pricePerM2: 12000 });

      const target = makeTestListing({
        id: 'target-fb', city: 'TestCityAlpha', district: 'TestMokotow',
        areaM2: 50, pricePerM2: 13500,
      });
      const r = computePriceFairness(target);
      // Sample tylko w Mokotów = 3 (excl. target), < 5 → fallback do city = 7
      assert.equal(r.source, 'city');
      assert.ok(r.sampleSize >= 5);
    });
  });

  describe('computePriceFairness — insufficient_data', () => {
    beforeEach(cleanup);

    it('zero comparables → unknown z source="insufficient_data"', () => {
      const lonely = makeTestListing({
        id: 'lonely', city: 'PustyKraj', district: null,
        areaM2: 50, pricePerM2: 10000,
      });
      const r = computePriceFairness(lonely);
      assert.equal(r.fairnessLabel, 'unknown');
      assert.equal(r.source, 'insufficient_data');
      assert.equal(r.medianPricePerM2, null);
      assert.equal(r.deltaPct, null);
    });

    it('listing bez price_per_m2 → insufficient_data', () => {
      const broken = { city: 'Warszawa', area_m2: 50, price_per_m2: null };
      const r = computePriceFairness(broken);
      assert.equal(r.fairnessLabel, 'unknown');
      assert.equal(r.source, 'insufficient_data');
    });

    it('listing bez city → insufficient_data', () => {
      const noCity = { city: null, area_m2: 50, price_per_m2: 10000 };
      const r = computePriceFairness(noCity);
      assert.equal(r.source, 'insufficient_data');
    });
  });

  describe('computePriceFairness — area tolerance', () => {
    beforeEach(cleanup);

    it('comparables poza zakresem area_m2 ±25% są wykluczone', () => {
      // 6 mieszkań ale 4 z nich w innym zakresie wielkości (poza ±25% od target 50m²)
      // target 50m² → zakres 37.5-62.5
      makeTestListing({ id: 'in-1', city: 'TestCityAlpha', district: 'TestMokotow', areaM2: 40, pricePerM2: 15000 });
      makeTestListing({ id: 'in-2', city: 'TestCityAlpha', district: 'TestMokotow', areaM2: 45, pricePerM2: 15000 });
      makeTestListing({ id: 'in-3', city: 'TestCityAlpha', district: 'TestMokotow', areaM2: 55, pricePerM2: 15000 });
      // 3 w zakresie — za mało
      makeTestListing({ id: 'out-1', city: 'TestCityAlpha', district: 'TestMokotow', areaM2: 30, pricePerM2: 18000 });
      makeTestListing({ id: 'out-2', city: 'TestCityAlpha', district: 'TestMokotow', areaM2: 100, pricePerM2: 12000 });
      makeTestListing({ id: 'out-3', city: 'TestCityAlpha', district: 'TestMokotow', areaM2: 80, pricePerM2: 11000 });

      const target = makeTestListing({
        id: 'target-area', city: 'TestCityAlpha', district: 'TestMokotow',
        areaM2: 50, pricePerM2: 15000,
      });
      const r = computePriceFairness(target);
      // 3 in-range < MIN_SAMPLE_SIZE (5) → fallback city; ale w city też mamy 3 in-range
      // Więc insufficient_data
      assert.equal(r.source, 'insufficient_data');
    });
  });

  describe('computeBatch', () => {
    beforeEach(cleanup);

    it('przelicza fairness dla wielu listings naraz', () => {
      for (let i = 1; i <= 6; i++) {
        makeTestListing({
          id: `b-${i}`, city: 'TestCityAlpha', district: 'TestMokotow',
          areaM2: 50, pricePerM2: 15000,
        });
      }
      const t1 = makeTestListing({ id: 't-b-1', city: 'TestCityAlpha', district: 'TestMokotow', areaM2: 50, pricePerM2: 15000 });
      const t2 = makeTestListing({ id: 't-b-2', city: 'TestCityAlpha', district: 'TestMokotow', areaM2: 50, pricePerM2: 13000 });

      const map = computeBatch([t1, t2]);
      assert.equal(map.size, 2);
      assert.equal(map.get('t-b-1').fairnessLabel, 'fair');
      assert.equal(map.get('t-b-2').fairnessLabel, 'below');
    });
  });
});
