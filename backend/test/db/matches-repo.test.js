import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../src/db/index.js';
import { users, listings, searches, matches } from '../../src/db/repos.js';
import { newId, nowIso } from '../../src/lib/ids.js';

/**
 * matches repo — DB integration tests.
 *
 * Pokrycie:
 *   - UPSERT z ON CONFLICT(user_id, listing_id) DO NOTHING (dedupe — krytyczne dla daily cron)
 *   - listByUser z JOIN do listings (publicMatch contract)
 *   - countTodayByUser (free tier daily limit)
 *   - markSeen/markSaved/markNotified
 *   - listUnnotified ASC sort (push delivery queue)
 *   - cascade on user delete + listing delete
 */

const TEST_PREFIX = 'repo-matches-test-';

let user;
let listing1;
let listing2;
let search;

function fullCleanup() {
  db.prepare(`DELETE FROM matches WHERE user_id IN (SELECT id FROM users WHERE email LIKE ?)`)
    .run(`${TEST_PREFIX}%`);
  db.prepare(`DELETE FROM searches WHERE user_id IN (SELECT id FROM users WHERE email LIKE ?)`)
    .run(`${TEST_PREFIX}%`);
  db.prepare(`DELETE FROM users WHERE email LIKE ?`).run(`${TEST_PREFIX}%`);
  db.prepare(`DELETE FROM listings WHERE source = ?`).run('matches-test');
}

function makeListing(sid = 'a') {
  return listings.upsert({
    source: 'matches-test',
    source_id: `${sid}-${newId().slice(0, 6)}`,
    url: `https://example.com/${sid}`,
    title: `Test listing ${sid}`,
    price_pln: 700000,
    area_m2: 50,
    price_per_m2: 14000,
    city: 'Warszawa',
    district: 'Mokotów',
    photos: [],
    raw_data: {},
    fetched_at: nowIso(),
    status: 'active',
  });
}

before(() => {
  fullCleanup();
  user = users.create({ email: `${TEST_PREFIX}main@test.local`, userType: 'investor' });
  listing1 = listings.findById(makeListing('l1'));
  listing2 = listings.findById(makeListing('l2'));
  search = searches.create(user.id, { name: 'Test search', city: 'Warszawa' });
});

beforeEach(() => {
  db.prepare(`DELETE FROM matches WHERE user_id = ?`).run(user.id);
});

after(fullCleanup);

