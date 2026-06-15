import Parser from 'rss-parser';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { nowIso } from '../../lib/ids.js';

/**
 * Domiporta — adapter dla publicznego RSS feedu nieruchomości.
 *
 * Dlaczego Domiporta a nie OLX (DEC-007):
 *   - OLX wycofał RSS (HTTP 404 + "Disallow: * /rss/" w robots.txt — pisane ze spacją by
 *     uniknąć JSDoc edge case).
 *   - Domiporta zwraca Content-Type: application/rss+xml, ~10000 ofert,
 *     filtrowanie po mieście przez ?Localization=<City>.
 *
 * Strategia legalna: jawny publiczny RSS, identyfikacja User-Agent z linkiem /about,
 * link zwrotny do oryginału (driving traffic), zero republikacji zdjęć (URL-e only).
 *
 * Format prawdziwych itemów (zweryfikowany 2026-05-23):
 *   - <title>: opisowy, NIE formuła "Mieszkanie na sprzedaż <city>".
 *              Przykład: "Dwupokojowe mieszkanie z balkonem- 484 000 zł".
 *              Cena zawsze na końcu po znaku `-`, format `<liczba> zł`.
 *   - <link>/<guid>: deterministyczny URL slug — to NASZE źródło prawdy.
 *              "/nieruchomosci/{action}-{subtype}[-{qualifier}]-{city}-{district}[-{street}]-{area}m2/{id}"
 *              action: 'sprzedam' | 'wynajme'
 *              subtype: 'mieszkanie' | 'dom' | 'biuro' | 'lokal_uzytkowy' | 'dzialka' | ...
 *              qualifier: 'dwupokojowe' | 'trzypokojowe' | 'kawalerka' | ... (opt.)
 *              area: liczba m² (np. "65m2")
 *   - <category domain=...>: rss-parser zwraca jako array stringów (gubi atrybut `domain`).
 *              Kolejność deterministyczna: [type, region, poviat, (community), city, (district)].
 *              Liczba elementów 4-6.
 *   - <description>: leak ASP.NET ("Microsoft.AspNetCore.Mvc.Razor.HelperResult") — IGNORE.
 *   - <media:content url=...>: wiele zdjęć w namespace xmlns:media.
 *
 * Filtrowanie w adapterze (zostają tylko mieszkania na sprzedaż):
 *   - action z URL slug == 'sprzedam'
 *   - subtype z URL slug == 'mieszkanie'
 */

const SOURCE_NAME = 'domiporta';
const BASE_URL = 'https://www.domiporta.pl';
const RSS_PATH = '/rss';

/** Kanoniczne nazwy głównych miast PL — używane do mapowania city slug → nazwa z diakrytykami. */
export const POLISH_CITIES_CANON = [
  'Warszawa', 'Kraków', 'Wrocław', 'Łódź', 'Poznań', 'Gdańsk', 'Szczecin',
  'Bydgoszcz', 'Lublin', 'Katowice', 'Białystok', 'Gdynia', 'Częstochowa',
  'Radom', 'Sosnowiec', 'Toruń', 'Kielce', 'Rzeszów', 'Olsztyn', 'Bielsko-Biała',
  'Zabrze', 'Bytom', 'Zielona Góra', 'Rybnik', 'Ruda Śląska', 'Tychy', 'Opole',
  'Gorzów Wielkopolski', 'Dąbrowa Górnicza', 'Płock', 'Elbląg', 'Tarnów',
  'Włocławek', 'Koszalin', 'Kalisz', 'Legnica', 'Grudziądz', 'Słupsk',
  'Jaworzno', 'Jastrzębie-Zdrój',
];

/** Słowa-kwalifikatory między subtype a city w slugu URL. Zignorować przy parsowaniu lokalizacji. */
const URL_QUALIFIERS = new Set([
  'jednopokojowe', 'dwupokojowe', 'trzypokojowe', 'czteropokojowe', 'pieciopokojowe',
  'kawalerka', 'kawalerkowe', 'apartament', 'studio',
]);

// xmlns:media — rss-parser zapisuje atrybuty XML w `$.url`.
const parser = new Parser({
  defaultRSS: 2.0,
  customFields: {
    item: [
      ['media:content', 'media', { keepArray: true }],
    ],
  },
});

/**
 * Buduje URL RSS feedu dla danego miasta.
 * Format: https://www.domiporta.pl/rss?Localization=Warszawa
 *
 * Localization akceptuje kanoniczną nazwę miasta PL (z polskimi diakrytykami).
 * Sprawdzono case-insensitive (warszawa vs Warszawa dają identyczny wynik).
 */
