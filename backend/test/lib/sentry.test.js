import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Iter 59 (część 2): testy `lib/sentry.js` — graceful behavior gdy SENTRY_DSN nie ustawiony,
 * captureException no-op, initSentry idempotent.
 */

// Wymusza brak DSN _przed_ importem modułu (features.sentry = false).
const ORIG_DSN = process.env.SENTRY_DSN_BACKEND;
delete process.env.SENTRY_DSN_BACKEND;

const { initSentry, captureException, sentryEnabled, Sentry } = await import('../../src/lib/sentry.js');

describe('lib/sentry — graceful Sentry init', () => {
  after(() => {
    if (ORIG_DSN) process.env.SENTRY_DSN_BACKEND = ORIG_DSN;
  });

  describe('initSentry()', () => {
    it('bez DSN → init NIE działa, sentryEnabled=false', () => {
      initSentry();
      // sentryEnabled jest snapshot stałą importu — sprawdzamy że nie krasznąl
      assert.equal(sentryEnabled, false);
    });

    it('idempotent — wielokrotne wywołanie bez crashu', () => {
      assert.doesNotThrow(() => {
        initSentry();
        initSentry();
        initSentry();
      });
    });
  });

  describe('captureException()', () => {
    it('no-op gdy Sentry off — NIE rzuca', () => {
      assert.doesNotThrow(() => {
        captureException(new Error('test'));
      });
    });

    it('akceptuje context jako 2gi arg bez crashu', () => {
      assert.doesNotThrow(() => {
        captureException(new Error('test'), { user_id: '123', op: 'test' });
      });
    });

    it('akceptuje null/undefined context', () => {
      assert.doesNotThrow(() => {
        captureException(new Error('null ctx'), null);
        captureException(new Error('undef ctx'));
      });
    });

    it('akceptuje non-Error values jako error', () => {
      assert.doesNotThrow(() => {
        captureException('string error');
        captureException({ code: 'EBADTHING' });
        captureException(null);
      });
    });
  });

  describe('Sentry export', () => {
    it('eksportuje obiekt Sentry SDK', () => {
      assert.ok(Sentry);
      assert.equal(typeof Sentry.init, 'function');
      assert.equal(typeof Sentry.captureException, 'function');
    });
  });
});