describe('matches repo — DB integration', () => {
  describe('create + dedupe (ON CONFLICT DO NOTHING)', () => {
    it('tworzy match z minimum', () => {
      const m = matches.create({
        userId: user.id,
        listingId: listing1.id,
        confidenceScore: 75,
      });
      assert.ok(m);
      assert.equal(m.user_id, user.id);
      assert.equal(m.listing_id, listing1.id);
      assert.equal(m.confidence_score, 75);
      assert.equal(m.scorer, 'ai');  // default
      assert.equal(m.price_fairness, 'unknown'); // default
      assert.equal(m.user_seen, 0);
      assert.equal(m.user_saved, 0);
      assert.equal(m.notified, 0);
    });

    it('JSON red_flags (array → string)', () => {
      const flags = [
        { type: 'price_vs_market', severity: 'high', text: 'Above mediana' },
        { type: 'photos_missing', severity: 'low', text: 'Brak zdjęć' },
      ];
      const m = matches.create({
        userId: user.id, listingId: listing1.id,
        confidenceScore: 60, redFlags: flags,
      });
      assert.deepEqual(JSON.parse(m.red_flags), flags);
    });

    it('drugi create z tym samym (user_id, listing_id) → DO NOTHING (zwraca pierwszy match)', () => {
      const m1 = matches.create({
        userId: user.id, listingId: listing1.id, confidenceScore: 70,
      });
      const m2 = matches.create({
        userId: user.id, listingId: listing1.id, confidenceScore: 99, // próba nadpisania
      });
      // Drugi insert był DO NOTHING — zwraca istniejący match
      assert.equal(m2.id, m1.id);
      assert.equal(m2.confidence_score, 70); // pierwsza wartość zachowana
    });

    it('różne listings → 2 osobne matches', () => {
      matches.create({ userId: user.id, listingId: listing1.id, confidenceScore: 70 });
      matches.create({ userId: user.id, listingId: listing2.id, confidenceScore: 80 });
      const all = matches.listByUser(user.id);
      assert.equal(all.length, 2);
    });

    it('zapisuje search_id (link do source search)', () => {
      const m = matches.create({
        userId: user.id, listingId: listing1.id,
        confidenceScore: 75, searchId: search.id,
      });
      assert.equal(m.search_id, search.id);
    });

    it('rzuca przy CHECK constraint na confidence_score (poza 0-100)', () => {
      assert.throws(() => matches.create({
        userId: user.id, listingId: listing1.id, confidenceScore: 150,
      }), /CHECK/i);
    });

    it('rzuca przy CHECK constraint na price_fairness', () => {
      assert.throws(() => matches.create({
        userId: user.id, listingId: listing1.id,
        confidenceScore: 75, priceFairness: 'invalid_value',
      }), /CHECK/i);
    });
  });

  describe('findByUserListing', () => {
    it('zwraca match albo null', () => {
      assert.equal(matches.findByUserListing(user.id, listing1.id), null);
      matches.create({ userId: user.id, listingId: listing1.id, confidenceScore: 70 });
      const found = matches.findByUserListing(user.id, listing1.id);
      assert.ok(found);
      assert.equal(found.user_id, user.id);
      assert.equal(found.listing_id, listing1.id);
    });
  });

  describe('listByUser z JOIN do listings', () => {
    it('zwraca matches z denormalized listing fields (prefix `listing_`)', () => {
      matches.create({ userId: user.id, listingId: listing1.id, confidenceScore: 70 });
      const list = matches.listByUser(user.id, { limit: 10 });
      assert.equal(list.length, 1);
      const m = list[0];
      // JOIN fields są dostępne
      assert.equal(m.listing_id, listing1.id);
      assert.equal(m.listing_source, 'matches-test');
      assert.equal(m.listing_title, listing1.title);
      assert.equal(m.listing_price_pln, listing1.price_pln);
      assert.equal(m.listing_city, listing1.city);
      assert.equal(m.listing_district, listing1.district);
    });

    it('sort DESC po created_at', async () => {
      matches.create({ userId: user.id, listingId: listing1.id, confidenceScore: 70 });
      await new Promise((r) => setTimeout(r, 5));
      matches.create({ userId: user.id, listingId: listing2.id, confidenceScore: 80 });
      const list = matches.listByUser(user.id);
      // Listing2 dodany później → pierwszy
      assert.equal(list[0].listing_id, listing2.id);
    });

    it('onlyUnseen filtruje user_seen = 0', () => {
      matches.create({ userId: user.id, listingId: listing1.id, confidenceScore: 70 });
      matches.create({ userId: user.id, listingId: listing2.id, confidenceScore: 80 });
      const m1 = matches.findByUserListing(user.id, listing1.id);
      matches.markSeen(m1.id);

      const all = matches.listByUser(user.id, { onlyUnseen: false });
      assert.equal(all.length, 2);

      const unseen = matches.listByUser(user.id, { onlyUnseen: true });
      assert.equal(unseen.length, 1);
      assert.equal(unseen[0].user_seen, 0);
    });

    it('limit respektowany', () => {
      matches.create({ userId: user.id, listingId: listing1.id, confidenceScore: 70 });
      matches.create({ userId: user.id, listingId: listing2.id, confidenceScore: 80 });
      const list = matches.listByUser(user.id, { limit: 1 });
      assert.equal(list.length, 1);
    });
  });

  describe('countTodayByUser (free tier daily limit)', () => {
    it('zlicza tylko dzisiejsze matches', () => {
      matches.create({ userId: user.id, listingId: listing1.id, confidenceScore: 70 });
      const n = matches.countTodayByUser(user.id);
      assert.equal(n, 1);
    });

    it('zero gdy brak matchy', () => {
      assert.equal(matches.countTodayByUser(user.id), 0);
    });

    it('NIE liczy wczorajszych (manual created_at update)', () => {
      // Manual insert z wczorajszą datą
      const yesterday = new Date(Date.now() - 24 * 3600_000).toISOString();
      db.prepare(`
        INSERT INTO matches (id, user_id, search_id, listing_id, confidence_score, price_fairness, red_flags, created_at, notified, user_seen, user_saved, scorer)
        VALUES (?, ?, ?, ?, ?, 'unknown', '[]', ?, 0, 0, 0, 'ai')
      `).run(newId(), user.id, null, listing1.id, 70, yesterday);
      const n = matches.countTodayByUser(user.id);
      assert.equal(n, 0); // wczorajszy nie liczy
    });
  });

  describe('markSeen / markSaved / markNotified', () => {
    it('markSeen: user_seen 0 → 1', () => {
      const m = matches.create({ userId: user.id, listingId: listing1.id, confidenceScore: 70 });
      matches.markSeen(m.id);
      const fresh = matches.findByUserListing(user.id, listing1.id);
      assert.equal(fresh.user_seen, 1);
    });

    it('markSaved: bool → 0/1', () => {
      const m = matches.create({ userId: user.id, listingId: listing1.id, confidenceScore: 70 });
      matches.markSaved(m.id, true);
      assert.equal(matches.findByUserListing(user.id, listing1.id).user_saved, 1);
      matches.markSaved(m.id, false);
      assert.equal(matches.findByUserListing(user.id, listing1.id).user_saved, 0);
    });

    it('markSaved default = true', () => {
      const m = matches.create({ userId: user.id, listingId: listing1.id, confidenceScore: 70 });
      matches.markSaved(m.id);
      assert.equal(matches.findByUserListing(user.id, listing1.id).user_saved, 1);
    });

    it('markNotified: batch update wielu matchy', () => {
      const m1 = matches.create({ userId: user.id, listingId: listing1.id, confidenceScore: 70 });
      const m2 = matches.create({ userId: user.id, listingId: listing2.id, confidenceScore: 80 });
      matches.markNotified([m1.id, m2.id]);
      assert.equal(matches.findByUserListing(user.id, listing1.id).notified, 1);
      assert.equal(matches.findByUserListing(user.id, listing2.id).notified, 1);
    });

    it('markNotified: empty array → no-op (defensive)', () => {
      assert.doesNotThrow(() => matches.markNotified([]));
      assert.doesNotThrow(() => matches.markNotified(null));
      assert.doesNotThrow(() => matches.markNotified(undefined));
    });
  });

  describe('listUnnotified (push delivery queue)', () => {
    it('zwraca tylko notified=0', () => {
      const m1 = matches.create({ userId: user.id, listingId: listing1.id, confidenceScore: 70 });
      const m2 = matches.create({ userId: user.id, listingId: listing2.id, confidenceScore: 80 });
      matches.markNotified([m1.id]);
      const queue = matches.listUnnotified();
      const ids = queue.map((m) => m.id);
      assert.ok(!ids.includes(m1.id)); // m1 already notified
      assert.ok(ids.includes(m2.id)); // m2 still pending
    });

    it('sort ASC po created_at (FIFO queue)', async () => {
      const m1 = matches.create({ userId: user.id, listingId: listing1.id, confidenceScore: 70 });
      await new Promise((r) => setTimeout(r, 5));
      matches.create({ userId: user.id, listingId: listing2.id, confidenceScore: 80 });
      const queue = matches.listUnnotified();
      // m1 utworzony wcześniej → pierwszy w ASC
      const idx1 = queue.findIndex((m) => m.id === m1.id);
      const idx2 = queue.findIndex((m) => m.listing_id === listing2.id);
      assert.ok(idx1 < idx2);
    });

    it('limit respektowany (default 200)', () => {
      const queue = matches.listUnnotified(50);
      assert.ok(queue.length <= 50);
    });
  });

  describe('cascade', () => {
    it('usunięcie listing kasuje matches (ON DELETE CASCADE)', () => {
      const tempListing = listings.findById(makeListing('cascade'));
      matches.create({ userId: user.id, listingId: tempListing.id, confidenceScore: 75 });
      db.prepare('DELETE FROM listings WHERE id = ?').run(tempListing.id);
      assert.equal(matches.findByUserListing(user.id, tempListing.id), null);
    });

    it('usunięcie searches → match.search_id = NULL (ON DELETE SET NULL)', () => {
      const tempSearch = searches.create(user.id, { name: 'Temp', city: 'X' });
      const m = matches.create({
        userId: user.id, listingId: listing1.id,
        confidenceScore: 75, searchId: tempSearch.id,
      });
      db.prepare('DELETE FROM searches WHERE id = ?').run(tempSearch.id);
      const fresh = matches.findByUserListing(user.id, listing1.id);
      assert.equal(fresh.search_id, null); // SET NULL działa, match zachowany
    });
  });
});
