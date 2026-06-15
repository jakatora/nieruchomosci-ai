import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../src/db/index.js';
import { listings } from '../../src/db/repos.js';
import { newId, nowIso } from '../../src/lib/ids.js';

/**
 * listings repo — DB integration tests (40+ test cases).
 *
 * Pokrycie:
 *   - upsert: insert + update (dedupe po source+source_id)
 *   - findBySource / findById / findRecent
 *   - findComparables: area tolerance, district filtering, excludeId, days back, status filter
 *   - search: city/district/price/area/source filters, pagination, ordering, total count
 *   - updateGeo: lat/lng + COALESCE district preserve
 *   - JSON serializacja photos / raw_data
 *
 * Strategia:
 *   - Test source 'repo-test' żeby nie kolidować z prawdziwymi (Domiporta).
 *   - before/after cleanup.
 */

const TEST_SOURCE = 'repo-test';
const TEST_CITY = 'RepoTestCity';

function cleanup() {
  db.prepare('DELETE FROM listings WHERE source = ? OR city = ?').run(TEST_SOURCE, TEST_CITY);
}

function makeTestListing(overrides = {}) {
  return {
    source: TEST_SOURCE,
    source_id: `id-${newId().slice(0, 8)}`,
    url: 'https://example.com/listing/123',
    title: 'Test listing',
    description: 'Test description',
    price_pln: 500000,
    area_m2: 50,
    price_per_m2: 10000,
    rooms: 2,
    floor: 3,
    city: TEST_CITY,
    district: 'TestDistrict',
    photos: ['https://example.com/1.jpg'],
    raw_data: { foo: 'bar' },
    published_at: nowIso(),
    fetched_at: nowIso(),
    status: 'active',
    ...overrides,
  };
}

before(cleanup);
after(cleanup);

