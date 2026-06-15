import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidExpoToken, sendPush, sendPushBatch, newMatchPushPayload,
} from '../../src/services/push.js';

const VALID_TOKEN_1 = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxxx]';
const VALID_TOKEN_2 = 'ExpoPushToken[abc123_DEF-456]';

describe('services/push — isValidExpoToken', () => {
  it('akceptuje format ExponentPushToken[…]', () => {
    assert.equal(isValidExpoToken(VALID_TOKEN_1), true);
  });

  it('akceptuje format ExpoPushToken[…]', () => {
    assert.equal(isValidExpoToken(VALID_TOKEN_2), true);
  });

  it('akceptuje alphanumeryczne + underscore + dash w inner content', () => {
    assert.equal(isValidExpoToken('ExpoPushToken[abc_123-DEF]'), true);
  });

  it('odrzuca null/undefined/empty', () => {
    assert.equal(isValidExpoToken(null), false);
    assert.equal(isValidExpoToken(undefined), false);
    assert.equal(isValidExpoToken(''), false);
  });

  it('odrzuca non-string (number, object, array)', () => {
    assert.equal(isValidExpoToken(123), false);
    assert.equal(isValidExpoToken({}), false);
    assert.equal(isValidExpoToken(['ExpoPushToken[abc]']), false);
  });

  it('odrzuca random string', () => {
    assert.equal(isValidExpoToken('random-token-abc'), false);
    assert.equal(isValidExpoToken('FCM:abc123'), false);
  });

  it('odrzuca prawie-validny format (brak nawiasów)', () => {
    assert.equal(isValidExpoToken('ExpoPushTokenabc'), false);
    assert.equal(isValidExpoToken('ExpoPushToken[abc'), false);
    assert.equal(isValidExpoToken('ExpoPushTokenabc]'), false);
  });

  it('odrzuca special chars w inner content (anti-injection)', () => {
    assert.equal(isValidExpoToken('ExpoPushToken[<script>]'), false);
    assert.equal(isValidExpoToken('ExpoPushToken[abc def]'), false);
  });
});

describe('services/push — sendPush (dry-run mode)', () => {
  let originalDryRun;
  before(() => { originalDryRun = process.env.PUSH_DRY_RUN; process.env.PUSH_DRY_RUN = '1'; });
  after(() => { process.env.PUSH_DRY_RUN = originalDryRun ?? ''; });

  it('dry-run mode → {sent: false, dryRun: true}', async () => {
    const r = await sendPush(VALID_TOKEN_1, { title: 'Test', body: 'Body' });
    assert.equal(r.sent, false);
    assert.equal(r.dryRun, true);
  });

  it('invalid token nawet w dry-run → error invalid_token', async () => {
    const r = await sendPush('niepoprawny', { title: 'Test' });
    assert.equal(r.sent, false);
    assert.equal(r.error, 'invalid_token');
  });
});

describe('services/push — sendPush (mocked fetch)', () => {
  let originalDryRun;
  let originalFetch;
  before(() => {
    originalDryRun = process.env.PUSH_DRY_RUN;
    process.env.PUSH_DRY_RUN = '0';
    originalFetch = global.fetch;
  });
  after(() => {
    process.env.PUSH_DRY_RUN = originalDryRun ?? '';
    global.fetch = originalFetch;
  });

  beforeEach(() => { global.fetch = originalFetch; });

  it('happy path — Expo zwraca ticket ok', async () => {
    let capturedBody;
    global.fetch = async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        json: async () => ({ data: [{ status: 'ok', id: 'rec-123' }] }),
      };
    };

    const r = await sendPush(VALID_TOKEN_1, { title: 'Tytuł', body: 'Treść' });
    assert.equal(r.sent, true);
    assert.equal(r.ticket.status, 'ok');
    assert.equal(capturedBody.to, VALID_TOKEN_1);
    assert.equal(capturedBody.title, 'Tytuł');
    assert.equal(capturedBody.body, 'Treść');
    assert.equal(capturedBody.sound, 'default');
  });

  it('Expo zwraca status=error → {sent: false, error}', async () => {
    global.fetch = async () => ({
      ok: true,
      json: async () => ({ data: [{ status: 'error', message: 'DeviceNotRegistered' }] }),
    });
    const r = await sendPush(VALID_TOKEN_1, { title: 'T' });
    assert.equal(r.sent, false);
    assert.equal(r.error, 'DeviceNotRegistered');
  });

  it('HTTP 500 → {sent: false, error: HTTP 500}', async () => {
    global.fetch = async () => ({ ok: false, status: 500, statusText: 'Internal Error' });
    const r = await sendPush(VALID_TOKEN_1, { title: 'T' });
    assert.equal(r.sent, false);
    assert.match(r.error, /HTTP 500/);
  });

  it('network error (fetch throw) → graceful {sent: false, error}', async () => {
    global.fetch = async () => { throw new Error('ECONNREFUSED'); };
    const r = await sendPush(VALID_TOKEN_1, { title: 'T' });
    assert.equal(r.sent, false);
    assert.match(r.error, /ECONNREFUSED/);
  });

  it('title obcięty do 65 chars (Expo limit)', async () => {
    let capturedBody;
    global.fetch = async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ data: [{ status: 'ok' }] }) };
    };
    const longTitle = 'A'.repeat(200);
    await sendPush(VALID_TOKEN_1, { title: longTitle, body: 'x' });
    assert.equal(capturedBody.title.length, 65);
  });

  it('body obcięty do 240 chars (Expo limit)', async () => {
    let capturedBody;
    global.fetch = async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ data: [{ status: 'ok' }] }) };
    };
    const longBody = 'B'.repeat(500);
    await sendPush(VALID_TOKEN_1, { title: 'T', body: longBody });
    assert.equal(capturedBody.body.length, 240);
  });

  it('default title gdy brak (anti undefined w Expo)', async () => {
    let capturedBody;
    global.fetch = async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ data: [{ status: 'ok' }] }) };
    };
    await sendPush(VALID_TOKEN_1, { body: 'X' });
    assert.equal(capturedBody.title, 'NieruchomościAI');
  });

  it('przekazuje data payload', async () => {
    let capturedBody;
    global.fetch = async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ data: [{ status: 'ok' }] }) };
    };
    await sendPush(VALID_TOKEN_1, { title: 'T', data: { match_id: 'abc', deep_link: '/listings/123' } });
    assert.deepEqual(capturedBody.data, { match_id: 'abc', deep_link: '/listings/123' });
  });
});

