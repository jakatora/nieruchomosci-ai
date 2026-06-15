import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../lib/asyncHandler.js';
import { authRequired } from '../middleware/auth.js';
import { badRequest, notFound } from '../lib/errors.js';
import { listings as listingsRepo } from '../db/repos.js';
import { publicListing, publicInvestorAnalysis } from '../lib/serialize.js';
import { computePriceFairness } from '../services/pricing-comparables.js';
import { getOrComputeROI } from '../services/roi.js';
import { audit } from '../lib/audit.js';

const router = Router();

/**
 * Paywall — limity wielkości list-page dla różnych planów:
 *   free      — max 3 per request (z START doc: "top 3 ogłoszenia/dzień")
 *   standard  — max 100 (nielimitowane real-world; 100 chroni przed nadużyciem)
 *   investor  — max 100
 *
 * Detail view (`/:id`):
 *   free      — listing + comparables
 *   standard  — + AI red flags (jeśli pre-computed w match), + mapa, + fair-price badge
 *   investor  — + ROI panel (yield, payback, cashflow)
 */
function listLimitForTier(tier) {
  return tier === 'free' ? 3 : 100;
}

// ====================================================================
// GET /listings — paginated list z filtrami
// ====================================================================

const listQuerySchema = z.object({
  city: z.string().min(1).max(60).optional(),
  district: z.string().min(1).max(60).optional(),
  min_price: z.coerce.number().nonnegative().optional(),
  max_price: z.coerce.number().nonnegative().optional(),
  min_area: z.coerce.number().nonnegative().optional(),
  max_area: z.coerce.number().nonnegative().optional(),
  source: z.string().min(1).max(30).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
  order_by: z.enum(['recent', 'price_asc', 'price_desc', 'ppm2_asc']).optional(),
});

router.get('/', authRequired, ah(async (req, res) => {
  const q = listQuerySchema.safeParse(req.query);
  if (!q.success) {
    throw badRequest('Nieprawidłowe parametry zapytania', q.error.issues.map((i) => ({
      field: i.path.join('.'),
      message: i.message,
    })));
  }
  const filters = q.data;
  const limit = Math.min(filters.limit ?? 30, listLimitForTier(req.user.premium_tier));

  const result = listingsRepo.search({
    city: filters.city,
    district: filters.district,
    minPrice: filters.min_price,
    maxPrice: filters.max_price,
    minArea: filters.min_area,
    maxArea: filters.max_area,
    source: filters.source,
    limit,
    offset: filters.offset,
    orderBy: filters.order_by,
  });

  const items = result.rows.map((l) => {
    const base = publicListing(l);
    // Dodajemy fairness inline — to tania operacja (median z DB).
    const fairness = computePriceFairness(l);
    base.price_fairness = fairness.fairnessLabel;
    base.fairness_delta_pct = fairness.deltaPct;
    return base;
  });

  audit({ userId: req.user.id, action: 'list_listings',
    detail: { filters, count: items.length }, ip: req.ip });

  res.json({
    listings: items,
    pagination: {
      total: result.total,
      limit: result.limit,
      offset: result.offset,
      has_more: result.offset + result.rows.length < result.total,
    },
    tier_limit: listLimitForTier(req.user.premium_tier),
    paywall_truncated: req.user.premium_tier === 'free'
      && result.total > listLimitForTier(req.user.premium_tier),
  });
}));

// ====================================================================
// GET /listings/:id — detail (listing + comparables + opt. ROI)
// ====================================================================

router.get('/:id', authRequired, ah(async (req, res) => {
  const id = req.params.id;
  const listing = listingsRepo.findById(id);
  if (!listing) throw notFound('Ogłoszenie nie istnieje');

  const fairness = computePriceFairness(listing);

  // Investor tier: dorzucamy ROI.
  let investorBlock = null;
  if (req.user.premium_tier === 'investor') {
    const roi = getOrComputeROI(listing);
    // publicInvestorAnalysis oczekuje rekordu z DB; obudowujemy result do tego kształtu.
    if (roi) {
      investorBlock = publicInvestorAnalysis({
        listing_id: listing.id,
        estimated_rent: roi.estimated_rent,
        yield_gross_pct: roi.yield_gross_pct,
        yield_net_pct: roi.yield_net_pct,
        payback_years: roi.payback_years,
        cashflow_monthly: roi.cashflow_monthly,
        rent_source: roi.rent_source,
        assumptions: roi.assumptions,
        computed_at: roi.cached ? null : new Date().toISOString(),
      });
    }
  }

  audit({ userId: req.user.id, action: 'view_listing',
    detail: { listing_id: id }, ip: req.ip });

  res.json({
    listing: publicListing(listing),
    comparables: {
      median_price_per_m2: fairness.medianPricePerM2,
      sample_size: fairness.sampleSize,
      fairness_label: fairness.fairnessLabel,
      delta_pct: fairness.deltaPct,
      source: fairness.source,
    },
    investor_analysis: investorBlock, // null dla free/standard
    paywall_locked: [
      ...(req.user.premium_tier !== 'investor' ? ['investor_analysis'] : []),
    ],
  });
}));

export default router;
