import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../lib/asyncHandler.js';
import { env, features } from '../config/env.js';
import { badRequest, notFound, serviceUnavailable } from '../lib/errors.js';
import { users } from '../db/repos.js';
import { consumeUpgradeLink } from '../services/magicLink.js';
import { createCheckoutSession, retrieveCheckoutSession, isStripeEnabled } from '../services/stripe.js';
import { audit } from '../lib/audit.js';
import { logger } from '../lib/logger.js';

const router = Router();

/**
 * DEC-009 (backend-served upgrade pages): Express odpowiada **statycznym HTML** dla 3 URLi:
 *
 *   GET  /upgrade?user_id=&token=&plan=    — entry page z CTA „Kontynuuj do płatności"
 *   POST /upgrade/checkout                 — tworzy Stripe Checkout Session, zwraca {url}
 *   GET  /upgrade/success?session_id=      — po powrocie z Stripe (success)
 *   GET  /upgrade/cancel                   — po powrocie z Stripe (cancel)
 *
 * Strategia bezpieczeństwa magic-link:
 *   - Token NIE jest konsumowany na GET /upgrade (tylko walidacja że istnieje +
 *     ważny + pasuje do user_id). Konsumowany dopiero przy POST /checkout
 *     (jednorazowy + nie cofalny).
 *   - Token CHECKOUT_TOKEN (ten sam) jest w form data na POST.
 *
 * HTML inline (Tailwind CDN dla stylingu) — żeby uniknąć osobnego repo / build steps.
 * UI minimalny ale wystarczający: branding, listing planu, CTA, footer legal links.
 */

// ====================================================================
// HELPER: HTML shell z Tailwind CDN i ASCII-safe content
// ====================================================================

