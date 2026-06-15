import { roiDefaults } from '../config/env.js';
import { getRentRate } from '../config/rent-rates.js';
import { investorAnalysis } from '../db/repos.js';
import { logger } from '../lib/logger.js';

/**
 * ROI Calculator — Investor tier feature (149 PLN/mc).
 *
 * Polityka DEC-005: heurystyka, NIE AI. User'owi pokazujemy wartości policzone
 * deterministycznie z transparentnymi założeniami (rent rate ze słownika +
 * standardowa formuła rat kredytowych).
 *
 * Inputy:
 *   - listing: { price_pln, area_m2, city, district } (z tabeli listings)
 *   - assumptions: nadpisanie defaultów (vacancy_pct, mgmt_cost_pct, ...)
 *
 * Outputs (zwracane przez computeROI):
 *   - estimated_rent     [PLN/mc]   — area_m2 × stawka_dzielnicy
 *   - yield_gross_pct    [%]        — (rent×12) / price × 100
 *   - yield_net_pct      [%]        — (rent×12 × (1-vacancy-mgmt)) / price × 100
 *   - payback_years      [lata]     — price / (rent×12)
 *   - cashflow_monthly   [PLN/mc]   — rent_net − rata_kredytu
 *   - rent_source        [string]   — opis źródła stawki (do UI/audytu)
 *   - assumptions        [object]   — efektywne założenia
 */

/**
 * Miesięczna rata kredytu hipotecznego (annuity formula, PMT).
 *
 * @param {number} loanAmount      — kwota kredytu po wkładzie własnym [PLN]
 * @param {number} annualRatePct   — oprocentowanie roczne nominalne [%]
 * @param {number} years           — okres kredytowania [lata]
 * @returns {number} — miesięczna rata [PLN], lub 0 gdy loanAmount <= 0
 */
export function mortgageMonthly(loanAmount, annualRatePct, years) {
  if (loanAmount <= 0) return 0;
  if (years <= 0) return loanAmount;
  const n = years * 12;
  const r = (annualRatePct / 100) / 12;
  if (r === 0) return loanAmount / n;
  // PMT = P × r × (1+r)^n / ((1+r)^n − 1)
  const pow = Math.pow(1 + r, n);
  return loanAmount * r * pow / (pow - 1);
}

/**
 * Estymowany miesięczny czynsz najmu [PLN] dla mieszkania.
 * Bazuje na heurystyce ze słownika `rent-rates.js`.
 *
 * @returns {{ estimatedRent: number, ratePerM2: number, source: string }}
 */
export function estimateRent(listing) {
  const area = Number(listing?.area_m2);
  if (!Number.isFinite(area) || area <= 0) {
    return { estimatedRent: 0, ratePerM2: 0, source: 'heuristic_v1:no_area' };
  }
  const { rate, source } = getRentRate(listing.city, listing.district);
  return {
    estimatedRent: Math.round(rate * area),
    ratePerM2: rate,
    source,
  };
}

/**
 * Wylicza pełen pakiet ROI dla danego ogłoszenia.
 *
 * @param {Object} listing       — wiersz z tabeli listings (musi mieć price_pln + area_m2)
 * @param {Object} [overrides]   — nadpisanie pól {vacancyPct, mgmtCostPct, mortgageRatePct, downPaymentPct, mortgageYears, customRent}
 * @returns {null | {
 *   estimated_rent, yield_gross_pct, yield_net_pct, payback_years,
 *   cashflow_monthly, rent_source, assumptions
 * }}
 *   — null gdy listing nie ma wymaganych danych (price_pln / area_m2)
 */
