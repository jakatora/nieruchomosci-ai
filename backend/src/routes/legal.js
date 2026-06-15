import { Router } from 'express';
import { ah } from '../lib/asyncHandler.js';

const router = Router();

/**
 * Legal pages — Privacy Policy + Terms of Service.
 *
 * Wymagania:
 *   - Apple App Store: Privacy Policy URL w listingu (mandatory dla app z user accounts)
 *   - Google Play: Privacy Policy URL w Console (mandatory)
 *   - RODO PL: klauzula informacyjna, prawo do usunięcia danych
 *   - Konsumenckie PL: regulamin, prawo odstąpienia 14 dni
 *
 * Content jest **draft prawny** — przed publikacją warto skonsultować z prawnikiem
 * znającym RODO + konsumenckie PL. Adres do reklamacji i dane administratora są
 * placeholders — TODO: wypełnić rzeczywistymi danymi przed deployem.
 */

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

function legalPage({ title, body }) {
  return `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} — NieruchomościAI</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
    .brand { background: linear-gradient(135deg, #0D9488 0%, #FB7185 100%); }
  </style>
</head>
<body class="bg-gray-50 min-h-screen flex flex-col">
  <header class="brand text-white py-4 px-6 shadow">
    <div class="max-w-3xl mx-auto flex items-center justify-between">
      <a href="/" class="text-xl font-bold">🏠 NieruchomościAI</a>
      <span class="text-sm opacity-80">${escapeHtml(title)}</span>
    </div>
  </header>
  <main class="flex-1 max-w-3xl mx-auto w-full px-6 py-8">
    <article class="bg-white rounded-lg p-8 shadow prose prose-sm max-w-none">
      ${body}
    </article>
  </main>
  <footer class="bg-white border-t mt-12 py-6 px-6 text-center text-sm text-gray-500">
    <a href="/legal/privacy" class="hover:text-teal-600 mx-2">Polityka prywatności</a>
    <a href="/legal/terms" class="hover:text-teal-600 mx-2">Regulamin</a>
    <span class="mx-2">support@nieruchomosciai.pl</span>
  </footer>
</body>
</html>`;
}

// ====================================================================
// GET /legal/privacy — Polityka prywatności (RODO)
// ====================================================================

