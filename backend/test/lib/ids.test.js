import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  newId, newToken, nowIso, startOfTodayIso, sha256, isMainModule,
} from '../../src/lib/ids.js';

describe('lib/ids — newId', () => {
  it('zwraca string', () => {
    assert.equal(typeof newId(), 'string');
  });

  it('format UUID v4 (8-4-4-4-12 hex)', () => {
    const id = newId();
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('jest unikalny — 1000 wywołań → 1000 distinct', () => {
    const set = new Set();
    for (let i = 0; i < 1000; i++) set.add(newId());
    assert.equal(set.size, 1000);
  });
});

describe('lib/ids — newToken', () => {
  it('default = 48 hex chars (24 bytes)', () => {
    const t = newToken();
    assert.equal(t.length, 48);
    assert.match(t, /^[0-9a-f]+$/);
  });

  it('custom byte length', () => {
    assert.equal(newToken(16).length, 32);   // 16 bytes → 32 hex chars
    assert.equal(newToken(8).length, 16);
    assert.equal(newToken(32).length, 64);
  });

  it('jest unikalny — 100 tokenów → 100 distinct', () => {
    const set = new Set();
    for (let i = 0; i < 100; i++) set.add(newToken());
    assert.equal(set.size, 100);
  });

  it('cryptographically random — wysoka entropia', () => {
    // Najprostszy test: pierwsze 24 hex chars (12 bytes) nie powtarzają się
    // w 1000 tokenach. Z pseudo-randomem (Math.random) by się powtarzało.
    const set = new Set();
    for (let i = 0; i < 1000; i++) set.add(newToken().slice(0, 24));
    assert.equal(set.size, 1000, 'prefiksy 24-char tokenów muszą być unikalne — wskaźnik entropii');
  });
});

describe('lib/ids — nowIso', () => {
  it('format ISO 8601 z milisekundami i UTC suffix', () => {
    const iso = nowIso();
    assert.match(iso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('jest aktualnym czasem (±5 sek)', () => {
    const t1 = Date.now();
    const iso = nowIso();
    const t2 = Date.now();
    const parsed = new Date(iso).getTime();
    assert.ok(parsed >= t1 - 100 && parsed <= t2 + 100,
      `parsed ${parsed} musi być w zakresie [${t1}, ${t2}]`);
  });

  it('dwukrotne wywołanie zwraca rosnący / równy timestamp', () => {
    const a = nowIso();
    const b = nowIso();
    assert.ok(b >= a, 'czas musi rosnąć monotonicznie');
  });
});

describe('lib/ids — startOfTodayIso', () => {
  it('zwraca początek dzisiejszej doby UTC (00:00:00.000Z)', () => {
    const sot = startOfTodayIso();
    assert.match(sot, /T00:00:00\.000Z$/);
  });

  it('data == dzisiejsza data UTC', () => {
    const sot = startOfTodayIso();
    const today = new Date().toISOString().slice(0, 10);
    assert.equal(sot.slice(0, 10), today);
  });

  it('parsowalne na Date object', () => {
    const sot = startOfTodayIso();
    const d = new Date(sot);
    assert.equal(d.getUTCHours(), 0);
    assert.equal(d.getUTCMinutes(), 0);
    assert.equal(d.getUTCSeconds(), 0);
  });
});

describe('lib/ids — sha256', () => {
  it('zwraca 64-char hex (256 bits)', () => {
    const h = sha256('test');
    assert.equal(h.length, 64);
    assert.match(h, /^[0-9a-f]+$/);
  });

  it('deterministyczne — ten sam input → ten sam hash', () => {
    assert.equal(sha256('Warszawa, Mokotów, Puławska 100'),
                 sha256('Warszawa, Mokotów, Puławska 100'));
  });

  it('różne inputy → różne hashe', () => {
    const a = sha256('input-a');
    const b = sha256('input-b');
    assert.notEqual(a, b);
  });

  it('znany wektor testowy: sha256("test") = 9f86d081…', () => {
    assert.equal(sha256('test'),
      '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08');
  });

  it('input numeryczny → konwersja na string', () => {
    assert.equal(sha256(42), sha256('42'));
    assert.equal(sha256(true), sha256('true'));
  });
});

describe('lib/ids — isMainModule', () => {
  it('zwraca boolean', () => {
    assert.equal(typeof isMainModule(import.meta.url), 'boolean');
  });

  it('null / undefined / pusty importMetaUrl → false', () => {
    assert.equal(isMainModule(null), false);
    assert.equal(isMainModule(undefined), false);
    assert.equal(isMainModule(''), false);
  });

  it('fałszywy url (nie matchuje process.argv[1]) → false', () => {
    assert.equal(isMainModule('file:///nonexistent/module.js'), false);
  });
});
