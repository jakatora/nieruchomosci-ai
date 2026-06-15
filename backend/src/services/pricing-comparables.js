import { listings } from '../db/repos.js';

/**
 * Pricing comparables — fair-price assessment dla pojedynczego listingu.
 *
 * Strategia:
 *   1. Próba "exact district": comparables = mieszkania w tym samym (city, district),
 *      area ±25%, opublikowane w ostatnich 60 dniach. Jeśli sample ≥ MIN_SAMPLE_SIZE
 *      → zwracamy wynik z `source = "district"`.
 *   2. Fallback "city-only": ten sam city (any district), area ±25%, 60 dni. Jeśli
 *      sample ≥ MIN_SAMPLE_SIZE → `source = "city"`. UI powinno pokazać user'owi że
 *      to porównanie szersze (mniej dokładne — ale dane są).
 *   3. Brak danych: `fairnessLabel = "unknown"`, `source = "insufficient_data"`.
 *
 * Próg fairness (od mediany):
 *   < -5%   → "below"   (okazja — cena wyraźnie poniżej rynku w okolicy)
 *   -5..+10 → "fair"    (rynkowa cena)
 *   > +10%  → "above"   (drożej niż okolica)
 *
 * Te progi są asymetryczne celowo:
 *   - „okazja" musi być wyraźna (≥5% poniżej) — szum statystyczny dla małych próbek
 *   - „rynkowa" obejmuje większy zakres bo natural variance
 *   - „drożej" wymaga >10% — mniej false positives przy realnym 5-7% premium za lepszy stan
 *
 * Decyzje (do udokumentowania w decisions.md):
 *   - MIN_SAMPLE_SIZE=5: poniżej tej liczby mediana niewiarygodna (single outlier
 *     wpływa zbyt mocno). Można rozważyć 10 gdy mamy więcej danych.
 *   - Area tolerance ±25%: mieszkanie 50m² porównujemy z 37.5-62.5m² — ten sam
 *     segment popytowy.
 *   - Recent 60 dni: balans między „świeżymi danymi" a „dostatecznej próbki".
 */

export const MIN_SAMPLE_SIZE = 5;
export const AREA_TOLERANCE_PCT = 25;
export const RECENT_DAYS = 60;
export const FAIRNESS_BELOW_THRESHOLD = -5;   // poniżej mediany o ≥5%
export const FAIRNESS_ABOVE_THRESHOLD = 10;   // powyżej mediany o ≥10%

/** Mediana arytmetyczna dla tablicy liczb (sortowana kopia + środek). */
export function median(values) {
  if (!values || values.length === 0) return null;
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** Klasyfikuje etykietę fairness na bazie procentowego odchylenia od mediany. */
export function classifyFairness(deltaPct) {
  if (!Number.isFinite(deltaPct)) return 'unknown';
  if (deltaPct < FAIRNESS_BELOW_THRESHOLD) return 'below';
  if (deltaPct > FAIRNESS_ABOVE_THRESHOLD) return 'above';
  return 'fair';
}

/**
 * Pobiera comparables z DB i liczy fairness dla danego listingu.
 *
 * @param {Object} listing — wiersz z `listings` (musi mieć city, area_m2, price_per_m2)
 * @param {Object} [opts]
 * @param {number} [opts.minSample=MIN_SAMPLE_SIZE]
 * @param {number} [opts.areaTolerancePct=AREA_TOLERANCE_PCT]
 * @param {number} [opts.daysBack=RECENT_DAYS]
 * @returns {{
 *   medianPricePerM2: number | null,
 *   sampleSize: number,
 *   fairnessLabel: 'below'|'fair'|'above'|'unknown',
 *   deltaPct: number | null,
 *   source: 'district'|'city'|'insufficient_data',
 * }}
 */
export function computePriceFairness(listing, opts = {}) {
  const minSample = opts.minSample ?? MIN_SAMPLE_SIZE;
  const areaTolerancePct = opts.areaTolerancePct ?? AREA_TOLERANCE_PCT;
  const daysBack = opts.daysBack ?? RECENT_DAYS;

  // Bez ceny/powierzchni nie ma o czym mówić.
  if (!listing?.price_per_m2 || !listing?.area_m2 || !listing?.city) {
    return {
      medianPricePerM2: null,
      sampleSize: 0,
      fairnessLabel: 'unknown',
      deltaPct: null,
      source: 'insufficient_data',
    };
  }

  // Helper — liczy fairness na bazie listy comparables (źródło zaznaczone w `source`).
  const computeFrom = (comparables, source) => {
    const valid = comparables.filter((c) => Number.isFinite(c.price_per_m2));
    if (valid.length < minSample) return null;
    const med = median(valid.map((c) => c.price_per_m2));
    if (!med) return null;
    const deltaPct = ((listing.price_per_m2 - med) / med) * 100;
    return {
      medianPricePerM2: Math.round(med),
      sampleSize: valid.length,
      fairnessLabel: classifyFairness(deltaPct),
      deltaPct: Number(deltaPct.toFixed(2)),
      source,
    };
  };

  // 1. Exact district match (jeśli listing ma district).
  if (listing.district) {
    const exact = listings.findComparables(listing, {
      areaTolerancePct, daysBack, excludeId: true,
    });
    const districtResult = computeFrom(exact, 'district');
    if (districtResult) return districtResult;
  }

  // 2. Fallback: city-only (district pominięty).
  const cityWide = listings.findComparables(
    { ...listing, district: null },
    { areaTolerancePct, daysBack, excludeId: true },
  );
  const cityResult = computeFrom(cityWide, 'city');
  if (cityResult) return cityResult;

  // 3. Niewystarczająca próbka — uczciwe "unknown".
  return {
    medianPricePerM2: null,
    sampleSize: Math.max(
      listing.district
        ? listings.findComparables(listing, { areaTolerancePct, daysBack }).length
        : 0,
      cityWide.length,
    ),
    fairnessLabel: 'unknown',
    deltaPct: null,
    source: 'insufficient_data',
  };
}

/**
 * Batch wrapper — liczy fairness dla wielu listings naraz. Używane np. w cron job
 * (Etap 10) gdy chcemy odświeżyć fairness dla pełnej listy.
 *
 * Idempotentne (każde wywołanie liczy od nowa).
 *
 * @returns {Map<string, ReturnType<typeof computePriceFairness>>}
 */
export function computeBatch(listingsArr, opts) {
  const out = new Map();
  for (const l of listingsArr) {
    out.set(l.id, computePriceFairness(l, opts));
  }
  return out;
}
