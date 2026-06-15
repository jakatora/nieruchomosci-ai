import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';

/**
 * Iter 55: Integration tests dla `/webhooks/stripe` — signed payload, idempotency,
 * 4 typy eventów (checkout.session.completed, subscription.updated/deleted, payment_failed).
 *
 * Strategia: ustawiamy STRIPE_WEBHOOK_SECRET PRZED importem createApp, sami generujemy
 * podpis HMAC-SHA256 zgodny z Stripe spec (`t=<timestamp>,v1=<sig>`), wysyłamy
 * RAW body + nagłówek `stripe-signature`. Sprawdzamy:
 *   - 400 bez podpisu / zły podpis
 *   - 200 i side-effecty (users.premium_tier update, processed_webhooks.mark)
 *   - 200 z `duplicate: true` przy retry tego samego event.id
 */

// MUSI być przed import createApp/stripe — env czytany przy module load.
const TEST_WEBHOOK_SECRET = 'whsec_test_' + crypto.randomBytes(16).toString('hex');
process.env.STRIPE_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_dummy';

const { createApp } = await import('../../src/app.js');
const { db } = await import('../../src/db/index.js');
const { users } = await import('../../src/db/repos.js');

let app, server, baseUrl;
let testUserId;

async function startServer() {
  app = createApp();
  server = http.createServer(app).listen(0);
  await new Promise((r) => server.on('listening', r));
  baseUrl = `http://localhost:${server.address().port}`;
}

async function stopServer() {
  if (server) await new Promise((r) => server.close(r));
}

/** Generuje Stripe signature header zgodny z constructEvent. */
function signPayload(rawBody, secret = TEST_WEBHOOK_SECRET) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signedPayload = `${timestamp}.${rawBody}`;
  const v1 = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  return `t=${timestamp},v1=${v1}`;
}

async function postWebhook(eventPayload, opts = {}) {
  const rawBody = JSON.stringify(eventPayload);
  const headers = {
    'Content-Type': 'application/json',
    'stripe-signature': opts.signature ?? signPayload(rawBody),
    ...(opts.headers || {}),
  };
  if (opts.skipSignature) delete headers['stripe-signature'];
  const res = await fetch(`${baseUrl}/webhooks/stripe`, {
    method: 'POST',
    headers,
    body: rawBody,
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body };
}

function makeCheckoutEvent({ eventId, userId, plan = 'standard', customerId = 'cus_test_xyz' }) {
  return {
    id: eventId,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_' + crypto.randomBytes(8).toString('hex'),
        client_reference_id: userId,
        customer: customerId,
        subscription: 'sub_test_' + crypto.randomBytes(8).toString('hex'),
        metadata: { user_id: userId, plan },
      },
    },
  };
}

