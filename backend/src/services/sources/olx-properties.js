import Parser from 'rss-parser';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { nowIso } from '../../lib/ids.js';

/**
 * OLX — adapter dla publicznych RSS feedów kategorii Nieruchomości / Mieszkania / Sprzedaż.
 *
 * Strategia legalna (patrz START_NIERUCHOMOSCIAI.md § Strategia prawna):
 *   - RSS to oficjalna funkcjonalność OLX (param `search%5Bview%5D=rss`).
 *   - Identyfikujemy się uczciwie w User-Agent (link do strony "o nas").
 *   - Rate limit `OLX_RATE_LIMIT_MS` między requestami (default 5000 ms).
 *   - Nie republikujemy zdjęć — przechowujemy tylko URL-e do oryginałów na OLX.
 *   - Każde ogłoszenie linkuje z powrotem do OLX ("driving traffic").
 *
 * Dane z RSS są minimalne (title, link, guid, description HTML, pubDate). Parser
 * wyciąga z description: cenę, powierzchnię, liczbę pokoi, dzielnicę, zdjęcia.
 */

const SOURCE_NAME = 'olx';
const BASE_URL = 'https://www.olx.pl/d/nieruchomosci/mieszkania/sprzedaz';

const parser = new Parser({
  defaultRSS: 2.0,
  // Dodatkowe pola które OLX czasami wstawia per item.
  customFields: {
    item: ['category', 'guid', 'pubDate'],
  },
});

/**
 * Buduje URL RSS feedu dla danego miasta + filtrów.
 * Dla OLX `?search%5Bview%5D=rss` to URL-encoded `?search[view]=rss`.
 */
export function buildFeedUrl({ city, minPrice, maxPrice, rooms } = {}) {
  if (!city) throw new Error('city jest wymagane przy budowaniu URL OLX RSS');
  const slug = city.toLowerCase()
    .replace(/[ą]/g, 'a').replace(/[ć]/g, 'c').replace(/[ę]/g, 'e')
    .replace(/[ł]/g, 'l').replace(/[ń]/g, 'n').replace(/[óö]/g, 'o')
    .replace(/[ś]/g, 's').replace(/[źż]/g, 'z')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/(^-|-$)/g, '');

  const params = new URLSearchParams({ 'search[view]': 'rss' });
  if (minPrice) params.set('search[filter_float_price:from]', String(minPrice));
  if (maxPrice) params.set('search[filter_float_price:to]', String(maxPrice));
  if (Array.isArray(rooms) && rooms.length) {
    // OLX akceptuje rooms jako "one", "two", "three", "four", "five_or_more"
    const map = { 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five_or_more' };
    rooms.forEach((r, i) => {
      const v = map[Math.min(r, 5)];
      if (v) params.set(`search[filter_enum_rooms][${i}]`, v);
    });
  }
  return `${BASE_URL}/${slug}/?${params.toString()}`;
}

// ---------------- parser HTML w <description> ----------------

const PRICE_RE  = /(\d[\d\s ]*)\s*(?:zł|PLN|zl)/i;
const AREA_RE   = /(\d+(?:[.,]\d+)?)\s*m\s*(?:²|2|kw)/i;
// Dwa warianty: "2 pokoje", "2-pokojowe" (cyfra przed słowem) oraz "Liczba pokoi: 2"
// (cyfra za słowem). Próbujemy w tej kolejności — pierwszy lepiej oddaje tytuł oferty.
const ROOMS_NUM_FIRST_RE = /(\d+)[\s\-]?(?:pokoj|pok\.?|pokoi|rooms?)/i;
const ROOMS_NUM_AFTER_RE = /(?:pokoj|pokoi|rooms?)\w*\s*[:\-]?\s*(\d+)/i;
const IMG_RE    = /<img[^>]+src\s*=\s*"([^"]+)"/gi;

