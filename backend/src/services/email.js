import { Resend } from 'resend';
import { env, features } from '../config/env.js';
import { logger } from '../lib/logger.js';

const resend = features.email ? new Resend(env.RESEND_API_KEY) : null;

/**
 * Wysyła email transakcyjny przez Resend. Z `EMAIL_DRY_RUN=1` *zawsze*
 * loguje treść zamiast wysyłać (dev / staging). Bez `RESEND_API_KEY`
 * działa w trybie degradacji (loguje treść, nie wysyła).
 */
export async function sendEmail({ to, subject, html, text }) {
  if (features.emailDryRun) {
    logger.info({ to, subject, text }, '[EMAIL_DRY_RUN] email NIE wysłany (tryb dev)');
    return { sent: false, dryRun: true };
  }
  if (!resend) {
    logger.warn({ to, subject }, 'Email pominięty — brak RESEND_API_KEY (tryb degradacji)');
    return { sent: false, degraded: true };
  }
  try {
    const { data, error } = await resend.emails.send({
      from: env.EMAIL_FROM,
      replyTo: env.EMAIL_REPLY_TO,
      to,
      subject,
      html,
      text,
    });
    if (error) {
      logger.error({ error }, 'Resend zwrócił błąd');
      return { sent: false, error };
    }
    return { sent: true, id: data?.id };
  } catch (err) {
    logger.error({ err: err.message }, 'Wysyłka email nie powiodła się');
    return { sent: false, error: err.message };
  }
}

// ---------------- szablony ----------------

/** Email powitalny — copy zależne od user_type (Consumer vs Investor). */
export function welcomeEmail(user) {
  if (user.user_type === 'investor') {
    return {
      subject: 'Witamy w NieruchomościAI — wersja dla inwestorów',
      text: `Konto inwestorskie zostało utworzone. AI analizuje yield, payback i red-flagi ofert mieszkaniowych z OLX, byś mógł szybciej znajdować dochodowe inwestycje.`,
      html: `<p>Dzień dobry,</p>
<p>Konto <b>NieruchomościAI</b> dla profilu inwestorskiego zostało utworzone.</p>
<p>Co dostajesz w wersji free:</p>
<ul>
  <li>1 obszar wyszukiwania (miasto + dzielnice)</li>
  <li>Top 3 oferty / dobę z analizą AI</li>
  <li>Wskaźnik fair-price vs średnia rynkowa w okolicy</li>
</ul>
<p>Plan <b>Investor (149 zł / mc)</b> dokłada kalkulator ROI / yield / payback, eksport CSV
i nielimitowane wyniki. Aktywacja: <a href="${env.LANDING_URL}/upgrade">${env.LANDING_URL}/upgrade</a></p>
<p>Powodzenia z portfelem,<br>zespół NieruchomościAI</p>`,
    };
  }
  // consumer (default)
  return {
    subject: 'Witamy w NieruchomościAI',
    text: `Konto utworzone. AI analizuje oferty mieszkań z OLX, wykrywa red-flagi i pokazuje czy cena jest fair vs okolica.`,
    html: `<p>Dzień dobry,</p>
<p>Konto <b>NieruchomościAI</b> zostało utworzone.</p>
<p>Co dostajesz w wersji free:</p>
<ul>
  <li>1 obszar wyszukiwania (miasto + dzielnice)</li>
  <li>Top 3 oferty / dobę</li>
  <li>Wskaźnik fair-price vs średnia rynkowa</li>
</ul>
<p>Plan <b>Standard (39 zł / mc)</b> usuwa limity, dokłada powiadomienia push i pełną listę
red-flag w każdej ofercie. Aktywacja: <a href="${env.LANDING_URL}/upgrade">${env.LANDING_URL}/upgrade</a></p>
<p>Powodzenia w poszukiwaniach,<br>zespół NieruchomościAI</p>`,
  };
}

/** Magic link do logowania (passwordless flow z aplikacji mobilnej / landingu). */
export function loginLinkEmail(loginUrl) {
  return {
    subject: 'Twój link logowania do NieruchomościAI',
    text: `Otwórz link by zalogować się: ${loginUrl}\nLink jest ważny 10 minut.`,
    html: `<p>Dzień dobry,</p>
<p>Kliknij poniższy link by zalogować się do NieruchomościAI:</p>
<p><a href="${loginUrl}">${loginUrl}</a></p>
<p>Link jest ważny <b>10 minut</b> i działa tylko raz.</p>
<p>Jeśli to nie Ty inicjowałeś logowanie — zignoruj tę wiadomość.</p>
<p>Zespół NieruchomościAI</p>`,
  };
}

/** Subskrypcja aktywna — copy per plan. */
export function subscriptionActiveEmail(user, plan) {
  const planLabel = plan === 'investor' ? 'Investor (149 zł / mc)' : 'Standard (39 zł / mc)';
  const featuresList = plan === 'investor'
    ? `<li>Nielimitowane wyniki AI</li>
       <li>Powiadomienia push o nowych ofertach</li>
       <li>Kalkulator ROI / yield / payback</li>
       <li>Estymacja czynszu na bazie stawek dzielnic</li>
       <li>Eksport CSV do Excela</li>`
    : `<li>Nielimitowane wyniki AI</li>
       <li>Powiadomienia push o nowych ofertach</li>
       <li>Pełna lista red-flag w każdej ofercie</li>
       <li>Mapa wyników z markerami</li>`;
  return {
    subject: `Subskrypcja NieruchomościAI ${planLabel} jest aktywna`,
    text: `Subskrypcja ${planLabel} dla ${user.email} jest aktywna.`,
    html: `<p>Dzień dobry,</p>
<p>Subskrypcja <b>NieruchomościAI ${planLabel}</b> jest aktywna.</p>
<p>Masz teraz:</p>
<ul>${featuresList}</ul>
<p>Faktura VAT zostanie wystawiona automatycznie.</p>
<p>Zespół NieruchomościAI</p>`,
  };
}
