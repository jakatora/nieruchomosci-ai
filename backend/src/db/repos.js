/**
 * Repository pattern — jedyne miejsce, które dotyka SQL bezpośrednio.
 * Wszystkie inne moduły wołają funkcje z tego pliku.
 *
 * Konwencja: stałe nazwy metod — `findById`, `findByX`, `create`, `update`,
 * `upsert`, `list*`, `delete`. Inputy w camelCase, kolumny DB w snake_case.
 */

import { db } from './index.js';
import { newId, nowIso, sha256, startOfTodayIso } from '../lib/ids.js';

// ====================================================================
// USERS
// ====================================================================
export const users = {
  findById(id) {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id) ?? null;
  },
  findByEmail(email) {
    return db.prepare('SELECT * FROM users WHERE email = ?').get(email) ?? null;
  },
  findByStripeCustomerId(stripeCustomerId) {
    return db.prepare('SELECT * FROM users WHERE stripe_customer_id = ?').get(stripeCustomerId) ?? null;
  },
  create({ email, passwordHash = null, userType = 'consumer', homeCity = null, searchRadiusKm = 5 }) {
    const id = newId();
    const ts = nowIso();
    db.prepare(
      `INSERT INTO users (id, email, password_hash, user_type, premium_tier,
                          home_city, search_radius_km, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'free', ?, ?, ?, ?)`,
    ).run(id, email, passwordHash, userType, homeCity, searchRadiusKm, ts, ts);
    return this.findById(id);
  },
  updatePremium(id, premiumTier, stripeCustomerId = null, stripeSubscriptionId = null) {
    db.prepare(
      `UPDATE users SET premium_tier = ?, stripe_customer_id = COALESCE(?, stripe_customer_id),
                        stripe_subscription_id = COALESCE(?, stripe_subscription_id),
                        updated_at = ?
       WHERE id = ?`,
    ).run(premiumTier, stripeCustomerId, stripeSubscriptionId, nowIso(), id);
    return this.findById(id);
  },
  updateUserType(id, userType) {
    db.prepare('UPDATE users SET user_type = ?, updated_at = ? WHERE id = ?')
      .run(userType, nowIso(), id);
    return this.findById(id);
  },
  updatePushToken(id, pushToken, pushPlatform) {
    db.prepare('UPDATE users SET push_token = ?, push_platform = ?, updated_at = ? WHERE id = ?')
      .run(pushToken, pushPlatform, nowIso(), id);
  },
  updateNotifPrefs(id, { notifEmail, notifPush }) {
    db.prepare(
      `UPDATE users SET notif_email = ?, notif_push = ?, updated_at = ? WHERE id = ?`,
    ).run(notifEmail ? 1 : 0, notifPush ? 1 : 0, nowIso(), id);
    return this.findById(id);
  },
  /** Aktualizuje wybrane pola profilu (user_type, home_city, search_radius_km). */
  updateProfile(id, patch) {
    const fields = [];
    const values = [];
    const map = {
      userType: 'user_type',
      homeCity: 'home_city',
      searchRadiusKm: 'search_radius_km',
    };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      if (!map[k]) continue;
      fields.push(`${map[k]} = ?`);
      values.push(v);
    }
    if (!fields.length) return this.findById(id);
    fields.push('updated_at = ?');
    values.push(nowIso(), id);
    db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.findById(id);
  },
  listAll(limit = 1000) {
    return db.prepare('SELECT * FROM users ORDER BY created_at DESC LIMIT ?').all(limit);
  },
  count() {
    return db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  },
};

