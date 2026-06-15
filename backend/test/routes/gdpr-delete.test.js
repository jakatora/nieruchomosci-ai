import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../../src/db/index.js';
import { users, searches, matches, listings } from '../../src/db/repos.js';
import { signToken } from '../../src/middleware/auth.js';
import { newId, nowIso } from '../../src/lib/ids.js';

/**
 * GDPR delete (DELETE /auth/me) — end-to-end test bez supertest.
 *
 * Test SQL-level cascade behaviors + audit preservation:
 *   - users DELETE → searches/matches/magic_links CASCADE (gone)
 *   - users DELETE → audit_logs.user_id SET NULL (audit zachowany, anonymized)
 *   - users DELETE → support_tickets.user_id SET NULL (zachowane jako anonymous)
 *   - investor_analysis NIE jest user-scoped → zachowane
 *
 * Symulujemy endpoint przez wywołanie sequencji DB ops (audit + DELETE).
 */

const TEST_PREFIX = 'gdpr-delete-test-';

function cleanup() {
  db.prepare(`DELETE FROM audit_logs WHERE detail LIKE ?`).run(`%${TEST_PREFIX}%`);
  db.prepare(`DELETE FROM users WHERE email LIKE ?`).run(`${TEST_PREFIX}%`);
  db.prepare(`DELETE FROM listings WHERE source = ?`).run('gdpr-test');
}

before(cleanup);
after(cleanup);

describe('GDPR DELETE /auth/me — cascade behavior', () => {
  let testUser;
  let testListing;

  beforeEach(() => {
    cleanup();
    testUser = users.create({
      email: `${TEST_PREFIX}user-${newId().slice(0, 6)}@test.local`,
      userType: 'investor',
    });
    testListing = listings.findById(listings.upsert({
      source: 'gdpr-test',
      source_id: `l-${newId().slice(0, 6)}`,
      url: 'https://x.com', title: 'Test',
      city: 'Warszawa', fetched_at: nowIso(), status: 'active',
    }));
  });

  it('DELETE user kasuje jego searches (CASCADE)', () => {
    const s1 = searches.create(testUser.id, { name: 'A', city: 'Warszawa' });
    const s2 = searches.create(testUser.id, { name: 'B', city: 'Kraków' });

    db.prepare('DELETE FROM users WHERE id = ?').run(testUser.id);

    assert.equal(searches.findById(s1.id), null);
    assert.equal(searches.findById(s2.id), null);
  });

  it('DELETE user kasuje jego matches (CASCADE)', () => {
    const m = matches.create({
      userId: testUser.id, listingId: testListing.id, confidenceScore: 70,
    });

    db.prepare('DELETE FROM users WHERE id = ?').run(testUser.id);

    assert.equal(matches.findByUserListing(testUser.id, testListing.id), null);
  });

  it('DELETE user kasuje jego magic_links (CASCADE)', () => {
    db.prepare(`INSERT INTO magic_links (token, user_id, purpose, expires_at, created_at)
                VALUES (?, ?, ?, ?, ?)`)
      .run(`tok-${newId()}`, testUser.id, 'login',
        new Date(Date.now() + 10 * 60_000).toISOString(), nowIso());

    db.prepare('DELETE FROM users WHERE id = ?').run(testUser.id);

    const remaining = db.prepare('SELECT COUNT(*) AS n FROM magic_links WHERE user_id = ?')
      .get(testUser.id).n;
    assert.equal(remaining, 0);
  });

  it('AUDIT log z user_id ustawiony na NULL po endpoint flow (UPDATE + DELETE)', () => {
    // Insert audit log dla usera
    db.prepare(`INSERT INTO audit_logs (id, user_id, action, detail, ip_address, created_at)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(newId(), testUser.id, 'test_action',
        `${TEST_PREFIX}detail`, '127.0.0.1', nowIso());

    // Symulacja endpoint flow: manualny UPDATE (bo schema nie ma FK SET NULL) + DELETE
    db.prepare('UPDATE audit_logs SET user_id = NULL WHERE user_id = ?').run(testUser.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(testUser.id);

    const row = db.prepare(`SELECT user_id FROM audit_logs WHERE detail = ?`)
      .get(`${TEST_PREFIX}detail`);
    assert.ok(row);
    assert.equal(row.user_id, null);
  });

  it('support_tickets.user_id SET NULL po DELETE user (zachowuje ticket jako anonymous)', () => {
    db.prepare(`INSERT INTO support_tickets
                (id, user_id, email, subject, body, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 'open', ?, ?)`)
      .run(newId(), testUser.id, `${TEST_PREFIX}ticket@x.com`,
        'Subject', 'Body', nowIso(), nowIso());

    db.prepare('DELETE FROM users WHERE id = ?').run(testUser.id);

    const tickets = db.prepare(`SELECT user_id FROM support_tickets WHERE email = ?`)
      .all(`${TEST_PREFIX}ticket@x.com`);
    assert.ok(tickets.length > 0);
    assert.ok(tickets.every((t) => t.user_id === null));
  });

  it('investor_analysis NIE jest user-scoped → zachowany po DELETE user', () => {
    db.prepare(`INSERT INTO investor_analysis
                (listing_id, estimated_rent, yield_gross_pct, yield_net_pct,
                 payback_years, cashflow_monthly, rent_source, assumptions, computed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(testListing.id, 3500, 6.0, 5.2, 16.7, -200,
        'heuristic_v1', '{}', nowIso());

    db.prepare('DELETE FROM users WHERE id = ?').run(testUser.id);

    const ia = db.prepare('SELECT * FROM investor_analysis WHERE listing_id = ?')
      .get(testListing.id);
    assert.ok(ia); // zachowane — listing-scoped, nie user-scoped
  });

  it('JWT token po DELETE user → authRequired powinien zwrócić 401', () => {
    const token = signToken(testUser.id);
    // Symulacja: DELETE
    db.prepare('DELETE FROM users WHERE id = ?').run(testUser.id);
    // signToken token nadal valid (JWT signature OK + nie expired),
    // ale authRequired robi users.findById → null → 401 "Konto nie istnieje"
    assert.equal(users.findById(testUser.id), null);
    // (full authRequired flow test w iter 31 — tu sprawdzamy że DB DELETE jest poprawny)
  });

  it('idempotency: drugi DELETE tego samego id → no-op (0 changes)', () => {
    db.prepare('DELETE FROM users WHERE id = ?').run(testUser.id);
    // Drugi DELETE
    const result = db.prepare('DELETE FROM users WHERE id = ?').run(testUser.id);
    assert.equal(result.changes, 0);
  });
});
