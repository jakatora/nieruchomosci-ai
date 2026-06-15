import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { errorHandler, notFoundHandler } from '../../src/middleware/errorHandler.js';
import { AppError, badRequest, unauthorized, forbidden, notFound, conflict, serviceUnavailable } from '../../src/lib/errors.js';

/**
 * middleware/errorHandler.js — central error mapper tests.
 *
 * Pokrycie:
 *   - notFoundHandler: 404 z request_id
 *   - errorHandler dla AppError: każdy status/code/message/details + request_id
 *   - errorHandler dla BAD_JSON (express.json() parse error): 400 z BAD_JSON code
 *   - errorHandler dla nieoczekiwanego wyjątku: 500 SERVER_ERROR z log + Sentry
 *   - request_id integration: ustawione gdy req.id istnieje, undefined gdy brak
 *   - SERVER_ERROR NIE leakuje stack trace ani message do response (security)
 */

/** Mock Express res — capturuje status + json body. */
function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
  };
  return res;
}

function mockReq({ id, originalUrl = '/test/path' } = {}) {
  return { id, originalUrl };
}

describe('middleware/errorHandler — notFoundHandler', () => {
  it('zwraca 404 z NOT_FOUND code i polish message', () => {
    const res = mockRes();
    notFoundHandler(mockReq(), res);
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
    assert.match(res.body.error.message, /Nie znaleziono/i);
  });

  it('dołącza request_id gdy req.id obecny', () => {
    const res = mockRes();
    notFoundHandler(mockReq({ id: 'req-abc-123' }), res);
    assert.equal(res.body.request_id, 'req-abc-123');
  });

  it('request_id undefined gdy req.id brak (graceful)', () => {
    const res = mockRes();
    notFoundHandler({}, res);
    assert.equal(res.body.request_id, undefined);
  });

  it('request_id undefined gdy req.id NIE jest string (defensive)', () => {
    const res = mockRes();
    notFoundHandler({ id: 12345 }, res); // number, nie string
    assert.equal(res.body.request_id, undefined);
  });
});

describe('middleware/errorHandler — errorHandler dla AppError', () => {
  it('badRequest → 400 BAD_REQUEST', () => {
    const res = mockRes();
    errorHandler(badRequest('Pole wymagane'), mockReq(), res, () => {});
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error.code, 'BAD_REQUEST');
    assert.equal(res.body.error.message, 'Pole wymagane');
  });

  it('badRequest z details → włączone w response', () => {
    const res = mockRes();
    errorHandler(
      badRequest('Walidacja', [{ field: 'email', message: 'invalid' }]),
      mockReq(), res, () => {},
    );
    assert.deepEqual(res.body.error.details, [{ field: 'email', message: 'invalid' }]);
  });

  it('unauthorized → 401 UNAUTHORIZED z default message', () => {
    const res = mockRes();
    errorHandler(unauthorized(), mockReq(), res, () => {});
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error.code, 'UNAUTHORIZED');
    assert.match(res.body.error.message, /Brak autoryzacji/i);
  });

  it('forbidden → 403 FORBIDDEN', () => {
    const res = mockRes();
    errorHandler(forbidden('Tylko admin'), mockReq(), res, () => {});
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
  });

  it('notFound → 404 NOT_FOUND', () => {
    const res = mockRes();
    errorHandler(notFound('User nie istnieje'), mockReq(), res, () => {});
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  it('conflict → 409 CONFLICT z details', () => {
    const res = mockRes();
    errorHandler(
      conflict('Plan już aktywny', { upgrade_to: 'standard' }),
      mockReq(), res, () => {},
    );
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error.code, 'CONFLICT');
    assert.deepEqual(res.body.error.details, { upgrade_to: 'standard' });
  });

  it('serviceUnavailable → 503 SERVICE_UNAVAILABLE', () => {
    const res = mockRes();
    errorHandler(serviceUnavailable('Stripe down'), mockReq(), res, () => {});
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.error.code, 'SERVICE_UNAVAILABLE');
  });

  it('AppError ma request_id w response', () => {
    const res = mockRes();
    errorHandler(badRequest('X'), mockReq({ id: 'req-bad-xyz' }), res, () => {});
    assert.equal(res.body.request_id, 'req-bad-xyz');
  });

  it('AppError z details=null → details undefined w response (JSON.stringify pomija)', () => {
    const res = mockRes();
    errorHandler(badRequest('X'), mockReq(), res, () => {});
    assert.equal(res.body.error.details, undefined);
    // Klucz `details` może istnieć w pamięci ale z wartością undefined.
    // JSON.stringify go pomija w wire payload — sprawdzamy to:
    const serialized = JSON.parse(JSON.stringify(res.body));
    assert.ok(!('details' in serialized.error), 'details powinien być pominięty w JSON');
  });

  it('Custom AppError z arbitrary status/code', () => {
    const customErr = new AppError(418, 'IM_A_TEAPOT', "Can't brew coffee");
    const res = mockRes();
    errorHandler(customErr, mockReq(), res, () => {});
    assert.equal(res.statusCode, 418);
    assert.equal(res.body.error.code, 'IM_A_TEAPOT');
  });
});

