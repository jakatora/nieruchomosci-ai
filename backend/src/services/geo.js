import { env, features } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { db } from '../db/index.js';
import { geocodingCache } from '../db/repos.js';

/**
 * Geocoding service — Google Maps Geocoding API z agresywnym cache w DB.
 *
 * Strategia kosztowa:
 *   - Cache hit pierwszy → 0 PLN, 0 quota
 *   - Cache TTL = `GEOCODING_CACHE_TTL_DAYS` (default 30 dni)
 *   - Bez `GOOGLE_MAPS_API_KEY_SERVER` → fallback mode (zwraca null, używamy categories)
 *
 * Hint dla BLK-01 P2: server-side key MUSI mieć inną restrykcję niż mobile
 * Android key (ten ma package-name restriction, nie nadaje się do server-side).
 */

const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

export function isGeoEnabled() {
  // Sprawdzamy zarówno `GOOGLE_MAPS_API_KEY_SERVER` jak i fallback `GOOGLE_MAPS_API_KEY`.
  return Boolean(env.GOOGLE_MAPS_API_KEY);
}

/**
 * Geokoduje adres (PL focus). Zwraca `{lat, lng, city, district}` albo null gdy brak.
 *
 * Cache w `geocoding_cache` table (sha256 normalized address jako klucz).
 */
export async function geocode(address) {
  if (!address || typeof address !== 'string') return null;
  const normalized = address.trim();

  // Cache lookup pierwsze.
  const cached = geocodingCache.findByQuery(normalized);
  if (cached) {
    const ageDays = (Date.now() - new Date(cached.cached_at).getTime()) / 86400_000;
    if (ageDays < env.GEOCODING_CACHE_TTL_DAYS) {
      return cached.lat && cached.lng ? {
        lat: cached.lat,
        lng: cached.lng,
        city: cached.city,
        district: cached.district,
        source: 'cache',
      } : null;
    }
  }

  // Fallback gdy brak klucza serwerowego.
  if (!isGeoEnabled()) {
    logger.debug({ address: normalized },
      'geocode: brak GOOGLE_MAPS_API_KEY — fallback mode, zwracam null');
    geocodingCache.upsert(normalized, null); // negative cache 30 dni
    return null;
  }

  // API call.
  try {
    const url = `${GEOCODE_URL}?address=${encodeURIComponent(normalized)}&region=pl&language=pl&key=${env.GOOGLE_MAPS_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) {
      logger.error({ status: res.status, address: normalized }, 'Geocoding API HTTP error');
      return null;
    }
    const json = await res.json();
    if (json.status !== 'OK' || !json.results?.length) {
      logger.warn({ status: json.status, address: normalized }, 'Geocoding API no results');
      geocodingCache.upsert(normalized, null);
      return null;
    }
    const first = json.results[0];
    const loc = first.geometry?.location;
    const components = first.address_components || [];
    const cityComp = components.find((c) => c.types?.includes('locality')
      || c.types?.includes('administrative_area_level_2'));
    const districtComp = components.find((c) => c.types?.includes('sublocality')
      || c.types?.includes('sublocality_level_1')
      || c.types?.includes('neighborhood'));

    const result = {
      lat: loc?.lat ?? null,
      lng: loc?.lng ?? null,
      city: cityComp?.long_name ?? null,
      district: districtComp?.long_name ?? null,
      source: 'api',
    };
    geocodingCache.upsert(normalized, result);
    return result;
  } catch (err) {
    logger.error({ err: err.message, address: normalized }, 'Geocode call failed');
    return null;
  }
}

/** Haversine — odległość między 2 punktami GPS w kilometrach. */
export function haversineKm(p1, p2) {
  if (!p1 || !p2 || p1.lat == null || p1.lng == null || p2.lat == null || p2.lng == null) {
    return null;
  }
  const R = 6371; // promień Ziemi km
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(p2.lat - p1.lat);
  const dLng = toRad(p2.lng - p1.lng);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(p1.lat)) * Math.cos(toRad(p2.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Listings w danym promieniu od punktu (bounding box + dokładny Haversine filtr w app-code).
 *
 * @param {number} centerLat
 * @param {number} centerLng
 * @param {number} radiusKm
 * @returns {Array<Listing & {distance_km: number}>}
 */
export function listingsInRadius(centerLat, centerLng, radiusKm) {
  if (centerLat == null || centerLng == null) return [];

  // Pre-filter SQL bounding box (≈ 1° = 111km na PL latitude).
  const latRange = radiusKm / 111;
  const lngRange = radiusKm / (111 * Math.cos(centerLat * Math.PI / 180));

  const candidates = db.prepare(`
    SELECT * FROM listings
     WHERE lat BETWEEN ? AND ?
       AND lng BETWEEN ? AND ?
       AND status = 'active'
     LIMIT 500
  `).all(
    centerLat - latRange, centerLat + latRange,
    centerLng - lngRange, centerLng + lngRange,
  );

  // Dokładny Haversine + filtr.
  const center = { lat: centerLat, lng: centerLng };
  return candidates
    .map((l) => ({ ...l, distance_km: haversineKm(center, { lat: l.lat, lng: l.lng }) }))
    .filter((l) => l.distance_km != null && l.distance_km <= radiusKm)
    .sort((a, b) => a.distance_km - b.distance_km);
}
