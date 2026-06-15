// Tests dla mobile/src/utils/format.ts — implementacja czysto JS, łatwa do testowania.
// Plik leży w backend/test/ żeby dzielić node:test runner; importujemy logikę zduplikowaną
// inline (pure functions, no deps).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Zduplikowana implementacja (mobile/src/utils/format.ts) — TS-stripped JS.
function formatPLN(amount) {
  if (amount == null || !Number.isFinite(amount)) return '—';
  return `${amount.toLocaleString('pl-PL')} PLN`;
}
function formatNumber(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toLocaleString('pl-PL');
}
function formatPricePerM2(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value.toLocaleString('pl-PL')} PLN/m²`;
}
function formatArea(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value} m²`;
}
function formatPercent(value, decimals = 1) {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}%`;
}
function truncate(text, max) {
  if (!text) return '';
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}

describe('mobile/utils/format — formatPLN', () => {
  it('format PL z separatorem tysięcy', () => {
    // toLocaleString PL używa NBSP ( ) jako separator
    const r = formatPLN(950000);
    assert.ok(r.includes('PLN'));
    assert.ok(r.match(/950[\s ]000/), `oczekiwany separator: "${r}"`);
  });

  it('null → "—"', () => {
    assert.equal(formatPLN(null), '—');
    assert.equal(formatPLN(undefined), '—');
  });

  it('NaN/Infinity → "—"', () => {
    assert.equal(formatPLN(NaN), '—');
    assert.equal(formatPLN(Infinity), '—');
  });

  it('zero → "0 PLN"', () => {
    assert.equal(formatPLN(0), '0 PLN');
  });
});

describe('mobile/utils/format — formatPricePerM2', () => {
  it('liczba → "X PLN/m²"', () => {
    const r = formatPricePerM2(16000);
    assert.match(r, /16[\s ]000 PLN\/m²/);
  });

  it('null → "—"', () => {
    assert.equal(formatPricePerM2(null), '—');
  });
});

describe('mobile/utils/format — formatArea', () => {
  it('liczba → "X m²"', () => {
    assert.equal(formatArea(65), '65 m²');
    assert.equal(formatArea(50.5), '50.5 m²');
  });

  it('null → "—"', () => {
    assert.equal(formatArea(null), '—');
  });
});

describe('mobile/utils/format — formatPercent', () => {
  it('positive z plus sign', () => {
    assert.equal(formatPercent(12.5), '+12.5%');
  });

  it('negative bez plus', () => {
    assert.equal(formatPercent(-5.3), '-5.3%');
  });

  it('zero bez sign', () => {
    assert.equal(formatPercent(0), '0.0%');
  });

  it('custom decimals', () => {
    assert.equal(formatPercent(12.34567, 2), '+12.35%');
    assert.equal(formatPercent(12.34567, 0), '+12%');
  });

  it('null/NaN → "—"', () => {
    assert.equal(formatPercent(null), '—');
    assert.equal(formatPercent(NaN), '—');
  });
});

describe('mobile/utils/format — formatNumber', () => {
  it('liczba bez waluty', () => {
    assert.match(formatNumber(1234567), /1[\s ]234[\s ]567/);
  });

  it('null → "—"', () => {
    assert.equal(formatNumber(null), '—');
  });
});

describe('mobile/utils/format — truncate', () => {
  it('text krótszy niż max → bez zmian', () => {
    assert.equal(truncate('short', 10), 'short');
  });

  it('text dłuższy → obcięty z "…"', () => {
    assert.equal(truncate('this is a long text', 10), 'this is a…');
  });

  it('text dokładnie max → bez zmian', () => {
    assert.equal(truncate('exactly10!', 10), 'exactly10!');
  });

  it('null/empty → ""', () => {
    assert.equal(truncate(null, 10), '');
    assert.equal(truncate('', 10), '');
    assert.equal(truncate(undefined, 10), '');
  });
});
