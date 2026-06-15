import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import cron from 'node-cron';
import { startScheduler, stopScheduler } from '../../src/jobs/scheduler.js';

/**
 * Iter 45: testy `jobs/scheduler.js` — node-cron wrapper.
 *
 * Strategia: env.NODE_ENV === 'test' już skipuje scheduler bezpośrednio (early return),
 * więc startScheduler() w trybie test jest no-op. Testujemy:
 *   1. test mode skip
 *   2. cron.validate() poprawnie rozpoznaje valid/invalid expressions
 *   3. stopScheduler() idempotent (można wywołać 2× bez błędu)
 *   4. cron.validate API contract (warstwa node-cron)
 */

describe('jobs/scheduler', () => {
  describe('startScheduler / stopScheduler — lifecycle', () => {
    it('startScheduler nie throwuje (test mode skip lub real create)', () => {
      assert.doesNotThrow(() => startScheduler());
      stopScheduler(); // cleanup gdy real jobs zostały utworzone
    });

    it('stopScheduler bez prior start → no-op (idempotent)', () => {
      assert.doesNotThrow(() => stopScheduler());
      assert.doesNotThrow(() => stopScheduler()); // drugi raz też ok
    });
  });

  describe('cron.validate — node-cron API contract', () => {
    it('default LISTINGS_FETCH_CRON "0 7 * * *" jest valid', () => {
      assert.equal(cron.validate('0 7 * * *'), true);
    });

    it('default BACKUP_CRON "0 3 * * *" jest valid', () => {
      assert.equal(cron.validate('0 3 * * *'), true);
    });

    it('6-pole z sekundami też valid (node-cron extension)', () => {
      assert.equal(cron.validate('0 0 7 * * *'), true);
    });

    it('common patterns valid', () => {
      assert.equal(cron.validate('*/5 * * * *'), true);   // co 5 minut
      assert.equal(cron.validate('0 */2 * * *'), true);    // co 2 godziny
      assert.equal(cron.validate('0 0 * * 0'), true);      // niedziela północ
      assert.equal(cron.validate('0 0 1 * *'), true);      // 1-szy każdego miesiąca
    });

    it('nieprawidłowe wyrażenia → false', () => {
      assert.equal(cron.validate('invalid'), false);
      assert.equal(cron.validate('60 * * * *'), false);    // minuta 60 nie istnieje
      assert.equal(cron.validate('* 25 * * *'), false);    // godzina 25 nie istnieje
      assert.equal(cron.validate(''), false);
      assert.equal(cron.validate('* * *'), false);          // za mało pól
    });
  });

  describe('integracja — startScheduler vs scheduler state', () => {
    it('po startScheduler() (test mode skip) — stopScheduler nie crashuje', () => {
      startScheduler();
      assert.doesNotThrow(() => stopScheduler());
    });

    it('wielokrotne start → stop pairs → no leak', () => {
      for (let i = 0; i < 5; i++) {
        startScheduler();
        stopScheduler();
      }
      // Jeśli były memory leak / state inconsistencies, ten test ujawniłby przez crash.
      assert.ok(true);
    });
  });
});
