import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../src/db/index.js';
import {
  listings, investorAnalysis, geocodingCache,
  processedWebhooks, aiUsage, feedback, killSwitches, supportTickets,
  users, matches,
} from '../../src/db/repos.js';
import { newId, nowIso, sha256 } from '../../src/lib/ids.js';

/**
 * Pozostałe repos (investorAnalysis + geocodingCache + processedWebhooks + aiUsage +
 * feedback + killSwitches + supportTickets) — DB integration tests.
 *
 * Pokrycie krytyczne dla:
 *   - investorAnalysis cache (Etap 9 ROI)
 *   - geocodingCache (Google Maps cost saver)
 *   - processedWebhooks (Stripe idempotency)
 *   - aiUsage (budget guard)
 *   - feedback (UNIQUE constraint anti-spam)
 *   - killSwitches (ops emergency)
 *   - supportTickets (filter by status)
 */

const TEST_PREFIX = 'misc-repos-test-';

let user;
let listing;

function cleanup() {
  db.prepare(`DELETE FROM investor_analysis WHERE listing_id IN (SELECT id FROM listings WHERE source = ?)`)
    .run('misc-test');
  db.prepare(`DELETE FROM listings WHERE source = ?`).run('misc-test');
  db.prepare(`DELETE FROM users WHERE email LIKE ?`).run(`${TEST_PREFIX}%`);
  db.prepare(`DELETE FROM geocoding_cache WHERE query_text LIKE ?`).run(`${TEST_PREFIX}%`);
  db.prepare(`DELETE FROM processed_webhooks WHERE source = ?`).run('test-source');
  db.prepare(`DELETE FROM ai_usage WHERE operation LIKE ?`).run(`${TEST_PREFIX}%`);
  db.prepare(`DELETE FROM kill_switches WHERE key LIKE ?`).run(`${TEST_PREFIX}%`);
  db.prepare(`DELETE FROM support_tickets WHERE email LIKE ?`).run(`${TEST_PREFIX}%`);
}

before(() => {
  cleanup();
  user = users.create({ email: `${TEST_PREFIX}main@test.local` });
  const lid = listings.upsert({
    source: 'misc-test', source_id: `l-${newId().slice(0, 6)}`,
    url: 'https://x.com', title: 'L', city: 'Warszawa',
    fetched_at: nowIso(), status: 'active',
  });
  listing = listings.findById(lid);
});

after(cleanup);

// ====================================================================
// investorAnalysis
// ====================================================================
describe('investorAnalysis repo', () => {
  beforeEach(() => {
    db.prepare('DELETE FROM investor_analysis WHERE listing_id = ?').run(listing.id);
  });

  it('upsert: INSERT pierwszy raz', () => {
    const result = investorAnalysis.upsert(listing.id, {
      estimatedRent: 3500, yieldGrossPct: 6.0, yieldNetPct: 5.2,
      paybackYears: 16.7, cashflowMonthly: -200,
      rentSource: 'heuristic_v1:Warszawa@2026-Q1',
      assumptions: { vacancy: 5, mgmt: 8 },
    });
    assert.equal(result.listing_id, listing.id);
    assert.equal(result.estimated_rent, 3500);
    assert.equal(result.yield_gross_pct, 6.0);
    assert.equal(result.rent_source, 'heuristic_v1:Warszawa@2026-Q1');
  });

  it('upsert: UPDATE drugi raz (ON CONFLICT)', async () => {
    investorAnalysis.upsert(listing.id, {
      estimatedRent: 3000, yieldGrossPct: 5.0, yieldNetPct: 4.3,
      paybackYears: 20, cashflowMonthly: -500,
    });
    await new Promise((r) => setTimeout(r, 5));
    const upd = investorAnalysis.upsert(listing.id, {
      estimatedRent: 3500, yieldGrossPct: 6.0, yieldNetPct: 5.2,
      paybackYears: 16.7, cashflowMonthly: -200,
    });
    assert.equal(upd.estimated_rent, 3500);  // new value
    assert.equal(upd.yield_gross_pct, 6.0);
  });

  it('get zwraca null gdy nie ma analizy', () => {
    assert.equal(investorAnalysis.get('non-existent-listing-id'), null);
  });

  it('JSON assumptions serialize/deserialize', () => {
    const assumptions = { vacancy: 5, mgmt: 8, mortgageRate: 7, customField: 'X' };
    const r = investorAnalysis.upsert(listing.id, {
      estimatedRent: 3500, yieldGrossPct: 6.0, yieldNetPct: 5.2,
      paybackYears: 16.7, cashflowMonthly: -200,
      assumptions,
    });
    assert.deepEqual(JSON.parse(r.assumptions), assumptions);
  });

  it('rentSource default = "heuristic_v1"', () => {
    const r = investorAnalysis.upsert(listing.id, {
      estimatedRent: 3500, yieldGrossPct: 6.0, yieldNetPct: 5.2,
      paybackYears: 16.7, cashflowMonthly: -200,
    });
    assert.equal(r.rent_source, 'heuristic_v1');
  });
});

