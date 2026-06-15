import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AppError, badRequest, unauthorized, forbidden, notFound,
  conflict, tooMany, serviceUnavailable,
} from '../../src/lib/errors.js';

describe('lib/errors — AppError class', () => {
  it('rozszerza Error', () => {
    const e = new AppError(400, 'BAD', 'msg');
    assert.ok(e instanceof Error);
    assert.ok(e instanceof AppError);
  });

  it('ustawia name = "AppError"', () => {
    assert.equal(new AppError(400, 'X', 'y').name, 'AppError');
  });

  it('zapisuje status, code, message, details', () => {
    const e = new AppError(418, 'TEAPOT', 'Jestem czajnikiem', { extra: 'info' });
    assert.equal(e.status, 418);
    assert.equal(e.code, 'TEAPOT');
    assert.equal(e.message, 'Jestem czajnikiem');
    assert.deepEqual(e.details, { extra: 'info' });
  });

  it('details default = null', () => {
    assert.equal(new AppError(400, 'X', 'y').details, null);
  });

  it('expose = true (bezpieczne do pokazania klientowi)', () => {
    assert.equal(new AppError(400, 'X', 'y').expose, true);
  });

  it('zachowuje stack trace', () => {
    const e = new AppError(400, 'X', 'y');
    assert.ok(typeof e.stack === 'string');
    assert.ok(e.stack.includes('AppError'));
  });

  it('serializable do JSON (przez middleware errorHandler)', () => {
    const e = new AppError(400, 'BAD', 'opis', { field: 'email' });
    const json = { status: e.status, code: e.code, message: e.message, details: e.details };
    assert.deepEqual(JSON.parse(JSON.stringify(json)), {
      status: 400, code: 'BAD', message: 'opis', details: { field: 'email' },
    });
  });
});

describe('lib/errors — helper functions: HTTP status code mapping', () => {
  it('badRequest → 400 BAD_REQUEST', () => {
    const e = badRequest('Niewłaściwy email');
    assert.equal(e.status, 400);
    assert.equal(e.code, 'BAD_REQUEST');
    assert.equal(e.message, 'Niewłaściwy email');
  });

  it('badRequest z details (zod validation errors)', () => {
    const details = [{ field: 'email', message: 'invalid' }];
    const e = badRequest('Błąd walidacji', details);
    assert.deepEqual(e.details, details);
  });

  it('unauthorized → 401 UNAUTHORIZED', () => {
    const e = unauthorized();
    assert.equal(e.status, 401);
    assert.equal(e.code, 'UNAUTHORIZED');
    assert.equal(e.message, 'Brak autoryzacji'); // default po polsku
  });

  it('unauthorized z custom msg', () => {
    assert.equal(unauthorized('Token wygasł').message, 'Token wygasł');
  });

  it('forbidden → 403 FORBIDDEN', () => {
    const e = forbidden();
    assert.equal(e.status, 403);
    assert.equal(e.code, 'FORBIDDEN');
    assert.equal(e.message, 'Brak dostępu');
  });

  it('notFound → 404 NOT_FOUND', () => {
    const e = notFound();
    assert.equal(e.status, 404);
    assert.equal(e.code, 'NOT_FOUND');
    assert.equal(e.message, 'Nie znaleziono zasobu');
  });

  it('conflict → 409 CONFLICT (z details np. upgrade_to)', () => {
    const e = conflict('Plan już aktywny', { upgrade_to: 'investor' });
    assert.equal(e.status, 409);
    assert.equal(e.code, 'CONFLICT');
    assert.equal(e.message, 'Plan już aktywny');
    assert.deepEqual(e.details, { upgrade_to: 'investor' });
  });

  it('tooMany → 429 RATE_LIMITED', () => {
    const e = tooMany();
    assert.equal(e.status, 429);
    assert.equal(e.code, 'RATE_LIMITED');
    assert.equal(e.message, 'Za dużo żądań');
  });

  it('serviceUnavailable → 503 SERVICE_UNAVAILABLE', () => {
    const e = serviceUnavailable('Płatności tymczasowo niedostępne');
    assert.equal(e.status, 503);
    assert.equal(e.code, 'SERVICE_UNAVAILABLE');
    assert.equal(e.message, 'Płatności tymczasowo niedostępne');
  });

  it('wszystkie helpery zwracają AppError instance', () => {
    assert.ok(badRequest('x') instanceof AppError);
    assert.ok(unauthorized() instanceof AppError);
    assert.ok(forbidden() instanceof AppError);
    assert.ok(notFound() instanceof AppError);
    assert.ok(conflict('x') instanceof AppError);
    assert.ok(tooMany() instanceof AppError);
    assert.ok(serviceUnavailable('x') instanceof AppError);
  });

  it('messages domyślne po polsku (UX dla polskich userów)', () => {
    assert.match(unauthorized().message, /autoryzacj/);
    assert.match(forbidden().message, /dostęp/);
    assert.match(notFound().message, /znaleziono/);
    assert.match(tooMany().message, /żądań/);
  });

  it('status codes są w prawidłowym HTTP range', () => {
    for (const helper of [() => badRequest('x'), unauthorized, forbidden, notFound,
                          () => conflict('x'), tooMany, () => serviceUnavailable('x')]) {
      const e = helper();
      assert.ok(e.status >= 400 && e.status < 600,
        `${e.code} status ${e.status} musi być 4xx lub 5xx`);
    }
  });

  it('codes są UPPER_SNAKE (konwencja maszynowa do parsing przez mobile)', () => {
    for (const e of [badRequest('x'), unauthorized(), forbidden(), notFound(),
                     conflict('x'), tooMany(), serviceUnavailable('x')]) {
      assert.match(e.code, /^[A-Z_]+$/, `${e.code} musi być UPPER_SNAKE`);
    }
  });
});
