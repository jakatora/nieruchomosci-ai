/**
 * Helpery do parsowania query string params w Express routes.
 *
 * DRY: wzorzec `Math.min(parseInt(req.query.limit, 10) || X, Y)` był powtórzony
 * 4× w routes (admin, listings, searches, investor). Bug w jednym miejscu = nie
 * wpłynie na inne. Tutaj = jeden test = wszystkie 4 miejsca poprawne.
 */

/**
 * Parsuje numeric query param z bezpiecznymi default + max bounds.
 *
 * @param {unknown} value   — req.query.limit (string albo undefined)
 * @param {number} defaultValue — wartość gdy brak / nieparsowalny
 * @param {number} max      — górne ograniczenie (anti-abuse)
 * @param {number} min      — dolne ograniczenie (default 1)
 * @returns {number} liczba w zakresie [min, max]
 */
export function parseLimit(value, { default: defaultValue = 50, max = 500, min = 1 } = {}) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return Math.max(min, Math.min(max, defaultValue));
  return Math.max(min, Math.min(max, n));
}

/** Parsuje offset (paginacja) — non-negative integer, default 0. */
export function parseOffset(value, { default: defaultValue = 0, max = 100_000 } = {}) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) return defaultValue;
  return Math.min(max, n);
}

/** Parsuje boolean query param ("1", "true", "yes" → true). */
export function parseBool(value, defaultValue = false) {
  if (value == null) return defaultValue;
  const s = String(value).toLowerCase().trim();
  if (['1', 'true', 'yes', 'y', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(s)) return false;
  return defaultValue;
}