router.get('/privacy', ah(async (req, res) => {
  res.send(legalPage({
    title: 'Polityka prywatności',
    body: `
<h1 class="text-3xl font-bold mb-6">Polityka prywatności</h1>
<p class="text-sm text-gray-500 mb-6">Ostatnia aktualizacja: 2026-05-24</p>

<h2 class="text-xl font-semibold mt-6 mb-3">1. Administrator danych</h2>
<p>Administratorem Twoich danych osobowych w aplikacji <strong>NieruchomościAI</strong> jest:</p>
<p><em>[TODO: nazwa firmy / imię i nazwisko + NIP, adres, email kontaktowy]</em></p>
<p>Email kontaktowy: <a href="mailto:support@nieruchomosciai.pl" class="text-teal-600">support@nieruchomosciai.pl</a></p>

<h2 class="text-xl font-semibold mt-6 mb-3">2. Jakie dane zbieramy</h2>
<ul class="list-disc pl-6 space-y-1">
  <li><strong>Email i hasło</strong> (hash bcrypt) — do założenia konta i logowania.</li>
  <li><strong>Typ użytkownika</strong> (consumer / investor) — żeby dostosować funkcje.</li>
  <li><strong>Miasto i preferencje wyszukiwania</strong> — do dopasowania ofert.</li>
  <li><strong>Push token urządzenia</strong> (Expo) — do wysyłania powiadomień.</li>
  <li><strong>Dane subskrypcji Stripe</strong> (customer_id, subscription_id) — tylko identyfikatory; danych karty nie mamy.</li>
  <li><strong>Dziennik akcji</strong> (audit_log): login, zmiana profilu, utworzenie wyszukiwania — do bezpieczeństwa i diagnostyki.</li>
  <li><strong>Adres IP</strong> przy rejestracji i logowaniu (anty-fraud, audit).</li>
</ul>

<h2 class="text-xl font-semibold mt-6 mb-3">3. Po co przetwarzamy dane</h2>
<ul class="list-disc pl-6 space-y-1">
  <li>Świadczenie usługi (analiza ofert mieszkaniowych dla Ciebie) — art. 6 ust. 1 lit. b RODO (umowa)</li>
  <li>Marketing własny (push notifications o nowych dopasowaniach) — art. 6 ust. 1 lit. a (Twoja zgoda, możesz wyłączyć)</li>
  <li>Bezpieczeństwo i audyt — art. 6 ust. 1 lit. f (uzasadniony interes administratora)</li>
  <li>Obowiązki podatkowe (faktury VAT za subskrypcję) — art. 6 ust. 1 lit. c (obowiązek prawny)</li>
</ul>

<h2 class="text-xl font-semibold mt-6 mb-3">4. Komu udostępniamy dane (procesory)</h2>
<ul class="list-disc pl-6 space-y-1">
  <li><strong>Stripe (Irlandia/USA)</strong> — przetwarzanie płatności subskrypcji. <a href="https://stripe.com/privacy" class="text-teal-600">Polityka Stripe</a></li>
  <li><strong>Resend (USA)</strong> — wysyłka emaili transakcyjnych. <a href="https://resend.com/legal/privacy-policy" class="text-teal-600">Polityka Resend</a></li>
  <li><strong>Anthropic (USA)</strong> — analiza AI ofert (red flags + matching). Wysyłamy tylko TYTUŁ + CENA + LOKALIZACJA oferty, NIE Twoje dane osobowe. <a href="https://anthropic.com/legal/privacy" class="text-teal-600">Polityka Anthropic</a></li>
  <li><strong>Expo / Google FCM / Apple APNs</strong> — dostarczanie push notifications.</li>
  <li><strong>Railway (USA)</strong> — hosting backend + baza.</li>
  <li><strong>Backblaze B2 (USA)</strong> — szyfrowane backupy.</li>
</ul>
<p class="mt-2">Transfer poza EOG: dotyczy USA. Bazujemy na standardowych klauzulach umownych (SCC) zatwierdzonych przez Komisję Europejską.</p>

<h2 class="text-xl font-semibold mt-6 mb-3">5. Czas przechowywania danych</h2>
<ul class="list-disc pl-6 space-y-1">
  <li>Dane konta — przez czas trwania umowy + 12 miesięcy po deaktywacji</li>
  <li>Audit logs — 12 miesięcy</li>
  <li>Faktury VAT (po Stripe) — 5 lat (obowiązek podatkowy)</li>
  <li>Push tokens — do momentu usunięcia konta lub odinstalowania aplikacji</li>
</ul>

<h2 class="text-xl font-semibold mt-6 mb-3">6. Twoje prawa (RODO art. 15-22)</h2>
<ul class="list-disc pl-6 space-y-1">
  <li><strong>Prawo dostępu</strong> — możesz zażądać kopii swoich danych (response w 30 dni)</li>
  <li><strong>Prawo sprostowania</strong> — popraw email/preferencje w aplikacji albo przez support</li>
  <li><strong>Prawo do bycia zapomnianym</strong> — usuwamy konto + wszystkie dane w 30 dni po wniosku</li>
  <li><strong>Prawo ograniczenia przetwarzania</strong></li>
  <li><strong>Prawo przenoszenia danych</strong> — eksport JSON na żądanie</li>
  <li><strong>Prawo sprzeciwu wobec marketingu</strong> — wyłącz w aplikacji (Ustawienia → Powiadomienia)</li>
  <li><strong>Prawo wniesienia skargi do PUODO</strong> — <a href="https://uodo.gov.pl" class="text-teal-600">uodo.gov.pl</a></li>
</ul>
<p class="mt-2">Żądania kieruj na: <a href="mailto:privacy@nieruchomosciai.pl" class="text-teal-600">privacy@nieruchomosciai.pl</a></p>

<h2 class="text-xl font-semibold mt-6 mb-3">7. Bezpieczeństwo</h2>
<p>Hasła hashowane bcrypt cost 12. Komunikacja HTTPS only. Backupy szyfrowane AES-256. Audit log dla każdej zmiany krytycznej. Tokeny JWT z 30-dniowym TTL.</p>

<h2 class="text-xl font-semibold mt-6 mb-3">8. Cookies / tracking</h2>
<p>Aplikacja mobilna NIE używa cookies — używa tylko local storage do tokena auth. Backend nie tracking użytkowników poza audit_log. NIE używamy Google Analytics, Facebook Pixel ani innych narzędzi marketingowych.</p>

<h2 class="text-xl font-semibold mt-6 mb-3">9. Zmiany polityki</h2>
<p>Powiadomimy o zmianach przez push notification i email co najmniej 14 dni przed wejściem w życie.</p>
`,
  }));
}));

// ====================================================================
// GET /legal/terms — Regulamin
// ====================================================================

