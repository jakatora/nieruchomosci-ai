import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { haversineKm } from '../../src/services/geo.js';
import { db } from '../../src/db/index.js';
import { geocodingCache } from '../../src/db/repos.js';
import { nowIso } from '../../src/lib/ids.js';

/**
 * Testy services/geo.js — `geocode()` z fetch wymaga monkey-patcha global.fetch
 * (Node 22 ma fetch wbudowane). Robimy save+restore w setup/teardown.
 */

describe('services/geo', () => {
  describe('haversineKm — math correctness', () => {
    it('zwraca 0 dla tych samych współrzędnych', () => {
      const p = { lat: 52.2297, lng: 21.0122 }; // Warszawa
      assert.equal(haversineKm(p, p), 0);
    });

    it('Warszawa → Kraków ≈ 252 km (znana referencja)', () => {
      const warszawa = { lat: 52.2297, lng: 21.0122 };
      const krakow = { lat: 50.0647, lng: 19.9450 };
      const d = haversineKm(warszawa, krakow);
      // Real distance Warszawa-Kraków ≈ 252 km. Tolerancja ±5 km.
      assert.ok(d > 247 && d < 257, `Oczekiwane ~252 km, jest ${d.toFixed(1)}`);
    });

    it('Gdańsk → Zakopane ≈ 569 km', () => {
      const gdansk = { lat: 54.3520, lng: 18.6466 };
      const zakopane = { lat: 49.2992, lng: 19.9496 };
      const d = haversineKm(gdansk, zakopane);
      // Haversine z tymi konkretnymi współrzędnymi daje ~568.9 km.
      assert.ok(d > 565 && d < 575, `Oczekiwane ~569 km, jest ${d.toFixed(1)}`);
    });

    it('symetria — dystans(A,B) === dystans(B,A)', () => {
      const a = { lat: 52.2, lng: 21.0 };
      const b = { lat: 50.0, lng: 19.9 };
      assert.equal(haversineKm(a, b), haversineKm(b, a));
    });

    it('null przy brakujących współrzędnych', () => {
      assert.equal(haversineKm(null, { lat: 1, lng: 2 }), null);
      assert.equal(haversineKm({ lat: 1, lng: 2 }, null), null);
      assert.equal(haversineKm({ lat: null, lng: 2 }, { lat: 1, lng: 2 }), null);
      assert.equal(haversineKm({}, {}), null);
    });

    it('antipody — dystans = pół obwodu Ziemi (~20015 km)', () => {
      const a = { lat: 0, lng: 0 };
      const b = { lat: 0, lng: 180 };
      const d = haversineKm(a, b);
      // π × R = 3.14159 × 6371 = 20015 km
      assert.ok(d > 20000 && d < 20030, `Oczekiwane ~20015 km, jest ${d.toFixed(1)}`);
    });
  });

  describe('geocodingCache repo (cache lookup logic)', () => {
    const TEST_QUERY = `__test_geo_query_${Date.now()}__`;

    after(() => {
      // Sprzątanie po testach.
      db.prepare('DELETE FROM geocoding_cache WHERE query_text LIKE ?').run(`%__test_geo_query_%`);
    });

    it('findByQuery → null gdy brak entry', () => {
      const r = geocodingCache.findByQuery(`${TEST_QUERY}_miss`);
      assert.equal(r, null);
    });

    it('upsert + findByQuery (hit z lat/lng)', () => {
      geocodingCache.upsert(TEST_QUERY, { lat: 52.5, lng: 21.0, city: 'Test', district: 'TestDist' });
      const r = geocodingCache.findByQuery(TEST_QUERY);
      assert.ok(r);
      assert.equal(r.lat, 52.5);
      assert.equal(r.lng, 21.0);
      assert.equal(r.city, 'Test');
      assert.equal(r.district, 'TestDist');
    });

    it('upsert(null) — negative cache (brak wyników z API)', () => {
      const negKey = `${TEST_QUERY}_neg`;
      geocodingCache.upsert(negKey, null);
      const r = geocodingCache.findByQuery(negKey);
      assert.ok(r); // entry istnieje
      assert.equal(r.lat, null);
      assert.equal(r.lng, null);
    });

    it('upsert override (drugie wywołanie aktualizuje)', () => {
      const k = `${TEST_QUERY}_update`;
      geocodingCache.upsert(k, { lat: 1, lng: 2 });
      geocodingCache.upsert(k, { lat: 10, lng: 20, city: 'NewCity' });
      const r = geocodingCache.findByQuery(k);
      assert.equal(r.lat, 10);
      assert.equal(r.lng, 20);
      assert.equal(r.city, 'NewCity');
    });

    it('case-insensitive normalization (same hash dla różnego case)', () => {
      const upper = `${TEST_QUERY}_CASE`;
      const lower = `${TEST_QUERY}_case`;
      geocodingCache.upsert(upper, { lat: 99, lng: 99 });
      // Lookup z lowercase powinien znaleźć ten sam wpis (sha256 z .toLowerCase()).
      const r = geocodingCache.findByQuery(lower);
      assert.ok(r);
      assert.equal(r.lat, 99);
    });

    it('pruneOlderThan — usuwanie starych wpisów', () => {
      // Wstaw wpis ze starą datą.
      const oldKey = `${TEST_QUERY}_old`;
      const oldDate = new Date(Date.now() - 100 * 86400_000).toISOString();
      geocodingCache.upsert(oldKey, { lat: 0, lng: 0 });
      db.prepare('UPDATE geocoding_cache SET cached_at = ? WHERE query_text = ?').run(oldDate, oldKey);

      const removed = geocodingCache.pruneOlderThan(60);
      assert.ok(removed >= 1);
      assert.equal(geocodingCache.findByQuery(oldKey), null);
    });
  });
});