describe('middleware/errorHandler — BAD_JSON (express.json parse fail)', () => {
  it('err.type=entity.parse.failed → 400 BAD_JSON', () => {
    const err = new Error('Unexpected token');
    err.type = 'entity.parse.failed';
    const res = mockRes();
    errorHandler(err, mockReq(), res, () => {});
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error.code, 'BAD_JSON');
    assert.match(res.body.error.message, /JSON/i);
  });

  it('BAD_JSON również ma request_id', () => {
    const err = new Error('parse fail');
    err.type = 'entity.parse.failed';
    const res = mockRes();
    errorHandler(err, mockReq({ id: 'req-json-99' }), res, () => {});
    assert.equal(res.body.request_id, 'req-json-99');
  });
});

describe('middleware/errorHandler — SERVER_ERROR (uncaught)', () => {
  it('zwykły Error → 500 SERVER_ERROR', () => {
    const res = mockRes();
    errorHandler(new Error('database connection lost'), mockReq(), res, () => {});
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error.code, 'SERVER_ERROR');
  });

  it('SECURITY: response message generic ("Wewnętrzny błąd serwera"), NIE leakuje err.message do klienta', () => {
    const sensitive = new Error('DB password: super-secret-123');
    const res = mockRes();
    errorHandler(sensitive, mockReq(), res, () => {});
    // Klient widzi generic msg, NIE prawdziwy err.message
    assert.equal(res.body.error.message, 'Wewnętrzny błąd serwera');
    assert.ok(!JSON.stringify(res.body).includes('super-secret-123'));
  });

  it('SECURITY: stack trace NIE w response', () => {
    const withStack = new Error('Bug at routes/auth.js:42');
    const res = mockRes();
    errorHandler(withStack, mockReq(), res, () => {});
    const bodyStr = JSON.stringify(res.body);
    assert.ok(!bodyStr.includes('at routes'));
    assert.ok(!bodyStr.includes('.js:'));
  });

  it('TypeError obsłużony bez crash', () => {
    const res = mockRes();
    assert.doesNotThrow(() => {
      errorHandler(new TypeError("Cannot read 'x' of undefined"), mockReq(), res, () => {});
    });
    assert.equal(res.statusCode, 500);
  });

  it('null/undefined err → 500 graceful (no crash)', () => {
    const res = mockRes();
    assert.doesNotThrow(() => errorHandler(null, mockReq(), res, () => {}));
    assert.equal(res.statusCode, 500);
  });

  it('SERVER_ERROR również ma request_id (incident response)', () => {
    const res = mockRes();
    errorHandler(new Error('boom'), mockReq({ id: 'req-srv-1' }), res, () => {});
    assert.equal(res.body.request_id, 'req-srv-1');
  });
});

describe('middleware/errorHandler — request_id contract', () => {
  it('request_id obecny we wszystkich response shapes', () => {
    const cases = [
      () => errorHandler(badRequest('X'), mockReq({ id: 'A' }), mockRes(), () => {}),
      () => errorHandler({ type: 'entity.parse.failed' }, mockReq({ id: 'B' }), mockRes(), () => {}),
      () => errorHandler(new Error('boom'), mockReq({ id: 'C' }), mockRes(), () => {}),
    ];
    const expected = ['A', 'B', 'C'];
    for (let i = 0; i < cases.length; i++) {
      const res = mockRes();
      const req = mockReq({ id: expected[i] });
      if (i === 0) errorHandler(badRequest('X'), req, res, () => {});
      if (i === 1) errorHandler({ type: 'entity.parse.failed' }, req, res, () => {});
      if (i === 2) errorHandler(new Error('boom'), req, res, () => {});
      assert.equal(res.body.request_id, expected[i]);
    }
  });
});
