import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Parser from 'rss-parser';
import olx, {
  buildFeedUrl,
  parseDescription,
  itemToListing,
} from '../../src/services/sources/olx-properties.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'olx-rss-sample.xml'), 'utf8');

describe('sources/olx-properties', () => {
  describe('buildFeedUrl', () => {
    it('tworzy URL z polskimi znakami zamienionymi na ASCII (warszawa)', () => {
      const url = buildFeedUrl({ city: 'Warszawa' });
      assert.match(url, /\/warszawa\//);
      assert.match(url, /search%5Bview%5D=rss/);
    });

    it('transliteruje Łódź → lodz', () => {
      const url = buildFeedUrl({ city: 'Łódź' });
      assert.match(url, /\/lodz\//);
    });

    it('dodaje filtr ceny i pokoi', () => {
      const url = buildFeedUrl({ city: 'Kraków', minPrice: 300000, maxPrice: 600000, rooms: [1, 2] });
      assert.match(url, /filter_float_price%3Afrom%5D=300000/);
      assert.match(url, /filter_float_price%3Ato%5D=600000/);
      assert.match(url, /filter_enum_rooms/);
    });

    it('rzuca błąd gdy brak city', () => {
      assert.throws(() => buildFeedUrl({}), /city/);
    });
  });

  describe('parseDescription', () => {
    it('wyciąga cenę "850 000 zł"', () => {
      const r = parseDescription('Cena: 850 000 zł. Powierzchnia: 48 m².');
      assert.equal(r.price_pln, 850000);
    });

    it('wyciąga cenę z formatu PLN', () => {
      const r = parseDescription('Cena 680 000 PLN. 72 m kw.');
      assert.equal(r.price_pln, 680000);
      assert.equal(r.area_m2, 72);
    });

    it('wyciąga powierzchnię i pokoje', () => {
      const r = parseDescription('Mieszkanie 2-pokojowe 48 m². 2 pokoje.');
      assert.equal(r.area_m2, 48);
      assert.equal(r.rooms, 2);
    });

    it('wyciąga zdjęcia z <img src="...">', () => {
      const r = parseDescription('<img src="https://a.com/1.jpg"/><img src="https://a.com/2.jpg"/>');
      assert.deepEqual(r.photos, ['https://a.com/1.jpg', 'https://a.com/2.jpg']);
    });

    it('zwraca puste pola gdy brak danych', () => {
      const r = parseDescription('Mieszkanie do negocjacji — zapytaj o cenę.');
      assert.equal(r.price_pln, null);
      assert.equal(r.area_m2, null);
      assert.equal(r.rooms, null);
      assert.deepEqual(r.photos, []);
    });

    it('strip HTML zachowuje tekst', () => {
      const r = parseDescription('<p>Cena <b>500 000 zł</b></p><br/>50 m²');
      assert.match(r.description, /Cena/);
      assert.match(r.description, /500 000/);
      assert.equal(r.price_pln, 500000);
    });
  });

  describe('itemToListing (fixture e2e)', () => {
    it('parsuje 4 itemy z fixture RSS i normalizuje', async () => {
      const parser = new Parser();
      const feed = await parser.parseString(FIXTURE);
      assert.equal(feed.items.length, 4);

      const listings = feed.items
        .map((item) => itemToListing(item, { city: 'warszawa' }))
        .filter(Boolean);

      assert.equal(listings.length, 4);

      // Item 1: Mokotów, 850k, 48m², 2 pokoje
      const l1 = listings[0];
      assert.equal(l1.source, 'olx');
      assert.equal(l1.source_id, '12345');
      assert.equal(l1.price_pln, 850000);
      assert.equal(l1.area_m2, 48);
      assert.equal(l1.price_per_m2, Math.round(850000 / 48));
      assert.equal(l1.rooms, 2);
      assert.equal(l1.city, 'warszawa');
      assert.equal(l1.photos.length, 2);

      // Item 2: Wola, 525k, 28m², 1 pokój
      const l2 = listings[1];
      assert.equal(l2.source_id, '67890');
      assert.equal(l2.price_pln, 525000);
      assert.equal(l2.area_m2, 28);
      assert.equal(l2.rooms, 1);

      // Item 3: Bemowo, 680k, 72m² (m kw. notation), 3 pokoje
      const l3 = listings[2];
      assert.equal(l3.source_id, '54321');
      assert.equal(l3.price_pln, 680000);
      assert.equal(l3.area_m2, 72);
      assert.equal(l3.rooms, 3);

      // Item 4: bez ceny — area jest, price null, price_per_m2 null
      const l4 = listings[3];
      assert.equal(l4.source_id, '99999');
      assert.equal(l4.price_pln, null);
      assert.equal(l4.area_m2, 55);
      assert.equal(l4.price_per_m2, null);
    });
  });

  describe('default export (Source interface)', () => {
    it('eksportuje { name, fetchListings, ... }', () => {
      assert.equal(olx.name, 'olx');
      assert.equal(typeof olx.fetchListings, 'function');
      assert.equal(typeof olx.buildFeedUrl, 'function');
    });
  });
});
