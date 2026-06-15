import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ah } from '../../src/lib/asyncHandler.js';

/**
 * Iter 59 (część 1): testy `lib/asyncHandler.js` (ah) — krytyczny helper Express 4
 * dla łapania rejected promises z async handlerów.
 */

describe('lib/asyncHandler — ah(fn)', () => {
  it('rozwiązany async handler NIE wywołuje next(err)', async () => {
    const next = mockNext();
    const fn = async (req, res) => res.send('ok');
    const req = {}, res = { sent: null, send(x) { this.sent = x; return this; } };

    await ah(fn)(req, res, next);

    assert.equal(res.sent, 'ok');
    assert.equal(next.calls.length, 0);
  });

  it('odrzucona Promise → next(err) z błędem', async () => {
    const err = new Error('boom');
    const next = mockNext();
    const fn = async () => { throw err; };
    await ah(fn)({}, {}, next);

    assert.equal(next.calls.length, 1);
    assert.equal(next.calls[0][0], err, 'next dostał ten sam error object');
  });

  it('synchroniczny throw NIE jest łapany przez ah (Express router łapie sam)', async () => {
    // ah opakowuje Promise.resolve(fn()) — sync throw rzuca PRZED resolve, więc
    // nie wpada do .catch(). Express 4 ma własny try/catch na sync handlery,
    // więc to nie problem w praktyce.
    const err = new Error('sync-throw');
    const next = mockNext();
    const fn = () => { throw err; };

    assert.throws(() => ah(fn)({}, {}, next), /sync-throw/);
    assert.equal(next.calls.length, 0, 'sync throw NIE przechodzi przez next');
  });

  it('handler zwracający niepromisowy value też OK', async () => {
    const next = mockNext();
    let called = false;
    const fn = (req, res) => { called = true; res.send('sync ok'); };
    const res = { sent: null, send(x) { this.sent = x; } };
    await ah(fn)({}, res, next);
    assert.equal(called, true);
    assert.equal(res.sent, 'sync ok');
    assert.equal(next.calls.length, 0);
  });

  it('handler który odrzuca z non-Error (string) → next(string)', async () => {
    const next = mockNext();
    const fn = async () => { throw 'plain string error'; };
    await ah(fn)({}, {}, next);
    assert.equal(next.calls[0][0], 'plain string error');
  });

  it('handler który zwraca undefined → next NIE wywołany', async () => {
    const next = mockNext();
    const fn = async () => undefined;
    await ah(fn)({}, {}, next);
    assert.equal(next.calls.length, 0);
  });

  it('zachowuje wszystkie 3 args (req, res, next) przekazane do handlera', async () => {
    const captured = [];
    const fn = (req, res, next) => { captured.push(req, res, next); };
    const req = { test: 1 }, res = { test: 2 }, next = mockNext();
    await ah(fn)(req, res, next);
    assert.equal(captured[0], req);
    assert.equal(captured[1], res);
    assert.equal(captured[2], next);
  });
});

function mockNext() {
  const next = (...args) => { next.calls.push(args); };
  next.calls = [];
  return next;
}