export function computeROI(listing, overrides = {}) {
  const price = Number(listing?.price_pln);
  const area = Number(listing?.area_m2);
  if (!Number.isFinite(price) || price <= 0) return null;
  if (!Number.isFinite(area) || area <= 0) return null;

  const assumptions = {
    vacancyPct: overrides.vacancyPct ?? roiDefaults.vacancyPct,
    mgmtCostPct: overrides.mgmtCostPct ?? roiDefaults.mgmtCostPct,
    mortgageRatePct: overrides.mortgageRatePct ?? roiDefaults.mortgageRatePct,
    downPaymentPct: overrides.downPaymentPct ?? roiDefaults.downPaymentPct,
    mortgageYears: overrides.mortgageYears ?? roiDefaults.mortgageYears,
  };

  let estimatedRent;
  let rentSource;
  if (Number.isFinite(overrides.customRent) && overrides.customRent > 0) {
    estimatedRent = Math.round(overrides.customRent);
    rentSource = 'user_override';
  } else {
    const est = estimateRent(listing);
    estimatedRent = est.estimatedRent;
    rentSource = est.source;
  }

  const yearlyRent = estimatedRent * 12;
  const netFactor = 1 - (assumptions.vacancyPct / 100) - (assumptions.mgmtCostPct / 100);

  const yieldGrossPct = (yearlyRent / price) * 100;
  const yieldNetPct = (yearlyRent * netFactor / price) * 100;
  const paybackYears = yearlyRent > 0 ? price / yearlyRent : Infinity;

  const loanAmount = price * (1 - assumptions.downPaymentPct / 100);
  const monthlyMortgage = mortgageMonthly(
    loanAmount,
    assumptions.mortgageRatePct,
    assumptions.mortgageYears,
  );
  const cashflowMonthly = (estimatedRent * netFactor) - monthlyMortgage;

  return {
    estimated_rent: estimatedRent,
    yield_gross_pct: yieldGrossPct,
    yield_net_pct: yieldNetPct,
    payback_years: paybackYears,
    cashflow_monthly: cashflowMonthly,
    rent_source: rentSource,
    assumptions,
  };
}

/**
 * Liczy ROI dla listingu i (gdy używaliśmy domyślnych założeń) cache'uje w `investor_analysis`.
 * Tania operacja — nawet bez cache nie kosztuje AI calls, ale cache pozwala servować Investor
 * dashboardy bez przeliczania per request.
 *
 * @param {Object} listing       — wiersz z tabeli listings
 * @param {Object} [overrides]   — nadpisanie defaultów (jeśli puste, wynik trafi do cache)
 * @returns {null | ReturnType<typeof computeROI>}
 */
export function computeAndCacheROI(listing, overrides = {}) {
  const result = computeROI(listing, overrides);
  if (!result) return null;
  const usesDefaults = Object.keys(overrides).length === 0;

  if (usesDefaults && listing?.id) {
    try {
      investorAnalysis.upsert(listing.id, {
        estimatedRent: result.estimated_rent,
        yieldGrossPct: result.yield_gross_pct,
        yieldNetPct: result.yield_net_pct,
        paybackYears: result.payback_years,
        cashflowMonthly: result.cashflow_monthly,
        rentSource: result.rent_source,
        assumptions: result.assumptions,
      });
    } catch (err) {
      logger.error({ err: err.message, listing_id: listing.id }, 'ROI upsert do investor_analysis failed');
    }
  }
  return result;
}

/**
 * Pobiera ROI z cache (jeśli wpis istnieje) albo liczy + cache'uje (gdy go nie ma).
 * Używać w hot-path (paywall'd Investor endpointach) gdy chcemy ograniczyć powtarzanie compute.
 */
export function getOrComputeROI(listing, overrides = {}) {
  const usesDefaults = Object.keys(overrides).length === 0;
  if (usesDefaults && listing?.id) {
    const cached = investorAnalysis.get(listing.id);
    if (cached) {
      return {
        estimated_rent: cached.estimated_rent,
        yield_gross_pct: cached.yield_gross_pct,
        yield_net_pct: cached.yield_net_pct,
        payback_years: cached.payback_years,
        cashflow_monthly: cached.cashflow_monthly,
        rent_source: cached.rent_source,
        assumptions: typeof cached.assumptions === 'string'
          ? JSON.parse(cached.assumptions) : cached.assumptions,
        cached: true,
      };
    }
  }
  return computeAndCacheROI(listing, overrides);
}
