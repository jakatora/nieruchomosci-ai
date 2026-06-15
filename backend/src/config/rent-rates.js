/**
 * Stawki czynszu najmu mieszkań [PLN / m² / miesiąc] dla głównych miast PL.
 *
 * ŹRÓDŁA (zgrubne — orientacja MVP):
 *   - Otodom raporty rynku najmu 2024-2025
 *   - GUS Bank Danych Lokalnych — średnie czynsze w sektorze rynkowym
 *   - PFR Nieruchomości — raporty cen i czynszów (publiczne)
 *   - Numbeo Cost of Living (cross-check)
 *
 * DEC-005 w decisions.md: heurystyka, NIE AI prediction. User ufa tym liczbom
 * przy decyzji o inwestycji 300-800k PLN — lepiej pokazać "szacunek na bazie
 * raportu z 2025-Q4" niż halucynować przez LLM.
 *
 * OSTATNIA AKTUALIZACJA: 2026-05-23 (przed pierwszym deployem MVP).
 * REKOMENDACJA: aktualizować raz na kwartał, śledzić Otodom raporty.
 *
 * STRUKTURA:
 *   ratesPerCity['Warszawa'] = { _default: 70, _districts: { 'Mokotów': 75, ... } }
 *   ratesPerCity._fallback = 45  (gdy miasto nieznane)
 *
 * Dla brakującej dzielnicy używamy `_default` miasta. Dla brakującego miasta —
 * `_fallback`. UI ZAWSZE pokazuje user'owi że to estymata + jej źródło.
 */

const ratesPerCity = {
  Warszawa: {
    _default: 70,
    _districts: {
      'Śródmieście': 95,
      'Mokotów': 75,
      'Wola': 80,
      'Wilanów': 80,
      'Ochota': 75,
      'Żoliborz': 75,
      'Praga-Południe': 65,
      'Praga-Północ': 60,
      'Bemowo': 60,
      'Bielany': 60,
      'Ursynów': 65,
      'Targówek': 55,
      'Ursus': 55,
      'Włochy': 60,
      'Białołęka': 50,
      'Wawer': 55,
      'Wesoła': 50,
      'Rembertów': 50,
    },
  },
  Kraków: {
    _default: 60,
    _districts: {
      'Stare Miasto': 85,
      'Grzegórzki': 70,
      'Krowodrza': 65,
      'Prądnik Biały': 60,
      'Prądnik Czerwony': 60,
      'Zwierzyniec': 70,
      'Łobzów': 65,
      'Salwator': 75,
      'Bronowice': 60,
      'Dębniki': 60,
      'Podgórze': 60,
      'Kazimierz': 75,
      'Nowa Huta': 45,
      'Bieżanów-Prokocim': 50,
      'Wzgórza Krzesławickie': 45,
    },
  },
  Wrocław: {
    _default: 55,
    _districts: {
      'Stare Miasto': 80,
      'Śródmieście': 65,
      'Krzyki': 55,
      'Fabryczna': 50,
      'Psie Pole': 45,
      'Sępolno': 55,
      'Borek': 60,
      'Karłowice': 50,
    },
  },
  Gdańsk: {
    _default: 60,
    _districts: {
      'Śródmieście': 80,
      'Wrzeszcz': 65,
      'Oliwa': 65,
      'Przymorze': 60,
      'Zaspa': 55,
      'Brzeźno': 55,
      'Stogi': 45,
      'Nowy Port': 45,
      'Orunia': 40,
    },
  },
  Poznań: {
    _default: 50,
    _districts: {
      'Stare Miasto': 65,
      'Jeżyce': 55,
      'Wilda': 50,
      'Grunwald': 55,
      'Nowe Miasto': 45,
      'Stary Browar': 60,
    },
  },
  Łódź: {
    _default: 40,
    _districts: {
      'Śródmieście': 50,
      'Bałuty': 35,
      'Polesie': 40,
      'Górna': 35,
      'Widzew': 38,
    },
  },
  Katowice: {
    _default: 45,
    _districts: {
      'Śródmieście': 55,
      'Ligota': 45,
      'Brynów': 50,
      'Wełnowiec': 40,
    },
  },
  Szczecin: {
    _default: 45,
    _districts: {
      'Śródmieście': 55,
      'Pogodno': 50,
      'Niebuszewo': 40,
      'Dąbie': 40,
    },
  },
  Bydgoszcz: { _default: 40, _districts: {} },
  Lublin: { _default: 42, _districts: {} },
  Białystok: { _default: 40, _districts: {} },
  Gdynia: {
    _default: 55,
    _districts: {
      'Śródmieście': 70,
      'Orłowo': 70,
      'Redłowo': 60,
    },
  },
  Toruń: { _default: 40, _districts: {} },
  Częstochowa: { _default: 35, _districts: {} },
  Radom: { _default: 35, _districts: {} },
  Sosnowiec: { _default: 38, _districts: {} },
  Kielce: { _default: 38, _districts: {} },
  Rzeszów: { _default: 42, _districts: {} },
  Olsztyn: { _default: 42, _districts: {} },
  'Bielsko-Biała': { _default: 40, _districts: {} },
  Opole: { _default: 40, _districts: {} },

  /** Fallback dla nieznanych miast — przeciętna PL bez metropolii. */
  _fallback: 38,
};

/** Wersja schematu stawek — bumpuj gdy zmienisz strukturę. */
export const RENT_RATES_VERSION = '2026-Q1';

/**
 * Zwraca stawkę czynszu [PLN/m²/mc] dla pary (city, district).
 *
 * Logika:
 *   1. Jeśli city istnieje w słowniku ∧ district istnieje w jej _districts → użyj district rate
 *   2. Jeśli city istnieje ∧ district nie istnieje → użyj city _default
 *   3. Jeśli city nie istnieje → użyj globalnego _fallback
 *
 * @returns {{ rate: number, source: string }} — stawka + opis źródła (do UI/audytu)
 */
export function getRentRate(city, district) {
  if (city && Object.prototype.hasOwnProperty.call(ratesPerCity, city)) {
    const cityData = ratesPerCity[city];
    if (district && Object.prototype.hasOwnProperty.call(cityData._districts, district)) {
      return {
        rate: cityData._districts[district],
        source: `heuristic_v1:${city}/${district}@${RENT_RATES_VERSION}`,
      };
    }
    return {
      rate: cityData._default,
      source: `heuristic_v1:${city}@${RENT_RATES_VERSION}`,
    };
  }
  return {
    rate: ratesPerCity._fallback,
    source: `heuristic_v1:_fallback@${RENT_RATES_VERSION}`,
  };
}

/** Eksport surowych danych — do admin endpoint i testów. */
export { ratesPerCity };
