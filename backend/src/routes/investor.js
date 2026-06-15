import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../lib/asyncHandler.js';
import { authRequired } from '../middleware/auth.js';
import { badRequest, forbidden } from '../lib/errors.js';
import { listings as listingsRepo } from '../db/repos.js';
import { publicListing, publicInvestorAnalysis } from '../lib/serialize.js';
import { getOrComputeROI } from '../services/roi.js';
import { computePriceFairness } from '../services/pricing-comparables.js';
import { median } from '../services/pricing-comparables.js';
import { audit } from '../lib/audit.js';

const router = Router();

/**
 * Investor dashboard endpoint — top ROI ranking + summary stats.
 *
 * Paywall: **wymaga `premium_tier === 'investor'`**. Inni dostają 403 z message
 * o upgrade'u. To jest "core feature" planu Investor — uzasadnienie 149 PLN/mc.
 *
 * Strategia compute:
 *   - Query do listingu (max 200 do sortowania) z filtrami.
 *   - Dla każdego: `getOrComputeROI` (cache w `investor_analysis` jeśli używamy defaultów).
 *   - Sort w app-code (małe próbki w MVP; SQL join optimalizacja na v2).
 *   - Top N + summary stats z całej puli (po filtrze).
 *
 * Future:
 *   - `POST /investor/analysis/recompute/:listing_id` z custom assumptions
 *     (override mortgage rate / down payment) → ad-hoc compute, NIE cache.
 *   - CSV export (eksport do Excela — Investor MVP feature z START doc).
 */

// ====================================================================
// Middleware: wymaga premium_tier === 'investor'
// ====================================================================

function investorRequired(req, res, next) {
  if (req.user?.premium_tier !== 'investor') {
    return next(forbidden(
      'Ta funkcja jest dostępna w planie Investor (149 PLN/mc). Aktywuj na ' +
      'nieruchomosciai → Plany.',
    ));
  }
  next();
}

// ====================================================================
// GET /investor/analysis — dashboard ranking
// ====================================================================

const dashSchema = z.object({
  city: z.string().min(2).max(60).optional(),
  district: z.string().min(2).max(60).optional(),
  sort_by: z.enum(['yield_net', 'yield_gross', 'payback', 'cashflow']).optional().default('yield_net'),
  limit: z.coerce.number().int().positive().max(50).optional().default(20),
  min_yield_net: z.coerce.number().nonnegative().optional(),
  min_price: z.coerce.number().nonnegative().optional(),
  max_price: z.coerce.number().nonnegative().optional(),
  min_area: z.coerce.number().nonnegative().optional(),
  max_area: z.coerce.number().nonnegative().optional(),
});

