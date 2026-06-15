import { env, sourcesEnabled } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { isMainModule } from '../lib/ids.js';
import { listings, killSwitches } from '../db/repos.js';
import { enabledSources, getSource } from '../services/sources/index.js';

/** Pauzuje na N ms (rate limit pomiędzy requestami do tego samego źródła). */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Pobiera ogłoszenia ze wskazanego źródła dla listy miast.
 * Upsert do tabeli `listings` (dedupe po `source + source_id`).
 *
 * @returns {Promise<{source, city, fetched, upserted, errors}[]>}
 */
export async function fetchFromSource(sourceName, cities, opts = {}) {
  const source = getSource(sourceName);

  // Kill switch — możliwość wyłączenia per-source bez deploya.
  if (!killSwitches.isEnabled(`sources.${sourceName}`)) {
    logger.warn({ source: sourceName }, 'Źródło wyłączone przez kill-switch — pomijam');
    return [];
  }

  const results = [];
  for (let i = 0; i < cities.length; i++) {
    const city = cities[i];
    try {
      const normalized = await source.fetchListings({ city, ...opts });
      let upserted = 0;
      for (const listing of normalized) {
        try {
          listings.upsert(listing);
          upserted++;
        } catch (err) {
          logger.error({ err: err.message, source_id: listing.source_id }, 'Listing upsert failed');
        }
      }
      logger.info({ source: sourceName, city, fetched: normalized.length, upserted }, 'fetchFromSource: city ok');
      results.push({ source: sourceName, city, fetched: normalized.length, upserted, errors: 0 });
    } catch (err) {
      logger.error({ err: err.message, source: sourceName, city }, 'fetchFromSource: city failed');
      results.push({ source: sourceName, city, fetched: 0, upserted: 0, errors: 1, errMessage: err.message });
    }

    // Rate limit między miastami w obrębie tego samego źródła.
    if (i < cities.length - 1) {
      const rl = sourceName === 'olx' ? env.OLX_RATE_LIMIT_MS : 1000;
      if (rl > 0) await sleep(rl);
    }
  }
  return results;
}

/**
 * Pobiera ogłoszenia ze WSZYSTKICH włączonych źródeł (env.SOURCES_ENABLED)
 * dla listy miast. Używane przez daily cron (Etap 10).
 */
export async function fetchAll(cities, opts = {}) {
  const sources = enabledSources(sourcesEnabled);
  if (!sources.length) {
    logger.warn({ sourcesEnabled }, 'Brak włączonych źródeł — nic do pobrania');
    return [];
  }
  logger.info({ sources: sources.map((s) => s.name), cities }, 'fetchAll: start');

  const all = [];
  for (const src of sources) {
    const res = await fetchFromSource(src.name, cities, opts);
    all.push(...res);
  }
  return all;
}

// ---------------- CLI ----------------

function parseArgs(argv) {
  const out = { source: null, city: null, limit: 50, once: false };
  for (const a of argv.slice(2)) {
    if (a === '--once') out.once = true;
    else if (a.startsWith('--source=')) out.source = a.slice(9);
    else if (a.startsWith('--city=')) out.city = a.slice(7);
    else if (a.startsWith('--limit=')) out.limit = parseInt(a.slice(8), 10);
  }
  return out;
}

async function runCli() {
  const args = parseArgs(process.argv);
  const cities = args.city ? [args.city] : ['warszawa', 'krakow', 'wroclaw', 'gdansk', 'poznan'];
  const opts = { limit: args.limit };

  try {
    let results;
    if (args.source) {
      results = await fetchFromSource(args.source, cities, opts);
    } else {
      results = await fetchAll(cities, opts);
    }
    const totals = results.reduce((acc, r) => ({
      fetched: acc.fetched + (r.fetched ?? 0),
      upserted: acc.upserted + (r.upserted ?? 0),
      errors: acc.errors + (r.errors ?? 0),
    }), { fetched: 0, upserted: 0, errors: 0 });

    logger.info({ totals, results }, 'fetchListings CLI: zakończono');
    process.exit(totals.errors > 0 ? 1 : 0);
  } catch (err) {
    logger.error({ err: err.message, stack: err.stack }, 'fetchListings CLI: krytyczny błąd');
    process.exit(2);
  }
}

if (isMainModule(import.meta.url)) {
  runCli();
}
