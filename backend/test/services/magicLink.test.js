import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  createLoginLink, createUpgradeLink,
  consumeLoginLink, consumeUpgradeLink, PURPOSES,
} from '../../src/services/magicLink.js';
import { users, magicLinks } from '../../src/db/repos.js';
import { db } from '../../src/db/index.js';

const TEST_USER_PREFIX = 'magiclink-test-';

function cleanup() {
  // Usuwamy testowych userów i ich magic links (CASCADE).
  db.prepare(`DELETE FROM users WHERE email LIKE '${TEST_USER_PREFIX}%'`).run();
}

function createTestUser(suffix) {
  return users.create({
    email: `${TEST_USER_PREFIX}${suffix}@test.local`,
    passwordHash: null,
    userType: 'consumer',
    homeCity: 'Warszawa',
    searchRadiusKm: 5,
  });
}

describe('services/magicLink', () => {
  before(() => cleanup());
  after(() => cleanup());

  describe('PURPOSES set', () => {
    it('zawiera 3 purpose: login, upgrade-standard, upgrade-investor', () => {
      assert.equal(PURPOSES.size, 3);
      assert.ok(PURPOSES.has('login'));
      assert.ok(PURPOSES.has('upgrade-standard'));
      assert.ok(PURPOSES.has('upgrade-investor'));
    });
  });

  describe('createLoginLink', () => {
    it('tworzy token + URL z user_id + token', () => {
      const user = createTestUser('login-1');
      const link = createLoginLink(user.id);
      assert.ok(link.token);
      assert.equal(link.token.length, 48); // 24 bytes hex
      assert.match(link.url, new RegExp(`user_id=${user.id}`));
      assert.match(link.url, new RegExp(`token=${link.token}`));
      assert.match(link.url, /\/login\/magic\?/);
    });

    it('zapisuje w DB z purpose=login', () => {
      const user = createTestUser('login-2');
      const link = createLoginLink(user.id);
      const row = db.prepare('SELECT * FROM magic_links WHERE token = ?').get(link.token);
      assert.ok(row);
      assert.equal(row.purpose, 'login');
      assert.equal(row.user_id, user.id);
      assert.equal(row.used_at, null);
    });
  });

  describe('createUpgradeLink', () => {
    it('plan=standard → purpose=upgrade-standard', () => {
      const user = createTestUser('upgrade-std-1');
      const link = createUpgradeLink(user.id, 'standard');
      assert.equal(link.plan, 'standard');
      const row = db.prepare('SELECT purpose FROM magic_links WHERE token = ?').get(link.token);
      assert.equal(row.purpose, 'upgrade-standard');
    });

    it('plan=investor → purpose=upgrade-investor', () => {
      const user = createTestUser('upgrade-inv-1');
      const link = createUpgradeLink(user.id, 'investor');
      assert.equal(link.plan, 'investor');
      const row = db.prepare('SELECT purpose FROM magic_links WHERE token = ?').get(link.token);
      assert.equal(row.purpose, 'upgrade-investor');
    });

    it('plan w URL query param', () => {
      const user = createTestUser('upgrade-url-1');
      const link = createUpgradeLink(user.id, 'investor');
      assert.match(link.url, /\/upgrade\?/);
      assert.match(link.url, /plan=investor/);
    });

    it('throwuje dla nieznanego planu', () => {
      const user = createTestUser('upgrade-bad-1');
      assert.throws(() => createUpgradeLink(user.id, 'gold-vip'), /Nieznany plan/);
    });
  });

  describe('consumeLoginLink', () => {
    it('ważny token → zwraca user_id i konsumuje (used_at set)', () => {
      const user = createTestUser('consume-login-1');
      const link = createLoginLink(user.id);
      const result = consumeLoginLink(link.token);
      assert.equal(result, user.id);
      // Sprawdź że został zużyty
      const row = db.prepare('SELECT used_at FROM magic_links WHERE token = ?').get(link.token);
      assert.ok(row.used_at, 'used_at musi być ustawione');
    });

    it('drugie consume tego samego tokenu → null (jednorazowy)', () => {
      const user = createTestUser('consume-login-2');
      const link = createLoginLink(user.id);
      const r1 = consumeLoginLink(link.token);
      const r2 = consumeLoginLink(link.token);
      assert.equal(r1, user.id);
      assert.equal(r2, null);
    });

    it('nieistniejący token → null', () => {
      assert.equal(consumeLoginLink('nieistnieje-token-123'), null);
    });

    it('null/undefined/empty → null', () => {
      assert.equal(consumeLoginLink(null), null);
      assert.equal(consumeLoginLink(undefined), null);
      assert.equal(consumeLoginLink(''), null);
    });

    it('upgrade token NIE jest akceptowany przez consumeLoginLink (purpose mismatch)', () => {
      const user = createTestUser('consume-cross-1');
      const link = createUpgradeLink(user.id, 'standard');
      const result = consumeLoginLink(link.token);
      assert.equal(result, null,
        'upgrade-standard token nie może być użyty do logowania (cross-purpose attack)');
    });
  });

  describe('consumeUpgradeLink', () => {
    it('plan=standard → zwraca "standard"', () => {
      const user = createTestUser('consume-up-std-1');
      const link = createUpgradeLink(user.id, 'standard');
      const plan = consumeUpgradeLink(user.id, link.token);
      assert.equal(plan, 'standard');
    });

    it('plan=investor → zwraca "investor"', () => {
      const user = createTestUser('consume-up-inv-1');
      const link = createUpgradeLink(user.id, 'investor');
      const plan = consumeUpgradeLink(user.id, link.token);
      assert.equal(plan, 'investor');
    });

    it('zły user_id (token kradzież) → null', () => {
      const userA = createTestUser('consume-up-A');
      const userB = createTestUser('consume-up-B');
      const link = createUpgradeLink(userA.id, 'standard');
      // Atakujący próbuje użyć tokenu userA z swoim user_id
      const result = consumeUpgradeLink(userB.id, link.token);
      assert.equal(result, null);
    });

    it('drugie consume → null', () => {
      const user = createTestUser('consume-up-2nd-1');
      const link = createUpgradeLink(user.id, 'investor');
      assert.equal(consumeUpgradeLink(user.id, link.token), 'investor');
      assert.equal(consumeUpgradeLink(user.id, link.token), null);
    });

    it('login token NIE konsumowany przez consumeUpgradeLink (cross-purpose)', () => {
      const user = createTestUser('consume-cross-2');
      const link = createLoginLink(user.id);
      const result = consumeUpgradeLink(user.id, link.token);
      assert.equal(result, null);
    });

    it('null inputs → null (defensive)', () => {
      assert.equal(consumeUpgradeLink(null, 'tok'), null);
      assert.equal(consumeUpgradeLink('user', null), null);
      assert.equal(consumeUpgradeLink(null, null), null);
      assert.equal(consumeUpgradeLink('', ''), null);
    });
  });

  describe('expiry', () => {
    it('wygasły token → null (manualnie set expires_at w przeszłości)', () => {
      const user = createTestUser('expired-1');
      const link = createLoginLink(user.id);
      // Ręcznie ustawiamy expires_at na 1 sek temu
      db.prepare(`UPDATE magic_links SET expires_at = ? WHERE token = ?`)
        .run(new Date(Date.now() - 1000).toISOString(), link.token);
      assert.equal(consumeLoginLink(link.token), null);
    });
  });
});
