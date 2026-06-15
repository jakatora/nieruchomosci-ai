import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { requestId } from '../../src/middleware/requestId.js';

function mockReqRes(headers = {}) {
  const req = { headers, id: undefined };
  const res = {
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
  };
  return { req, res };
}

describe('middleware/requestId', () => {
  it('generuje UUID v4 gdy brak X-Request-Id', () => {
    const { req, res } = mockReqRes();
    let calledNext = false;
    requestId(req, res, () => { calledNext = true; });
    assert.ok(calledNext);
    assert.match(req.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(res.headers['X-Request-Id'], req.id);
  });

  it('używa X-Request-Id z headera klienta (gdy validny)', () => {
    const { req, res } = mockReqRes({ 'x-request-id': 'mobile-abc-123' });
    requestId(req, res, () => {});
    assert.equal(req.id, 'mobile-abc-123');
    assert.equal(res.headers['X-Request-Id'], 'mobile-abc-123');
  });

  it('odrzuca za długi X-Request-Id (>64 chars) → generuje UUID', () => {
    const longId = 'x'.repeat(100);
    const { req, res } = mockReqRes({ 'x-request-id': longId });
    requestId(req, res, () => {});
    assert.notEqual(req.id, longId);
    assert.match(req.id, /^[0-9a-f-]{36}$/);
  });

  it('odrzuca X-Request-Id z niedozwolonymi znakami (anti injection)', () => {
    const malicious = '<script>alert(1)</script>';
    const { req, res } = mockReqRes({ 'x-request-id': malicious });
    requestId(req, res, () => {});
    assert.notEqual(req.id, malicious);
    assert.match(req.id, /^[0-9a-f-]{36}$/);
  });

  it('akceptuje alfanumeryczne + . - _ w X-Request-Id', () => {
    const valid = 'req_abc.123-def';
    const { req, res } = mockReqRes({ 'x-request-id': valid });
    requestId(req, res, () => {});
    assert.equal(req.id, valid);
  });

  it('pusty string header → generuje nowy UUID', () => {
    const { req, res } = mockReqRes({ 'x-request-id': '' });
    requestId(req, res, () => {});
    assert.match(req.id, /^[0-9a-f-]{36}$/);
  });

  it('zawsze ustawia req.id (nie zostawia undefined)', () => {
    const { req, res } = mockReqRes();
    requestId(req, res, () => {});
    assert.ok(req.id);
    assert.equal(typeof req.id, 'string');
  });

  it('zawsze ustawia response header (do logu klienta)', () => {
    const { req, res } = mockReqRes();
    requestId(req, res, () => {});
    assert.ok(res.headers['X-Request-Id']);
    assert.equal(res.headers['X-Request-Id'], req.id);
  });

  it('uniqueness — 100 requestów bez headera → 100 distinct IDs', () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) {
      const { req, res } = mockReqRes();
      requestId(req, res, () => {});
      ids.add(req.id);
    }
    assert.equal(ids.size, 100);
  });
});
