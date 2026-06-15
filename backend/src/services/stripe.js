import Stripe from 'stripe';
import { env, features } from '../config/env.js';
import { serviceUnavailable, badRequest } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

/**
 * Stripe wrapper — checkout sessions + webhook signature verification.
 *
 * Dual-plan setup (DEC-007, DEC-008/009):
 *   - Standard (39 PLN/mc) → `env.STRIPE_PRICE_STANDARD`
 *   - Investor (149 PLN/mc) → `env.STRIPE_PRICE_INVESTOR`
 *
 * Graceful degradation: bez `STRIPE_SECRET_KEY` wszystko zwraca 503 z czytelnym message.
 * To pozwala backendowi startować i odpowiadać na inne endpointy w trakcie konfiguracji
 * (BLK-01 P1).
 */

let _stripe = null;
function client() {
  if (!features.stripe) return null;
  if (!_stripe) _stripe = new Stripe(env.STRIPE_SECRET_KEY);
  return _stripe;
}

export function isStripeEnabled() {
  return features.stripe;
}

/** Zwraca price_id z env dla danego planu albo rzuca jeśli nieskonfigurowany. */
export function priceIdForPlan(plan) {
  if (plan === 'standard') {
    if (!env.STRIPE_PRICE_STANDARD) {
      throw serviceUnavailable('Plan Standard nie jest jeszcze skonfigurowany (brak STRIPE_PRICE_STANDARD).');
    }
    return env.STRIPE_PRICE_STANDARD;
  }
  if (plan === 'investor') {
    if (!env.STRIPE_PRICE_INVESTOR) {
      throw serviceUnavailable('Plan Investor nie jest jeszcze skonfigurowany (brak STRIPE_PRICE_INVESTOR).');
    }
    return env.STRIPE_PRICE_INVESTOR;
  }
  throw badRequest(`Nieznany plan: ${plan}`);
}

/**
 * Tworzy sesję Stripe Checkout dla danego usera + planu.
 * Strategia iOS bypass: zawsze przez external browser (DEC-009 backend-served).
 */
export async function createCheckoutSession({ user, plan, successUrl, cancelUrl }) {
  const s = client();
  if (!s) throw serviceUnavailable('Płatności chwilowo niedostępne — brak konfiguracji Stripe.');

  const priceId = priceIdForPlan(plan);

  return s.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    customer: user.stripe_customer_id || undefined,
    customer_email: user.stripe_customer_id ? undefined : user.email,
    client_reference_id: user.id,
    metadata: { user_id: user.id, plan },
    subscription_data: { metadata: { user_id: user.id, plan } },
    success_url: successUrl,
    cancel_url: cancelUrl,
    allow_promotion_codes: true,
    locale: 'pl',
  });
}

/** Pobiera szczegóły sesji checkout (do `/upgrade/success` z verify). */
export async function retrieveCheckoutSession(sessionId) {
  const s = client();
  if (!s) throw serviceUnavailable('Stripe niedostępny');
  return s.checkout.sessions.retrieve(sessionId, { expand: ['subscription', 'customer'] });
}

/** Konstrukcja eventu webhooka z weryfikacją podpisu (security-critical). */
export function constructWebhookEvent(rawBody, signature) {
  const s = client();
  if (!s) throw serviceUnavailable('Stripe niedostępny');
  if (!env.STRIPE_WEBHOOK_SECRET) {
    throw serviceUnavailable('Brak STRIPE_WEBHOOK_SECRET — odrzucam webhook.');
  }
  return s.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
}

/** Mapuje price_id z subskrypcji na nazwę planu (do persistence w `users.premium_tier`). */
export function planFromPriceId(priceId) {
  if (priceId === env.STRIPE_PRICE_STANDARD) return 'standard';
  if (priceId === env.STRIPE_PRICE_INVESTOR) return 'investor';
  logger.warn({ priceId }, 'Stripe webhook: nieznany price_id — domyślnie standard');
  return 'standard';
}

export { client as stripeClient };