router.get('/terms', ah(async (req, res) => {
  res.send(legalPage({
    title: 'Regulamin',
    body: `
<h1 class="text-3xl font-bold mb-6">Regulamin korzystania z aplikacji NieruchomościAI</h1>
<p class="text-sm text-gray-500 mb-6">Ostatnia aktualizacja: 2026-05-24</p>

<h2 class="text-xl font-semibold mt-6 mb-3">§1. Definicje</h2>
<ul class="list-disc pl-6 space-y-1">
  <li><strong>Aplikacja</strong> — NieruchomościAI (mobile Android + iOS) i strony backend dostępne pod URL'em wskazanym przez Operatora.</li>
  <li><strong>Operator</strong> — <em>[TODO: pełne dane administracyjne]</em></li>
  <li><strong>Użytkownik</strong> — osoba fizyczna pełnoletnia, korzystająca z Aplikacji.</li>
  <li><strong>Subskrypcja</strong> — abonament płatny (plan Standard 39 PLN/mc lub Investor 149 PLN/mc).</li>
  <li><strong>AI</strong> — algorytm wykorzystujący model językowy do analizy ogłoszeń (Anthropic Claude).</li>
</ul>

<h2 class="text-xl font-semibold mt-6 mb-3">§2. Charakter usługi</h2>
<p>Aplikacja agreguje publiczne ogłoszenia nieruchomości i przedstawia analizę AI (oszacowanie ceny vs rynek, identyfikacja niezgodności w opisie, kalkulacja ROI dla inwestorów). <strong>Aplikacja NIE świadczy doradztwa inwestycyjnego, prawnego ani podatkowego.</strong> Decyzje o zakupie/inwestycji Użytkownik podejmuje samodzielnie.</p>

<h2 class="text-xl font-semibold mt-6 mb-3">§3. Subskrypcja i płatności</h2>
<ul class="list-disc pl-6 space-y-1">
  <li>Subskrypcja jest miesięczna z automatycznym odnowieniem.</li>
  <li>Płatność realizowana przez Stripe — Operator nie przechowuje danych karty.</li>
  <li>Anulować można w każdej chwili w ustawieniach konta (Stripe Customer Portal). Anulacja działa od następnego okresu rozliczeniowego.</li>
  <li>Faktura VAT generowana automatycznie po każdej płatności (wysyłka email).</li>
  <li>VAT 23% wliczony w cenę (39 PLN brutto / 149 PLN brutto).</li>
</ul>

<h2 class="text-xl font-semibold mt-6 mb-3">§4. Prawo odstąpienia (konsumenci PL)</h2>
<p>Zgodnie z ustawą o prawach konsumenta, Użytkownik będący konsumentem ma prawo odstąpić od umowy w terminie 14 dni od jej zawarcia bez podania przyczyny. Wystarczy email na <a href="mailto:support@nieruchomosciai.pl" class="text-teal-600">support@nieruchomosciai.pl</a> z wnioskiem.</p>
<p class="text-sm text-gray-600 mt-2">Uwaga: prawo odstąpienia NIE przysługuje jeżeli rozpoczęto świadczenie usługi za wyraźną zgodą konsumenta — co dla SaaS oznacza moment aktywacji premium_tier. W praktyce Operator zwraca prorate kwoty przy odstąpieniu w pierwszych 14 dniach.</p>

<h2 class="text-xl font-semibold mt-6 mb-3">§5. Disclaimer AI</h2>
<p><strong>AI nie gwarantuje 100% poprawności analiz.</strong> Modele językowe mogą "halucynować" lub błędnie interpretować dane. Użytkownik MUSI weryfikować informacje bezpośrednio u źródła (portal nieruchomości, ogłoszeniodawca, prawnik, geodeta, rzeczoznawca). Operator nie odpowiada za decyzje podjęte wyłącznie na podstawie analizy AI.</p>

<h2 class="text-xl font-semibold mt-6 mb-3">§6. Źródła danych</h2>
<p>Aplikacja korzysta z publicznych RSS feedów portali nieruchomości (obecnie Domiporta.pl). Linkujemy zwrotnie do oryginalnego ogłoszenia. NIE republikujemy zdjęć — pokazujemy tylko URL do oryginalnego źródła. Jeśli ogłoszenie zniknęło ze źródła, może wciąż pojawiać się w aplikacji przez 24-48h (najnowszy cron daily).</p>

<h2 class="text-xl font-semibold mt-6 mb-3">§7. Ograniczenie odpowiedzialności</h2>
<p>Operator nie odpowiada za:</p>
<ul class="list-disc pl-6 space-y-1">
  <li>Decyzje inwestycyjne Użytkownika oparte na analizach AI</li>
  <li>Niedostępność czasową spowodowaną awarią po stronie zewnętrznych usług (Stripe, Anthropic, źródła RSS)</li>
  <li>Treści ogłoszeń pochodzących z portali zewnętrznych (Domiporta itd.)</li>
  <li>Sytuacje force majeure</li>
</ul>

<h2 class="text-xl font-semibold mt-6 mb-3">§8. Reklamacje i ADR</h2>
<p>Reklamacje: email na <a href="mailto:support@nieruchomosciai.pl" class="text-teal-600">support@nieruchomosciai.pl</a> — odpowiedź w 14 dni roboczych.</p>
<p class="mt-2">W przypadku sporów konsumenckich możliwe jest pozasądowe rozwiązanie sporów przez Stałe Polubowne Sądy Konsumenckie przy Wojewódzkich Inspektoratach Inspekcji Handlowej, oraz przez platformę ODR Komisji Europejskiej: <a href="https://ec.europa.eu/consumers/odr" class="text-teal-600">ec.europa.eu/consumers/odr</a></p>

<h2 class="text-xl font-semibold mt-6 mb-3">§9. Zmiany regulaminu</h2>
<p>Operator zastrzega prawo do zmian regulaminu z 14-dniowym wyprzedzeniem (push + email). Brak akceptacji = możliwość anulowania subskrypcji bez konsekwencji.</p>

<h2 class="text-xl font-semibold mt-6 mb-3">§10. Prawo właściwe i sądy</h2>
<p>Umowa podlega prawu polskiemu. Spory rozstrzyga sąd właściwy dla siedziby Operatora (dla konsumentów — sąd właściwy ze względu na miejsce zamieszkania).</p>
`,
  }));
}));

export default router;