// ====================================================================
// LISTINGS
// ====================================================================
export const listings = {
  findById(id) {
    return db.prepare('SELECT * FROM listings WHERE id = ?').get(id) ?? null;
  },
  findBySource(source, sourceId) {
    return db.prepare('SELECT * FROM listings WHERE source = ? AND source_id = ?')
      .get(source, sourceId) ?? null;
  },
  /** Idempotent upsert (po source + source_id). Zwraca id wstawionego / istniejącego rekordu. */
  upsert(listing) {
    const existing = this.findBySource(listing.source, listing.source_id);
    if (existing) {
      db.prepare(
        `UPDATE listings SET
          title = ?, description = ?, price_pln = ?, area_m2 = ?, price_per_m2 = ?,
          rooms = ?, floor = ?, building_year = ?, market = ?, property_type = ?,
          city = ?, district = ?, street = ?, lat = ?, lng = ?,
          photos = ?, raw_data = ?, published_at = ?, fetched_at = ?, status = ?
         WHERE id = ?`,
      ).run(
        listing.title, listing.description ?? null, listing.price_pln ?? null,
        listing.area_m2 ?? null, listing.price_per_m2 ?? null,
        listing.rooms ?? null, listing.floor ?? null, listing.building_year ?? null,
        listing.market ?? null, listing.property_type ?? null,
        listing.city, listing.district ?? null, listing.street ?? null,
        listing.lat ?? null, listing.lng ?? null,
        JSON.stringify(listing.photos ?? []),
        JSON.stringify(listing.raw_data ?? {}),
        listing.published_at ?? null, listing.fetched_at ?? nowIso(),
        listing.status ?? 'active',
        existing.id,
      );
      return existing.id;
    }
    const id = listing.id ?? newId();
    db.prepare(
      `INSERT INTO listings
        (id, source, source_id, url, title, description, price_pln, area_m2, price_per_m2,
         rooms, floor, building_year, market, property_type, city, district, street,
         lat, lng, photos, raw_data, published_at, fetched_at, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id, listing.source, listing.source_id, listing.url,
      listing.title, listing.description ?? null,
      listing.price_pln ?? null, listing.area_m2 ?? null, listing.price_per_m2 ?? null,
      listing.rooms ?? null, listing.floor ?? null, listing.building_year ?? null,
      listing.market ?? null, listing.property_type ?? null,
      listing.city, listing.district ?? null, listing.street ?? null,
      listing.lat ?? null, listing.lng ?? null,
      JSON.stringify(listing.photos ?? []),
      JSON.stringify(listing.raw_data ?? {}),
      listing.published_at ?? null, listing.fetched_at ?? nowIso(),
      listing.status ?? 'active',
    );
    return id;
  },
  updateGeo(id, { lat, lng, district }) {
    db.prepare('UPDATE listings SET lat = ?, lng = ?, district = COALESCE(?, district) WHERE id = ?')
      .run(lat, lng, district, id);
  },
  /** Comparable listings: ta sama (city, district), area_m2 w ±25%, opublikowane w ostatnich 60 dniach. */
  findComparables(listing, { areaTolerancePct = 25, daysBack = 60, excludeId = true } = {}) {
    if (!listing.city || !listing.area_m2) return [];
    const minArea = listing.area_m2 * (1 - areaTolerancePct / 100);
    const maxArea = listing.area_m2 * (1 + areaTolerancePct / 100);
    const since = new Date(Date.now() - daysBack * 86400_000).toISOString();
    const params = [listing.city, minArea, maxArea, since];
    let sql = `SELECT * FROM listings
                WHERE city = ?
                  AND area_m2 BETWEEN ? AND ?
                  AND (published_at IS NULL OR published_at >= ?)
                  AND price_per_m2 IS NOT NULL
                  AND status = 'active'`;
    if (listing.district) {
      sql += ' AND district = ?';
      params.push(listing.district);
    }
    if (excludeId && listing.id) {
      sql += ' AND id != ?';
      params.push(listing.id);
    }
    return db.prepare(sql).all(...params);
  },
  findRecent({ city = null, limit = 50 } = {}) {
    if (city) {
      return db.prepare(
        'SELECT * FROM listings WHERE city = ? AND status = \'active\' ORDER BY fetched_at DESC LIMIT ?',
      ).all(city, limit);
    }
    return db.prepare(
      'SELECT * FROM listings WHERE status = \'active\' ORDER BY fetched_at DESC LIMIT ?',
    ).all(limit);
  },
  /**
   * Elastyczne wyszukiwanie z filtrami (do GET /listings).
   * Zwraca tablicę listings + `total` z osobnego count query.
   */
  search(filters = {}) {
    const where = ['status = ?'];
    const params = ['active'];
    if (filters.city) { where.push('city = ?'); params.push(filters.city); }
    if (filters.district) { where.push('district = ?'); params.push(filters.district); }
    if (filters.minPrice != null) { where.push('price_pln >= ?'); params.push(filters.minPrice); }
    if (filters.maxPrice != null) { where.push('price_pln <= ?'); params.push(filters.maxPrice); }
    if (filters.minArea != null) { where.push('area_m2 >= ?'); params.push(filters.minArea); }
    if (filters.maxArea != null) { where.push('area_m2 <= ?'); params.push(filters.maxArea); }
    if (filters.source) { where.push('source = ?'); params.push(filters.source); }

    const limit = Math.max(1, Math.min(100, filters.limit ?? 30));
    const offset = Math.max(0, filters.offset ?? 0);
    const order = filters.orderBy === 'price_asc'  ? 'price_pln ASC'
                : filters.orderBy === 'price_desc' ? 'price_pln DESC'
                : filters.orderBy === 'ppm2_asc'   ? 'price_per_m2 ASC'
                : 'fetched_at DESC';

    const rows = db.prepare(
      `SELECT * FROM listings WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`,
    ).all(...params, limit, offset);
    const total = db.prepare(
      `SELECT COUNT(*) AS n FROM listings WHERE ${where.join(' AND ')}`,
    ).get(...params).n;
    return { rows, total, limit, offset };
  },
  countBySource(source) {
    return db.prepare('SELECT COUNT(*) AS n FROM listings WHERE source = ?').get(source).n;
  },
};

// ====================================================================
// SEARCHES
// ====================================================================
export const searches = {
  findById(id) {
    return db.prepare('SELECT * FROM searches WHERE id = ?').get(id) ?? null;
  },
  listByUser(userId) {
    return db.prepare('SELECT * FROM searches WHERE user_id = ? ORDER BY created_at DESC').all(userId);
  },
  listEnabledByUser(userId) {
    return db.prepare(
      'SELECT * FROM searches WHERE user_id = ? AND enabled = 1 ORDER BY created_at DESC',
    ).all(userId);
  },
  create(userId, input) {
    const id = newId();
    const ts = nowIso();
    db.prepare(
      `INSERT INTO searches
        (id, user_id, name, city, districts, center_lat, center_lng, radius_km,
         min_price, max_price, min_area, max_area, rooms, enabled, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id, userId, input.name, input.city,
      JSON.stringify(input.districts ?? []),
      input.centerLat ?? null, input.centerLng ?? null, input.radiusKm ?? 5,
      input.minPrice ?? null, input.maxPrice ?? null,
      input.minArea ?? null, input.maxArea ?? null,
      JSON.stringify(input.rooms ?? []),
      input.enabled !== false ? 1 : 0,
      ts, ts,
    );
    return this.findById(id);
  },
  update(id, patch) {
    const fields = [];
    const values = [];
    const map = {
      name: 'name', city: 'city', radiusKm: 'radius_km',
      minPrice: 'min_price', maxPrice: 'max_price',
      minArea: 'min_area', maxArea: 'max_area',
      centerLat: 'center_lat', centerLng: 'center_lng',
    };
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'districts' || k === 'rooms') {
        fields.push(`${k} = ?`); values.push(JSON.stringify(v ?? []));
      } else if (k === 'enabled') {
        fields.push('enabled = ?'); values.push(v ? 1 : 0);
      } else if (map[k]) {
        fields.push(`${map[k]} = ?`); values.push(v);
      }
    }
    if (!fields.length) return this.findById(id);
    fields.push('updated_at = ?'); values.push(nowIso());
    values.push(id);
    db.prepare(`UPDATE searches SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.findById(id);
  },
  delete(id) {
    db.prepare('DELETE FROM searches WHERE id = ?').run(id);
  },
};

// ====================================================================
// MATCHES
// ====================================================================
export const matches = {
  findByUserListing(userId, listingId) {
    return db.prepare('SELECT * FROM matches WHERE user_id = ? AND listing_id = ?')
      .get(userId, listingId) ?? null;
  },
  create(input) {
    const id = newId();
    db.prepare(
      `INSERT INTO matches
        (id, user_id, search_id, listing_id, confidence_score, match_reasoning,
         price_fairness, fairness_delta_pct, red_flags, scorer, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(user_id, listing_id) DO NOTHING`,
    ).run(
      id, input.userId, input.searchId ?? null, input.listingId,
      input.confidenceScore, input.matchReasoning ?? null,
      input.priceFairness ?? 'unknown', input.fairnessDeltaPct ?? null,
      JSON.stringify(input.redFlags ?? []),
      input.scorer ?? 'ai', nowIso(),
    );
    return this.findByUserListing(input.userId, input.listingId);
  },
  /** Lista match-y z JOINem do listings (do publicMatch w serialize). */
  listByUser(userId, { limit = 50, onlyUnseen = false } = {}) {
    const sql = `
      SELECT m.*,
             l.id          AS listing_id,
             l.source      AS listing_source,
             l.url         AS listing_url,
             l.title       AS listing_title,
             l.price_pln   AS listing_price_pln,
             l.area_m2     AS listing_area_m2,
             l.price_per_m2 AS listing_price_per_m2,
             l.rooms       AS listing_rooms,
             l.city        AS listing_city,
             l.district    AS listing_district,
             l.lat         AS listing_lat,
             l.lng         AS listing_lng,
             l.photos      AS listing_photos,
             l.published_at AS listing_published_at
        FROM matches m
        JOIN listings l ON l.id = m.listing_id
       WHERE m.user_id = ?
         ${onlyUnseen ? 'AND m.user_seen = 0' : ''}
       ORDER BY m.created_at DESC
       LIMIT ?`;
    return db.prepare(sql).all(userId, limit);
  },
  countTodayByUser(userId) {
    return db.prepare(
      'SELECT COUNT(*) AS n FROM matches WHERE user_id = ? AND created_at >= ?',
    ).get(userId, startOfTodayIso()).n;
  },
  markSeen(matchId) {
    db.prepare('UPDATE matches SET user_seen = 1 WHERE id = ?').run(matchId);
  },
  markSaved(matchId, saved = true) {
    db.prepare('UPDATE matches SET user_saved = ? WHERE id = ?').run(saved ? 1 : 0, matchId);
  },
  markNotified(matchIds) {
    if (!matchIds?.length) return;
    const placeholders = matchIds.map(() => '?').join(',');
    db.prepare(`UPDATE matches SET notified = 1 WHERE id IN (${placeholders})`).run(...matchIds);
  },
  listUnnotified(limit = 200) {
    return db.prepare('SELECT * FROM matches WHERE notified = 0 ORDER BY created_at ASC LIMIT ?').all(limit);
  },
};

// ====================================================================
// INVESTOR_ANALYSIS
// ====================================================================
export const investorAnalysis = {
  get(listingId) {
    return db.prepare('SELECT * FROM investor_analysis WHERE listing_id = ?')
      .get(listingId) ?? null;
  },
  upsert(listingId, data) {
    db.prepare(
      `INSERT INTO investor_analysis
        (listing_id, estimated_rent, yield_gross_pct, yield_net_pct,
         payback_years, cashflow_monthly, rent_source, assumptions, computed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(listing_id) DO UPDATE SET
         estimated_rent = excluded.estimated_rent,
         yield_gross_pct = excluded.yield_gross_pct,
         yield_net_pct = excluded.yield_net_pct,
         payback_years = excluded.payback_years,
         cashflow_monthly = excluded.cashflow_monthly,
         rent_source = excluded.rent_source,
         assumptions = excluded.assumptions,
         computed_at = excluded.computed_at`,
    ).run(
      listingId, data.estimatedRent, data.yieldGrossPct, data.yieldNetPct,
      data.paybackYears, data.cashflowMonthly,
      data.rentSource ?? 'heuristic_v1',
      JSON.stringify(data.assumptions ?? {}),
      nowIso(),
    );
    return this.get(listingId);
  },
};

// ====================================================================
// GEOCODING_CACHE
// ====================================================================
export const geocodingCache = {
  findByQuery(queryText) {
    const hash = sha256(queryText.toLowerCase().trim());
    return db.prepare('SELECT * FROM geocoding_cache WHERE query_hash = ?').get(hash) ?? null;
  },
  upsert(queryText, result) {
    const hash = sha256(queryText.toLowerCase().trim());
    db.prepare(
      `INSERT INTO geocoding_cache (query_hash, query_text, lat, lng, city, district, cached_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(query_hash) DO UPDATE SET
         lat = excluded.lat, lng = excluded.lng,
         city = excluded.city, district = excluded.district,
         cached_at = excluded.cached_at`,
    ).run(
      hash, queryText,
      result?.lat ?? null, result?.lng ?? null,
      result?.city ?? null, result?.district ?? null,
      nowIso(),
    );
  },
  pruneOlderThan(daysAgo) {
    const cutoff = new Date(Date.now() - daysAgo * 86400_000).toISOString();
    return db.prepare('DELETE FROM geocoding_cache WHERE cached_at < ?').run(cutoff).changes;
  },
};

// ====================================================================
// MAGIC_LINKS
// ====================================================================
export const magicLinks = {
  create(userId, purpose, ttlMinutes, tokenValue) {
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
    db.prepare(
      `INSERT INTO magic_links (token, user_id, purpose, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(tokenValue, userId, purpose, expiresAt, nowIso());
    return { token: tokenValue, expiresAt };
  },
  consume(token) {
    const row = db.prepare('SELECT * FROM magic_links WHERE token = ?').get(token);
    if (!row) return null;
    if (row.used_at) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) return null;
    db.prepare('UPDATE magic_links SET used_at = ? WHERE token = ?').run(nowIso(), token);
    return row;
  },
};

// ====================================================================
// PROCESSED_WEBHOOKS
// ====================================================================
export const processedWebhooks = {
  exists(eventId) {
    return Boolean(db.prepare('SELECT 1 FROM processed_webhooks WHERE event_id = ?').get(eventId));
  },
  mark(eventId, source = 'stripe') {
    db.prepare(
      `INSERT INTO processed_webhooks (event_id, source, processed_at) VALUES (?, ?, ?)
       ON CONFLICT(event_id) DO NOTHING`,
    ).run(eventId, source, nowIso());
  },
};

// ====================================================================
// AI_USAGE
// ====================================================================
export const aiUsage = {
  record({ operation, model, inputTokens = 0, outputTokens = 0, costUsd = 0 }) {
    db.prepare(
      `INSERT INTO ai_usage (id, operation, model, input_tokens, output_tokens, cost_usd, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(newId(), operation, model, inputTokens, outputTokens, costUsd, nowIso());
  },
  monthCostUsd() {
    const since = new Date();
    since.setUTCDate(1); since.setUTCHours(0, 0, 0, 0);
    return db.prepare('SELECT COALESCE(SUM(cost_usd), 0) AS s FROM ai_usage WHERE created_at >= ?')
      .get(since.toISOString()).s;
  },
  monthCallCount() {
    const since = new Date();
    since.setUTCDate(1); since.setUTCHours(0, 0, 0, 0);
    return db.prepare('SELECT COUNT(*) AS n FROM ai_usage WHERE created_at >= ?')
      .get(since.toISOString()).n;
  },
};

// ====================================================================
// FEEDBACK
// ====================================================================
export const feedback = {
  create({ userId, matchId, helpful, reason = null }) {
    const id = newId();
    db.prepare(
      `INSERT INTO feedback (id, user_id, match_id, helpful, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, match_id) DO UPDATE SET helpful = excluded.helpful, reason = excluded.reason`,
    ).run(id, userId, matchId, helpful ? 1 : 0, reason, nowIso());
  },
};

// ====================================================================
// KILL_SWITCHES — proste flagi do wyłączenia ficzerów bez deploya.
// ====================================================================
export const killSwitches = {
  isEnabled(key, defaultValue = true) {
    const row = db.prepare('SELECT enabled FROM kill_switches WHERE key = ?').get(key);
    if (!row) return defaultValue;
    return Boolean(row.enabled);
  },
  set(key, enabled, reason = null) {
    db.prepare(
      `INSERT INTO kill_switches (key, enabled, reason, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET enabled = excluded.enabled, reason = excluded.reason, updated_at = excluded.updated_at`,
    ).run(key, enabled ? 1 : 0, reason, nowIso());
  },
  listAll() {
    return db.prepare('SELECT * FROM kill_switches ORDER BY key').all();
  },
};

// ====================================================================
// SUPPORT_TICKETS
// ====================================================================
export const supportTickets = {
  create({ userId = null, email, subject, body }) {
    const id = newId();
    const ts = nowIso();
    db.prepare(
      `INSERT INTO support_tickets (id, user_id, email, subject, body, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?)`,
    ).run(id, userId, email, subject, body, ts, ts);
    return db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(id);
  },
  listByStatus(status, limit = 100) {
    return db.prepare(
      'SELECT * FROM support_tickets WHERE status = ? ORDER BY created_at DESC LIMIT ?',
    ).all(status, limit);
  },
};
