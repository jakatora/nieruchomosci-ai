import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { ah } from '../lib/asyncHandler.js';
import { badRequest, notFound } from '../lib/errors.js';
import { listings as listingsRepo } from '../db/repos.js';
import { computePriceFairness } from '../services/pricing-comparables.js';
import { analyzeListingRedFlags } from '../services/ai.js';
import { audit } from '../lib/audit.js';
import { getSource } from '../services/sources/index.js';

const router = Router();

/**
 * Public endpoint dla landingu (GitHub Pages). User wkleja URL Domiporty z
 * formularza demo → zwracamy preview analizy AI + fairness.
 *
 * Strategia (START_NIERUCHOMOSCIAI.md § Etap 15):
 *   - **Bez auth** — landing nie zna usera. Zachęta do rejestracji w odpowiedzi.
 *   - **Rate limit 5/IP/dobę** — anti-abuse + AI cost guard.
 *   - **Tylko cached listings** — nie fetchujemy live z Domiporty (RSS to feed
 *     kategorii, nie single-item endpoint). Jeśli listing nie w DB → 404 z message
 *     "dodamy przy następnym daily cron, sprawdź jutro".
 *   - **Preview-only** — 1 flag o najwyższej severity + 1-zdaniowe podsumowanie.
 *     Pełna lista flag wymaga rejestracji (lead magnet).
 *
 * URL parsing: reuse `parseLink` z adaptera Domiporta — wyciągamy source_id.
 */

// Rate limit (Iter 12: konfigurowalne przez env, default 5/IP/24h).
const pasteLimiter = rateLimit({
  windowMs: env.PASTE_DEMO_RATE_WINDOW_MS,
  max: env.PASTE_DEMO_RATE_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED',
    message: `Limit demo (${env.PASTE_DEMO_RATE_MAX} analiz / ${Math.round(env.PASTE_DEMO_RATE_WINDOW_MS / (60 * 60 * 1000))}h) wyczerpany. Zarejestruj się dla nielimitowanego dostępu.` } },
});

const pasteSchema = z.object({
  url: z.string().url('Wpisz pełen URL ogłoszenia, np. https://www.domiporta.pl/...'),
});

/** Wyciąga source name z URL ogłoszenia. */
function detectSource(url) {
  if (/domiporta\.pl\b/i.test(url)) return 'domiporta';
  if (/olx\.pl\b/i.test(url)) return 'olx';
  return null;
}

/** Wyciąga source_id z URL (per source). */
function extractSourceId(url, source) {
  if (source === 'domiporta') {
    const adapter = getSource('domiporta');
    // Wyodrębniamy path /nieruchomosci/.../<id>
    try {
      const u = new URL(url);
      const parsed = adapter.parseLink(u.pathname);
      return parsed?.id ?? null;
    } catch {
      return null;
    }
  }
  if (source === 'olx') {
    const m = url.match(/-ID([A-Za-z0-9]+)/);
    return m ? m[1] : null;
  }
  return null;
}

// ====================================================================
// POST /content/paste-listing-analysis
// ====================================================================

router.post('/paste-listing-analysis', pasteLimiter, ah(async (req, res) => {
  const parsed = pasteSchema.safeParse(req.body);
  if (!parsed.success) {
    throw badRequest('Nieprawidłowe dane', parsed.error.issues.map((i) => ({
      field: i.path.join('.'), message: i.message,
    })));
  }
  const url = parsed.data.url.trim();

  const source = detectSource(url);
  if (!source) {
    throw badRequest(
      'Obsługujemy obecnie tylko URL-e z portalu Domiporta. Inne portale dodamy wkrótce.',
      { supported_sources: ['domiporta'] },
    );
  }

  const sourceId = extractSourceId(url, source);
  if (!sourceId) {
    throw badRequest(
      'Nie udało się rozpoznać identyfikatora ogłoszenia w URL. Upewnij się że to bezpośredni link do oferty.',
      { url_received: url },
    );
  }

  // Lookup w DB.
  const listing = listingsRepo.findBySource(source, sourceId);
  if (!listing) {
    audit({ action: 'paste_demo_unknown_listing',
      detail: { source, source_id: sourceId, url }, ip: req.ip });
    throw notFound(
      'Nie mamy jeszcze tej oferty w bazie. Dodamy ją przy najbliższym codziennym pobraniu (rano). ' +
      'Zarejestruj się — wyślemy push gdy oferta wpadnie i wykryjemy red-flagi.',
      { source_id: sourceId, retry_after: 'next_daily_cron' },
    );
  }

  // Mamy listing — compute fairness + AI flags.
  const fairness = computePriceFairness(listing);

  // Parse photos jeśli to JSON string z DB.
  if (typeof listing.photos === 'string') {
    try { listing.photos = JSON.parse(listing.photos); } catch { listing.photos = []; }
  }

  // AI red flags (z budget guard + fallback null gdy AI off).
  const flags = await analyzeListingRedFlags(listing);

  // Wybieramy 1 flag o najwyższej severity (preview-only — pełna lista wymaga login).
  let topFlag = null;
  if (Array.isArray(flags) && flags.length) {
    const order = { high: 0, medium: 1, low: 2 };
    topFlag = [...flags].sort((a, b) => order[a.severity] - order[b.severity])[0];
  }

  audit({ action: 'paste_demo_analyzed',
    detail: { source, source_id: sourceId, fairness: fairness.fairnessLabel,
      flags_total: flags?.length ?? 0, top_severity: topFlag?.severity }, ip: req.ip });

  res.json({
    listing: {
      title: listing.title,
      city: listing.city,
      district: listing.district,
      price_pln: listing.price_pln,
      area_m2: listing.area_m2,
      price_per_m2: listing.price_per_m2,
      url: listing.url,
      photo: Array.isArray(listing.photos) ? listing.photos[0] ?? null : null,
    },
    fairness: {
      label: fairness.fairnessLabel,
      delta_pct: fairness.deltaPct,
      median_price_per_m2: fairness.medianPricePerM2,
      sample_size: fairness.sampleSize,
      source: fairness.source,
    },
    red_flag_preview: topFlag ? {
      type: topFlag.type,
      severity: topFlag.severity,
      text: topFlag.text,
      total_found: flags.length,
    } : (flags === null ? {
      type: null,
      text: 'Analiza AI chwilowo niedostępna — sprawdź lokalizację i cenę manualnie.',
      total_found: 0,
    } : {
      type: null,
      text: 'Nie wykryliśmy red-flag w tej ofercie.',
      total_found: 0,
    }),
    cta: {
      message: flags?.length
        ? `Wykryliśmy ${flags.length} sygnał${flags.length === 1 ? '' : 'ów'} ostrzegawczy${flags.length === 1 ? '' : 'ch'}. Zarejestruj się aby zobaczyć pełną listę + AI matching dla Twoich wyszukiwań.`
        : 'Zarejestruj się aby dostawać powiadomienia o ofertach z dobrym yield-em / fair price w Twojej okolicy.',
      register_url: 'https://jakatora.github.io/nieruchomosciai/#register',
    },
  });
}));

export default router;