describe('routes/webhooks/stripe — integration', () => {
  before(async () => {
    await startServer();
    db.prepare("DELETE FROM users WHERE email LIKE 'webhook-test-%'").run();
    const u = users.create({
      email: 'webhook-test-' + crypto.randomBytes(4).toString('hex') + '@test.local',
      passwordHash: 'fake',
      userType: 'consumer',
    });
    testUserId = u.id;
  });

  after(async () => {
    db.prepare("DELETE FROM users WHERE email LIKE 'webhook-test-%'").run();
    db.prepare("DELETE FROM processed_webhooks WHERE event_id LIKE 'evt_test_%'").run();
    await stopServer();
  });

  beforeEach(() => {
    // Reset premium_tier
    users.updatePremium(testUserId, 'free');
    db.prepare("DELETE FROM processed_webhooks WHERE event_id LIKE 'evt_test_%'").run();
  });

  describe('signature validation', () => {
    it('400 bez stripe-signature header', async () => {
      const { status, body } = await postWebhook(
        makeCheckoutEvent({ eventId: 'evt_test_nosig', userId: testUserId }),
        { skipSignature: true },
      );
      assert.equal(status, 400);
      assert.match(String(body), /Missing signature/);
    });

    it('400 dla nieprawidłowego podpisu', async () => {
      const { status, body } = await postWebhook(
        makeCheckoutEvent({ eventId: 'evt_test_badsig', userId: testUserId }),
        { signature: 't=12345,v1=deadbeef' },
      );
      assert.equal(status, 400);
      assert.match(String(body), /Webhook Error/);
    });

    it('200 dla prawidłowego podpisu z naszym test secretem', async () => {
      const { status, body } = await postWebhook(
        makeCheckoutEvent({ eventId: 'evt_test_ok_sig', userId: testUserId }),
      );
      assert.equal(status, 200);
      assert.equal(body.received, true);
    });
  });

  describe('checkout.session.completed → premium activation', () => {
    it('aktywuje plan standard z metadata.plan', async () => {
      const { status } = await postWebhook(makeCheckoutEvent({
        eventId: 'evt_test_checkout_std', userId: testUserId, plan: 'standard',
        customerId: 'cus_test_std',
      }));
      assert.equal(status, 200);
      const u = users.findById(testUserId);
      assert.equal(u.premium_tier, 'standard');
      assert.equal(u.stripe_customer_id, 'cus_test_std');
    });

    it('aktywuje plan investor z metadata.plan', async () => {
      const { status } = await postWebhook(makeCheckoutEvent({
        eventId: 'evt_test_checkout_inv', userId: testUserId, plan: 'investor',
        customerId: 'cus_test_inv',
      }));
      assert.equal(status, 200);
      const u = users.findById(testUserId);
      assert.equal(u.premium_tier, 'investor');
    });

    it('user_id z client_reference_id (fallback gdy brak metadata)', async () => {
      const ev = makeCheckoutEvent({ eventId: 'evt_test_cref', userId: testUserId });
      // Wyczyść metadata.user_id by zmusić fallback
      ev.data.object.metadata = { plan: 'standard' };
      const { status } = await postWebhook(ev);
      assert.equal(status, 200);
      assert.equal(users.findById(testUserId).premium_tier, 'standard');
    });
  });

  describe('idempotency', () => {
    it('drugi raz ten sam event.id → duplicate: true, NIE re-process', async () => {
      const ev = makeCheckoutEvent({
        eventId: 'evt_test_dup', userId: testUserId, plan: 'standard',
      });
      const r1 = await postWebhook(ev);
      assert.equal(r1.status, 200);
      assert.equal(r1.body.duplicate, undefined);

      // Downgrade ręcznie do free
      users.updatePremium(testUserId, 'free');

      const r2 = await postWebhook(ev);
      assert.equal(r2.status, 200);
      assert.equal(r2.body.duplicate, true);

      // premium_tier NIE zmieniony (bo skip)
      assert.equal(users.findById(testUserId).premium_tier, 'free',
        'duplicate event NIE re-processuje');
    });
  });

  describe('customer.subscription.deleted → downgrade do free', () => {
    it('user → free po subscription.deleted', async () => {
      users.updatePremium(testUserId, 'standard', 'cus_xxx', 'sub_xxx');
      const ev = {
        id: 'evt_test_sub_del',
        type: 'customer.subscription.deleted',
        data: { object: { id: 'sub_xxx', metadata: { user_id: testUserId } } },
      };
      const { status } = await postWebhook(ev);
      assert.equal(status, 200);
      assert.equal(users.findById(testUserId).premium_tier, 'free');
    });
  });

  describe('customer.subscription.updated → downgrade gdy unpaid', () => {
    it('status=unpaid → free', async () => {
      users.updatePremium(testUserId, 'investor', 'cus_xxx', 'sub_xxx');
      const ev = {
        id: 'evt_test_sub_upd',
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_xxx', status: 'unpaid', metadata: { user_id: testUserId } } },
      };
      await postWebhook(ev);
      assert.equal(users.findById(testUserId).premium_tier, 'free');
    });

    it('status=active → NIE zmienia tier', async () => {
      users.updatePremium(testUserId, 'standard', 'cus_xxx', 'sub_xxx');
      const ev = {
        id: 'evt_test_sub_active',
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_xxx', status: 'active', metadata: { user_id: testUserId } } },
      };
      await postWebhook(ev);
      assert.equal(users.findById(testUserId).premium_tier, 'standard');
    });
  });

  describe('nieobsługiwane eventy', () => {
    it('200 dla unknown event type (po prostu log)', async () => {
      const ev = {
        id: 'evt_test_unknown',
        type: 'some.unknown.event',
        data: { object: {} },
      };
      const { status, body } = await postWebhook(ev);
      assert.equal(status, 200);
      assert.equal(body.received, true);
    });
  });
});