export function buildFeedUrl({ city } = {}) {
  if (!city) throw new Error('city jest wymagane przy budowaniu URL Domiporta RSS');
  const canonical = POLISH_CITIES_CANON.find((c) => c.toLowerCase() === city.toLowerCase())
    || (city.charAt(0).toUpperCase() + city.slice(1).toLowerCase());
  const params = new URLSearchParams({ Localization: canonical });
  return `${BASE_URL}${RSS_PATH}?${params.toString()}`;
}

// ---------------- parser URL slug ----------------

/**
 * Parsuje URL Domiporty. Slug → {action, subtype, area, id, citySlug, districtSlug}.
 *
 * Przykład: "/nieruchomosci/sprzedam-mieszkanie-dwupokojowe-warszawa-bialoleka-sieczna-40m2/156503734"
 *   → { action: 'sprzedam', subtype: 'mieszkanie', area: 40, id: '156503734',
 *       citySlug: 'warszawa', districtSlug: 'bialoleka-sieczna' }
 *
 * Zwraca null gdy slug nie pasuje do wzorca.
 */
export function parseLink(link) {
  if (!link) return null;
  const m = String(link).match(/^\/nieruchomosci\/([^/]+)\/(\d+)\/?$/);
  if (!m) return null;
  const slug = m[1];
  const id = m[2];

  const parts = slug.split('-');
  if (parts.length < 4) return null; // min: action + subtype + city + areaXm2

  const action = parts[0];
  const subtype = parts[1];

  // Find area position — pierwszy segment matching "Xm2".
  const areaIdx = parts.findIndex((p) => /^\d+(?:[.,]\d+)?m2$/i.test(p));
  if (areaIdx === -1) return null;
  const areaRaw = parts[areaIdx].match(/^(\d+(?:[.,]\d+)?)m2$/i)[1];
  const area = parseFloat(areaRaw.replace(',', '.'));

  // City zaczyna się po subtype (+ opcjonalny qualifier).
  let cityIdx = 2;
  if (URL_QUALIFIERS.has(parts[2])) cityIdx = 3;

  if (cityIdx >= areaIdx) return null; // brak segmentu city między subtype a area
  const locationParts = parts.slice(cityIdx, areaIdx);
  const citySlug = locationParts[0];
  const districtSlug = locationParts.slice(1).join('-') || null;

  return { action, subtype, area, id, citySlug, districtSlug };
}

// ---------------- helpers ----------------

