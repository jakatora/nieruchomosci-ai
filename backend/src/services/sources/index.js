/**
 * Registry źródeł ogłoszeń (pluginowa architektura).
 *
 * Każde źródło eksportuje obiekt:
 *   {
 *     name: 'olx',
 *     fetchListings({ city, limit, minPrice, maxPrice, rooms }): Promise<NormalizedListing[]>
 *   }
 *
 * NormalizedListing musi pasować do `db/repos.js#listings.upsert()`:
 *   { source, source_id, url, title, description?, price_pln?, area_m2?, price_per_m2?,
 *     rooms?, floor?, city, district?, street?, lat?, lng?, photos?, raw_data?,
 *     published_at?, fetched_at }
 *
 * MVP: tylko OLX. Otodom / Allegro Lokalnie wchodzą po walidacji (decyzja w decisions.md).
 */

import olxProperties from './olx-properties.js';
import domiportaProperties from './domiporta-properties.js';

const REGISTRY = new Map([
  // DEC-007: Domiporta jest głównym źródłem MVP (OLX wycofał RSS).
  [domiportaProperties.name, domiportaProperties],
  // OLX-properties zostaje jako reference — gotowy gdy OLX wróci do RSS lub na ścieżkę B (HTML scraping).
  [olxProperties.name, olxProperties],
]);

/**
 * @internal — rejestruje custom source (głównie dla testów i v2 plugin extensions).
 * Production sources są dodawane na top tego modułu w `REGISTRY` konstrukturze.
 * Zwraca cleanup function która usuwa source z registry.
 */
export function registerSource(source) {
  if (!source?.name || typeof source.fetchListings !== 'function') {
    throw new Error('registerSource: wymaga { name, fetchListings }');
  }
  const wasOverride = REGISTRY.get(source.name);
  REGISTRY.set(source.name, source);
  return () => {
    if (wasOverride) REGISTRY.set(source.name, wasOverride);
    else REGISTRY.delete(source.name);
  };
}

/** Zwraca źródło po nazwie albo rzuca jeśli nieznane. */
export function getSource(name) {
  const src = REGISTRY.get(name);
  if (!src) {
    throw new Error(`Nieznane źródło ogłoszeń: "${name}". Dostępne: ${[...REGISTRY.keys()].join(', ') || '(brak)'}`);
  }
  return src;
}

/** Lista wszystkich zarejestrowanych źródeł. */
export function listSources() {
  return [...REGISTRY.values()];
}

/** Lista źródeł włączonych w env (po przefiltrowaniu przez sourcesEnabled CSV).
 *  Iter 15: defensive — Array.isArray check zamiast crash przy null/undefined/object. */
export function enabledSources(sourcesEnabledList) {
  if (!Array.isArray(sourcesEnabledList)) return [];
  return sourcesEnabledList
    .map((name) => REGISTRY.get(name))
    .filter(Boolean);
}
