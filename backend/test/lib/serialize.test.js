import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  publicUser, publicListing, publicMatch, publicInvestorAnalysis,
} from '../../src/lib/serialize.js';

describe('lib/serialize — publicUser', () => {
  it('null → null', () => {
    assert.equal(publicUser(null), null);
    assert.equal(publicUser(undefined), null);
  });

  it('zwraca tylko bezpieczne pola (NIE password_hash, NIE stripe_*)', () => {
    const raw = {
      id: 'u1', email: 'x@y.pl', user_type: 'consumer', premium_tier: 'free',
      home_city: 'Warszawa', search_radius_km: 5,
      notif_email: 1, notif_push: 0,
      created_at: '2026-01-01T00:00:00Z',
      // Te pola NIE mogą wyciec:
      password_hash: 'bcrypt$secret',
      stripe_customer_id: 'cus_xxx',
      stripe_subscription_id: 'sub_xxx',
      push_token: 'ExponentPushToken[secret]',
    };
    const out = publicUser(raw);
    assert.equal(out.id, 'u1');
    assert.equal(out.email, 'x@y.pl');
    assert.equal(out.user_type, 'consumer');
    assert.equal(out.premium_tier, 'free');
    assert.equal(out.home_city, 'Warszawa');
    assert.equal(out.search_radius_km, 5);
    assert.equal(out.notif_email, true);   // 1 → true
    assert.equal(out.notif_push, false);   // 0 → false
    assert.equal(out.created_at, '2026-01-01T00:00:00Z');

    // Krytyczne: te pola NIE mogą być w output.
    assert.ok(!('password_hash' in out), 'password_hash nie powinno wyciec');
    assert.ok(!('stripe_customer_id' in out), 'stripe_customer_id nie powinno wyciec');
    assert.ok(!('stripe_subscription_id' in out), 'stripe_subscription_id nie powinno wyciec');
    assert.ok(!('push_token' in out), 'push_token nie powinno wyciec');
  });

  it('notif_email / notif_push: konwertuje 0/1 na boolean', () => {
    assert.equal(publicUser({ notif_email: 1, notif_push: 1 }).notif_email, true);
    assert.equal(publicUser({ notif_email: 0, notif_push: 0 }).notif_push, false);
    assert.equal(publicUser({ notif_email: null }).notif_email, false);
    assert.equal(publicUser({ notif_email: undefined }).notif_email, false);
  });
});

describe('lib/serialize — publicListing', () => {
  it('null → null', () => {
    assert.equal(publicListing(null), null);
  });

  it('photos jako stringified JSON jest parsowane', () => {
    const out = publicListing({
      id: 'l1', source: 'domiporta', source_id: '12345',
      photos: '["https://img1.jpg","https://img2.jpg"]',
    });
    assert.deepEqual(out.photos, ['https://img1.jpg', 'https://img2.jpg']);
  });

  it('photos jako już-array zostaje array', () => {
    const out = publicListing({ photos: ['a', 'b'] });
    assert.deepEqual(out.photos, ['a', 'b']);
  });

  it('photos invalid JSON → []', () => {
    assert.deepEqual(publicListing({ photos: 'not-json' }).photos, []);
    assert.deepEqual(publicListing({ photos: null }).photos, []);
    assert.deepEqual(publicListing({ photos: undefined }).photos, []);
  });

  it('NIE zwraca raw_data (zbędny payload + wycieka oryginał z portalu)', () => {
    const raw = {
      id: 'l1', title: 'X',
      raw_data: { guid: '...', pubDate: '...', secret_field: 'leak' },
    };
    const out = publicListing(raw);
    assert.ok(!('raw_data' in out), 'raw_data nie powinno wyciec do API');
  });

  it('source_id JEST eksportowane (mobile go używa do deep-linkowania)', () => {
    const out = publicListing({ id: 'l1', source: 'domiporta', source_id: '156503590' });
    assert.equal(out.source_id, '156503590');
  });

  it('wszystkie pola listing (smoke)', () => {
    const raw = {
      id: 'l1', source: 'domiporta', source_id: '12345', url: 'https://...',
      title: 'Mokotów 50m²', description: 'opis',
      price_pln: 800000, area_m2: 50, price_per_m2: 16000,
      rooms: 2, floor: 3, building_year: 2015,
      market: 'secondary', property_type: 'apartment',
      city: 'Warszawa', district: 'Mokotów', street: 'Puławska',
      lat: 52.2, lng: 21.0, photos: '[]',
      published_at: '2026-01-01', status: 'active',
    };
    const out = publicListing(raw);
    assert.equal(out.title, 'Mokotów 50m²');
    assert.equal(out.price_pln, 800000);
    assert.equal(out.area_m2, 50);
    assert.equal(out.price_per_m2, 16000);
    assert.equal(out.city, 'Warszawa');
    assert.equal(out.district, 'Mokotów');
    assert.equal(out.lat, 52.2);
    assert.equal(out.lng, 21.0);
    assert.equal(out.status, 'active');
  });
});

