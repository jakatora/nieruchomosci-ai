import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isStripeEnabled, priceIdForPlan, planFromPriceId,
  createCheckoutSession, retrieveCheckoutSession, constructWebhookEvent,
} from '../../src/services/stripe.js';
import { env, features } from '../../src/config/env.js';

describe('services/stripe — isStripeEnabled', () => {
  it('zwraca boolean', () => {
    assert.equal(typeof isStripeEnabled(), 'boolean');
  });

  it('odzwierciedla features.stripe flag z env config', () => {
    assert.equal(isStripeEnabled(), features.stripe);
  });
});

describe('services/stripe — priceIdForPlan', () => {
  it('throwuje gdy plan=standard ale brak STRIPE_PRICE_STANDARD (BLK-01 P1)', () => {
    if (!env.STRIPE_PRICE_STANDARD) {
      assert.throws(() => priceIdForPlan('standard'), /Plan Standard nie jest jeszcze skonfigurowany/);
    } else {
      // Jeśli env ma value, pricerId musi być zwrócony.
      assert.equal(priceIdForPlan('standard'), env.STRIPE_PRICE_STANDARD);
    }
  });

  it('throwuje gdy plan=investor ale brak STRIPE_PRICE_INVESTOR', () => {
    if (!env.STRIPE_PRICE_INVESTOR) {
      assert.throws(() => priceIdForPlan('investor'), /Plan Investor nie jest jeszcze skonfigurowany/);
    } else {
      assert.equal(priceIdForPlan('investor'), env.STRIPE_PRICE_INVESTOR);
    }
  });

  it('throwuje BAD_REQUEST dla nieznanego planu', () => {
    assert.throws(() => priceIdForPlan('gold'), /Nieznany plan: gold/);
    assert.throws(() => priceIdForPlan(null), /Nieznany plan/);
    assert.throws(() => priceIdForPlan(''), /Nieznany plan/);
  });
});

describe('services/stripe — planFromPriceId (webhook plan detection)', () => {
  it('STRIPE_PRICE_STANDARD env → "standard"', () => {
    // Test działa tylko gdy env jest ustawiony — inaczej fallback "standard"
    if (env.STRIPE_PRICE_STANDARD) {
      assert.equal(planFromPriceId(env.STRIPE_PRICE_STANDARD), 'standard');
    }
  });

  it('STRIPE_PRICE_INVESTOR env → "investor"', () => {
    if (env.STRIPE_PRICE_INVESTOR) {
      assert.equal(planFromPriceId(env.STRIPE_PRICE_INVESTOR), 'investor');
    }
  });

  it('nieznany price_id → fallback "standard" + warn log', () => {
    // Fallback do "standard" gdy webhook dostaje price_id którego nie znamy
    // (np. lifetime / family plan z przyszłości albo legacy plan).
    assert.equal(planFromPriceId('price_xxxxxxxxxxxxxxxx'), 'standard');
  });

  it('null/undefined price_id → fallback "standard"', () => {
    assert.equal(planFromPriceId(null), 'standard');
    assert.equal(planFromPriceId(undefined), 'standard');
  });
});

describe('services/stripe — graceful degradation gdy Stripe niedostępny', () => {
  it('createCheckoutSession throwuje serviceUnavailable gdy brak SECRET_KEY', async () => {
    if (!features.stripe) {
      await assert.rejects(
        createCheckoutSession({
          user: { id: 'u1', email: 'x@y.z' },
          plan: 'standard',
          successUrl: 'http://x', cancelUrl: 'http://y',
        }),
        /Płatności chwilowo niedostępne/,
      );
    }
  });

  it('retrieveCheckoutSession throwuje gdy brak SECRET_KEY', async () => {
    if (!features.stripe) {
      await assert.rejects(
        retrieveCheckoutSession('cs_test_xxx'),
        /Stripe niedostępny/,
      );
    }
  });

  it('constructWebhookEvent throwuje gdy brak WEBHOOK_SECRET', () => {
    if (!env.STRIPE_WEBHOOK_SECRET) {
      assert.throws(
        () => constructWebhookEvent('{}', 't=123,v1=abc'),
        /Brak STRIPE_WEBHOOK_SECRET|Stripe niedostępny/,
      );
    }
  });
});

describe('services/stripe — contract: signatures', () => {
  it('createCheckoutSession to async function', () => {
    assert.equal(typeof createCheckoutSession, 'function');
    assert.equal(createCheckoutSession.constructor.name, 'AsyncFunction');
  });

  it('retrieveCheckoutSession to async function', () => {
    assert.equal(retrieveCheckoutSession.constructor.name, 'AsyncFunction');
  });

  it('constructWebhookEvent to sync function (Stripe SDK sync verify)', () => {
    assert.equal(typeof constructWebhookEvent, 'function');
    assert.equal(constructWebhookEvent.constructor.name, 'Function');
  });

  it('isStripeEnabled to sync function zwracająca boolean', () => {
    assert.equal(typeof isStripeEnabled(), 'boolean');
  });
});
