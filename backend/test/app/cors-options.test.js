import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCorsOptions } from '../../src/app.js';

/**
 * Iter 42: testy `buildCorsOptions(env)` — CORS origin allowlist policy.
 *
 * Test strategy: invoke origin function bezpośrednio (CORS lib delegates do nas),
 * weryfikuje callback(err, allowed) per case.
 */

function check(opts, origin) {
  return new Promise((resolve) => {
    opts.origin(origin, (err, allowed) => resolve({ err, allowed }));
  });
}

describe('app/buildCorsOptions', () => {
  describe('allow-all mode (dev, brak CORS_ALLOWED_ORIGINS)', () => {
    const opts = buildCorsOptions({ CORS_ALLOWED_ORIGINS: '' });

    it('zwraca exposedHeaders + credentials: true', () => {
      assert.deepEqual(opts.exposedHeaders, ['X-Request-Id']);
      assert.equal(opts.credentials, true);
    });

    it('każdy origin → allowed', async () => {
      for (const origin of ['https://evil.com', 'http://localhost:3000', 'http://random.example']) {
        const { err, allowed } = await check(opts, origin);
        assert.equal(err, null);
        assert.equal(allowed, true);
      }
    });

    it('null/undefined origin (server-to-server) → allowed', async () => {
      assert.equal((await check(opts, null)).allowed, true);
      assert.equal((await check(opts, undefined)).allowed, true);
    });
  });

  describe('allowlist mode (production)', () => {
    const opts = buildCorsOptions({
      CORS_ALLOWED_ORIGINS: 'https://nieruchomosciai.pl,https://jakatora.github.io',
    });

    it('exact match → allowed', async () => {
      const r1 = await check(opts, 'https://nieruchomosciai.pl');
      assert.equal(r1.err, null);
      assert.equal(r1.allowed, true);

      const r2 = await check(opts, 'https://jakatora.github.io');
      assert.equal(r2.allowed, true);
    });

    it('mismatch → CORS error', async () => {
      const { err, allowed } = await check(opts, 'https://evil.com');
      assert.ok(err instanceof Error);
      assert.match(err.message, /CORS.*evil/);
      assert.equal(allowed, undefined);
    });

    it('null origin (server-to-server, curl) → allowed nawet z allowlist', async () => {
      assert.equal((await check(opts, null)).allowed, true);
    });

    it('case sensitive (https vs http) → mismatch', async () => {
      const { err } = await check(opts, 'http://nieruchomosciai.pl'); // http not https
      assert.ok(err instanceof Error);
    });

    it('extra path NIE liczy się jako origin', async () => {
      const { err } = await check(opts, 'https://nieruchomosciai.pl/api');
      assert.ok(err instanceof Error, 'origin to host:port, NIE z path');
    });

    it('whitespace trimowane z CSV', async () => {
      const optsWS = buildCorsOptions({
        CORS_ALLOWED_ORIGINS: '  https://a.com  ,   https://b.com   ',
      });
      assert.equal((await check(optsWS, 'https://a.com')).allowed, true);
      assert.equal((await check(optsWS, 'https://b.com')).allowed, true);
    });
  });

  describe('wildcard pattern (subdomain support)', () => {
    const opts = buildCorsOptions({
      CORS_ALLOWED_ORIGINS: 'https://*.nieruchomosciai.pl',
    });

    it('subdomain → allowed', async () => {
      assert.equal((await check(opts, 'https://api.nieruchomosciai.pl')).allowed, true);
      assert.equal((await check(opts, 'https://app.nieruchomosciai.pl')).allowed, true);
    });

    it('mismatch domain → blocked', async () => {
      const { err } = await check(opts, 'https://api.evil.com');
      assert.ok(err instanceof Error);
    });

    it('różne TLD nie liczą się (anti-subdomain-takeover guard)', async () => {
      const { err } = await check(opts, 'https://api.nieruchomosciai.com');
      assert.ok(err instanceof Error, 'wildcard NIE matchuje .com gdy zdefiniowano .pl');
    });
  });

  describe('edge cases', () => {
    it('null env → defaultuje do allow-all', () => {
      const opts = buildCorsOptions({});
      assert.equal(typeof opts.origin, 'function');
    });

    it('mixed exact + wildcard', async () => {
      const opts = buildCorsOptions({
        CORS_ALLOWED_ORIGINS: 'https://exact.com,https://*.wildcard.com',
      });
      assert.equal((await check(opts, 'https://exact.com')).allowed, true);
      assert.equal((await check(opts, 'https://sub.wildcard.com')).allowed, true);
      const { err } = await check(opts, 'https://other.com');
      assert.ok(err instanceof Error);
    });
  });
});
