import { Router } from 'express';
import { z } from 'zod';
import { ah } from '../lib/asyncHandler.js';
import { authRequired } from '../middleware/auth.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { searches as searchesRepo } from '../db/repos.js';
import { audit } from '../lib/audit.js';

const router = Router();

/**
 * Paywall: free tier może mieć **max 1 enabled search** w MVP (z START doc:
 * „1 search area, top 3 ogłoszenia/dzień"). Standard/Investor — unlimited.
 *
 * UX flow:
 *   Onboarding step 2 → POST /searches (pierwszy search = enabled).
 *   Dodanie drugiego jako free → 409 z message „upgrade to Standard for more".
 *   Disable starego (PATCH /:id {enabled:false}) → mogę dodać nowy enabled.
 */
const FREE_TIER_MAX_ENABLED = 1;

function canAddEnabledSearch(user) {
  if (user.premium_tier !== 'free') return true;
  const existing = searchesRepo.listEnabledByUser(user.id);
  return existing.length < FREE_TIER_MAX_ENABLED;
}

// ====================================================================
// GET /searches — lista all (enabled + disabled)
// ====================================================================

router.get('/', authRequired, ah(async (req, res) => {
  const items = searchesRepo.listByUser(req.user.id);
  res.json({
    searches: items.map(serializeSearch),
    paywall: {
      free_tier_max_enabled: FREE_TIER_MAX_ENABLED,
      can_add_enabled: canAddEnabledSearch(req.user),
    },
  });
}));

// ====================================================================
// POST /searches — utwórz
// ====================================================================

const createSchema = z.object({
  name: z.string().min(1).max(100),
  city: z.string().min(2).max(60),
  districts: z.array(z.string().min(1).max(60)).max(20).optional().default([]),
  center_lat: z.number().min(-90).max(90).optional(),
  center_lng: z.number().min(-180).max(180).optional(),
  radius_km: z.coerce.number().positive().max(50).optional().default(5),
  min_price: z.coerce.number().nonnegative().optional(),
  max_price: z.coerce.number().nonnegative().optional(),
  min_area: z.coerce.number().nonnegative().optional(),
  max_area: z.coerce.number().nonnegative().optional(),
  rooms: z.array(z.number().int().positive()).max(10).optional().default([]),
  enabled: z.boolean().optional().default(true),
});

router.post('/', authRequired, ah(async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    throw badRequest('Błąd walidacji', parsed.error.issues.map((i) => ({
      field: i.path.join('.'), message: i.message,
    })));
  }
  const data = parsed.data;
  if (data.min_price && data.max_price && data.min_price > data.max_price) {
    throw badRequest('min_price musi być ≤ max_price');
  }
  if (data.min_area && data.max_area && data.min_area > data.max_area) {
    throw badRequest('min_area musi być ≤ max_area');
  }

  // Paywall — gdy próbujesz dodać enabled search jako free i już masz limit:
  if (data.enabled && !canAddEnabledSearch(req.user)) {
    throw conflict(
      'Plan Free dopuszcza tylko 1 aktywny obszar wyszukiwania. Wyłącz istniejący albo aktywuj Standard.',
      { upgrade_to: 'standard' },
    );
  }

  const created = searchesRepo.create(req.user.id, {
    name: data.name,
    city: data.city,
    districts: data.districts,
    centerLat: data.center_lat,
    centerLng: data.center_lng,
    radiusKm: data.radius_km,
    minPrice: data.min_price,
    maxPrice: data.max_price,
    minArea: data.min_area,
    maxArea: data.max_area,
    rooms: data.rooms,
    enabled: data.enabled,
  });

  audit({ userId: req.user.id, action: 'create_search',
    detail: { search_id: created.id, name: created.name }, ip: req.ip });

  res.status(201).json({ search: serializeSearch(created) });
}));

// ====================================================================
// PATCH /searches/:id — edytuj
// ====================================================================

const patchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  city: z.string().min(2).max(60).optional(),
  districts: z.array(z.string().min(1).max(60)).max(20).optional(),
  center_lat: z.number().min(-90).max(90).nullable().optional(),
  center_lng: z.number().min(-180).max(180).nullable().optional(),
  radius_km: z.coerce.number().positive().max(50).optional(),
  min_price: z.coerce.number().nonnegative().nullable().optional(),
  max_price: z.coerce.number().nonnegative().nullable().optional(),
  min_area: z.coerce.number().nonnegative().nullable().optional(),
  max_area: z.coerce.number().nonnegative().nullable().optional(),
  rooms: z.array(z.number().int().positive()).max(10).optional(),
  enabled: z.boolean().optional(),
});

router.patch('/:id', authRequired, ah(async (req, res) => {
  const existing = searchesRepo.findById(req.params.id);
  if (!existing) throw notFound('Search nie istnieje');
  if (existing.user_id !== req.user.id) throw forbidden('To nie Twój search');

  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    throw badRequest('Błąd walidacji', parsed.error.issues.map((i) => ({
      field: i.path.join('.'), message: i.message,
    })));
  }
  const data = parsed.data;

  // Paywall: próba enable gdy obecnie disabled i przekroczy limit.
  if (data.enabled === true && !existing.enabled && !canAddEnabledSearch(req.user)) {
    throw conflict(
      'Plan Free dopuszcza tylko 1 aktywny obszar. Wyłącz inny albo upgradeuj.',
      { upgrade_to: 'standard' },
    );
  }

  const map = {
    name: 'name', city: 'city',
    districts: 'districts',
    radius_km: 'radiusKm',
    min_price: 'minPrice', max_price: 'maxPrice',
    min_area: 'minArea', max_area: 'maxArea',
    rooms: 'rooms', enabled: 'enabled',
    center_lat: 'centerLat', center_lng: 'centerLng',
  };
  const patch = {};
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined && map[k]) patch[map[k]] = v;
  }

  const updated = searchesRepo.update(req.params.id, patch);
  audit({ userId: req.user.id, action: 'update_search',
    detail: { search_id: updated.id, fields: Object.keys(patch) }, ip: req.ip });

  res.json({ search: serializeSearch(updated) });
}));

// ====================================================================
// DELETE /searches/:id
// ====================================================================

router.delete('/:id', authRequired, ah(async (req, res) => {
  const existing = searchesRepo.findById(req.params.id);
  if (!existing) throw notFound('Search nie istnieje');
  if (existing.user_id !== req.user.id) throw forbidden('To nie Twój search');

  searchesRepo.delete(req.params.id);
  audit({ userId: req.user.id, action: 'delete_search',
    detail: { search_id: req.params.id }, ip: req.ip });

  res.json({ ok: true, deleted_id: req.params.id });
}));

// ---------------- helpers ----------------

function serializeSearch(s) {
  if (!s) return null;
  const parseList = (v) => {
    if (!v) return [];
    if (Array.isArray(v)) return v;
    try { return JSON.parse(v); } catch { return []; }
  };
  return {
    id: s.id,
    name: s.name,
    city: s.city,
    districts: parseList(s.districts),
    center_lat: s.center_lat,
    center_lng: s.center_lng,
    radius_km: s.radius_km,
    min_price: s.min_price,
    max_price: s.max_price,
    min_area: s.min_area,
    max_area: s.max_area,
    rooms: parseList(s.rooms),
    enabled: Boolean(s.enabled),
    created_at: s.created_at,
    updated_at: s.updated_at,
  };
}

export default router;