/** Wyciąga cenę z tytułu — szuka OSTATNIEGO matcha "<liczba> zł" (ignoruje liczby pośrodku). */
export function parsePriceFromTitle(title) {
  if (!title) return null;
  // \s w JS od ES2018 łapie też   (non-breaking space).
  const re = /(\d[\d\s ]+)\s*z[lł](?![\p{L}])/giu;
  let last = null;
  for (const m of title.matchAll(re)) last = m[1];
  if (!last) return null;
  const cleaned = last.replace(/[\s ]/g, '');
  const n = parseInt(cleaned, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Ekstrakcja city + district z categories array (rss-parser default).
 *
 * Kolejność z Domiporty (deterministyczna w real-world feed):
 *   [type, region, poviat, (community), city, (district)]
 *
 * Algorytm:
 *   - jeśli array ma >= 5 elementów: ostatnie 2 to city + district (jeśli district istnieje)
 *     albo poprzednie + ostatnie. Heurystyka: jeśli ostatni jest w POLISH_CITIES_CANON, to city.
 *   - jeśli array ma 4 elementy: ostatni to city, district null.
 *   - krzyż-weryfikacja z citySlug: jeśli categories.city nie pasuje do citySlug, fallback do
 *     citySlug + capitalize.
 */
export function extractCityDistrict(categories, citySlug) {
  // rss-parser zwykle daje array stringów, ale defensive — wymuszamy stringi.
  const cats = (Array.isArray(categories) ? categories : [])
    .map((c) => {
      if (typeof c === 'string') return c;
      if (c && typeof c === 'object') return c._ || c.value || null;
      return null;
    })
    .filter(Boolean);

  let city = null;
  let district = null;

  if (cats.length >= 5) {
    const last = cats[cats.length - 1];
    const secondLast = cats[cats.length - 2];
    if (POLISH_CITIES_CANON.includes(last)) {
      city = last;
    } else {
      city = secondLast;
      district = last;
    }
  } else if (cats.length >= 4) {
    city = cats[cats.length - 1];
  }

  // Krzyż-weryfikacja z citySlug — jeśli city z categories nie pasuje, fallback.
  if (citySlug) {
    const fromSlug = POLISH_CITIES_CANON.find((c) => slugify(c) === citySlug);
    const cityStr = typeof city === 'string' ? city : null;
    if (!cityStr || (fromSlug && cityStr.toLowerCase() !== fromSlug.toLowerCase())) {
      city = fromSlug || (citySlug.charAt(0).toUpperCase() + citySlug.slice(1));
    }
  }

  return {
    city: typeof city === 'string' ? city : null,
    district: typeof district === 'string' ? district : null,
  };
}

/** Konwersja nazwy PL na slug URL Domiporty (lowercase + transliteracja). */
function slugify(name) {
  return name.toLowerCase()
    .replace(/[ą]/g, 'a').replace(/[ć]/g, 'c').replace(/[ę]/g, 'e')
    .replace(/[ł]/g, 'l').replace(/[ń]/g, 'n').replace(/[óö]/g, 'o')
    .replace(/[ś]/g, 's').replace(/[źż]/g, 'z')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/** URL-e zdjęć z elementów <media:content>. */
function extractPhotos(media) {
  if (!Array.isArray(media)) return [];
  const urls = [];
  for (const m of media) {
    const url = m?.$?.url || m?.url || (typeof m === 'string' ? m : null);
    if (url && typeof url === 'string') urls.push(url);
  }
  return urls;
}

/**
 * Konwertuje pojedynczy item RSS na NormalizedListing — albo null gdy odfiltrowany
 * (nie-sprzedaż / nie-mieszkanie / brak wymaganych pól).
 */
export function itemToListing(item) {
  if (!item?.link) return null;

  const slug = parseLink(item.link);
  if (!slug) return null;
  if (slug.action !== 'sprzedam') return null;
  if (slug.subtype !== 'mieszkanie') return null;

  const { city, district } = extractCityDistrict(item.categories, slug.citySlug);
  const price = parsePriceFromTitle(item.title);
  const area = slug.area;
  const pricePerM2 = (price && area) ? Math.round(price / area) : null;
  const photos = extractPhotos(item.media);

  let absoluteUrl = item.link;
  if (absoluteUrl && !absoluteUrl.startsWith('http')) {
    absoluteUrl = `${BASE_URL}${absoluteUrl.startsWith('/') ? '' : '/'}${absoluteUrl}`;
  }

  return {
    source: SOURCE_NAME,
    source_id: slug.id,
    url: absoluteUrl,
    title: item.title?.trim() ?? '',
    description: null, // Domiporta RSS nie ma użytecznego description.
    price_pln: price,
    area_m2: area,
    price_per_m2: pricePerM2,
    rooms: null,
    floor: null,
    building_year: null,
    market: null,
    property_type: 'apartment',
    city,
    district,
    street: null,
    lat: null,
    lng: null,
    photos: photos.slice(0, 12),
    raw_data: {
      guid: item.guid,
      pubDate: item.pubDate,
      raw_title: item.title,
      categories: item.categories,
    },
    published_at: item.isoDate || (item.pubDate ? new Date(item.pubDate).toISOString() : null),
    fetched_at: nowIso(),
    status: 'active',
  };
}

/** Pobiera RSS z URL z odpowiednim User-Agent i parsuje. */
export async function fetchFeed(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': env.SOURCES_USER_AGENT,
      Accept: 'application/rss+xml, application/xml, text/xml',
    },
    redirect: 'follow',
  });
  if (!res.ok) {
    throw new Error(`Domiporta RSS HTTP ${res.status}: ${res.statusText}`);
  }
  const xml = await res.text();
  return parser.parseString(xml);
}

/**
 * Główny entrypoint: pobiera ogłoszenia dla miasta i zwraca znormalizowane listingi.
 */
export async function fetchListings(opts) {
  const { city, limit = 100 } = opts;
  if (!city) throw new Error('Domiporta fetchListings: city jest wymagane');

  const url = buildFeedUrl({ city });
  logger.info({ source: SOURCE_NAME, url, city }, 'Domiporta: pobieranie RSS');

  const feed = await fetchFeed(url);
  const items = feed?.items ?? [];

  const normalized = [];
  let filtered = 0;
  for (const item of items) {
    try {
      const listing = itemToListing(item);
      if (listing) {
        normalized.push(listing);
        if (normalized.length >= limit) break;
      } else {
        filtered++;
      }
    } catch (err) {
      logger.warn({ err: err.message, item_link: item.link }, 'Domiporta: pominięto item (parse error)');
      filtered++;
    }
  }
  logger.info({
    source: SOURCE_NAME, total: items.length, kept: normalized.length, filtered,
  }, 'Domiporta: parsowanie zakończone');
  return normalized;
}

export default {
  name: SOURCE_NAME,
  fetchListings,
  buildFeedUrl,
  itemToListing,
  parseLink,
  extractCityDistrict,
  parsePriceFromTitle,
};
