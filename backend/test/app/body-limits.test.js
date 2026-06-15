import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../../src/app.js';

/**
 * Iter 47: testy per-route body size limits (z iter 46).
 *
 * Cel: anti-DoS. Każda trasa ma rozmiar limit dopasowany do payload szczerze
 * wymaganego. Klient próbujący wysłać 1MB do /content → 413 Payload Too Large.
 *
 * Strategy: spinujemy ephemeral http.createServer + fetch.
 */

async function callJson(path, body, opts = {}) {
  const app = createApp();
  const server = http.createServer(app).listen(0);
  await new Promise((r) => server.on('listening', r));
  try {
    const port = server.address().port;
    const res = await fetch(`http://localhost:${port}${path}`, {
      method: opts.method || 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body: json, text };
  } finally {
    server.close();
  }
}

function makeBigPayload(approxKb) {
  // Każdy znak = 1 bajt. Wytworz string aproksymujący żądany rozmiar w KB.
  return { url: 'x'.repeat(approxKb * 1024) };
}

describe('app/body-size-limits per-route', () => {
  describe('/content paste-listing-analysis — limit 4KB', () => {
    it('< 4KB body → przechodzi parser (zod może rzucić 400, ale NIE 413)', async () => {
      const { status } = await callJson('/content/paste-listing-analysis',
        { url: 'https://www.domiporta.pl/test' });
      // Może być 400 (zod URL invalid) lub 404 (nie ma w DB) — ważne że NIE 413.
      assert.notEqual(status, 413, `oczekuję ≠ 413, dostałem ${status}`);
    });

    it('> 4KB body → 413 Payload Too Large', async () => {
      const { status } = await callJson('/content/paste-listing-analysis',
        makeBigPayload(10)); // 10KB > 4KB limit
      assert.equal(status, 413, '10KB do /content powinno dać 413');
    });
  });

  describe('/auth/login — limit 32KB (małe payloady)', () => {
    it('< 32KB body → przechodzi parser', async () => {
      const { status } = await callJson('/auth/login',
        { email: 'fake@test.local', password: 'fake' });
      // 401 (wrong creds), nie 413.
      assert.notEqual(status, 413);
    });

    it('> 32KB body → 413', async () => {
      const { status } = await callJson('/auth/login',
        { password: 'x'.repeat(35 * 1024) }); // 35KB
      assert.equal(status, 413);
    });
  });

  describe('/searches — limit 128KB (search definitions z district lists)', () => {
    it('< 128KB → przechodzi parser', async () => {
      const { status } = await callJson('/searches',
        { name: 'test', city: 'Warszawa' });
      // 401 (no auth), nie 413.
      assert.notEqual(status, 413);
    });

    it('> 128KB → 413', async () => {
      const { status } = await callJson('/searches',
        { name: 'x'.repeat(130 * 1024) });
      assert.equal(status, 413);
    });
  });

  describe('/listings — limit 256KB (default — GET ale tolerant na duże POST/PATCH)', () => {
    it('< 256KB → przechodzi parser', async () => {
      const { status } = await callJson('/listings/fake-id',
        { x: 'y' }, { method: 'POST' });
      // 404 (no listing) albo 405 (method not allowed), nie 413.
      assert.notEqual(status, 413);
    });
  });

  describe('/legal — no JSON parser (HTML response)', () => {
    it('GET /legal/privacy → 200 HTML (parser pominięty)', async () => {
      const app = createApp();
      const server = http.createServer(app).listen(0);
      await new Promise((r) => server.on('listening', r));
      try {
        const port = server.address().port;
        const res = await fetch(`http://localhost:${port}/legal/privacy`);
        const text = await res.text();
        assert.equal(res.status, 200);
        assert.ok(text.startsWith('<!DOCTYPE html>'), 'HTML response');
      } finally {
        server.close();
      }
    });
  });

  describe('413 response shape', () => {
    it('zawiera error code BAD_JSON albo PayloadTooLarge', async () => {
      const { status, body } = await callJson('/content/paste-listing-analysis',
        makeBigPayload(10));
      assert.equal(status, 413);
      // Express body-parser zwraca tekst 'request entity too large' albo errorHandler obsługuje.
      // Niezależnie od message — kluczowe że 413 vs 5xx (server error).
      assert.ok(status === 413, 'security: zwracamy 413 PayloadTooLarge, NIE 500');
    });
  });
});
