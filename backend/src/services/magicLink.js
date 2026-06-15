import { env } from '../config/env.js';
import { magicLinks } from '../db/repos.js';
import { newToken } from '../lib/ids.js';

/**
 * Magic linki obsługują **trzy** różne flows:
 *
 *   - `login`            — passwordless login (email → kliknij link → JWT)
 *   - `upgrade-standard` — checkout planu Standard (39 zł)
 *   - `upgrade-investor` — checkout planu Investor (149 zł)
 *
 * Każdy link jest jednorazowy i krótkotrwały (MAGIC_LINK_TTL_MINUTES).
 * Aplikacja mobilna otwiera URL w external browser — strategia iOS bez IAP.
 */

const PURPOSES = new Set(['login', 'upgrade-standard', 'upgrade-investor']);

/** Mapa plan → purpose w bazie. */
function purposeForPlan(plan) {
  if (plan === 'standard') return 'upgrade-standard';
  if (plan === 'investor') return 'upgrade-investor';
  throw new Error(`Nieznany plan: ${plan}`);
}

/** Tworzy magic link do checkoutu subskrypcji. */
export function createUpgradeLink(userId, plan) {
  const token = newToken(24);
  magicLinks.create(userId, purposeForPlan(plan), env.MAGIC_LINK_TTL_MINUTES, token);
  return {
    token,
    plan,
    url: `${env.LANDING_URL}/upgrade?user_id=${encodeURIComponent(userId)}&token=${token}&plan=${plan}`,
  };
}

/** Tworzy magic link do logowania (passwordless). */
export function createLoginLink(userId) {
  const token = newToken(24);
  magicLinks.create(userId, 'login', env.MAGIC_LINK_TTL_MINUTES, token);
  return {
    token,
    url: `${env.LANDING_URL}/login/magic?user_id=${encodeURIComponent(userId)}&token=${token}`,
  };
}

/**
 * Weryfikuje i konsumuje magic link „upgrade".
 *
 * @param {string} userId  Spodziewany user_id z parametrów URL
 * @param {string} token   Token z URL
 * @returns {string|null}  Plan ('standard' | 'investor') gdy ważny, w przeciwnym razie null.
 */
export function consumeUpgradeLink(userId, token) {
  if (!userId || !token) return null;
  const row = magicLinks.consume(token);
  if (!row) return null;
  if (row.user_id !== userId) return null;
  if (row.purpose === 'upgrade-standard') return 'standard';
  if (row.purpose === 'upgrade-investor') return 'investor';
  return null;
}

/**
 * Weryfikuje i konsumuje magic link „login".
 * @returns {string|null} userId gdy ważny, w przeciwnym razie null.
 */
export function consumeLoginLink(token) {
  if (!token) return null;
  const row = magicLinks.consume(token);
  if (!row) return null;
  if (row.purpose !== 'login') return null;
  return row.user_id;
}

/** Eksport dla testów / debug. */
export { PURPOSES };
