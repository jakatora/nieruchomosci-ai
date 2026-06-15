import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sendEmail, welcomeEmail, loginLinkEmail, subscriptionActiveEmail,
} from '../../src/services/email.js';
import { features } from '../../src/config/env.js';

describe('services/email — sendEmail', () => {
  it('dry-run mode (EMAIL_DRY_RUN=1) → {sent: false, dryRun: true}', async () => {
    if (features.emailDryRun) {
      const r = await sendEmail({ to: 'test@x.pl', subject: 'Test', text: 'body' });
      assert.equal(r.sent, false);
      assert.equal(r.dryRun, true);
    }
  });

  it('graceful degradation gdy brak RESEND_API_KEY i nie dry-run', async () => {
    // W dev mamy EMAIL_DRY_RUN=1, więc test pokryje gdy DRY_RUN i degraded ścieżki.
    const r = await sendEmail({ to: 'test@x.pl', subject: 'Test', text: 'body' });
    assert.equal(r.sent, false); // nigdy nie wysyła w testach
    // dryRun lub degraded — oba akceptowalne
    assert.ok(r.dryRun || r.degraded, 'powinien być dryRun=true LUB degraded=true');
  });
});

describe('services/email — welcomeEmail (dual-segment)', () => {
  it('Consumer (default) — subject + html z planem Standard', () => {
    const user = { user_type: 'consumer', email: 'k@x.pl' };
    const e = welcomeEmail(user);
    assert.equal(e.subject, 'Witamy w NieruchomościAI');
    assert.match(e.html, /Standard \(39 zł \/ mc\)/);
    assert.match(e.text, /red-flagi/);
    assert.ok(!e.html.includes('Investor'), 'Consumer email NIE powinien mieć Investor copy');
  });

  it('Investor — subject + html z planem Investor', () => {
    const user = { user_type: 'investor', email: 'i@x.pl' };
    const e = welcomeEmail(user);
    assert.equal(e.subject, 'Witamy w NieruchomościAI — wersja dla inwestorów');
    assert.match(e.html, /Investor \(149 zł \/ mc\)/);
    assert.match(e.text, /yield, payback/);
    assert.ok(!e.html.includes('Standard (39'), 'Investor email NIE pokazuje Standard plan');
  });

  it('bez user_type → fallback consumer', () => {
    const e = welcomeEmail({ email: 'x@x.pl' });
    assert.equal(e.subject, 'Witamy w NieruchomościAI');
  });

  it('href do /upgrade jest w html (CTA → backend-served upgrade page)', () => {
    const e1 = welcomeEmail({ user_type: 'consumer' });
    const e2 = welcomeEmail({ user_type: 'investor' });
    assert.match(e1.html, /href=".*\/upgrade"/);
    assert.match(e2.html, /href=".*\/upgrade"/);
  });

  it('zawiera 3 features w bullet list (free tier preview)', () => {
    const e = welcomeEmail({ user_type: 'consumer' });
    const liCount = (e.html.match(/<li>/g) || []).length;
    assert.equal(liCount, 3);
  });

  it('text version (non-HTML) zawiera kluczowe słowa', () => {
    assert.match(welcomeEmail({ user_type: 'consumer' }).text, /Konto utworzone/);
    assert.match(welcomeEmail({ user_type: 'investor' }).text, /Konto inwestorskie/);
  });
});

describe('services/email — loginLinkEmail', () => {
  it('zawiera URL w html i text', () => {
    const url = 'https://nieruchomosciai.up.railway.app/login/magic?token=abc';
    const e = loginLinkEmail(url);
    assert.match(e.subject, /Twój link logowania/);
    assert.ok(e.html.includes(url));
    assert.ok(e.text.includes(url));
  });

  it('informuje że link jest ważny 10 minut + jednorazowy', () => {
    const e = loginLinkEmail('http://x');
    assert.match(e.html, /10 minut/);
    assert.match(e.html, /tylko raz/);
  });

  it('zawiera anti-phishing instruction (jeśli to nie Ty…)', () => {
    const e = loginLinkEmail('http://x');
    assert.match(e.html, /jeśli to nie Ty|zignoruj/i);
  });
});

describe('services/email — subscriptionActiveEmail', () => {
  it('plan=standard — subject + features Standard tier', () => {
    const e = subscriptionActiveEmail({ email: 'x@y.pl' }, 'standard');
    assert.match(e.subject, /Standard \(39 zł/);
    assert.match(e.html, /Mapa wyników z markerami/);
    assert.match(e.html, /Pełna lista red-flag/);
    assert.ok(!e.html.includes('ROI'), 'Standard email NIE ma ROI features');
  });

  it('plan=investor — subject + features Investor tier (z ROI + CSV)', () => {
    const e = subscriptionActiveEmail({ email: 'x@y.pl' }, 'investor');
    assert.match(e.subject, /Investor \(149 zł/);
    assert.match(e.html, /Kalkulator ROI/);
    assert.match(e.html, /Eksport CSV/);
    assert.match(e.html, /Estymacja czynszu/);
  });

  it('zawiera email usera w text (potwierdzenie tożsamości)', () => {
    const e = subscriptionActiveEmail({ email: 'inwestor@example.pl' }, 'standard');
    assert.match(e.text, /inwestor@example\.pl/);
  });

  it('informuje o automatycznej fakturze VAT (compliance PL)', () => {
    const e = subscriptionActiveEmail({ email: 'x@y.pl' }, 'standard');
    assert.match(e.html, /Faktura VAT|faktura/i);
  });
});

describe('services/email — kontrakty', () => {
  it('wszystkie template funkcje zwracają {subject, text, html}', () => {
    const w1 = welcomeEmail({ user_type: 'consumer' });
    const w2 = welcomeEmail({ user_type: 'investor' });
    const l = loginLinkEmail('http://x');
    const s = subscriptionActiveEmail({ email: 'x@y.pl' }, 'standard');
    for (const e of [w1, w2, l, s]) {
      assert.ok(e.subject, 'subject wymagane');
      assert.ok(e.text, 'text wymagane (fallback dla klientów email bez HTML)');
      assert.ok(e.html, 'html wymagane');
    }
  });

  it('subject jest krótki (<70 znaków — gmail mobile truncates)', () => {
    assert.ok(welcomeEmail({ user_type: 'consumer' }).subject.length < 70);
    assert.ok(welcomeEmail({ user_type: 'investor' }).subject.length < 70);
    assert.ok(loginLinkEmail('http://x').subject.length < 70);
    assert.ok(subscriptionActiveEmail({ email: 'x' }, 'investor').subject.length < 70);
  });
});