router.get('/analysis', authRequired, investorRequired, ah(async (req, res) => {
  const q = dashSchema.safeParse(req.query);
  if (!q.success) {
    throw badRequest('Nieprawidłowe parametry', q.error.issues.map((i) => ({
      field: i.path.join('.'), message: i.message,
    })));
  }
  const filters = q.data;

  // Default city = user's home_city (jeśli ustawiony).
  const cityFilter = filters.city ?? req.user.home_city ?? null;

  // Pre-fetch większej puli (200) by sortowanie po ROI w app-code dało sensowny top.
  const pool = listingsRepo.search({
    city: cityFilter,
    district: filters.district,
    minPrice: filters.min_price,
    maxPrice: filters.max_price,
    minArea: filters.min_area,
    maxArea: filters.max_area,
    limit: 200,
    offset: 0,
    orderBy: 'recent',
  });

  // Compute ROI + fairness per listing (cache-first).
  const enriched = [];
  for (const l of pool.rows) {
    const roi = getOrComputeROI(l);
    if (!roi) continue; // brak price/area
    if (filters.min_yield_net != null && roi.yield_net_pct < filters.min_yield_net) continue;
    const fairness = computePriceFairness(l);
    enriched.push({ listing: l, roi, fairness });
  }

  // Sort wg wybranego kryterium (DESC dla yield, ASC dla payback — niższy lepszy).
  const sorters = {
    yield_net:   (a, b) => b.roi.yield_net_pct  - a.roi.yield_net_pct,
    yield_gross: (a, b) => b.roi.yield_gross_pct - a.roi.yield_gross_pct,
    payback:     (a, b) => a.roi.payback_years  - b.roi.payback_years,
    cashflow:    (a, b) => b.roi.cashflow_monthly - a.roi.cashflow_monthly,
  };
  enriched.sort(sorters[filters.sort_by]);
  const top = enriched.slice(0, filters.limit);

  // Summary stats z PEŁNEJ przefiltrowanej puli (nie tylko top).
  const allYieldsNet = enriched.map((e) => e.roi.yield_net_pct);
  const allYieldsGross = enriched.map((e) => e.roi.yield_gross_pct);
  const allPaybacks = enriched.map((e) => e.roi.payback_years).filter(Number.isFinite);
  const allCashflows = enriched.map((e) => e.roi.cashflow_monthly);

  const summary = enriched.length === 0 ? {
    total_analyzed: 0,
    note: 'Brak ogłoszeń pasujących do filtrów',
  } : {
    total_analyzed: enriched.length,
    pool_size: pool.total,
    median_yield_net_pct: round2(median(allYieldsNet)),
    median_yield_gross_pct: round2(median(allYieldsGross)),
    best_yield_net_pct: round2(Math.max(...allYieldsNet)),
    worst_yield_net_pct: round2(Math.min(...allYieldsNet)),
    median_payback_years: allPaybacks.length ? round2(median(allPaybacks)) : null,
    median_cashflow_monthly: round2(median(allCashflows)),
    positive_cashflow_count: allCashflows.filter((c) => c > 0).length,
  };

  audit({ userId: req.user.id, action: 'view_investor_dashboard',
    detail: { filters, returned: top.length, pool_size: pool.total }, ip: req.ip });

  res.json({
    summary,
    rankings: top.map((e) => ({
      listing: publicListing(e.listing),
      investor_analysis: publicInvestorAnalysis({
        listing_id: e.listing.id,
        estimated_rent: e.roi.estimated_rent,
        yield_gross_pct: e.roi.yield_gross_pct,
        yield_net_pct: e.roi.yield_net_pct,
        payback_years: e.roi.payback_years,
        cashflow_monthly: e.roi.cashflow_monthly,
        rent_source: e.roi.rent_source,
        assumptions: e.roi.assumptions,
        computed_at: e.roi.cached ? null : new Date().toISOString(),
      }),
      fairness: {
        label: e.fairness.fairnessLabel,
        delta_pct: e.fairness.deltaPct,
        median_price_per_m2: e.fairness.medianPricePerM2,
        sample_size: e.fairness.sampleSize,
      },
    })),
    filters_applied: {
      city: cityFilter,
      district: filters.district,
      sort_by: filters.sort_by,
      min_yield_net: filters.min_yield_net ?? null,
      min_price: filters.min_price ?? null,
      max_price: filters.max_price ?? null,
      min_area: filters.min_area ?? null,
      max_area: filters.max_area ?? null,
    },
  });
}));

// ====================================================================
// GET /investor/analysis/csv — eksport CSV (Investor feature z START doc)
// ====================================================================

router.get('/analysis/csv', authRequired, investorRequired, ah(async (req, res) => {
  const q = dashSchema.safeParse(req.query);
  if (!q.success) throw badRequest('Nieprawidłowe parametry');
  const filters = q.data;
  const cityFilter = filters.city ?? req.user.home_city ?? null;

  const pool = listingsRepo.search({
    city: cityFilter,
    district: filters.district,
    minPrice: filters.min_price,
    maxPrice: filters.max_price,
    minArea: filters.min_area,
    maxArea: filters.max_area,
    limit: 500,
  });

  const rows = [];
  for (const l of pool.rows) {
    const roi = getOrComputeROI(l);
    if (!roi) continue;
    if (filters.min_yield_net != null && roi.yield_net_pct < filters.min_yield_net) continue;
    const fairness = computePriceFairness(l);
    rows.push([
      l.source_id,
      csvEscape(l.city),
      csvEscape(l.district),
      l.price_pln,
      l.area_m2,
      l.price_per_m2,
      fairness.fairnessLabel,
      fairness.deltaPct ?? '',
      roi.estimated_rent,
      roi.yield_gross_pct.toFixed(2),
      roi.yield_net_pct.toFixed(2),
      roi.payback_years.toFixed(2),
      Math.round(roi.cashflow_monthly),
      csvEscape(l.url),
    ]);
  }

  // BOM + headers po polsku, by Excel ładnie czytał.
  const header = [
    'ID', 'Miasto', 'Dzielnica', 'Cena PLN', 'Powierzchnia m2', 'Cena/m2',
    'Fair-price', 'Delta vs okolica %', 'Czynsz estymowany PLN/mc',
    'Yield gross %', 'Yield net %', 'Payback (lata)', 'Cashflow PLN/mc', 'URL',
  ];
  const csv = '﻿' + [header, ...rows].map((r) => r.join(';')).join('\n');

  audit({ userId: req.user.id, action: 'export_investor_csv',
    detail: { row_count: rows.length, city: cityFilter }, ip: req.ip });

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition',
    `attachment; filename="nieruchomosciai-analysis-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
}));

// ---------------- helpers ----------------

function round2(n) {
  if (!Number.isFinite(n)) return n;
  return Math.round(n * 100) / 100;
}

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v).replace(/"/g, '""');
  return /[;"\n]/.test(s) ? `"${s}"` : s;
}

export default router;
