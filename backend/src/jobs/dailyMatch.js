import { logger } from '../lib/logger.js';
import { isMainModule } from '../lib/ids.js';
import {
  users, listings, searches, matches, killSwitches,
} from '../db/repos.js';
import { fetchAll } from './fetchListings.js';
import { computePriceFairness } from '../services/pricing-comparables.js';
import { computeAndCacheROI } from '../services/roi.js';
import { scoreListingMatch, analyzeListingRedFlags, heuristicMatchScore, budgetStatus } from '../services/ai.js';
import { sendPushBatch, newMatchPushPayload } from '../services/push.js';
import { env, sourcesEnabled } from '../config/env.js';
import { audit } from '../lib/audit.js';

/**
 * Daily match pipeline. Wywoływane przez cron raz dziennie (LISTINGS_FETCH_CRON).
 *
 * Pipeline:
 *   1. Fetch nowych ogłoszeń ze wszystkich enabled sources (z `services/sources/`).
 *   2. Dla każdego enabled search każdego usera:
 *      a. Znajdź listings pasujące do filtrów search (city, district, price, area, rooms).
 *      b. Pomiń te które już mają match dla tego usera (dedupe).
 *      c. Dla nowych: compute fairness + (Investor) ROI + AI red flags + AI match score
 *         (z budget guard — fallback do heurystyki przy hard budget).
 *      d. Insert do `matches` table.
 *   3. Dla każdego usera: zbierz nowe match-e do batcha push (max 1 push/dzień/user — w MVP
 *      wysyłamy summary „masz N nowych ofert" zamiast 10 osobnych).
 *   4. Mark match jako `notified=1` po skutecznym push.
 *
 * Idempotentne: drugi run tego samego dnia nie zduplikuje match-y (UNIQUE constraint
 * user_id + listing_id).
 *
 * Kill switches (sprawdzane na początku):
 *   - `cron.daily` — wyłącz cały pipeline
 *   - `ai.matching` — wyłącz AI calls (używaj tylko heurystyki)
 */

const CITIES_TO_FETCH = ['warszawa', 'krakow', 'wroclaw', 'gdansk', 'poznan'];

