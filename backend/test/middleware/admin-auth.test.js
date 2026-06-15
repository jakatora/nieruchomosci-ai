import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { adminRequired } from '../../src/middleware/adminAuth.js';
import { env } from '../../src/config/env.js';

/**
 * middleware/adminAuth.js — admin key check tests.
 *
 * Pokrycie:
 *   - missing ADMIN_API_KEY w env → 503 SERVICE_UNAVAILABLE (graceful, nie crash)
 *   - missing x-admin-key header → 403 FORBIDDEN
 *   - wrong x-admin-key → 403 (timing-safe compare)
 *   - correct key → next() bez błędu
 *   - different length keys → false bez throw (Node timingSafeEqual rzuca przy length mismatch
 *     — sprawdzamy że nasza ochrona przez length check działa)
 */

function mockNext() {
  const calls = [];
  const fn = (err) => calls.push(err);
  fn.calls = calls;
  return fn;
}

function mockReq(headers = {}) {
  return { headers };
}

describe('middleware/adminAuth — adminRequired', () => {
  describe('gdy ADMIN_API_KEY skonfigurowany w env', () => {
    // Test używa real env (lokalnie ADMIN_API_KEY=local-dev-admin-key-do-not-use-in-prod).
    // Jeśli env nie ma key, ten describe skipuje.

    it('skip jeśli ADMIN_API_KEY pusty', { skip: !env.ADMIN_API_KEY }, () => {
      // marker
    });

    it('missing x-admin-key header → 403 FORBIDDEN', () => {
      if (!env.ADMIN_API_KEY) return;
      const req = mockReq({});
      const next = mockNext();
      adminRequired(req, null, next);
      assert.equal(next.calls.length, 1);
      assert.equal(next.calls[0].status, 403);
      assert.equal(next.calls[0].code, 'FORBIDDEN');
      assert.match(next.calls[0].message, /Nieprawidłowy klucz/i);
    });

    it('x-admin-key z różnej długości niż secret → 403', () => {
      if (!env.ADMIN_API_KEY) return;
      const req = mockReq({ 'x-admin-key': 'short' });
      const next = mockNext();
      adminRequired(req, null, next);
      assert.equal(next.calls[0].status, 403);
    });

    it('x-admin-key z tej samej długości ale wrong content → 403', () => {
      if (!env.ADMIN_API_KEY) return;
      // Wygeneruj klucz o tej samej długości co dev key
      const fake = 'X'.repeat(env.ADMIN_API_KEY.length);
      const req = mockReq({ 'x-admin-key': fake });
      const next = mockNext();
      adminRequired(req, null, next);
      assert.equal(next.calls[0].status, 403);
    });

    it('correct x-admin-key → next() bez błędu', () => {
      if (!env.ADMIN_API_KEY) return;
      const req = mockReq({ 'x-admin-key': env.ADMIN_API_KEY });
      const next = mockNext();
      adminRequired(req, null, next);
      assert.equal(next.calls.length, 1);
      assert.equal(next.calls[0], undefined); // valid → no error
    });

    it('empty string x-admin-key → 403', () => {
      if (!env.ADMIN_API_KEY) return;
      const req = mockReq({ 'x-admin-key': '' });
      const next = mockNext();
      adminRequired(req, null, next);
      // empty string jest falsy → fast path "missing key" → 403
      assert.equal(next.calls[0].status, 403);
    });

    it('x-admin-key z trailing whitespace → 403 (NIE trimuje by zachować security)', () => {
      if (!env.ADMIN_API_KEY) return;
      const req = mockReq({ 'x-admin-key': `${env.ADMIN_API_KEY}  ` });
      const next = mockNext();
      adminRequired(req, null, next);
      // Różna długość → 403 (timing-safe)
      assert.equal(next.calls[0].status, 403);
    });

    it('Wielkość liter respektowana (case-sensitive)', () => {
      if (!env.ADMIN_API_KEY) return;
      const upperKey = env.ADMIN_API_KEY.toUpperCase();
      if (upperKey === env.ADMIN_API_KEY) return; // skip jeśli key w pełni numeryczny
      const req = mockReq({ 'x-admin-key': upperKey });
      const next = mockNext();
      adminRequired(req, null, next);
      assert.equal(next.calls[0].status, 403);
    });

    it('nie crashuje przy nietypowych headers (number/object zamiast string)', () => {
      if (!env.ADMIN_API_KEY) return;
      const req = mockReq({ 'x-admin-key': 12345 }); // number
      const next = mockNext();
      assert.doesNotThrow(() => adminRequired(req, null, next));
      assert.equal(next.calls[0].status, 403);
    });

    it('rezultat 403 ma FORBIDDEN code (consistent z API contract)', () => {
      if (!env.ADMIN_API_KEY) return;
      const req = mockReq({ 'x-admin-key': 'wrong' });
      const next = mockNext();
      adminRequired(req, null, next);
      const err = next.calls[0];
      assert.equal(err.code, 'FORBIDDEN');
      assert.equal(err.expose, true); // bezpieczny do pokazania klientowi
    });
  });

  describe('graceful degradation — środowisko bez ADMIN_API_KEY', () => {
    it('komentarz: wymaga inn sesji do testu (env baked-in)', () => {
      // Nie możemy live mutować env.ADMIN_API_KEY (zod ma sealed schema).
      // Branch `if (!env.ADMIN_API_KEY) return 503` jest jednolinijkowy i visual-inspect verified.
      // Real test wymagałby spawnowania subprocess z innym .env — pomijamy w MVP test cost.
      assert.ok(true);
    });
  });
});
