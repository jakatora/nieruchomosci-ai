import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { costUsd, MODEL_PRICING } from '../../src/lib/pricing.js';

describe('lib/pricing — MODEL_PRICING dictionary', () => {
  it('zawiera 3 modele Claude 4.x', () => {
    assert.ok(MODEL_PRICING['claude-haiku-4-5'], 'haiku 4.5 musi być');
    assert.ok(MODEL_PRICING['claude-sonnet-4-6'], 'sonnet 4.6 musi być');
    assert.ok(MODEL_PRICING['claude-opus-4-7'], 'opus 4.7 musi być');
  });

  it('każdy model ma {input, output} z liczbami dodatnimi', () => {
    for (const [name, pricing] of Object.entries(MODEL_PRICING)) {
      assert.equal(typeof pricing.input, 'number', `${name}.input musi być number`);
      assert.equal(typeof pricing.output, 'number', `${name}.output musi być number`);
      assert.ok(pricing.input > 0, `${name}.input musi być > 0`);
      assert.ok(pricing.output > 0, `${name}.output musi być > 0`);
    }
  });

  it('output zawsze droższy niż input (model billing pattern)', () => {
    for (const [name, pricing] of Object.entries(MODEL_PRICING)) {
      assert.ok(pricing.output > pricing.input,
        `${name}: output (${pricing.output}) musi być > input (${pricing.input})`);
    }
  });

  it('opus > sonnet > haiku (price ordering)', () => {
    assert.ok(MODEL_PRICING['claude-opus-4-7'].input > MODEL_PRICING['claude-sonnet-4-6'].input);
    assert.ok(MODEL_PRICING['claude-sonnet-4-6'].input > MODEL_PRICING['claude-haiku-4-5'].input);
    assert.ok(MODEL_PRICING['claude-opus-4-7'].output > MODEL_PRICING['claude-sonnet-4-6'].output);
    assert.ok(MODEL_PRICING['claude-sonnet-4-6'].output > MODEL_PRICING['claude-haiku-4-5'].output);
  });
});

describe('lib/pricing — costUsd', () => {
  it('haiku 1M in + 1M out = $1.00 + $5.00 = $6.00', () => {
    assert.equal(costUsd('claude-haiku-4-5', 1_000_000, 1_000_000), 6.0);
  });

  it('sonnet 1M in + 1M out = $3.00 + $15.00 = $18.00', () => {
    assert.equal(costUsd('claude-sonnet-4-6', 1_000_000, 1_000_000), 18.0);
  });

  it('opus 1M in + 1M out = $15.00 + $75.00 = $90.00', () => {
    assert.equal(costUsd('claude-opus-4-7', 1_000_000, 1_000_000), 90.0);
  });

  it('typowy match call haiku: 500 in + 200 out ≈ $0.0015', () => {
    const cost = costUsd('claude-haiku-4-5', 500, 200);
    // 500/1M * 1.0 + 200/1M * 5.0 = 0.0005 + 0.001 = 0.0015
    assert.equal(cost.toFixed(6), '0.001500');
  });

  it('zero tokens → $0', () => {
    assert.equal(costUsd('claude-haiku-4-5', 0, 0), 0);
  });

  it('defaultowe wartości — brak input/output args → $0', () => {
    assert.equal(costUsd('claude-haiku-4-5'), 0);
  });

  it('nieznany model → fallback do haiku pricing', () => {
    // fallback DEFAULT_PRICING = haiku
    const cost = costUsd('nieznany-model', 1_000_000, 1_000_000);
    assert.equal(cost, 6.0);
  });

  it('skala liniowo z tokenami', () => {
    const c1 = costUsd('claude-haiku-4-5', 1000, 500);
    const c2 = costUsd('claude-haiku-4-5', 2000, 1000);
    assert.equal(c2.toFixed(8), (c1 * 2).toFixed(8));
  });

  it('input i output liczone osobno (nie suma)', () => {
    const inputOnly = costUsd('claude-haiku-4-5', 1_000_000, 0);
    const outputOnly = costUsd('claude-haiku-4-5', 0, 1_000_000);
    assert.equal(inputOnly, 1.0); // $1 za 1M input haiku
    assert.equal(outputOnly, 5.0); // $5 za 1M output haiku
  });

  it('realistyczny scenariusz: 200 calli match_scoring + 200 red_flags', () => {
    // 200× match: ~300 in + 100 out each
    let total = 0;
    for (let i = 0; i < 200; i++) total += costUsd('claude-haiku-4-5', 300, 100);
    // 200× red_flags: ~400 in + 200 out
    for (let i = 0; i < 200; i++) total += costUsd('claude-haiku-4-5', 400, 200);
    // = 200 * (0.0003*1 + 0.0001*5) + 200 * (0.0004*1 + 0.0002*5)
    // = 200 * 0.0008 + 200 * 0.0014 = 0.16 + 0.28 = 0.44
    assert.equal(total.toFixed(4), '0.4400');
    // 400 calls × ~$0.0011 average = ~$0.44 — bezpiecznie pod soft limit $200
    assert.ok(total < 200, 'realistyczny daily volume musi być pod soft budget limit');
  });
});
