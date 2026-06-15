/** Reprezentacje zasobów bezpieczne do zwrotu w API (bez danych wrażliwych). */

/** Użytkownik bez hasła i identyfikatorów Stripe. */
export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    user_type: user.user_type,
    premium_tier: user.premium_tier,
    home_city: user.home_city,
    search_radius_km: user.search_radius_km,
    notif_email: Boolean(user.notif_email),
    notif_push: Boolean(user.notif_push),
    created_at: user.created_at,
  };
}

/** Pojedynczy listing — publiczna reprezentacja (bez raw_data). */
export function publicListing(listing) {
  if (!listing) return null;
  return {
    id: listing.id,
    source: listing.source,
    source_id: listing.source_id,
    url: listing.url,
    title: listing.title,
    description: listing.description,
    price_pln: listing.price_pln,
    area_m2: listing.area_m2,
    price_per_m2: listing.price_per_m2,
    rooms: listing.rooms,
    floor: listing.floor,
    building_year: listing.building_year,
    market: listing.market,
    property_type: listing.property_type,
    city: listing.city,
    district: listing.district,
    street: listing.street,
    lat: listing.lat,
    lng: listing.lng,
    photos: parseJsonArray(listing.photos),
    published_at: listing.published_at,
    status: listing.status,
  };
}

/** Dopasowanie wraz z danymi ogłoszenia (z JOIN-a w repos.matches). */
export function publicMatch(row) {
  if (!row) return null;
  return {
    id: row.id,
    confidence_score: row.confidence_score,
    reasoning: row.match_reasoning,
    price_fairness: row.price_fairness,
    fairness_delta_pct: row.fairness_delta_pct,
    red_flags: parseJsonArray(row.red_flags),
    scorer: row.scorer,
    user_seen: Boolean(row.user_seen),
    user_saved: Boolean(row.user_saved),
    created_at: row.created_at,
    listing: row.listing_id ? {
      id: row.listing_id,
      source: row.listing_source,
      url: row.listing_url,
      title: row.listing_title,
      price_pln: row.listing_price_pln,
      area_m2: row.listing_area_m2,
      price_per_m2: row.listing_price_per_m2,
      rooms: row.listing_rooms,
      city: row.listing_city,
      district: row.listing_district,
      lat: row.listing_lat,
      lng: row.listing_lng,
      photos: parseJsonArray(row.listing_photos),
      published_at: row.listing_published_at,
    } : null,
  };
}

/** Analiza inwestorska (Investor tier) — wraz z założeniami. */
export function publicInvestorAnalysis(row) {
  if (!row) return null;
  return {
    listing_id: row.listing_id,
    estimated_rent: row.estimated_rent,
    yield_gross_pct: round2(row.yield_gross_pct),
    yield_net_pct: round2(row.yield_net_pct),
    payback_years: round2(row.payback_years),
    cashflow_monthly: round2(row.cashflow_monthly),
    rent_source: row.rent_source,
    assumptions: safeJsonParse(row.assumptions, {}),
    computed_at: row.computed_at,
  };
}

function parseJsonArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try { return JSON.parse(value); } catch { return []; }
}

function safeJsonParse(value, fallback) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function round2(n) {
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 100) / 100 : n;
}