function htmlPage({ title, body, ogDescription = 'NieruchomościAI — analiza ofert mieszkaniowych z AI.' }) {
  return `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} — NieruchomościAI</title>
  <meta name="description" content="${escapeHtml(ogDescription)}">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
    .brand { background: linear-gradient(135deg, #0D9488 0%, #FB7185 100%); }
  </style>
</head>
<body class="bg-gray-50 min-h-screen flex flex-col">
  <header class="brand text-white py-4 px-6 shadow">
    <div class="max-w-2xl mx-auto flex items-center justify-between">
      <a href="/" class="text-xl font-bold">🏠 NieruchomościAI</a>
      <span class="text-sm opacity-80">${escapeHtml(title)}</span>
    </div>
  </header>
  <main class="flex-1 max-w-2xl mx-auto w-full px-6 py-8">
    ${body}
  </main>
  <footer class="bg-white border-t mt-12 py-6 px-6 text-center text-sm text-gray-500">
    <a href="/legal/privacy" class="hover:text-teal-600 mx-2">Polityka prywatności</a>
    <a href="/legal/terms" class="hover:text-teal-600 mx-2">Regulamin</a>
    <span class="mx-2">support@nieruchomosciai.pl</span>
  </footer>
</body>
</html>`;
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

const PLAN_LABELS = {
  standard: { name: 'Standard', price: '39 PLN / miesiąc', features: [
    'Nielimitowane wyniki AI',
    'Powiadomienia push o nowych ofertach',
    'Pełna lista red-flag w każdej ofercie',
    'Mapa wyników z markerami',
    'Wskaźnik fair-price vs mediana okolicy',
  ] },
  investor: { name: 'Investor', price: '149 PLN / miesiąc', features: [
    'Wszystko z planu Standard',
    'Kalkulator ROI — yield, payback, cashflow',
    'Estymacja czynszu na bazie stawek dzielnic',
    'Top investments ranking + filtry',
    'Eksport CSV do Excela',
    'Priorytetowe wsparcie',
  ] },
};

// ====================================================================
// GET /upgrade — entry page (walidacja magic linku, CTA do Stripe)
// ====================================================================

router.get('/', ah(async (req, res) => {
  const userId = req.query.user_id;
  const token = req.query.token;
  const plan = req.query.plan;

  if (!userId || !token || !plan || !['standard', 'investor'].includes(plan)) {
    return res.status(400).send(htmlPage({
      title: 'Nieprawidłowy link',
      body: `<div class="bg-white rounded-lg p-8 shadow">
        <h1 class="text-2xl font-bold text-red-600 mb-4">❌ Nieprawidłowy link</h1>
        <p class="text-gray-700 mb-4">Brakuje parametrów <code>user_id</code>, <code>token</code> lub <code>plan</code>.</p>
        <p class="text-sm text-gray-500">Otwórz link aktywacyjny z aplikacji.</p>
      </div>`,
    }));
  }

  const user = users.findById(userId);
  if (!user) {
    return res.status(404).send(htmlPage({
      title: 'Konto nie istnieje',
      body: `<div class="bg-white rounded-lg p-8 shadow">
        <h1 class="text-2xl font-bold text-red-600 mb-4">❌ Konto nie istnieje</h1>
        <p class="text-gray-700">Sprawdź czy zalogowałeś się w aplikacji.</p>
      </div>`,
    }));
  }

  if (user.premium_tier === plan) {
    return res.send(htmlPage({
      title: 'Subskrypcja już aktywna',
      body: `<div class="bg-white rounded-lg p-8 shadow">
        <h1 class="text-2xl font-bold text-teal-600 mb-4">✅ Plan ${escapeHtml(PLAN_LABELS[plan].name)} już aktywny</h1>
        <p class="text-gray-700 mb-4">Twoje konto (${escapeHtml(user.email)}) ma już aktywny ten plan.</p>
        <p class="text-sm text-gray-500">Możesz zamknąć tę kartę i wrócić do aplikacji.</p>
      </div>`,
    }));
  }

  const planInfo = PLAN_LABELS[plan];
  const featuresHtml = planInfo.features.map((f) => `<li class="flex items-start"><span class="text-teal-500 mr-2">✓</span><span>${escapeHtml(f)}</span></li>`).join('\n');

  const stripeReady = isStripeEnabled() && (plan === 'standard' ? env.STRIPE_PRICE_STANDARD : env.STRIPE_PRICE_INVESTOR);
  const ctaButton = stripeReady
    ? `<button id="checkout-btn" class="w-full brand text-white font-semibold py-3 px-6 rounded-lg hover:opacity-90 transition">
        Kontynuuj do płatności Stripe →
      </button>`
    : `<div class="bg-yellow-50 border border-yellow-200 text-yellow-800 p-4 rounded-lg">
        <strong>⚠️ Płatności tymczasowo niedostępne.</strong> Pracujemy nad konfiguracją Stripe — sprawdź ponownie za kilka godzin.
      </div>`;

  res.send(htmlPage({
    title: `Aktywacja: ${planInfo.name}`,
    body: `
      <div class="bg-white rounded-lg p-8 shadow mb-6">
        <h1 class="text-3xl font-bold mb-2">Aktywuj plan <span class="text-teal-600">${escapeHtml(planInfo.name)}</span></h1>
        <p class="text-2xl text-gray-600 mb-6">${escapeHtml(planInfo.price)}</p>
        <ul class="space-y-2 mb-6 text-gray-700">
          ${featuresHtml}
        </ul>
        ${ctaButton}
        <p class="text-xs text-gray-400 mt-4 text-center">
          Płatność obsługuje Stripe. Anulujesz w każdej chwili. Pierwsze 14 dni — możesz odstąpić bez podania przyczyny (RODO).
        </p>
      </div>
      <div class="text-center text-sm text-gray-500">
        Konto: ${escapeHtml(user.email)} • Plan: <strong>${escapeHtml(planInfo.name)}</strong>
      </div>
      <script>
        document.getElementById('checkout-btn')?.addEventListener('click', async (e) => {
          e.target.disabled = true;
          e.target.textContent = 'Przekierowywanie…';
          try {
            const res = await fetch('/upgrade/checkout', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ user_id: ${JSON.stringify(userId)}, token: ${JSON.stringify(token)}, plan: ${JSON.stringify(plan)} }),
            });
            const data = await res.json();
            if (data.checkout_url) {
              window.location.href = data.checkout_url;
            } else {
              alert(data.error?.message || 'Błąd inicjalizacji płatności');
              e.target.disabled = false;
              e.target.textContent = 'Kontynuuj do płatności Stripe →';
            }
          } catch (err) {
            alert('Błąd sieci. Spróbuj ponownie.');
            e.target.disabled = false;
            e.target.textContent = 'Kontynuuj do płatności Stripe →';
          }
        });
      </script>
    `,
  }));
}));

// ====================================================================
// POST /upgrade/checkout — konsumuje magic link + tworzy Stripe session
// ====================================================================

const checkoutSchema = z.object({
  user_id: z.string().min(1),
  token: z.string().min(1),
  plan: z.enum(['standard', 'investor']),
});

router.post('/checkout', ah(async (req, res) => {
  const parsed = checkoutSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('Wymagane: user_id, token, plan');
  const { user_id: userId, token, plan } = parsed.data;

  const user = users.findById(userId);
  if (!user) throw notFound('Użytkownik nie istnieje');
  if (user.premium_tier === plan) throw badRequest(`Plan ${plan} jest już aktywny`);

  const consumedPlan = consumeUpgradeLink(userId, token);
  if (!consumedPlan || consumedPlan !== plan) {
    throw badRequest('Link do subskrypcji jest nieprawidłowy, zużyty lub nie pasuje do wybranego planu.');
  }

  if (!isStripeEnabled()) {
    throw serviceUnavailable('Płatności chwilowo niedostępne — sprawdź ponownie za kilka godzin.');
  }

  const session = await createCheckoutSession({
    user,
    plan,
    successUrl: `${env.LANDING_URL}/upgrade/success?session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${env.LANDING_URL}/upgrade/cancel`,
  });

  audit({ userId: user.id, action: 'checkout_started',
    detail: { plan, session_id: session.id }, ip: req.ip });
  logger.info({ userId: user.id, plan, sessionId: session.id }, 'Stripe Checkout session utworzona');

  res.json({ checkout_url: session.url });
}));

// ====================================================================
// GET /upgrade/success — po powrocie ze Stripe (subskrypcja aktywna)
// ====================================================================

router.get('/success', ah(async (req, res) => {
  const sessionId = req.query.session_id;
  let detailHtml = '';
  if (sessionId && isStripeEnabled()) {
    try {
      const session = await retrieveCheckoutSession(sessionId);
      const planLabel = session.metadata?.plan === 'investor' ? 'Investor (149 PLN/mc)' : 'Standard (39 PLN/mc)';
      detailHtml = `<p class="text-gray-700 mb-4">Plan <strong>${escapeHtml(planLabel)}</strong> aktywny. Webhook Stripe potwierdzi w aplikacji w ciągu chwili.</p>`;
      audit({ action: 'checkout_success_page', detail: { session_id: sessionId, plan: session.metadata?.plan }, ip: req.ip });
    } catch (err) {
      logger.warn({ err: err.message }, 'Nie udało się retrieve session w /success');
    }
  }
  res.send(htmlPage({
    title: 'Subskrypcja aktywna',
    body: `<div class="bg-white rounded-lg p-8 shadow text-center">
      <div class="text-6xl mb-4">✅</div>
      <h1 class="text-3xl font-bold text-teal-600 mb-4">Subskrypcja aktywna!</h1>
      ${detailHtml || '<p class="text-gray-700 mb-4">Płatność zakończona pomyślnie.</p>'}
      <p class="text-gray-600 mb-6">Wróć do aplikacji NieruchomościAI — wszystkie funkcje premium są już odblokowane.</p>
      <a href="nieruchomosciai://upgrade-complete" class="inline-block bg-teal-600 text-white px-6 py-3 rounded-lg hover:bg-teal-700">
        Otwórz aplikację
      </a>
      <p class="text-xs text-gray-400 mt-4">Jeśli aplikacja się nie otworzy — wróć do niej ręcznie.</p>
    </div>`,
  }));
}));

// ====================================================================
// GET /upgrade/cancel — anulowanie checkoutu
// ====================================================================

router.get('/cancel', ah(async (req, res) => {
  res.send(htmlPage({
    title: 'Płatność anulowana',
    body: `<div class="bg-white rounded-lg p-8 shadow text-center">
      <div class="text-6xl mb-4">↩️</div>
      <h1 class="text-3xl font-bold text-gray-700 mb-4">Płatność anulowana</h1>
      <p class="text-gray-600 mb-6">Nic nie zostało pobrane. Możesz wrócić do aplikacji i spróbować ponownie później.</p>
      <a href="nieruchomosciai://" class="inline-block bg-gray-200 text-gray-700 px-6 py-3 rounded-lg hover:bg-gray-300">
        Wróć do aplikacji
      </a>
    </div>`,
  }));
}));

export default router;
