import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseLimit, parseOffset, parseBool } from '../../src/lib/queryHelpers.js';

describe('lib/queryHelpers — parseLimit', () => {
  it('liczba w zakresie → bez zmian', () => {
    assert.equal(parseLimit('20', { default: 50, max: 100 }), 20);
    assert.equal(parseLimit('50', { default: 50, max: 100 }), 50);
  });

  it('limituje do max', () => {
    assert.equal(parseLimit('999', { default: 50, max: 100 }), 100);
    assert.equal(parseLimit('500000', { default: 50, max: 500 }), 500);
  });

  it('undefined/null → default', () => {
    assert.equal(parseLimit(undefined, { default: 50, max: 500 }), 50);
    assert.equal(parseLimit(null, { default: 50, max: 500 }), 50);
  });

  it('nieparsowalny string → default', () => {
    assert.equal(parseLimit('abc', { default: 50, max: 500 }), 50);
    assert.equal(parseLimit('', { default: 50, max: 500 }), 50);
  });

  it('zero / negatywne → default (defensive)', () => {
    assert.equal(parseLimit('0', { default: 50, max: 500 }), 50);
    assert.equal(parseLimit('-10', { default: 50, max: 500 }), 50);
  });

  it('zachowuje min jako floor', () => {
    assert.equal(parseLimit('1', { default: 50, max: 500, min: 5 }), 5);
  });

  it('default options (50/500/1)', () => {
    assert.equal(parseLimit('20'), 20);
    assert.equal(parseLimit('1000'), 500); // max cap
    assert.equal(parseLimit(undefined), 50); // default
  });
});

describe('lib/queryHelpers — parseOffset', () => {
  it('liczba ≥ 0 → bez zmian', () => {
    assert.equal(parseOffset('0'), 0);
    assert.equal(parseOffset('100'), 100);
  });

  it('undefined/null → 0', () => {
    assert.equal(parseOffset(undefined), 0);
    assert.equal(parseOffset(null), 0);
  });

  it('negatywne → 0 (defensive)', () => {
    assert.equal(parseOffset('-10'), 0);
  });

  it('limituje do max (default 100k)', () => {
    assert.equal(parseOffset('999999999'), 100_000);
  });

  it('custom max', () => {
    assert.equal(parseOffset('5000', { max: 1000 }), 1000);
  });

  it('nieparsowalny → default', () => {
    assert.equal(parseOffset('abc'), 0);
    assert.equal(parseOffset('abc', { default: 99 }), 99);
  });
});

describe('lib/queryHelpers — parseBool', () => {
  it('truthy strings → true', () => {
    assert.equal(parseBool('1'), true);
    assert.equal(parseBool('true'), true);
    assert.equal(parseBool('True'), true);
    assert.equal(parseBool('yes'), true);
    assert.equal(parseBool('Y'), true);
    assert.equal(parseBool('ON'), true);
  });

  it('falsy strings → false', () => {
    assert.equal(parseBool('0'), false);
    assert.equal(parseBool('false'), false);
    assert.equal(parseBool('no'), false);
    assert.equal(parseBool('N'), false);
    assert.equal(parseBool('off'), false);
  });

  it('null/undefined → default', () => {
    assert.equal(parseBool(undefined), false);
    assert.equal(parseBool(null), false);
    assert.equal(parseBool(null, true), true);
  });

  it('nieznany string → default', () => {
    assert.equal(parseBool('maybe', false), false);
    assert.equal(parseBool('maybe', true), true);
  });
});
