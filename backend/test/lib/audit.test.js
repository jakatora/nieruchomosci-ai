import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { audit } from '../../src/lib/audit.js';
import { db } from '../../src/db/index.js';

const TEST_ACTION = 'test_audit_iter23';

function cleanup() {
  db.prepare(`DELETE FROM audit_logs WHERE action = ?`).run(TEST_ACTION);
}

describe('lib/audit — audit()', () => {
  after(() => cleanup());

  it('zapisuje wpis do audit_logs', () => {
    cleanup();
    audit({ userId: 'u1', action: TEST_ACTION, ip: '127.0.0.1' });
    const row = db.prepare(`SELECT * FROM audit_logs WHERE action = ? ORDER BY created_at DESC LIMIT 1`)
      .get(TEST_ACTION);
    assert.ok(row);
    assert.equal(row.user_id, 'u1');
    assert.equal(row.action, TEST_ACTION);
    assert.equal(row.ip_address, '127.0.0.1');
  });

  it('detail jako object jest JSON.stringify', () => {
    audit({ userId: 'u2', action: TEST_ACTION, detail: { plan: 'standard', count: 3 }, ip: '::1' });
    const row = db.prepare(`SELECT * FROM audit_logs WHERE user_id = 'u2' AND action = ? ORDER BY created_at DESC LIMIT 1`)
      .get(TEST_ACTION);
    const parsed = JSON.parse(row.detail);
    assert.deepEqual(parsed, { plan: 'standard', count: 3 });
  });

  it('detail null → kolumna NULL (nie string "null")', () => {
    audit({ userId: 'u3', action: TEST_ACTION, ip: '::1' });
    const row = db.prepare(`SELECT * FROM audit_logs WHERE user_id = 'u3' AND action = ? ORDER BY created_at DESC LIMIT 1`)
      .get(TEST_ACTION);
    assert.equal(row.detail, null);
  });

  it('userId opcjonalny — anonimowe akcje', () => {
    audit({ action: TEST_ACTION, ip: '203.0.113.1' });
    const row = db.prepare(`SELECT * FROM audit_logs WHERE action = ? AND user_id IS NULL ORDER BY created_at DESC LIMIT 1`)
      .get(TEST_ACTION);
    assert.ok(row);
    assert.equal(row.user_id, null);
  });

  it('NIE rzuca przy missing action (zwala silnie do logger.error)', () => {
    // KRYTYCZNE: audit ma try-catch — NIGDY nie rzuca, bo zewnętrzny code'em
    // (route handler) nie może być zablokowany przez awarię audit.
    assert.doesNotThrow(() => audit({ userId: 'u4' /* action: undefined */ }));
  });

  it('NIE rzuca przy invalid input', () => {
    assert.doesNotThrow(() => audit({}));
    assert.doesNotThrow(() => audit({ userId: 12345, action: TEST_ACTION }));
    assert.doesNotThrow(() => audit({ action: TEST_ACTION, detail: { nested: { deep: 'data' } } }));
  });

  it('Każdy zapis ma unique id (UUID v4)', () => {
    cleanup();
    audit({ userId: 'u5', action: TEST_ACTION });
    audit({ userId: 'u5', action: TEST_ACTION });
    const rows = db.prepare(`SELECT id FROM audit_logs WHERE user_id = 'u5' AND action = ?`).all(TEST_ACTION);
    assert.equal(rows.length, 2);
    assert.notEqual(rows[0].id, rows[1].id);
    for (const r of rows) {
      assert.match(r.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-/);
    }
  });

  it('created_at jest ISO 8601 (sortowalny)', () => {
    audit({ userId: 'u6', action: TEST_ACTION });
    const row = db.prepare(`SELECT created_at FROM audit_logs WHERE user_id = 'u6' AND action = ? LIMIT 1`)
      .get(TEST_ACTION);
    assert.match(row.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