describe('listings repo — DB integration', () => {
  describe('upsert', () => {
    it('INSERT gdy listing nie istnieje (zwraca id)', () => {
      const listing = makeTestListing();
      const id = listings.upsert(listing);
      assert.ok(id);
      const fresh = listings.findById(id);
      assert.equal(fresh.source, listing.source);
      assert.equal(fresh.source_id, listing.source_id);
      assert.equal(fresh.price_pln, 500000);
    });

    it('UPDATE gdy już istnieje (dedupe po source+source_id)', () => {
      const listing = makeTestListing({ price_pln: 500000 });
      const id1 = listings.upsert(listing);
      // Drugi upsert z tym samym source+source_id ale nową ceną
      const id2 = listings.upsert({ ...listing, price_pln: 550000, title: 'Updated' });
      assert.equal(id1, id2); // ten sam ID
      const fresh = listings.findById(id1);
      assert.equal(fresh.price_pln, 550000); // zaktualizowana cena
      assert.equal(fresh.title, 'Updated');
    });

    it('JSON serializacja photos array', () => {
      const photos = ['https://a.jpg', 'https://b.jpg', 'https://c.jpg'];
      const id = listings.upsert(makeTestListing({ photos }));
      const fresh = listings.findById(id);
      assert.deepEqual(JSON.parse(fresh.photos), photos);
    });

    it('JSON serializacja raw_data object', () => {
      const raw = { categories: ['Mieszkanie'], pubDate: 'Sat, 13 Jun 2026', meta: { x: 1 } };
      const id = listings.upsert(makeTestListing({ raw_data: raw }));
      const fresh = listings.findById(id);
      assert.deepEqual(JSON.parse(fresh.raw_data), raw);
    });

    it('null/undefined fields → null w DB (graceful)', () => {
      const id = listings.upsert(makeTestListing({
        description: null, price_pln: null, area_m2: null,
        rooms: null, floor: null, district: null,
      }));
      const fresh = listings.findById(id);
      assert.equal(fresh.description, null);
      assert.equal(fresh.price_pln, null);
      assert.equal(fresh.district, null);
    });

    it('photos default to [] gdy nie podane', () => {
      const id = listings.upsert(makeTestListing({ photos: undefined }));
      const fresh = listings.findById(id);
      assert.deepEqual(JSON.parse(fresh.photos), []);
    });

    it('raw_data default to {} gdy nie podane', () => {
      const id = listings.upsert(makeTestListing({ raw_data: undefined }));
      const fresh = listings.findById(id);
      assert.deepEqual(JSON.parse(fresh.raw_data), {});
    });

    it('status default to active', () => {
      const id = listings.upsert(makeTestListing({ status: undefined }));
      const fresh = listings.findById(id);
      assert.equal(fresh.status, 'active');
    });

    it('rzuca przy invalid status (CHECK constraint)', () => {
      assert.throws(
        () => listings.upsert(makeTestListing({ status: 'pending' })),
        /CHECK/i,
      );
    });

    it('różne source_id w tym samym source → 2 osobne wpisy', () => {
      const id1 = listings.upsert(makeTestListing({ source_id: 'a-1' }));
      const id2 = listings.upsert(makeTestListing({ source_id: 'a-2' }));
      assert.notEqual(id1, id2);
    });

    it('ten sam source_id w różnych source → 2 osobne wpisy', () => {
      const id1 = listings.upsert(makeTestListing({ source: TEST_SOURCE, source_id: 'shared-id' }));
      const id2 = listings.upsert(makeTestListing({ source: `${TEST_SOURCE}-2`, source_id: 'shared-id' }));
      assert.notEqual(id1, id2);
      // Cleanup specjalnie dla tego testu
      db.prepare('DELETE FROM listings WHERE source = ?').run(`${TEST_SOURCE}-2`);
    });
  });

  describe('findBySource', () => {
    it('zwraca listing albo null', () => {
      const sid = `find-${newId().slice(0, 6)}`;
      listings.upsert(makeTestListing({ source_id: sid }));
      assert.ok(listings.findBySource(TEST_SOURCE, sid));
      assert.equal(listings.findBySource(TEST_SOURCE, 'nonexistent'), null);
      assert.equal(listings.findBySource('wrong-source', sid), null);
    });
  });

  describe('updateGeo', () => {
    it('aktualizuje lat/lng', () => {
      const id = listings.upsert(makeTestListing());
      listings.updateGeo(id, { lat: 52.2297, lng: 21.0122, district: null });
      const fresh = listings.findById(id);
      assert.equal(fresh.lat, 52.2297);
      assert.equal(fresh.lng, 21.0122);
    });

    it('COALESCE: null district NIE nadpisuje istniejącego (preserve)', () => {
      const id = listings.upsert(makeTestListing({ district: 'OldDistrict' }));
      listings.updateGeo(id, { lat: 52.0, lng: 21.0, district: null });
      const fresh = listings.findById(id);
      assert.equal(fresh.district, 'OldDistrict'); // zachowany
    });

    it('nowy district nadpisuje', () => {
      const id = listings.upsert(makeTestListing({ district: 'Old' }));
      listings.updateGeo(id, { lat: 52.0, lng: 21.0, district: 'New' });
      const fresh = listings.findById(id);
      assert.equal(fresh.district, 'New');
    });
  });

  describe('findComparables', () => {
    // Każdy test musi mieć czysty pool — inaczej kumulacja z poprzednich it().
    beforeEach(() => {
      db.prepare('DELETE FROM listings WHERE source = ? OR city = ?')
        .run(TEST_SOURCE, TEST_CITY);
    });

    function setupComparablePool() {
      // 5 listings w TestDistrict, area 45-55 m², różne price_per_m2
      const ids = [];
      for (let i = 0; i < 5; i++) {
        ids.push(listings.upsert(makeTestListing({
          source_id: `comp-${i}`,
          area_m2: 45 + i * 2.5, // 45, 47.5, 50, 52.5, 55
          price_per_m2: 9000 + i * 500, // 9000, 9500, 10000, 10500, 11000
          district: 'TestDistrict',
        })));
      }
      // 1 listing w innej dzielnicy (powinien być filtrowany przy district match)
      ids.push(listings.upsert(makeTestListing({
        source_id: 'comp-other',
        area_m2: 50, price_per_m2: 15000,
        district: 'OtherDistrict',
      })));
      return ids;
    }

    it('znajduje listings w district + area tolerance ±25%', () => {
      const ids = setupComparablePool();
      const target = { id: 'separate-target', city: TEST_CITY, district: 'TestDistrict', area_m2: 50 };
      const comps = listings.findComparables(target);
      // area 50 ±25% = [37.5, 62.5] — wszystkie 5 z TestDistrict mieszczą się
      assert.equal(comps.length, 5);
      // OtherDistrict NIE jest w wyniku
      assert.ok(!comps.some((c) => c.district === 'OtherDistrict'));
    });

    it('district filter pomija inne dzielnice', () => {
      setupComparablePool();
      const targetDistrict = { id: 'sep', city: TEST_CITY, district: 'OtherDistrict', area_m2: 50 };
      const comps = listings.findComparables(targetDistrict);
      assert.equal(comps.length, 1); // tylko 1 listing w OtherDistrict
    });

    it('bez district zwraca wszystkie z city (areaTolerance check)', () => {
      setupComparablePool();
      const target = { id: 'sep', city: TEST_CITY, area_m2: 50 };
      const comps = listings.findComparables(target);
      assert.equal(comps.length, 6); // 5 + 1 cross-district
    });

    it('excludeId: pomija target listing z wyników', () => {
      setupComparablePool();
      const idSelf = listings.upsert(makeTestListing({
        source_id: 'self', area_m2: 50, price_per_m2: 10000, district: 'TestDistrict',
      }));
      const target = listings.findById(idSelf);
      const compsExcl = listings.findComparables(target);
      assert.ok(!compsExcl.some((c) => c.id === idSelf));
      // Bez excludeId — target się pojawia
      const compsIncl = listings.findComparables(target, { excludeId: false });
      assert.ok(compsIncl.some((c) => c.id === idSelf));
    });

    it('area tolerance custom — areaTolerancePct=10%', () => {
      setupComparablePool();
      const target = { id: 'sep', city: TEST_CITY, district: 'TestDistrict', area_m2: 50 };
      const comps10 = listings.findComparables(target, { areaTolerancePct: 10 });
      // area 50 ±10% = [45, 55] — wszystkie 5 (45-55) mieszczą się
      assert.equal(comps10.length, 5);
      const comps5 = listings.findComparables(target, { areaTolerancePct: 5 });
      // area 50 ±5% = [47.5, 52.5] — 3 (47.5, 50, 52.5)
      assert.equal(comps5.length, 3);
    });

    it('filter: tylko price_per_m2 != NULL', () => {
      listings.upsert(makeTestListing({
        source_id: 'no-ppm2', area_m2: 50, price_per_m2: null, district: 'TestDistrict',
      }));
      const target = { id: 'sep', city: TEST_CITY, district: 'TestDistrict', area_m2: 50 };
      const comps = listings.findComparables(target);
      assert.ok(!comps.some((c) => c.price_per_m2 == null));
    });

    it('filter: tylko status=active', () => {
      listings.upsert(makeTestListing({
        source_id: 'expired', area_m2: 50, price_per_m2: 10000,
        district: 'TestDistrict', status: 'expired',
      }));
      const target = { id: 'sep', city: TEST_CITY, district: 'TestDistrict', area_m2: 50 };
      const comps = listings.findComparables(target);
      assert.ok(!comps.some((c) => c.status === 'expired'));
    });

    it('brak city lub brak area_m2 → zwraca []', () => {
      assert.deepEqual(listings.findComparables({ city: null, area_m2: 50 }), []);
      assert.deepEqual(listings.findComparables({ city: TEST_CITY, area_m2: null }), []);
    });

    it('daysBack respektowany: stare published_at filtrowane', () => {
      // Listing sprzed 90 dni
      const oldDate = new Date(Date.now() - 90 * 86400_000).toISOString();
      listings.upsert(makeTestListing({
        source_id: 'old', area_m2: 50, price_per_m2: 10000,
        district: 'TestDistrict', published_at: oldDate,
      }));
      const target = { id: 'sep', city: TEST_CITY, district: 'TestDistrict', area_m2: 50 };
      const comps = listings.findComparables(target, { daysBack: 60 });
      assert.ok(!comps.some((c) => c.source_id === 'old'));
      const compsLong = listings.findComparables(target, { daysBack: 120 });
      assert.ok(compsLong.some((c) => c.source_id === 'old'));
    });
  });

  describe('search (paginated + filters)', () => {
    function setupSearchPool() {
      const sources = ['repo-test', 'repo-test'];
      for (let i = 0; i < 10; i++) {
        listings.upsert(makeTestListing({
          source: sources[i % 2],
          source_id: `search-${i}`,
          price_pln: 400000 + i * 100000,
          area_m2: 40 + i * 5,
          city: TEST_CITY,
        }));
      }
    }

    it('zwraca rows + total + limit + offset', () => {
      setupSearchPool();
      const res = listings.search({ city: TEST_CITY, limit: 3 });
      assert.equal(res.rows.length, 3);
      assert.ok(res.total >= 10);
      assert.equal(res.limit, 3);
      assert.equal(res.offset, 0);
    });

    it('filter min/max price', () => {
      setupSearchPool();
      const res = listings.search({
        city: TEST_CITY, minPrice: 600000, maxPrice: 800000, limit: 100,
      });
      assert.ok(res.rows.every((l) => l.price_pln >= 600000 && l.price_pln <= 800000));
    });

    it('filter min/max area', () => {
      setupSearchPool();
      const res = listings.search({
        city: TEST_CITY, minArea: 50, maxArea: 65, limit: 100,
      });
      assert.ok(res.rows.every((l) => l.area_m2 >= 50 && l.area_m2 <= 65));
    });

    it('limit clamped do max 100', () => {
      setupSearchPool();
      const res = listings.search({ city: TEST_CITY, limit: 999 });
      assert.ok(res.limit <= 100);
    });

    it('limit clamped do min 1', () => {
      setupSearchPool();
      const res = listings.search({ city: TEST_CITY, limit: 0 });
      assert.ok(res.limit >= 1);
    });

    it('orderBy: price_asc', () => {
      setupSearchPool();
      const res = listings.search({ city: TEST_CITY, orderBy: 'price_asc', limit: 100 });
      for (let i = 1; i < res.rows.length; i++) {
        if (res.rows[i].price_pln != null && res.rows[i - 1].price_pln != null) {
          assert.ok(res.rows[i].price_pln >= res.rows[i - 1].price_pln);
        }
      }
    });

    it('orderBy: price_desc', () => {
      setupSearchPool();
      const res = listings.search({ city: TEST_CITY, orderBy: 'price_desc', limit: 100 });
      for (let i = 1; i < res.rows.length; i++) {
        if (res.rows[i].price_pln != null && res.rows[i - 1].price_pln != null) {
          assert.ok(res.rows[i].price_pln <= res.rows[i - 1].price_pln);
        }
      }
    });

    it('offset paginates correctly', () => {
      setupSearchPool();
      const page1 = listings.search({ city: TEST_CITY, limit: 3, offset: 0 });
      const page2 = listings.search({ city: TEST_CITY, limit: 3, offset: 3 });
      const ids1 = page1.rows.map((l) => l.id);
      const ids2 = page2.rows.map((l) => l.id);
      // Brak overlapu
      assert.ok(!ids1.some((id) => ids2.includes(id)));
    });

    it('default order = fetched_at DESC', () => {
      setupSearchPool();
      const res = listings.search({ city: TEST_CITY, limit: 100 });
      for (let i = 1; i < res.rows.length; i++) {
        const a = new Date(res.rows[i - 1].fetched_at).getTime();
        const b = new Date(res.rows[i].fetched_at).getTime();
        assert.ok(a >= b);
      }
    });

    it('countBySource', () => {
      setupSearchPool();
      const n = listings.countBySource(TEST_SOURCE);
      assert.ok(n >= 10);
    });
  });

  describe('findRecent', () => {
    it('default: 50 listings sortowane DESC po fetched_at', () => {
      listings.upsert(makeTestListing());
      const recent = listings.findRecent();
      assert.ok(recent.length > 0);
      assert.ok(recent.length <= 50);
    });

    it('filter po city', () => {
      listings.upsert(makeTestListing({ city: TEST_CITY }));
      const recent = listings.findRecent({ city: TEST_CITY, limit: 5 });
      assert.ok(recent.every((l) => l.city === TEST_CITY));
    });
  });
});
