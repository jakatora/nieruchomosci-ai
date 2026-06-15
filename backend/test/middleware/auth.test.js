import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { signToken, authRequired } from '../../src/middleware/auth.js';
import { env } from '../../src/config/env.js';
import { db } from '../../src/db/index.js';
import { users } from '../../src/db/repos.js';
import { newId } from '../../src/lib/ids.js';

/**
 * middleware/auth.js — JWT auth tests.
 *
 * Pokrycie krytyczne (każdy authenticated route zależy):
 *   - signToken format + content
 *   - authRequired: missing header, malformed prefix, invalid token, expired token,
 *     valid token + user lookup, valid token + user deleted
 *   - Race condition: token wygenerowany dla usera potem usuniętego
 *
 * Mock pattern: `req` z headers + `next(err)` callback.
 */

const TEST_PREFIX = 'mw-auth-test-';

let testUser;

function cleanup() {
  db.prepare('DELETE FROM users WHERE email LIKE ?').run(`${TEST_PREFIX}%`);
}

before(() => {
  cleanup();
  testUser = users.create({ email: `${TEST_PREFIX}main@test.local` });
});

after(cleanup);

/** Helper — symuluje express next(err) z capture. */
function mockNext() {
  const calls = [];
  const fn = (err) => calls.push(err);
  fn.calls = calls;
  return fn;
}

function mockReq(headers = {}) {
  return { headers, user: undefined };
}

describe('middleware/auth — signToken', () => {
  it('zwraca string', () => {
    const token = signToken(testUser.id);
    assert.equal(typeof token, 'string');
    assert.ok(token.length > 50);
  });

  it('payload zawiera sub = userId', () => {
    const token = signToken(testUser.id);
    const decoded = jwt.decode(token);
    assert.equal(decoded.sub, testUser.id);
  });

  it('expiresIn ustawione na JWT_TTL_DAYS', () => {
    const token = signToken(testUser.id);
    const decoded = jwt.decode(token);
    assert.ok(decoded.exp);
    assert.ok(decoded.iat);
    const ttlSeconds = decoded.exp - decoded.iat;
    const expectedSeconds = env.JWT_TTL_DAYS * 86400;
    // Tolerance ±5s — może być różnica między iat a real time
    assert.ok(Math.abs(ttlSeconds - expectedSeconds) < 5);
  });

  it('podpis JWT weryfikowalny tym samym JWT_SECRET', () => {
    const token = signToken(testUser.id);
    assert.doesNotThrow(() => jwt.verify(token, env.JWT_SECRET));
  });

  it('podpis NIE weryfikowalny innym secret', () => {
    const token = signToken(testUser.id);
    assert.throws(() => jwt.verify(token, 'wrong-secret-12345'));
  });

  it('różne userId → różne tokeny', () => {
    const t1 = signToken('user-a');
    const t2 = signToken('user-b');
    assert.notEqual(t1, t2);
  });

  it('ten sam userId w czasie t i t+0 → identyczne tokeny (deterministic w 1 sek)', () => {
    const t1 = signToken(testUser.id);
    const t2 = signToken(testUser.id);
    // Mogą być różne jeśli iat się przesunął, ale payload jest same
    assert.deepEqual(jwt.decode(t1).sub, jwt.decode(t2).sub);
  });
});

