import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeROI,
  estimateRent,
  mortgageMonthly,
} from '../../src/services/roi.js';
import { getRentRate, RENT_RATES_VERSION } from '../../src/config/rent-rates.js';

describe('services/roi', () => {
  describe('getRentRate (lookup w słowniku)', () => {
    it('Warszawa Mokotów: konkretna stawka dzielnicy', () => {
      const r = getRentRate('Warszawa', 'Mokotów');
      assert.equal(r.rate, 75);
      assert.match(r.source, /Warszawa\/Mokotów/);
      assert.match(r.source, new RegExp(RENT_RATES_VERSION));
    });

    it('Warszawa bez dzielnicy: city _default', () => {
      const r = getRentRate('Warszawa', null);
      assert.equal(r.rate, 70);
      assert.match(r.source, /Warszawa@/);
      assert.doesNotMatch(r.source, /\//);
    });

    it('Warszawa z nieznaną dzielnicą: fallback do city _default', () => {
      const r = getRentRate('Warszawa', 'NieistniejącaDzielnica');
      assert.equal(r.rate, 70);
    });

    it('Nieznane miasto: globalny _fallback', () => {
      const r = getRentRate('MałeMiasteczko', null);
      assert.equal(r.rate, 38);
      assert.match(r.source, /_fallback/);
    });

    it('Kraków Stare Miasto: 85 PLN/m²', () => {
      assert.equal(getRentRate('Kraków', 'Stare Miasto').rate, 85);
    });
  });

  describe('estimateRent', () => {
    it('Warszawa Mokotów 50 m² → 75 × 50 = 3750 PLN/mc', () => {
      const r = estimateRent({ city: 'Warszawa', district: 'Mokotów', area_m2: 50 });
      assert.equal(r.estimatedRent, 3750);
      assert.equal(r.ratePerM2, 75);
    });

    it('Gdańsk Wrzeszcz 60 m² (district nie w słowniku, używa _default 60)', () => {
      const r = estimateRent({ city: 'Gdańsk', district: 'Wrzeszcz', area_m2: 60 });
      // Wrzeszcz w słowniku = 65
      assert.equal(r.estimatedRent, 65 * 60);
    });

    it('brak area_m2 → 0 + no_area source', () => {
      const r = estimateRent({ city: 'Warszawa', district: 'Mokotów' });
      assert.equal(r.estimatedRent, 0);
      assert.match(r.source, /no_area/);
    });

    it('area_m2 = 0 → 0', () => {
      const r = estimateRent({ city: 'Warszawa', area_m2: 0 });
      assert.equal(r.estimatedRent, 0);
    });
  });

  describe('mortgageMonthly (annuity formula)', () => {
    it('600k loan, 7%, 30 lat → realny zakres ~4000 PLN/mc', () => {
      const m = mortgageMonthly(600000, 7, 30);
      // PMT = 600000 × 0.005833 × (1.005833^360) / ((1.005833^360) - 1)
      // ≈ 600000 × 0.006653 ≈ 3992
      assert.ok(m > 3900 && m < 4100, `oczekiwane ~4000, jest ${m}`);
    });

    it('0% rate → loan/months', () => {
      const m = mortgageMonthly(360000, 0, 30);
      assert.equal(m, 1000); // 360000 / (30×12)
    });

    it('loanAmount = 0 → 0', () => {
      assert.equal(mortgageMonthly(0, 7, 30), 0);
    });

    it('years = 0 → loanAmount (pełna spłata w 1 racie)', () => {
      assert.equal(mortgageMonthly(100000, 7, 0), 100000);
    });
  });

  describe('computeROI (full pipeline)', () => {
    const wMokotowListing = {
      id: 'test-listing-1',
      city: 'Warszawa',
      district: 'Mokotów',
      price_pln: 950000,
      area_m2: 65,
    };

    it('Warszawa Mokotów 65m² @ 950k zwraca pełen obiekt ROI', () => {
      const r = computeROI(wMokotowListing);
      assert.ok(r);
      // Mokotów rate = 75 → rent = 75 × 65 = 4875 PLN/mc
      assert.equal(r.estimated_rent, 4875);
      assert.equal(r.rent_source, `heuristic_v1:Warszawa/Mokotów@${RENT_RATES_VERSION}`);

      // yield gross = 4875×12 / 950000 × 100 = 6.158%
      assert.ok(Math.abs(r.yield_gross_pct - 6.158) < 0.01);

      // yield net (vacancy 5%, mgmt 8%, factor 0.87): 4875×12×0.87 / 950000 × 100 = 5.357%
      assert.ok(Math.abs(r.yield_net_pct - 5.357) < 0.01);

      // payback = 950000 / (4875×12) = 16.24 lat
      assert.ok(Math.abs(r.payback_years - 16.24) < 0.05);

      // assumptions z env defaults
      assert.equal(r.assumptions.vacancyPct, 5);
      assert.equal(r.assumptions.mgmtCostPct, 8);
      assert.equal(r.assumptions.mortgageRatePct, 7);
      assert.equal(r.assumptions.downPaymentPct, 20);
      assert.equal(r.assumptions.mortgageYears, 30);
    });

    it('cashflow_monthly = rent_net - rata_kredytu (może być ujemny)', () => {
      const r = computeROI(wMokotowListing);
      // loan = 950000 × 0.8 = 760000
      // rata @ 7% / 30y ≈ 5057 PLN
      // rent_net = 4875 × 0.87 = 4241
      // cashflow = 4241 - 5057 ≈ -816 PLN/mc (typowy ujemny cashflow przy 20% wkładu i wysokim ratesie)
      assert.ok(r.cashflow_monthly < 0, `oczekiwano ujemny cashflow, jest ${r.cashflow_monthly}`);
      assert.ok(r.cashflow_monthly > -1500);
    });

    it('customRent override pomija słownik', () => {
      const r = computeROI(wMokotowListing, { customRent: 6000 });
      assert.equal(r.estimated_rent, 6000);
      assert.equal(r.rent_source, 'user_override');
    });

    it('override mortgageRate 0% → wyższy cashflow', () => {
      const baseline = computeROI(wMokotowListing);
      const noRate = computeROI(wMokotowListing, { mortgageRatePct: 0 });
      assert.ok(noRate.cashflow_monthly > baseline.cashflow_monthly);
    });

    it('override downPayment 100% (cash) → dodatni cashflow (zero raty)', () => {
      const r = computeROI(wMokotowListing, { downPaymentPct: 100 });
      // loan = 0 → rata = 0 → cashflow = rent_net
      const expectedCf = 4875 * (1 - 0.05 - 0.08);
      assert.ok(Math.abs(r.cashflow_monthly - expectedCf) < 1);
    });

    it('brak price_pln → null', () => {
      assert.equal(computeROI({ city: 'Warszawa', area_m2: 50 }), null);
      assert.equal(computeROI({ price_pln: 0, area_m2: 50 }), null);
    });

    it('brak area_m2 → null', () => {
      assert.equal(computeROI({ city: 'Warszawa', price_pln: 500000 }), null);
      assert.equal(computeROI({ price_pln: 500000, area_m2: 0 }), null);
    });
  });

  describe('sanity check — realistyczne zakresy dla 2026 PL', () => {
    it('Mokotów 65m² @ 950k: yield_net w realistycznym zakresie 4-7%', () => {
      const r = computeROI({ city: 'Warszawa', district: 'Mokotów', price_pln: 950000, area_m2: 65 });
      assert.ok(r.yield_net_pct >= 4 && r.yield_net_pct <= 7,
        `yield_net ${r.yield_net_pct}% poza zakresem 4-7%`);
    });

    it('Łódź Bałuty 50m² @ 350k: yield_net w realistycznym zakresie 4-6%', () => {
      const r = computeROI({ city: 'Łódź', district: 'Bałuty', price_pln: 350000, area_m2: 50 });
      // 35 PLN/m² × 50 = 1750 PLN/mc → roczny 21000 → 6% gross
      assert.ok(r.yield_net_pct >= 4 && r.yield_net_pct <= 6);
    });

    it('Bardzo drogie centrum (Warszawa Śródmieście) ma niski yield', () => {
      const central = computeROI({ city: 'Warszawa', district: 'Śródmieście', price_pln: 2500000, area_m2: 80 });
      const cheaper = computeROI({ city: 'Warszawa', district: 'Białołęka', price_pln: 600000, area_m2: 50 });
      // Drogi metr w Śródmieściu zwykle niższy yield niż tanie Białołęka.
      assert.ok(cheaper.yield_gross_pct > central.yield_gross_pct,
        `Białołęka yield ${cheaper.yield_gross_pct}% powinien > Śródmieście ${central.yield_gross_pct}%`);
    });
  });
});
