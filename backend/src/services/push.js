import { logger } from '../lib/logger.js';

/**
 * Expo Push API wrapper — wysyłka push notifications do iOS i Android.
 *
 * Expo push działa **bez klucza API** dla podstawowego flow (nie wymaga konta).
 * Endpoint: https://exp.host/--/api/v2/push/send
 *
 * Format `push_token` z aplikacji: `ExponentPushToken[xxxxxx]` lub `ExpoPushToken[xxxxxx]`.
 * Token zapisany w `users.push_token` po wywołaniu `/auth/me/push-token` z mobile app.
 *
 * Strategia kosztowa:
 *   - Bezpłatne dla niskich wolumenów (do ~1000 notyfikacji/dzień)
 *   - 1 POST batch może zawierać do 100 messages — używamy chunking
 *   - W razie błędu per-message (invalid token, app uninstalled) loguje, ale NIE crashuje
 *
 * Dev mode (`PUSH_DRY_RUN=1` lub brak push tokenów):
 *   - Loguje co by wysłał, nie woła Expo
 */

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const MAX_BATCH_SIZE = 100;

/** Czy token wygląda jak validny Expo Push Token? */
export function isValidExpoToken(token) {
  if (!token || typeof token !== 'string') return false;
  return /^(?:ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/.test(token);
}

/**
 * Wysyła pojedynczą wiadomość push.
 *
 * @param {string} token   — Expo push token
 * @param {Object} payload — { title, body, data?, sound?, priority? }
 * @returns {Promise<{sent: boolean, error?: string, ticket?: object}>}
 */
export async function sendPush(token, payload) {
  if (!isValidExpoToken(token)) {
    logger.warn({ token: maskToken(token) }, 'sendPush: nieprawidłowy token, pomijam');
    return { sent: false, error: 'invalid_token' };
  }
  if (process.env.PUSH_DRY_RUN === '1') {
    logger.info({ to: maskToken(token), ...payload }, '[PUSH_DRY_RUN] push NIE wysłany');
    return { sent: false, dryRun: true };
  }

  const message = {
    to: token,
    title: payload.title?.slice(0, 65) ?? 'NieruchomościAI',
    body: payload.body?.slice(0, 240) ?? '',
    sound: payload.sound ?? 'default',
    priority: payload.priority ?? 'default',
    data: payload.data ?? {},
  };

  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
      },
      body: JSON.stringify(message),
    });
    if (!res.ok) {
      logger.error({ status: res.status, statusText: res.statusText, to: maskToken(token) },
        'Expo Push HTTP error');
      return { sent: false, error: `HTTP ${res.status}` };
    }
    const json = await res.json();
    const ticket = json?.data?.[0] ?? json?.data ?? json;
    if (ticket?.status === 'error') {
      logger.error({ ticket, to: maskToken(token) }, 'Expo Push ticket error');
      return { sent: false, error: ticket?.message || 'expo_error', ticket };
    }
    return { sent: true, ticket };
  } catch (err) {
    logger.error({ err: err.message, to: maskToken(token) }, 'Expo Push call failed');
    return { sent: false, error: err.message };
  }
}

/**
 * Batch send — wiele tokenów + per-token payload albo wspólny.
 *
 * @param {Array<{token, payload}>} messages
 * @returns {Promise<{sent: number, failed: number, errors: object[]}>}
 */
export async function sendPushBatch(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { sent: 0, failed: 0, errors: [] };
  }
  const chunks = chunk(messages, MAX_BATCH_SIZE);
  const errors = [];
  let sent = 0;
  let failed = 0;

  for (const ck of chunks) {
    // Dla prostoty serializujemy per-message — Expo wspiera array request,
    // ale wtedy obsługa per-message ticket'ów jest bardziej skomplikowana.
    const results = await Promise.all(ck.map((m) => sendPush(m.token, m.payload)));
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.sent) sent++;
      else { failed++; errors.push({ token: maskToken(ck[i].token), error: r.error }); }
    }
  }
  return { sent, failed, errors };
}

// ---------------- helpers ----------------

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function maskToken(token) {
  if (!token || typeof token !== 'string') return '(null)';
  if (token.length < 20) return token.slice(0, 10) + '…';
  return token.slice(0, 25) + '…' + token.slice(-6);
}

// ---------------- helpery do typowych powiadomień (Etap 10 daily cron) ----------------

/** Push przy nowym dopasowaniu — copy zależne od user_type. */
export function newMatchPushPayload(user, match, listing) {
  const isInvestor = user.user_type === 'investor';
  const fairness = match.price_fairness;
  const district = listing.district ? ` (${listing.district})` : '';
  let title;
  let body;

  if (isInvestor) {
    title = `🏢 Nowa inwestycja: ${listing.city}${district}`;
    const yieldStr = match.yield_net_pct ? ` | yield ${match.yield_net_pct.toFixed(1)}%` : '';
    body = `${listing.price_pln?.toLocaleString('pl-PL')} PLN, ${listing.area_m2}m²${yieldStr}` +
      (fairness === 'below' ? ' • OKAZJA' : '');
  } else {
    title = `🏠 Nowa oferta: ${listing.city}${district}`;
    body = `${listing.price_pln?.toLocaleString('pl-PL')} PLN, ${listing.area_m2}m²` +
      (fairness === 'below' ? ' • OKAZJA poniżej rynku' : fairness === 'above' ? ' • powyżej rynku' : '');
  }

  return {
    title,
    body,
    data: {
      type: 'new_match',
      match_id: match.id,
      listing_id: listing.id,
    },
  };
}
