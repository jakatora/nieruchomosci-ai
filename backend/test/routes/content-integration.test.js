import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import { __setTestClient, __resetTestClient } from '../../src/services/ai.js';

/**
 * Iter 54: Integration tests dla `/content/paste-listing-analysis` (landing demo).
 *
 * Pokrywa: source detection (Domiporta/OLX/inne), URL → source_id parsing,
 * 404 dla nieznanego listing, happy path z fairness + AI flags preview-only.
 *
 * NOTE: rate-limiting (5/IP/24h) jest BARDZO konfigurowalne przez env, testujemy
 * pozytywne ścieżki tylko (rate limiter testowany osobno).
 */

let app, server, baseUrl;
const TEST_SOURCE = 'content-integration-test';

async function startServer() {
  app = createApp();
  server = http.createServer(app).listen(0);
  await new Promise((r) => server.on('listening', r));
  baseUrl = `http://localhost:${server.address().port}`;
}

async function stopServer() {
  if (server) await new Promise((r) => server.close(r));
}

let ipCounter = 100;
async function req(path, opts = {}) {
  // Unikalny IP per request by ominąć rate limiter (5/IP/24h).
  ipCounter += 1;
  const res = await fetch(baseUrl + path, {
    method: opts.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `192.168.99.${ipCounter}`,
      ...(opts.headers || {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* */ }
  return { status: res.status, body };
}

const URL_BASE = 'https://www.domiporta.pl/nieruchomosci/sprzedam-mieszkanie-dwupokojowe-warszawa-mokotow-50m2/';

function seedListing(sourceId, overrides = {}) {
  const id = `${TEST_SOURCE}-${sourceId}`;
  db.prepare(`
    INSERT OR REPLACE INTO listings (id, source, source_id, url, title, price_pln, area_m2, price_per_m2,
                          city, district, photos, raw_data, fetched_at, published_at, status)
    VALUES (?, 'domiporta', ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, 'active')
  `).run(
    id, sourceId, overrides.url || `https://www.domiporta.pl/test/${sourceId}`,
    overrides.title || 'Mieszkanie testowe', overrides.price ?? 500_000,
    overrides.area ?? 50, Math.round((overrides.price ?? 500_000) / (overrides.area ?? 50)),
    overrides.city ?? 'Warszawa', overrides.district ?? 'Mokotów',
    JSON.stringify(overrides.photos ?? ['https://test/img.jpg']),
    new Date().toISOString(), new Date().toISOString(),
  );
  return id;
}

describe('routes/content — integration (paste-listing-analysis)', () => {
  before(async () => {
    await startServer();
    // AI off — heurystyczny fallback dla testów (deterministic, no API cost).
    __setTestClient(null);
    db.prepare("DELETE FROM listings WHERE source = 'domiporta' AND id LIKE ?")
      .run(`${TEST_SOURCE}-%`);
  });

  after(async () => {
    __resetTestClient();
    db.prepare("DELETE FROM listings WHERE source = 'domiporta' AND id LIKE ?")
      .run(`${TEST_SOURCE}-%`);
    await stopServer();
  });

  describe('walidacja URL', () => {
    it('400 BAD_REQUEST dla pustego body', async () => {
      const { status, body } = await req('/content/paste-listing-analysis', {
        method: 'POST',
        body: {},
      });
      assert.equal(status, 400);
      assert.equal(body.error.code, 'BAD_REQUEST');
    });

    it('400 dla niepełnego URL (nie http)', async () => {
      const { status } = await req('/content/paste-listing-analysis', {
        method: 'POST',
        body: { url: 'nie-jest-url' },
      });
      assert.equal(status, 400);
    });

    it('400 dla nieobsługiwanego portalu (np. otodom)', async () => {
      const { status, body } = await req('/content/paste-listing-analysis', {
        method: 'POST',
        body: { url: 'https://www.otodom.pl/oferta/abc-123' },
      });
      assert.equal(status, 400);
      assert.match(body.error.message, /Domiporta/);
      assert.deepEqual(body.error.details?.supported_sources, ['domiporta']);
    });

    it('400 gdy URL Domiporta ale bez rozpoznawalnego ID', async () => {
      const { status, body } = await req('/content/paste-listing-analysis', {
        method: 'POST',
        body: { url: 'https://www.domiporta.pl/' },
      });
      assert.equal(status, 400);
      assert.match(body.error.message, /identyfikator/);
    });
  });

  describe('404 dla nieznanego listing (nie w DB)', () => {
    it('zwraca 404 z CTA do rejestracji', async () => {
      const { status, body } = await req('/content/paste-listing-analysis', {
        method: 'POST',
        body: {
          url: URL_BASE + '99999999',
        },
      });
      assert.equal(status, 404);
      assert.match(body.error.message, /rejestruj/i);
      assert.equal(body.error.details?.retry_after, 'next_daily_cron');
    });
  });

  describe('happy path — listing w DB', () => {
    it('200 z listing + fairness + red_flag_preview + CTA', async () => {
      seedListing('12345678', {
        title: 'Apartament Mokotów 50m2',
        price: 600_000,
        area: 50,
        city: 'Warszawa',
        district: 'Mokotów',
      });

      const { status, body } = await req('/content/paste-listing-analysis', {
        method: 'POST',
        body: {
          url: URL_BASE + '12345678',
        },
      });

      assert.equal(status, 200);
      // listing shape
      assert.equal(body.listing.title, 'Apartament Mokotów 50m2');
      assert.equal(body.listing.city, 'Warszawa');
      assert.equal(body.listing.district, 'Mokotów');
      assert.equal(body.listing.price_pln, 600_000);
      assert.equal(body.listing.area_m2, 50);
      // fairness shape
      assert.ok(body.fairness);
      assert.ok(['below', 'fair', 'above', 'unknown'].includes(body.fairness.label));
      // red_flag_preview (preview-only, max 1 flag)
      assert.ok(body.red_flag_preview);
      assert.ok('total_found' in body.red_flag_preview);
      // CTA
      assert.ok(body.cta.message);
      assert.ok(body.cta.register_url);
    });

    it('photo: pierwsze zdjęcie z listy (preview)', async () => {
      seedListing('22222222', {
        photos: ['https://test/first.jpg', 'https://test/second.jpg'],
      });
      const { body } = await req('/content/paste-listing-analysis', {
        method: 'POST',
        body: {
          url: URL_BASE + '22222222',
        },
      });
      assert.equal(body.listing.photo, 'https://test/first.jpg');
    });

    it('photo=null gdy brak zdjęć', async () => {
      seedListing('33333333', { photos: [] });
      const { body } = await req('/content/paste-listing-analysis', {
        method: 'POST',
        body: {
          url: URL_BASE + '33333333',
        },
      });
      assert.equal(body.listing.photo, null);
    });

    it('CTA register_url wskazuje na landing GitHub Pages', async () => {
      seedListing('44444444');
      const { body } = await req('/content/paste-listing-analysis', {
        method: 'POST',
        body: {
          url: URL_BASE + '44444444',
        },
      });
      assert.match(body.cta.register_url, /github\.io|nieruchomosciai/);
    });
  });
});
