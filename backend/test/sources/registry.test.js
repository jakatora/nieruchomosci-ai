import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getSource, listSources, enabledSources } from '../../src/services/sources/index.js';

describe('sources/index — registry', () => {
  describe('getSource', () => {
    it('zwraca Domiporta adapter', () => {
      const src = getSource('domiporta');
      assert.equal(src.name, 'domiporta');
      assert.equal(typeof src.fetchListings, 'function');
      assert.equal(typeof src.buildFeedUrl, 'function');
    });

    it('zwraca OLX adapter (zachowany jako reference)', () => {
      const src = getSource('olx');
      assert.equal(src.name, 'olx');
      assert.equal(typeof src.fetchListings, 'function');
    });

    it('rzuca dla nieznanego źródła z listą dostępnych', () => {
      assert.throws(
        () => getSource('nieistnieje'),
        /Nieznane źródło ogłoszeń: "nieistnieje"\. Dostępne: domiporta, olx/,
      );
    });

    it('rzuca dla pustej nazwy', () => {
      assert.throws(() => getSource(''), /Nieznane źródło/);
    });

    it('rzuca dla null/undefined', () => {
      assert.throws(() => getSource(null), /Nieznane źródło/);
      assert.throws(() => getSource(undefined), /Nieznane źródło/);
    });
  });

  describe('listSources', () => {
    it('zwraca array of registered sources', () => {
      const all = listSources();
      assert.ok(Array.isArray(all));
      assert.equal(all.length, 2); // domiporta + olx (MVP)
    });

    it('każdy source ma interface {name, fetchListings, buildFeedUrl}', () => {
      for (const src of listSources()) {
        assert.equal(typeof src.name, 'string');
        assert.equal(typeof src.fetchListings, 'function');
        assert.equal(typeof src.buildFeedUrl, 'function');
      }
    });

    it('nazwy są unikalne (no duplicates w registry)', () => {
      const names = listSources().map((s) => s.name);
      const unique = new Set(names);
      assert.equal(names.length, unique.size);
    });

    it('Domiporta jest pierwsza (primary MVP source per DEC-007)', () => {
      const all = listSources();
      assert.equal(all[0].name, 'domiporta');
    });
  });

  describe('enabledSources', () => {
    it('filtruje na podstawie CSV listy z env.SOURCES_ENABLED', () => {
      const result = enabledSources(['domiporta']);
      assert.equal(result.length, 1);
      assert.equal(result[0].name, 'domiporta');
    });

    it('zwraca wiele gdy więcej włączonych', () => {
      const result = enabledSources(['domiporta', 'olx']);
      assert.equal(result.length, 2);
    });

    it('ignoruje nieznane nazwy (graceful)', () => {
      const result = enabledSources(['domiporta', 'nieistnieje']);
      assert.equal(result.length, 1);
      assert.equal(result[0].name, 'domiporta');
    });

    it('pusty input → pusty array', () => {
      assert.deepEqual(enabledSources([]), []);
    });

    it('null input → graceful (zwraca [], nie throw — Iter 15 defensive fix)', () => {
      assert.deepEqual(enabledSources(null), []);
      assert.deepEqual(enabledSources(undefined), []);
    });

    it('non-array input → graceful empty (Iter 15)', () => {
      assert.deepEqual(enabledSources('domiporta'), []);  // string ≠ array
      assert.deepEqual(enabledSources({}), []);
      assert.deepEqual(enabledSources(42), []);
    });

    it('zachowuje kolejność z input list (deterministic order dla cron)', () => {
      const result = enabledSources(['olx', 'domiporta']);
      assert.equal(result[0].name, 'olx');
      assert.equal(result[1].name, 'domiporta');
    });
  });

  describe('registerSource (Iter 38 — testing + v2 plugin extensions)', () => {
    it('rejestruje nowe źródło + getSource znajduje', async () => {
      const { registerSource } = await import('../../src/services/sources/index.js');
      const customSource = {
        name: 'custom-test-1',
        fetchListings: async () => [],
      };
      const unregister = registerSource(customSource);
      assert.equal(getSource('custom-test-1'), customSource);
      unregister(); // cleanup
    });

    it('cleanup function usuwa source z registry', async () => {
      const { registerSource } = await import('../../src/services/sources/index.js');
      const customSource = { name: 'custom-test-2', fetchListings: async () => [] };
      const unregister = registerSource(customSource);
      unregister();
      assert.throws(() => getSource('custom-test-2'), /Nieznane źródło/);
    });

    it('rejestracja na istniejące źródło → cleanup PRZYWRACA poprzednie', async () => {
      const { registerSource } = await import('../../src/services/sources/index.js');
      const orig = getSource('domiporta');
      const fakeDomiporta = { name: 'domiporta', fetchListings: async () => [] };
      const unregister = registerSource(fakeDomiporta);
      assert.equal(getSource('domiporta'), fakeDomiporta);
      unregister();
      assert.equal(getSource('domiporta'), orig, 'oryginalna domiporta przywrócona');
    });

    it('rzuca gdy source nie ma name', async () => {
      const { registerSource } = await import('../../src/services/sources/index.js');
      assert.throws(() => registerSource({ fetchListings: async () => [] }), /name, fetchListings/);
    });

    it('rzuca gdy source nie ma fetchListings function', async () => {
      const { registerSource } = await import('../../src/services/sources/index.js');
      assert.throws(() => registerSource({ name: 'x', fetchListings: 'not-a-fn' }), /name, fetchListings/);
      assert.throws(() => registerSource({ name: 'x' }), /name, fetchListings/);
    });

    it('rzuca gdy null/undefined source', async () => {
      const { registerSource } = await import('../../src/services/sources/index.js');
      assert.throws(() => registerSource(null));
      assert.throws(() => registerSource(undefined));
    });
  });
});