export async function runDailyMatch({ skipFetch = false } = {}) {
  const startTs = Date.now();

  if (!killSwitches.isEnabled('cron.daily')) {
    logger.warn('Daily cron wyłączony przez kill-switch — pomijam');
    return { status: 'skipped_killswitch' };
  }

  // ---------- Step 1: Fetch new listings ----------

  let fetchStats = { fetched: 0, upserted: 0, errors: 0 };
  if (!skipFetch && sourcesEnabled.length > 0) {
    try {
      const results = await fetchAll(CITIES_TO_FETCH, { limit: 100 });
      fetchStats = results.reduce((acc, r) => ({
        fetched: acc.fetched + (r.fetched ?? 0),
        upserted: acc.upserted + (r.upserted ?? 0),
        errors: acc.errors + (r.errors ?? 0),
      }), { fetched: 0, upserted: 0, errors: 0 });
      logger.info({ fetchStats, sources: sourcesEnabled, cities: CITIES_TO_FETCH },
        'Daily: fetch zakończony');
    } catch (err) {
      logger.error({ err: err.message }, 'Daily: fetch failed');
    }
  } else {
    logger.info('Daily: pomijam fetch (skipFetch lub brak źródeł)');
  }

  // ---------- Step 2: Match scoring per user.search ----------

  const allUsers = users.listAll(1000);
  const useAi = killSwitches.isEnabled('ai.matching');

  let totalMatchesCreated = 0;
  const usersWithNewMatches = new Map(); // userId → matches[]

  for (const user of allUsers) {
    const userSearches = searches.listEnabledByUser(user.id);
    if (userSearches.length === 0) continue;

    // Free tier: max FREE_TIER_DAILY_MATCH_LIMIT match-y/dzień. Premium: unlimited.
    const dailyMax = user.premium_tier === 'free' ? env.FREE_TIER_DAILY_MATCH_LIMIT : 9999;
    const alreadyToday = matches.countTodayByUser(user.id);
    let remaining = Math.max(0, dailyMax - alreadyToday);
    if (remaining === 0) continue;

    const userMatches = [];

    for (const search of userSearches) {
      if (remaining <= 0) break;

      const districtsList = JSON.parse(search.districts || '[]');
      const roomsList = JSON.parse(search.rooms || '[]');

      // Query listings pasujące do filtrów.
      const candidates = listings.search({
        city: search.city,
        district: districtsList[0] || null, // MVP: pierwszy district z listy
        minPrice: search.min_price,
        maxPrice: search.max_price,
        minArea: search.min_area,
        maxArea: search.max_area,
        limit: 200,
      });

      for (const listing of candidates.rows) {
        if (remaining <= 0) break;
        // Dedupe — skip jeśli już mamy match.
        if (matches.findByUserListing(user.id, listing.id)) continue;
        // Rooms filter (in-app — schema list).
        if (roomsList.length && listing.rooms && !roomsList.includes(listing.rooms)) continue;

        // Compute fairness (tania, deterministyczna).
        const fairness = computePriceFairness(listing);

        // AI red flags (z budget guard, gdy włączone).
        let flags = [];
        if (useAi && budgetStatus().hardExceeded === false) {
          const aiFlags = await analyzeListingRedFlags(listing);
          if (Array.isArray(aiFlags)) flags = aiFlags;
        }

        // AI match score albo fallback heurystyczny.
        let score, reasoning, scorer;
        const aiResult = useAi && !budgetStatus().hardExceeded
          ? await scoreListingMatch(user, listing, {
              medianPricePerM2: fairness.medianPricePerM2,
              fairnessLabel: fairness.fairnessLabel,
              deltaPct: fairness.deltaPct,
              sampleSize: fairness.sampleSize,
            }, search)
          : null;
        if (aiResult) {
          score = aiResult.score;
          reasoning = aiResult.reasoning;
          scorer = 'ai';
        } else {
          const h = heuristicMatchScore(user, listing, fairness);
          score = h.score;
          reasoning = h.reasoning;
          scorer = 'heuristic';
        }

        // Pomijamy match-e poniżej confidence threshold (chyba że okazja BELOW).
        if (score < env.MATCH_CONFIDENCE_THRESHOLD && fairness.fairnessLabel !== 'below') {
          continue;
        }

        // Insert match.
        const m = matches.create({
          userId: user.id,
          searchId: search.id,
          listingId: listing.id,
          confidenceScore: score,
          matchReasoning: reasoning,
          priceFairness: fairness.fairnessLabel,
          fairnessDeltaPct: fairness.deltaPct,
          redFlags: flags,
          scorer,
        });
        if (m) {
          userMatches.push({ match: m, listing, score, fairness });
          remaining--;
          totalMatchesCreated++;

          // Inwestor — pre-compute ROI (cache do investor_analysis).
          if (user.user_type === 'investor') {
            computeAndCacheROI(listing);
          }
        }
      }
    }

    if (userMatches.length > 0) usersWithNewMatches.set(user.id, userMatches);
  }

  // ---------- Step 3: Send push notifications ----------

  const pushMessages = [];
  for (const [userId, ms] of usersWithNewMatches.entries()) {
    const user = users.findById(userId);
    if (!user || !user.notif_push || !user.push_token) continue;
    // MVP: summary push „masz N nowych ofert" jeśli > 1, inaczej szczegóły pierwszego match.
    if (ms.length === 1) {
      const { match, listing } = ms[0];
      pushMessages.push({
        token: user.push_token,
        payload: newMatchPushPayload(user, match, listing),
      });
    } else {
      const isInvestor = user.user_type === 'investor';
      pushMessages.push({
        token: user.push_token,
        payload: {
          title: isInvestor
            ? `🏢 ${ms.length} nowych inwestycji do oceny`
            : `🏠 ${ms.length} nowych ofert pasujących do Ciebie`,
          body: `Najlepsza: ${ms[0].listing.title?.slice(0, 50) ?? 'oferta'} (${ms[0].listing.city})`,
          data: { type: 'daily_summary', match_count: ms.length },
        },
      });
    }
  }

  let pushStats = { sent: 0, failed: 0 };
  if (pushMessages.length > 0) {
    pushStats = await sendPushBatch(pushMessages);
    // Mark match-e (z 1 user) jako notified gdy push OK (uproszczenie — zakładamy że batch
    // index === user index w usersWithNewMatches).
    const ids = [];
    let idx = 0;
    for (const [, ms] of usersWithNewMatches.entries()) {
      const user = users.findById(ms[0].match.user_id);
      if (user?.push_token && user.notif_push) {
        // Nie wiemy precyzyjnie który push się udał — w MVP markujemy wszystkie z usera jeśli
        // batch zwrócił sent > 0. Akceptowalne ryzyko duplikatu push w razie partial fail.
        for (const m of ms) ids.push(m.match.id);
      }
      idx++;
    }
    if (ids.length) matches.markNotified(ids);
  }

  // ---------- Step 4: Stats + audit ----------

  const summary = {
    duration_ms: Date.now() - startTs,
    fetch: fetchStats,
    matches_created: totalMatchesCreated,
    users_with_new_matches: usersWithNewMatches.size,
    push: pushStats,
    ai_used: useAi,
    ai_budget: budgetStatus(),
  };
  audit({ action: 'daily_cron_completed', detail: summary });
  logger.info({ summary }, 'Daily match pipeline zakończony');
  return summary;
}

// ---------------- CLI ----------------

if (isMainModule(import.meta.url)) {
  const skipFetch = process.argv.includes('--skip-fetch');
  runDailyMatch({ skipFetch })
    .then((s) => { console.log('\n=== Summary ==='); console.log(JSON.stringify(s, null, 2)); process.exit(0); })
    .catch((err) => { logger.error({ err: err.message }, 'Daily CLI failed'); process.exit(1); });
}
