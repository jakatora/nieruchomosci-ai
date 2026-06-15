import { Router } from 'express';
import express from 'express';
import { ah } from '../lib/asyncHandler.js';
import { constructWebhookEvent, planFromPriceId, retrieveCheckoutSession } from '../services/stripe.js';
import { users, processedWebhooks } from '../db/repos.js';
import { sendEmail, subscriptionActiveEmail } from '../services/email.js';
import { logger } from '../lib/logger.js';
import { audit } from '../lib/audit.js';

const router = Router();

/**
 * Stripe webhooks — idempotent handler dla 4 kluczowych eventów:
 *
 *   - `checkout.session.completed`           — pierwsza płatność → premium_tier aktywny
 *   - `customer.subscription.updated`        — zmiana statusu (active / past_due / canceled)
 *   - `customer.subscription.deleted`        — koniec subskrypcji → premium_tier = 'free'
 *   - `invoice.payment_failed`               — log + email do usera (opt.)
 *
 * Idempotency: każdy event.id zapisujemy w `processed_webhooks` przed action.
 * Jeśli widzieliśmy już ten event — skip.
 *
 * Bezpieczeństwo: middleware `express.raw({type: 'application/json'})` — Stripe
 * wymaga RAW body do weryfikacji podpisu. Mount BEFORE `express.json()` w app.js.
 */

router.post(
  '/stripe',
  express.raw({ type: 'application/json' }),
  ah(async (req, res) => {
    const sig = req.headers['stripe-signature'];
    if (!sig) {
      logger.warn('Webhook Stripe bez stripe-signature header');
      return res.status(400).send('Missing signature');
    }

    let event;
    try {
      event = constructWebhookEvent(req.body, sig);
    } catch (err) {
      logger.error({ err: err.message }, 'Webhook signature verification failed');
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Idempotency check.
    if (processedWebhooks.exists(event.id)) {
      logger.info({ eventId: event.id, type: event.type }, 'Webhook już przetworzony — skip');
      return res.json({ received: true, duplicate: true });
    }

    try {
      await handleEvent(event);
      processedWebhooks.mark(event.id, 'stripe');
      audit({ action: 'stripe_webhook_handled',
        detail: { event_id: event.id, type: event.type } });
      res.json({ received: true });
    } catch (err) {
      logger.error({ err: err.message, eventId: event.id, type: event.type },
        'Webhook handler failed');
      // NIE zapisujemy w processed_webhooks — Stripe powtórzy próbę.
      res.status(500).send('Handler error');
    }
  }),
);

// ---------------- handlers per event type ----------------

async function handleEvent(event) {
  switch (event.type) {
    case 'checkout.session.completed':
      return handleCheckoutCompleted(event.data.object);
    case 'customer.subscription.updated':
      return handleSubscriptionUpdated(event.data.object);
    case 'customer.subscription.deleted':
      return handleSubscriptionDeleted(event.data.object);
    case 'invoice.payment_failed':
      return handlePaymentFailed(event.data.object);
    default:
      logger.debug({ type: event.type }, 'Webhook event ignorowany');
  }
}

async function handleCheckoutCompleted(session) {
  const userId = session.client_reference_id || session.metadata?.user_id;
  if (!userId) {
    logger.error({ session_id: session.id }, 'Brak user_id w checkout session');
    return;
  }
  const user = users.findById(userId);
  if (!user) {
    logger.error({ userId, session_id: session.id }, 'User nie istnieje przy checkout webhook');
    return;
  }

  // Wyciągamy plan z metadata albo z line_items (z fresh retrieve).
  let plan = session.metadata?.plan;
  if (!plan && session.id) {
    try {
      const full = await retrieveCheckoutSession(session.id);
      const priceId = full?.line_items?.data?.[0]?.price?.id
        || full?.subscription?.items?.data?.[0]?.price?.id;
      if (priceId) plan = planFromPriceId(priceId);
    } catch (err) {
      logger.warn({ err: err.message }, 'Retrieve session w webhooku failed');
    }
  }
  plan = plan ?? 'standard';

  users.updatePremium(userId, plan, session.customer, session.subscription);
  audit({ userId, action: 'subscription_activated', detail: { plan, session_id: session.id } });
  logger.info({ userId, plan, customer: session.customer }, 'Subskrypcja aktywowana');

  // Email potwierdzający (jeśli włączony email).
  sendEmail({ to: user.email, ...subscriptionActiveEmail(user, plan) })
    .catch((err) => logger.warn({ err: err.message }, 'Email subscriptionActive nie wysłany'));
}

async function handleSubscriptionUpdated(subscription) {
  const userId = subscription.metadata?.user_id;
  if (!userId) return;
  const user = users.findById(userId);
  if (!user) return;

  // Jeśli status 'past_due' / 'canceled' → downgrade. 'active' / 'trialing' → utrzymaj.
  if (['canceled', 'incomplete_expired', 'unpaid'].includes(subscription.status)) {
    users.updatePremium(userId, 'free');
    audit({ userId, action: 'subscription_downgraded',
      detail: { reason: subscription.status, subscription_id: subscription.id } });
    logger.info({ userId, status: subscription.status }, 'Subskrypcja → free');
  }
}

async function handleSubscriptionDeleted(subscription) {
  const userId = subscription.metadata?.user_id;
  if (!userId) return;
  users.updatePremium(userId, 'free');
  audit({ userId, action: 'subscription_deleted',
    detail: { subscription_id: subscription.id } });
  logger.info({ userId }, 'Subskrypcja usunięta → free');
}

async function handlePaymentFailed(invoice) {
  const customerId = invoice.customer;
  const user = users.findByStripeCustomerId(customerId);
  if (!user) return;
  audit({ userId: user.id, action: 'invoice_payment_failed',
    detail: { invoice_id: invoice.id, amount_due: invoice.amount_due } });
  logger.warn({ userId: user.id, invoice_id: invoice.id }, 'Płatność nieudana');
  // TODO Etap v2: dunning email do usera + retry policy
}

export default router;