// ====================================================================
// geocodingCache
// ====================================================================
describe('geocodingCache repo', () => {
  it('findByQuery zwraca null gdy nie cached', () => {
    const q = `${TEST_PREFIX}unique-query-${newId().slice(0, 8)}`;
    assert.equal(geocodingCache.findByQuery(q), null);
  });

  it('upsert + findByQuery (case-insensitive, trim)', () => {
    const q = `${TEST_PREFIX}Mokotów, Warszawa  `; // z trailing spaces
    geocodingCache.upsert(q, { lat: 52.0, lng: 21.0, city: 'Warszawa', district: 'Mokotów' });
    // Lookup case-insensitive + trim
    const found = geocodingCache.findByQuery(`${TEST_PREFIX}MOKOTÓW, WARSZAWA`);
    assert.ok(found);
    assert.equal(found.lat, 52.0);
    assert.equal(found.lng, 21.0);
  });

  it('upsert z null result = negative cache', () => {
    const q = `${TEST_PREFIX}invalid-${newId().slice(0, 8)}`;
    geocodingCache.upsert(q, null);
    const found = geocodingCache.findByQuery(q);
    assert.ok(found);
    assert.equal(found.lat, null);
    assert.equal(found.lng, null);
  });

  it('drugi upsert nadpisuje (cached_at się zmienia)', async () => {
    const q = `${TEST_PREFIX}override-${newId().slice(0, 8)}`;
    geocodingCache.upsert(q, { lat: 50, lng: 20 });
    await new Promise((r) => setTimeout(r, 5));
    geocodingCache.upsert(q, { lat: 52, lng: 21 });
    const found = geocodingCache.findByQuery(q);
    assert.equal(found.lat, 52);
    assert.equal(found.lng, 21);
  });

  it('query_hash używa sha256', () => {
    const q = `${TEST_PREFIX}hash-check-${newId().slice(0, 8)}`;
    geocodingCache.upsert(q, { lat: 50, lng: 20 });
    const expectedHash = sha256(q.toLowerCase().trim());
    const row = db.prepare('SELECT query_hash FROM geocoding_cache WHERE query_text = ?').get(q);
    assert.equal(row.query_hash, expectedHash);
  });

  it('pruneOlderThan usuwa stare wpisy', () => {
    const q = `${TEST_PREFIX}old-${newId().slice(0, 8)}`;
    const oldDate = new Date(Date.now() - 100 * 86400_000).toISOString();
    // Manual insert z bardzo starą datą
    db.prepare(`
      INSERT INTO geocoding_cache (query_hash, query_text, lat, lng, city, district, cached_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(sha256(q), q, 50, 20, 'X', null, oldDate);
    const removed = geocodingCache.pruneOlderThan(60);
    assert.ok(removed >= 1);
    assert.equal(geocodingCache.findByQuery(q), null);
  });
});

// ====================================================================
// processedWebhooks (Stripe idempotency)
// ====================================================================
describe('processedWebhooks repo', () => {
  it('exists: false dla nie-przetworzonego eventu', () => {
    assert.equal(processedWebhooks.exists(`evt_${newId().slice(0, 16)}`), false);
  });

  it('mark + exists pattern (idempotency check)', () => {
    const eventId = `evt_test_${newId().slice(0, 16)}`;
    assert.equal(processedWebhooks.exists(eventId), false);
    processedWebhooks.mark(eventId, 'test-source');
    assert.equal(processedWebhooks.exists(eventId), true);
  });

  it('mark drugi raz tego samego event_id → no-op (ON CONFLICT DO NOTHING)', () => {
    const eventId = `evt_dup_${newId().slice(0, 16)}`;
    processedWebhooks.mark(eventId, 'test-source');
    assert.doesNotThrow(() => processedWebhooks.mark(eventId, 'test-source'));
  });

  it('default source = "stripe"', () => {
    const eventId = `evt_def_${newId().slice(0, 16)}`;
    processedWebhooks.mark(eventId);
    const row = db.prepare('SELECT source FROM processed_webhooks WHERE event_id = ?').get(eventId);
    assert.equal(row.source, 'stripe');
  });
});

// ====================================================================
// aiUsage (budget guard)
// ====================================================================
describe('aiUsage repo', () => {
  it('record zapisuje wpis', () => {
    const op = `${TEST_PREFIX}op-${newId().slice(0, 6)}`;
    aiUsage.record({
      operation: op, model: 'claude-haiku-4-5',
      inputTokens: 100, outputTokens: 50, costUsd: 0.001,
    });
    const row = db.prepare('SELECT * FROM ai_usage WHERE operation = ?').get(op);
    assert.ok(row);
    assert.equal(row.input_tokens, 100);
    assert.equal(row.output_tokens, 50);
    assert.equal(row.cost_usd, 0.001);
  });

  it('defaults: 0 tokens, 0 cost', () => {
    const op = `${TEST_PREFIX}def-${newId().slice(0, 6)}`;
    aiUsage.record({ operation: op, model: 'claude-haiku-4-5' });
    const row = db.prepare('SELECT * FROM ai_usage WHERE operation = ?').get(op);
    assert.equal(row.input_tokens, 0);
    assert.equal(row.output_tokens, 0);
    assert.equal(row.cost_usd, 0);
  });

  it('monthCostUsd zwraca number (sum)', () => {
    const v = aiUsage.monthCostUsd();
    assert.equal(typeof v, 'number');
    assert.ok(v >= 0);
  });

  it('monthCallCount zwraca number ≥ 0', () => {
    const v = aiUsage.monthCallCount();
    assert.equal(typeof v, 'number');
    assert.ok(v >= 0);
  });
});

// ====================================================================
// killSwitches (ops emergency)
// ====================================================================
describe('killSwitches repo', () => {
  it('isEnabled: defaultValue gdy klucz nie istnieje', () => {
    assert.equal(killSwitches.isEnabled(`${TEST_PREFIX}nonexistent`), true);
    assert.equal(killSwitches.isEnabled(`${TEST_PREFIX}nonexistent`, false), false);
  });

  it('set + isEnabled (toggle off → on)', () => {
    const key = `${TEST_PREFIX}toggle-${newId().slice(0, 6)}`;
    killSwitches.set(key, false, 'incident');
    assert.equal(killSwitches.isEnabled(key), false);
    killSwitches.set(key, true);
    assert.equal(killSwitches.isEnabled(key), true);
  });

  it('listAll zwraca array', () => {
    const list = killSwitches.listAll();
    assert.ok(Array.isArray(list));
  });

  it('reason zapisany w DB', () => {
    const key = `${TEST_PREFIX}reason-${newId().slice(0, 6)}`;
    killSwitches.set(key, false, 'Domiporta zmieniła format RSS');
    const row = db.prepare('SELECT reason FROM kill_switches WHERE key = ?').get(key);
    assert.equal(row.reason, 'Domiporta zmieniła format RSS');
  });
});

// ====================================================================
// supportTickets
// ====================================================================
describe('supportTickets repo', () => {
  it('create: ticket z minimum (email + subject + body)', () => {
    const t = supportTickets.create({
      email: `${TEST_PREFIX}user@test.local`,
      subject: 'Bug w mapie',
      body: 'Treść zgłoszenia',
    });
    assert.ok(t.id);
    assert.equal(t.email, `${TEST_PREFIX}user@test.local`);
    assert.equal(t.status, 'open');
  });

  it('create: ticket z user_id (zalogowany)', () => {
    const t = supportTickets.create({
      userId: user.id, email: `${TEST_PREFIX}auth@test.local`,
      subject: 'Q', body: 'B',
    });
    assert.equal(t.user_id, user.id);
  });

  it('listByStatus filter "open"', () => {
    supportTickets.create({ email: `${TEST_PREFIX}open@test.local`, subject: 'S', body: 'B' });
    const open = supportTickets.listByStatus('open', 50);
    assert.ok(open.length > 0);
    assert.ok(open.every((t) => t.status === 'open'));
  });

  it('listByStatus filter "resolved" zwraca tylko resolved', () => {
    const resolved = supportTickets.listByStatus('resolved', 50);
    assert.ok(resolved.every((t) => t.status === 'resolved'));
  });

  it('rzuca przy invalid status (CHECK)', () => {
    assert.throws(
      () => db.prepare(`UPDATE support_tickets SET status = 'spam' WHERE email = ?`).run(`${TEST_PREFIX}user@test.local`),
      /CHECK/i,
    );
  });
});

// ====================================================================
// feedback (UNIQUE per user_id + match_id, anti-spam)
// ====================================================================
describe('feedback repo', () => {
  let matchId;

  before(() => {
    const m = matches.create({ userId: user.id, listingId: listing.id, confidenceScore: 70 });
    matchId = m.id;
  });

  it('create + UPSERT pattern (UNIQUE user_id+match_id)', () => {
    feedback.create({ userId: user.id, matchId, helpful: true });
    const row = db.prepare('SELECT * FROM feedback WHERE user_id = ? AND match_id = ?')
      .get(user.id, matchId);
    assert.ok(row);
    assert.equal(row.helpful, 1);

    // Drugi feedback tego samego usera dla tego samego match → UPDATE, nie INSERT
    feedback.create({ userId: user.id, matchId, helpful: false, reason: 'changed mind' });
    const updated = db.prepare('SELECT * FROM feedback WHERE user_id = ? AND match_id = ?')
      .get(user.id, matchId);
    assert.equal(updated.helpful, 0);
    assert.equal(updated.reason, 'changed mind');
  });

  it('count == 1 (UNIQUE enforced)', () => {
    const count = db.prepare('SELECT COUNT(*) AS n FROM feedback WHERE user_id = ? AND match_id = ?')
      .get(user.id, matchId).n;
    assert.equal(count, 1);
  });
});