/** Bezpiecznie usuwa znaczniki HTML zwracając czysty tekst. */
function stripHtml(html) {
  if (!html) return '';
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

function parseNumber(raw) {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[\s ]/g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Wyciąga cenę / m² / pokoje / zdjęcia z HTML lub plain text. */
export function parseDescription(rawDescription) {
  const result = {
    description: stripHtml(rawDescription),
    price_pln: null,
    area_m2: null,
    rooms: null,
    photos: [],
  };
  if (!rawDescription) return result;

  const priceMatch = rawDescription.match(PRICE_RE);
  if (priceMatch) result.price_pln = parseNumber(priceMatch[1]);

  const areaMatch = rawDescription.match(AREA_RE);
  if (areaMatch) result.area_m2 = parseNumber(areaMatch[1]);

  // Najpierw "digit przed słowem" (np. "2-pokojowe", "2 pokoje"), w razie braku
  // "pokoi: 2". Ten porządek wybiera tytuł ("2-pokojowe") nad luźne wzmianki
  // w dalszej części opisu (np. ".. 2 pokoje na piętrze"), co jest dokładniejsze.
  const roomsMatch = rawDescription.match(ROOMS_NUM_FIRST_RE)
    ?? rawDescription.match(ROOMS_NUM_AFTER_RE);
  if (roomsMatch) {
    const r = parseInt(roomsMatch[1], 10);
    if (Number.isFinite(r) && r > 0 && r < 20) result.rooms = r;
  }

  let imgMatch;
  while ((imgMatch = IMG_RE.exec(rawDescription)) !== null) {
    if (imgMatch[1]) result.photos.push(imgMatch[1]);
  }

  return result;
}

/** Wyciąga dzielnicę z tytułu lub kategorii (heurystyka). */
function extractDistrict(item, city) {
  // Tytuł OLX często ma format "Mieszkanie 2-pokojowe Mokotów" lub "... - Warszawa, Mokotów"
  const candidates = [
    ...(item.categories ?? []),
    item.category,
    item.title,
  ].filter(Boolean).map(String);
  for (const text of candidates) {
    // Szukamy "Miasto, Dzielnica" lub "Miasto Dzielnica"
    const re = new RegExp(`${city}\\s*[,\\-]?\\s*([A-ZŁŚŻŹĄĘĆŃÓ][\\wŁŚŻŹĄĘĆŃÓłśżźąęćńó-]+)`, 'i');
    const m = text.match(re);
    if (m) return m[1];
  }
  return null;
}

/** Pobiera stabilny source_id z guid lub link. */
function extractSourceId(item) {
  // OLX format: ".../CID3-ID12345.html" lub guid ".../CID3-ID12345".
  // Regex musi być anchored — żeby NIE wpaść w "CID3" (literalnie zawiera "ID").
  const candidates = [item.guid, item.link, item.id].filter(Boolean).map(String);
  for (const c of candidates) {
    const m = c.match(/-ID([A-Za-z0-9]+)/);
    if (m) return m[1];
  }
  // Fallback: cała wartość pierwszego dostępnego identyfikatora (przy nietypowym formacie).
  return candidates[0] ?? null;
}

/** Konwertuje pojedynczy item RSS na NormalizedListing. */
export function itemToListing(item, { city }) {
  const sourceId = extractSourceId(item);
  if (!sourceId) return null;

  // Preferuj surowy HTML (zachowuje <img>); contentSnippet to text-only — gubi zdjęcia.
  const rawHtml = item['content:encoded'] || item.content || item.description || item.contentSnippet || '';
  const parsed = parseDescription(rawHtml);
  const price = parsed.price_pln;
  const area = parsed.area_m2;
  const pricePerM2 = (price && area) ? Math.round(price / area) : null;
  const district = extractDistrict(item, city);

  return {
    source: SOURCE_NAME,
    source_id: sourceId,
    url: item.link,
    title: item.title?.trim() || '(bez tytułu)',
    description: parsed.description.slice(0, 4000),
    price_pln: price,
    area_m2: area,
    price_per_m2: pricePerM2,
    rooms: parsed.rooms,
    floor: null,
    building_year: null,
    market: null,
    property_type: 'apartment',
    city,
    district,
    street: null,
    lat: null,
    lng: null,
    photos: parsed.photos.slice(0, 12),
    raw_data: {
      guid: item.guid,
      pubDate: item.pubDate,
      categories: item.categories ?? null,
    },
    published_at: item.isoDate || (item.pubDate ? new Date(item.pubDate).toISOString() : null),
    fetched_at: nowIso(),
    status: 'active',
  };
}

/** Pobiera RSS z URL z odpowiednim User-Agent i parsuje. Zwraca surowy feed object. */
export async function fetchFeed(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': env.OLX_RSS_USER_AGENT,
      Accept: 'application/rss+xml, application/xml, text/xml',
    },
    redirect: 'follow',
  });
  if (!res.ok) {
    throw new Error(`OLX RSS HTTP ${res.status}: ${res.statusText}`);
  }
  const xml = await res.text();
  return parser.parseString(xml);
}

/**
 * Główny entrypoint: pobiera ogłoszenia dla miasta i zwraca znormalizowane listingi.
 *
 * @param {Object} opts
 * @param {string} opts.city           — miasto (np. "warszawa")
 * @param {number} [opts.limit=50]     — maksymalna liczba zwracanych ogłoszeń
 * @param {number} [opts.minPrice]
 * @param {number} [opts.maxPrice]
 * @param {number[]} [opts.rooms]
 * @returns {Promise<NormalizedListing[]>}
 */
export async function fetchListings(opts) {
  const { city, limit = 50 } = opts;
  if (!city) throw new Error('OLX fetchListings: city jest wymagane');

  const url = buildFeedUrl(opts);
  logger.info({ source: SOURCE_NAME, url, city }, 'OLX: pobieranie RSS');

  const feed = await fetchFeed(url);
  const items = feed?.items ?? [];

  const normalized = [];
  for (const item of items.slice(0, limit)) {
    try {
      const listing = itemToListing(item, { city });
      if (listing) normalized.push(listing);
    } catch (err) {
      logger.warn({ err: err.message, item_link: item.link }, 'OLX: pominięto item (parse error)');
    }
  }
  logger.info({ source: SOURCE_NAME, fetched: items.length, normalized: normalized.length }, 'OLX: parsowanie zakończone');
  return normalized;
}

export default {
  name: SOURCE_NAME,
  fetchListings,
  buildFeedUrl,
  // eksport dla testów
  itemToListing,
  parseDescription,
};
