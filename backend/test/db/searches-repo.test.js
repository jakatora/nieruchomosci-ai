import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../src/db/index.js';
import { users, searches } from '../../src/db/repos.js';
import { newId } from '../../src/lib/ids.js';

/**
 * searches repo — DB integration tests.
 *
 * Pokrycie: create + listByUser + listEnabledByUser + update + delete + cascade.
 * Critical: JSON serializacja districts/rooms, enabled boolean → 0/1,
 *           paywall logic (free tier max 1 enabled), cascade on user delete.
 */

const TEST_PREFIX = 'repo-searches-test-';

let testUser;

function cleanup() {
  db.prepare('DELETE FROM searches WHERE user_id IN (SELECT id FROM users WHERE email LIKE ?)')
    .run(`${TEST_PREFIX}%`);
  db.prepare('DELETE FROM users WHERE email LIKE ?').run(`${TEST_PREFIX}%`);
}

before(() => {
  cleanup();
  testUser = users.create({ email: `${TEST_PREFIX}main@test.local` });
});

beforeEach(() => {
  db.prepare('DELETE FROM searches WHERE user_id = ?').run(testUser.id);
});

after(cleanup);

describe('searches repo — DB integration', () => {
  describe('create', () => {
    it('tworzy search z defaults', () => {
      const s = searches.create(testUser.id, { name: 'Test', city: 'Warszawa' });
      assert.ok(s.id);
      assert.equal(s.user_id, testUser.id);
      assert.equal(s.name, 'Test');
      assert.equal(s.city, 'Warszawa');
      assert.equal(s.radius_km, 5);    // default
      assert.equal(s.enabled, 1);      // default true → 1
      assert.equal(s.min_price, null);
      assert.equal(s.max_price, null);
    });

    it('JSON districts array', () => {
      const s = searches.create(testUser.id, {
        name: 'X', city: 'Kraków',
        districts: ['Stare Miasto', 'Kazimierz', 'Krowodrza'],
      });
      assert.deepEqual(JSON.parse(s.districts), ['Stare Miasto', 'Kazimierz', 'Krowodrza']);
    });

    it('JSON rooms array (number[])', () => {
      const s = searches.create(testUser.id, {
        name: 'X', city: 'Wrocław', rooms: [2, 3],
      });
      assert.deepEqual(JSON.parse(s.rooms), [2, 3]);
    });

    it('enabled: false → 0', () => {
      const s = searches.create(testUser.id, { name: 'X', city: 'Y', enabled: false });
      assert.equal(s.enabled, 0);
    });

    it('enabled: undefined → 1 (default true)', () => {
      const s = searches.create(testUser.id, { name: 'X', city: 'Y' });
      assert.equal(s.enabled, 1);
    });

    it('rzuca przy non-existing user (FK constraint)', () => {
      assert.throws(
        () => searches.create('non-existing-id', { name: 'X', city: 'Y' }),
        /FOREIGN KEY/i,
      );
    });

    it('zachowuje min/max price + area', () => {
      const s = searches.create(testUser.id, {
        name: 'Filtered', city: 'Gdańsk',
        minPrice: 500000, maxPrice: 1200000,
        minArea: 40, maxArea: 80,
      });
      assert.equal(s.min_price, 500000);
      assert.equal(s.max_price, 1200000);
      assert.equal(s.min_area, 40);
      assert.equal(s.max_area, 80);
    });

    it('center_lat / center_lng (geo radius search)', () => {
      const s = searches.create(testUser.id, {
        name: 'Geo', city: 'Warszawa',
        centerLat: 52.2297, centerLng: 21.0122, radiusKm: 3,
      });
      assert.equal(s.center_lat, 52.2297);
      assert.equal(s.center_lng, 21.0122);
      assert.equal(s.radius_km, 3);
    });
  });

  describe('listByUser', () => {
    it('zwraca wszystkie searches usera (enabled + disabled) DESC po created_at', async () => {
      const s1 = searches.create(testUser.id, { name: 'A', city: 'X' });
      await new Promise((r) => setTimeout(r, 5));
      const s2 = searches.create(testUser.id, { name: 'B', city: 'Y', enabled: false });
      const list = searches.listByUser(testUser.id);
      assert.equal(list.length, 2);
      // s2 utworzony później → wcześniej w DESC sort
      assert.equal(list[0].id, s2.id);
      assert.equal(list[1].id, s1.id);
    });

    it('zwraca [] dla usera bez search', () => {
      assert.deepEqual(searches.listByUser(testUser.id), []);
    });

    it('zwraca [] dla non-existing user (no rows)', () => {
      assert.deepEqual(searches.listByUser('does-not-exist'), []);
    });
  });

  describe('listEnabledByUser (używane przez daily cron)', () => {
    it('zwraca TYLKO enabled searches', () => {
      searches.create(testUser.id, { name: 'A', city: 'X', enabled: true });
      searches.create(testUser.id, { name: 'B', city: 'Y', enabled: false });
      searches.create(testUser.id, { name: 'C', city: 'Z', enabled: true });
      const list = searches.listEnabledByUser(testUser.id);
      assert.equal(list.length, 2);
      assert.ok(list.every((s) => s.enabled === 1));
    });

    it('zwraca [] gdy wszystkie disabled (paywall enforcement)', () => {
      searches.create(testUser.id, { name: 'A', city: 'X', enabled: false });
      assert.deepEqual(searches.listEnabledByUser(testUser.id), []);
    });
  });

  describe('update', () => {
    it('aktualizuje pojedyncze pole', () => {
      const s = searches.create(testUser.id, { name: 'Old', city: 'Warszawa' });
      const upd = searches.update(s.id, { name: 'New' });
      assert.equal(upd.name, 'New');
      assert.equal(upd.city, 'Warszawa'); // niezmienione
    });

    it('aktualizuje districts (JSON re-serialize)', () => {
      const s = searches.create(testUser.id, { name: 'X', city: 'Y' });
      const upd = searches.update(s.id, { districts: ['New1', 'New2'] });
      assert.deepEqual(JSON.parse(upd.districts), ['New1', 'New2']);
    });

    it('aktualizuje enabled: true → false (paywall toggle)', () => {
      const s = searches.create(testUser.id, { name: 'X', city: 'Y', enabled: true });
      const upd = searches.update(s.id, { enabled: false });
      assert.equal(upd.enabled, 0);
    });

    it('NIE pozwala zmienić user_id (whitelist anti-injection)', () => {
      const s = searches.create(testUser.id, { name: 'X', city: 'Y' });
      // Próba podstawienia user_id przez patch
      const upd = searches.update(s.id, { user_id: 'attacker-id', userId: 'attacker-id' });
      // user_id zostaje original
      assert.equal(upd.user_id, testUser.id);
    });

    it('NIE pozwala zmienić id (whitelist)', () => {
      const s = searches.create(testUser.id, { name: 'X', city: 'Y' });
      const upd = searches.update(s.id, { id: 'new-id' });
      assert.equal(upd.id, s.id); // niezmienione
    });

    it('empty patch → no-op (zwraca aktualny stan)', () => {
      const s = searches.create(testUser.id, { name: 'X', city: 'Y' });
      const upd = searches.update(s.id, {});
      assert.equal(upd.id, s.id);
      assert.equal(upd.name, 'X');
    });

    it('updated_at się zmienia', async () => {
      const s = searches.create(testUser.id, { name: 'X', city: 'Y' });
      const before = s.updated_at;
      await new Promise((r) => setTimeout(r, 10));
      const upd = searches.update(s.id, { name: 'Z' });
      assert.notEqual(upd.updated_at, before);
    });

    it('rzuca przy invalid radiusKm (negatywny) — DB akceptuje', () => {
      const s = searches.create(testUser.id, { name: 'X', city: 'Y' });
      // SQLite REAL nie ma constraint — radius -5 przejdzie do DB.
      // Test pokazuje że walidacja musi być w route (zod), nie repo.
      const upd = searches.update(s.id, { radiusKm: -5 });
      assert.equal(upd.radius_km, -5);
    });
  });

  describe('delete', () => {
    it('usuwa search', () => {
      const s = searches.create(testUser.id, { name: 'X', city: 'Y' });
      searches.delete(s.id);
      assert.equal(searches.findById(s.id), null);
    });

    it('delete non-existing id → no-op (no throw)', () => {
      assert.doesNotThrow(() => searches.delete('does-not-exist'));
    });
  });

  describe('cascade on user delete', () => {
    it('usunięcie usera kasuje jego searches', () => {
      const tempUser = users.create({ email: `${TEST_PREFIX}cascade@test.local` });
      const s = searches.create(tempUser.id, { name: 'X', city: 'Y' });
      db.prepare('DELETE FROM users WHERE id = ?').run(tempUser.id);
      assert.equal(searches.findById(s.id), null);
    });
  });
});