describe('services/push — sendPushBatch (dry-run)', () => {
  let originalDryRun;
  before(() => { originalDryRun = process.env.PUSH_DRY_RUN; process.env.PUSH_DRY_RUN = '1'; });
  after(() => { process.env.PUSH_DRY_RUN = originalDryRun ?? ''; });

  it('empty array → {sent: 0, failed: 0, errors: []}', async () => {
    const r = await sendPushBatch([]);
    assert.deepEqual(r, { sent: 0, failed: 0, errors: [] });
  });

  it('null/undefined input → graceful', async () => {
    assert.deepEqual(await sendPushBatch(null), { sent: 0, failed: 0, errors: [] });
    assert.deepEqual(await sendPushBatch(undefined), { sent: 0, failed: 0, errors: [] });
  });

  it('dry-run wszystkie messages → 0 sent, każde "failed" z dryRun', async () => {
    const messages = [
      { token: VALID_TOKEN_1, payload: { title: 'A' } },
      { token: VALID_TOKEN_2, payload: { title: 'B' } },
    ];
    const r = await sendPushBatch(messages);
    // w dry-run sendPush zwraca {sent: false, dryRun: true} → liczone jako failed
    assert.equal(r.sent, 0);
    assert.equal(r.failed, 2);
  });
});

describe('services/push — newMatchPushPayload', () => {
  const listing = {
    id: 'l1', city: 'Warszawa', district: 'Mokotów',
    price_pln: 950000, area_m2: 65,
  };

  it('Consumer + below = "OKAZJA poniżej rynku" w body', () => {
    const user = { user_type: 'consumer' };
    const match = { id: 'm1', price_fairness: 'below' };
    const p = newMatchPushPayload(user, match, listing);
    assert.match(p.title, /Nowa oferta.*Warszawa.*Mokotów/);
    assert.match(p.body, /OKAZJA/);
    assert.equal(p.data.type, 'new_match');
    assert.equal(p.data.match_id, 'm1');
  });

  it('Investor + below = "OKAZJA" + yield w body', () => {
    const user = { user_type: 'investor' };
    const match = { id: 'm1', price_fairness: 'below', yield_net_pct: 6.15 };
    const p = newMatchPushPayload(user, match, listing);
    assert.match(p.title, /Nowa inwestycja/);
    assert.match(p.body, /yield 6\.2%/);
    assert.match(p.body, /OKAZJA/);
  });

  it('Investor bez yield_net_pct → bez yield w body', () => {
    const user = { user_type: 'investor' };
    const match = { id: 'm1', price_fairness: 'fair' };
    const p = newMatchPushPayload(user, match, listing);
    assert.ok(!p.body.includes('yield'));
  });

  it('Consumer + above = "powyżej rynku"', () => {
    const user = { user_type: 'consumer' };
    const match = { id: 'm1', price_fairness: 'above' };
    const p = newMatchPushPayload(user, match, listing);
    assert.match(p.body, /powyżej rynku/);
  });

  it('Bez district → tylko miasto w title', () => {
    const user = { user_type: 'consumer' };
    const match = { id: 'm1', price_fairness: 'fair' };
    const p = newMatchPushPayload(user, match, { ...listing, district: null });
    assert.match(p.title, /Warszawa/);
    assert.ok(!p.title.includes('null'));
    assert.ok(!p.title.includes('()'));
  });

  it('Formatuje cenę po polsku (separator tysięcy)', () => {
    const user = { user_type: 'consumer' };
    const match = { id: 'm1', price_fairness: 'fair' };
    const p = newMatchPushPayload(user, match, listing);
    // 950000 → "950 000" (PL locale)
    assert.match(p.body, /950[\s ]000/);
  });
});