describe('lib/serialize — publicMatch', () => {
  it('null → null', () => {
    assert.equal(publicMatch(null), null);
  });

  it('mapuje JOIN row z listing_* prefixami na nested listing object', () => {
    const row = {
      id: 'm1', user_id: 'u1', confidence_score: 78,
      match_reasoning: 'Świetny match', price_fairness: 'below',
      fairness_delta_pct: -15.5, red_flags: '[]', scorer: 'ai',
      user_seen: 0, user_saved: 1,
      created_at: '2026-01-01T00:00:00Z',
      listing_id: 'l1', listing_source: 'domiporta',
      listing_url: 'https://...', listing_title: 'Mokotów',
      listing_price_pln: 800000, listing_area_m2: 50,
      listing_price_per_m2: 16000, listing_rooms: 2,
      listing_city: 'Warszawa', listing_district: 'Mokotów',
      listing_lat: 52.2, listing_lng: 21.0,
      listing_photos: '["https://img.jpg"]',
      listing_published_at: '2026-01-01',
    };
    const out = publicMatch(row);
    assert.equal(out.id, 'm1');
    assert.equal(out.confidence_score, 78);
    assert.equal(out.reasoning, 'Świetny match'); // alias match_reasoning → reasoning
    assert.equal(out.price_fairness, 'below');
    assert.equal(out.user_seen, false);
    assert.equal(out.user_saved, true);
    assert.equal(out.listing.id, 'l1');
    assert.equal(out.listing.title, 'Mokotów');
    assert.equal(out.listing.price_pln, 800000);
    assert.equal(out.listing.lat, 52.2);
    assert.deepEqual(out.listing.photos, ['https://img.jpg']);
  });

  it('listing: null gdy listing_id brak', () => {
    const out = publicMatch({ id: 'm1', confidence_score: 60, red_flags: '[]' });
    assert.equal(out.listing, null);
  });

  it('red_flags jako string JSON jest parsowane na array', () => {
    const out = publicMatch({
      id: 'm1', confidence_score: 60,
      red_flags: '[{"type":"price_vs_market","severity":"high","text":"drogo"}]',
    });
    assert.equal(out.red_flags.length, 1);
    assert.equal(out.red_flags[0].type, 'price_vs_market');
    assert.equal(out.red_flags[0].severity, 'high');
  });

  it('red_flags invalid → []', () => {
    assert.deepEqual(publicMatch({ red_flags: 'not-json' }).red_flags, []);
    assert.deepEqual(publicMatch({ red_flags: null }).red_flags, []);
  });
});

describe('lib/serialize — publicInvestorAnalysis', () => {
  it('null → null', () => {
    assert.equal(publicInvestorAnalysis(null), null);
  });

  it('zaokrągla wartości procentowe do 2 miejsc po przecinku', () => {
    const out = publicInvestorAnalysis({
      listing_id: 'l1', estimated_rent: 3500,
      yield_gross_pct: 5.81666666, yield_net_pct: 5.0612345,
      payback_years: 17.234567, cashflow_monthly: -736.4567,
      rent_source: 'heuristic_v1:Warszawa@2026-Q1',
      assumptions: '{"vacancyPct":5,"mortgageRatePct":7}',
      computed_at: '2026-01-01T00:00:00Z',
    });
    assert.equal(out.yield_gross_pct, 5.82);
    assert.equal(out.yield_net_pct, 5.06);
    assert.equal(out.payback_years, 17.23);
    assert.equal(out.cashflow_monthly, -736.46);
  });

  it('assumptions jako string JSON jest parsowane', () => {
    const out = publicInvestorAnalysis({
      listing_id: 'l1',
      assumptions: '{"vacancyPct":5,"mgmtCostPct":8,"mortgageRatePct":7}',
    });
    assert.equal(out.assumptions.vacancyPct, 5);
    assert.equal(out.assumptions.mgmtCostPct, 8);
    assert.equal(out.assumptions.mortgageRatePct, 7);
  });

  it('assumptions jako już-obiekt zostaje obiekt', () => {
    const out = publicInvestorAnalysis({
      listing_id: 'l1', assumptions: { vacancyPct: 10 },
    });
    assert.equal(out.assumptions.vacancyPct, 10);
  });

  it('assumptions invalid JSON → fallback {}', () => {
    const out = publicInvestorAnalysis({
      listing_id: 'l1', assumptions: 'not-json',
    });
    assert.deepEqual(out.assumptions, {});
  });

  it('rent_source przekazany 1:1 (do UI explainability)', () => {
    const out = publicInvestorAnalysis({
      listing_id: 'l1', rent_source: 'heuristic_v1:Warszawa/Mokotów@2026-Q1',
    });
    assert.equal(out.rent_source, 'heuristic_v1:Warszawa/Mokotów@2026-Q1');
  });

  it('payback_years dla Infinity zostaje Infinity (gdy rent = 0)', () => {
    const out = publicInvestorAnalysis({
      listing_id: 'l1', payback_years: Infinity,
    });
    // round2 zostawia Infinity bo !Number.isFinite
    assert.equal(out.payback_years, Infinity);
  });
});
