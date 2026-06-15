import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Parser from 'rss-parser';
import domiporta, {
  buildFeedUrl,
  parseLink,
  parsePriceFromTitle,
  extractCityDistrict,
  itemToListing,
} from '../../src/services/sources/domiporta-properties.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'domiporta-rss-sample.xml'), 'utf8');

describe('sources/domiporta-properties', () => {
  describe('buildFeedUrl', () => {
    it('tworzy URL z Localization=Warszawa (canonical PL)', () => {
      const url = buildFeedUrl({ city: 'Warszawa' });
      assert.match(url, /^https:\/\/www\.domiporta\.pl\/rss\?/);
      assert.match(url, /Localization=Warszawa/);
    });

    it('konwertuje lowercase na canonical (warszawa → Warszawa)', () => {
      const url = buildFeedUrl({ city: 'warszawa' });
      assert.match(url, /Localization=Warszawa/);
    });

    it('zachowuje polskie diakrytyki (Kraków → URL-encoded)', () => {
      const url = buildFeedUrl({ city: 'kraków' });
      assert.match(url, /Localization=Krak%C3%B3w/);
    });

    it('rzuca błąd gdy brak city', () => {
      assert.throws(() => buildFeedUrl({}), /city/);
    });
  });

  describe('parseLink (URL slug — deterministyczne źródło prawdy)', () => {
    it('mieszkanie sprzedaż bez qualifier: warszawa Mokotów', () => {
      const r = parseLink('/nieruchomosci/sprzedam-mieszkanie-warszawa-mokotow-65m2/156503731');
      assert.deepEqual(r, {
        action: 'sprzedam', subtype: 'mieszkanie', area: 65, id: '156503731',
        citySlug: 'warszawa', districtSlug: 'mokotow',
      });
    });

    it('mieszkanie sprzedaż Z qualifier (dwupokojowe): Warszawa Białołęka Sieczna', () => {
      const r = parseLink('/nieruchomosci/sprzedam-mieszkanie-dwupokojowe-warszawa-bialoleka-sieczna-40m2/156503734');
      assert.equal(r.action, 'sprzedam');
      assert.equal(r.subtype, 'mieszkanie');
      assert.equal(r.area, 40);
      assert.equal(r.id, '156503734');
      assert.equal(r.citySlug, 'warszawa');
      assert.equal(r.districtSlug, 'bialoleka-sieczna');
    });

    it('wynajem biuro: warszawa srodmiescie topiel', () => {
      const r = parseLink('/nieruchomosci/wynajme-biuro-warszawa-srodmiescie-topiel-80m2/156503727');
      assert.equal(r.action, 'wynajme');
      assert.equal(r.subtype, 'biuro');
      assert.equal(r.area, 80);
    });

    it('zwraca null dla niepełnego URL', () => {
      assert.equal(parseLink('/nieruchomosci/foo'), null);
      assert.equal(parseLink('/inny-path/abc/123'), null);
      assert.equal(parseLink(''), null);
      assert.equal(parseLink(null), null);
    });
  });

  describe('parsePriceFromTitle (last match wins)', () => {
    it('"Dwupokojowe mieszkanie z balkonem- 484 000 zł" → 484000', () => {
      assert.equal(parsePriceFromTitle('Dwupokojowe mieszkanie z balkonem- 484 000 zł'), 484000);
    });

    it('cena z non-breaking space (\\u00A0)', () => {
      assert.equal(parsePriceFromTitle('Mieszkanie- 484 000 zł'), 484000);
    });

    it('"... 80 m2 w Śródmieściu- 5 900 zł" → 5900 (ignoruje 80 z m2)', () => {
      assert.equal(parsePriceFromTitle('Nowoczesny lokal biurowy 80 m2 w Śródmieściu- 5 900 zł'), 5900);
    });

    it('zwraca null gdy brak ceny', () => {
      assert.equal(parsePriceFromTitle('jakiś tytuł bez ceny'), null);
      assert.equal(parsePriceFromTitle(''), null);
    });
  });

  describe('extractCityDistrict (categories array)', () => {
    it('6 elementów: city + district', () => {
      // [type, region, poviat, community, city, district]
      const r = extractCityDistrict(['Mieszkanie', 'mazowieckie', 'warszawski', 'Warszawa', 'Warszawa', 'Białołęka'], 'warszawa');
      assert.equal(r.city, 'Warszawa');
      assert.equal(r.district, 'Białołęka');
    });

    it('5 elementów: city + district', () => {
      const r = extractCityDistrict(['Mieszkanie', 'mazowieckie', 'warszawski', 'Warszawa', 'Mokotów'], 'warszawa');
      assert.equal(r.city, 'Warszawa');
      assert.equal(r.district, 'Mokotów');
    });

    it('5 elementów ale ostatni jest miastem (heurystyka)', () => {
      // [type, region, poviat, community, city] — ostatni "Warszawa" jest w POLISH_CITIES_CANON
      const r = extractCityDistrict(['Mieszkanie', 'mazowieckie', 'warszawski', 'community', 'Warszawa'], 'warszawa');
      assert.equal(r.city, 'Warszawa');
      assert.equal(r.district, null);
    });

    it('4 elementy: city, district null', () => {
      const r = extractCityDistrict(['Mieszkanie', 'mazowieckie', 'krakowski', 'Kraków'], 'krakow');
      assert.equal(r.city, 'Kraków');
      assert.equal(r.district, null);
    });

    it('krzyż-weryfikacja: jeśli categories nie pasuje do slug, fallback do slug', () => {
      // Hipotetyczny przypadek — categories pusty, ale slug daje warszawa.
      const r = extractCityDistrict([], 'warszawa');
      assert.equal(r.city, 'Warszawa');
    });
  });

  describe('itemToListing (fixture e2e — REAL Domiporta format)', () => {
    it('filtruje 6 itemów → 3 mieszkania na sprzedaż', async () => {
      const parser = new Parser({
        customFields: { item: [['media:content', 'media', { keepArray: true }]] },
      });
      const feed = await parser.parseString(FIXTURE);
      assert.equal(feed.items.length, 6);

      const listings = feed.items.map(itemToListing).filter(Boolean);
      assert.equal(listings.length, 3);

      // Listing 1 — Warszawa Mokotów (sprzedam mieszkanie)
      const l1 = listings[0];
      assert.equal(l1.source, 'domiporta');
      assert.equal(l1.source_id, '156503731');
      assert.equal(l1.url, 'https://www.domiporta.pl/nieruchomosci/sprzedam-mieszkanie-warszawa-mokotow-65m2/156503731');
      assert.equal(l1.price_pln, 950000);
      assert.equal(l1.area_m2, 65);
      assert.equal(l1.price_per_m2, Math.round(950000 / 65));
      assert.equal(l1.city, 'Warszawa');
      assert.equal(l1.district, 'Mokotów');
      assert.equal(l1.property_type, 'apartment');
      assert.equal(l1.photos.length, 2);
      assert.match(l1.photos[0], /^https:\/\/galeria\.domiporta\.pl\//);

      // Listing 2 — Kraków Stare Miasto
      const l2 = listings[1];
      assert.equal(l2.source_id, '156503734');
      assert.equal(l2.price_pln, 1250000);
      assert.equal(l2.area_m2, 72);
      assert.equal(l2.city, 'Kraków');
      assert.equal(l2.district, 'Stare Miasto');

      // Listing 3 — Gdańsk Wrzeszcz
      const l3 = listings[2];
      assert.equal(l3.source_id, '156503736');
      assert.equal(l3.price_pln, 720000);
      assert.equal(l3.area_m2, 55);
      assert.equal(l3.city, 'Gdańsk');
      assert.equal(l3.district, 'Wrzeszcz');
    });

    it('description = null (RSS ma leak ASP.NET)', async () => {
      const parser = new Parser({
        customFields: { item: [['media:content', 'media', { keepArray: true }]] },
      });
      const feed = await parser.parseString(FIXTURE);
      const l = itemToListing(feed.items[0]);
      assert.equal(l.description, null);
    });
  });

  describe('default export (Source interface)', () => {
    it('eksportuje { name, fetchListings, ... }', () => {
      assert.equal(domiporta.name, 'domiporta');
      assert.equal(typeof domiporta.fetchListings, 'function');
      assert.equal(typeof domiporta.buildFeedUrl, 'function');
    });
  });
});