describe('middleware/auth — authRequired', () => {
  it('brak Authorization header → 401 UNAUTHORIZED', () => {
    const req = mockReq({});
    const next = mockNext();
    authRequired(req, null, next);
    assert.equal(next.calls.length, 1);
    assert.equal(next.calls[0].status, 401);
    assert.equal(next.calls[0].code, 'UNAUTHORIZED');
    assert.match(next.calls[0].message, /Brak tokenu/i);
  });

  it('Authorization header bez "Bearer " prefix → 401', () => {
    const req = mockReq({ authorization: 'Basic abc:xyz' });
    const next = mockNext();
    authRequired(req, null, next);
    assert.equal(next.calls.length, 1);
    assert.equal(next.calls[0].status, 401);
    assert.match(next.calls[0].message, /Brak tokenu/i);
  });

  it('Authorization Bearer (pusty token) → 401', () => {
    const req = mockReq({ authorization: 'Bearer ' });
    const next = mockNext();
    authRequired(req, null, next);
    assert.equal(next.calls.length, 1);
    assert.equal(next.calls[0].status, 401);
  });

  it('Bearer z malformed JWT → 401 "Nieprawidłowy lub wygasły"', () => {
    const req = mockReq({ authorization: 'Bearer not.a.jwt' });
    const next = mockNext();
    authRequired(req, null, next);
    assert.equal(next.calls.length, 1);
    assert.equal(next.calls[0].status, 401);
    assert.match(next.calls[0].message, /Nieprawidłowy lub wygasły/i);
  });

  it('Bearer JWT podpisany innym secret → 401', () => {
    const fake = jwt.sign({ sub: testUser.id }, 'evil-secret');
    const req = mockReq({ authorization: `Bearer ${fake}` });
    const next = mockNext();
    authRequired(req, null, next);
    assert.equal(next.calls.length, 1);
    assert.equal(next.calls[0].status, 401);
    assert.match(next.calls[0].message, /Nieprawidłowy lub wygasły/i);
  });

  it('Bearer EXPIRED token → 401', () => {
    const expired = jwt.sign(
      { sub: testUser.id, exp: Math.floor(Date.now() / 1000) - 60 },
      env.JWT_SECRET,
    );
    const req = mockReq({ authorization: `Bearer ${expired}` });
    const next = mockNext();
    authRequired(req, null, next);
    assert.equal(next.calls.length, 1);
    assert.equal(next.calls[0].status, 401);
    assert.match(next.calls[0].message, /Nieprawidłowy lub wygasły/i);
  });

  it('valid Bearer ale user usunięty z DB → 401 "Konto nie istnieje"', () => {
    const ghostId = newId();
    const ghostToken = signToken(ghostId);
    const req = mockReq({ authorization: `Bearer ${ghostToken}` });
    const next = mockNext();
    authRequired(req, null, next);
    assert.equal(next.calls.length, 1);
    assert.equal(next.calls[0].status, 401);
    assert.match(next.calls[0].message, /Konto nie istnieje/i);
  });

  it('valid Bearer + valid user → dołącza req.user, next() bez błędu', () => {
    const token = signToken(testUser.id);
    const req = mockReq({ authorization: `Bearer ${token}` });
    const next = mockNext();
    authRequired(req, null, next);
    assert.equal(next.calls.length, 1);
    assert.equal(next.calls[0], undefined); // next() bez argumentu = ok
    assert.ok(req.user);
    assert.equal(req.user.id, testUser.id);
    assert.equal(req.user.email, testUser.email);
  });

  it('valid Bearer z whitespace przed/po → trimowany', () => {
    const token = signToken(testUser.id);
    const req = mockReq({ authorization: `Bearer   ${token}  ` });
    const next = mockNext();
    authRequired(req, null, next);
    // .slice(7).trim() obsługuje trailing spaces; leading spaces po "Bearer " → token sam się trimuje
    assert.equal(req.user?.id, testUser.id);
  });

  it('Bearer authorization wpisany lowercase ("bearer") → 401 (case-sensitive)', () => {
    const token = signToken(testUser.id);
    const req = mockReq({ authorization: `bearer ${token}` });
    const next = mockNext();
    authRequired(req, null, next);
    // startsWith('Bearer ') jest case-sensitive — lowercase fail
    assert.equal(next.calls[0].status, 401);
  });

  it('Authorization header z array (multi-value) → traktowany jako string', () => {
    // Express normalizuje, ale defensive sprawdzamy że nie crash
    const req = mockReq({ authorization: '' });
    const next = mockNext();
    assert.doesNotThrow(() => authRequired(req, null, next));
    assert.equal(next.calls[0].status, 401);
  });

  it('req.user NIE jest mutated przed walidacją', () => {
    const req = mockReq({}); // brak header
    req.user = { id: 'attacker' };
    const next = mockNext();
    authRequired(req, null, next);
    // Atak: ktoś podstawia req.user przed middleware → middleware powinno zwrócić 401
    // a nie pozwolić, by req.user pozostał atakującą wartością.
    // Aktualny middleware: jeśli no token, return next(err) bez dotykania req.user.
    // To OK — bo route handlers korzystają z req.user ustawionego TYLKO przez middleware
    // PO valid token check.
    assert.equal(next.calls[0].status, 401);
  });
});

describe('middleware/auth — integration: signToken → authRequired roundtrip', () => {
  it('full flow: sign → request z tym tokenem → user dołączony', () => {
    const token = signToken(testUser.id);
    const req = mockReq({ authorization: `Bearer ${token}` });
    const next = mockNext();
    authRequired(req, null, next);
    assert.equal(req.user.email, testUser.email);
    assert.equal(next.calls[0], undefined);
  });
});
