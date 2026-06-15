import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../../src/app.js';
import { db } from '../../src/db/index.js';
import { env } from '../../src/config/env.js';
import { newId } from '../../src/lib/ids.js';
import { users, matches, investorAnalysis } from '../../src/db/repos.js';

/**
 * Iter 44: testy `POST /admin/listings/cleanup` (z iter 43).
 *
 * Testowanie przez wywołanie route handler bezpośrednio z fake req/res
 * (uniknięcie zależności od supertest).
 */

const TEST_SOURCE = 'cleanup-test-source';

function makeReqRes({ body = {}, headers = {} }) {
  const req = { body, headers: { 'x-admin-key': env.ADMIN_API_KEY, ...headers }, ip: '127.0.0.1' };
  let statusCode = 200;
  let jsonBody = null;
  const res = {
    status(c) { statusCode = c; return this; },
    json(b) { jsonBody = b; return this; },
  };
  return { req, res, getResult: () => ({ statusCode, body: jsonBody }) };
}

function makeOldListing({ status = 'active', daysAgo = 200 }) {
  const id = newId();
  const fetchedAt = new Date(Date.now() - daysAgo * 86400_000).toISOString();
  db.prepare(`
    INSERT INTO listings (id, source, source_id, url, title, city, photos, raw_data, fetched_at, status)
    VALUES (?, ?, ?, 'http://test', 'Test', 'TestCity', '[]', '{}', ?, ?)
  `).run(id, TEST_SOURCE, `${id}-${daysAgo}`, fetchedAt, status);
  return id;
}

async function callCleanup(body) {
  const app = createApp();
  return new Promise((resolve, reject) => {
    const req = {
      method: 'POST',
      url: '/admin/listings/cleanup',
      headers: {
        'x-admin-key': env.ADMIN_API_KEY,
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(JSON.stringify(body)).toString(),
      },
      body,
    };
    const server = http.createServer(app).listen(0, async () => {
      try {
        const port = server.address().port;
        const res = await fetch(`http://localhost:${port}/admin/listings/cleanup`, {
          method: 'POST',
          headers: {
            'X-Admin-Key': env.ADMIN_API_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });
        const json = await res.json();
        server.close();
        resolve({ status: res.status, json });
      } catch (err) {
        server.close();
        reject(err);
      }
    });
  });
}

describe('routes /admin/listings/cleanup', () => {
  before(() => {
    db.prepare('DELETE FROM listings WHERE source = ?').run(TEST_SOURCE);
  });

  after(() => {
    db.prepare('DELETE FROM listings WHERE source = ?').run(TEST_SOURCE);
  });

  beforeEach(() => {
    db.prepare('DELETE FROM listings WHERE source = ?').run(TEST_SOURCE);
  });

  describe('dry_run mode (default)', () => {
    it('zlicza candidates ale NIE usuwa', async () => {
      makeOldListing({ status: 'active', daysAgo: 200 }); // > 180 dni
      makeOldListing({ status: 'active', daysAgo: 30 });  // safe
      makeOldListing({ status: 'expired', daysAgo: 90 }); // > 60 dni
      makeOldListing({ status: 'sold', daysAgo: 30 });    // safe inactive

      const { status, json } = await callCleanup({});
      assert.equal(status, 200);
      assert.equal(json.dry_run, true, 'default jest dry_run=true (safety)');
      assert.equal(json.candidates.to_delete_active, 1);
      assert.equal(json.candidates.to_delete_inactive, 1);
      assert.equal(json.candidates.total_candidates, 2);
      assert.equal(json.deleted, 0, 'dry_run NIE usuwa');

      const stillThere = db.prepare(
        'SELECT COUNT(*) AS n FROM listings WHERE source = ?',
      ).get(TEST_SOURCE).n;
      assert.equal(stillThere, 4, 'wszystkie 4 nadal w DB po dry run');
    });
  });

  describe('real cleanup (dry_run=false)', () => {
    it('usuwa kandydatów + cascade matches', async () => {
      const oldId = makeOldListing({ status: 'active', daysAgo: 250 });
      const safeId = makeOldListing({ status: 'active', daysAgo: 10 });

      // Dodaj match na old listing — sprawdzimy CASCADE.
      const u = users.findByEmail('jakub.investor@test.local');
      if (u) {
        matches.create({
          userId: u.id, listingId: oldId, confidenceScore: 50,
          scorer: 'heuristic',
        });
      }

      const { json } = await callCleanup({ dry_run: false });
      assert.equal(json.dry_run, false);
      assert.equal(json.deleted >= 1, true, `oczekuję ≥1 deleted, dostałem ${json.deleted}`);

      const survivors = db.prepare(
        'SELECT id FROM listings WHERE source = ?',
      ).all(TEST_SOURCE).map((r) => r.id);
      assert.ok(survivors.includes(safeId), 'safe listing przeżył');
      assert.ok(!survivors.includes(oldId), 'old listing usunięty');

      // CASCADE: match dla oldId zniknął
      if (u) {
        const matchGone = matches.findByUserListing(u.id, oldId);
        assert.equal(matchGone, null, 'match CASCADE deleted z listing');
      }
    });

    it('orphaned investor_analysis cleaned up po CASCADE', async () => {
      const oldId = makeOldListing({ status: 'expired', daysAgo: 100 });
      investorAnalysis.upsert(oldId, {
        estimatedRent: 1000, yieldGrossPct: 5, yieldNetPct: 4,
        paybackYears: 20, cashflowMonthly: -500,
      });

      assert.notEqual(investorAnalysis.get(oldId), null, 'analiza utworzona przed cleanup');
      await callCleanup({ dry_run: false });
      assert.equal(investorAnalysis.get(oldId), null, 'orphaned analysis cleaned');
    });
  });

  describe('custom thresholds', () => {
    it('max_age_days_active=10 → listing 30-dniowy łapie (test scope inclusive — produkcyjne też się liczą)', async () => {
      const before = (await callCleanup({ dry_run: true, max_age_days_active: 10 }))
        .json.candidates.to_delete_active;
      makeOldListing({ status: 'active', daysAgo: 30 });
      const after = (await callCleanup({ dry_run: true, max_age_days_active: 10 }))
        .json.candidates.to_delete_active;
      assert.equal(after, before + 1, 'dodanie 1 starego listing → +1 w candidates');
    });

    it('max_age_days_inactive=200 → 90-dniowy expired NIE łapie (delta=0)', async () => {
      const before = (await callCleanup({ dry_run: true, max_age_days_inactive: 200 }))
        .json.candidates.to_delete_inactive;
      makeOldListing({ status: 'expired', daysAgo: 90 });
      const after = (await callCleanup({ dry_run: true, max_age_days_inactive: 200 }))
        .json.candidates.to_delete_inactive;
      assert.equal(after, before, '90-dniowy NIE liczy się gdy próg 200');
    });
  });

  describe('walidacja', () => {
    it('negatywne max_age_days → 400', async () => {
      const { status, json } = await callCleanup({ max_age_days_active: -1 });
      assert.equal(status, 400);
      assert.equal(json.error.code, 'BAD_REQUEST');
    });

    it('non-integer → 400', async () => {
      const { status } = await callCleanup({ max_age_days_active: 'abc' });
      assert.equal(status, 400);
    });
  });
});
