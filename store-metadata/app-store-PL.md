# App Store — Polski (default locale)

## App Name (≤30 znaków)
```
NieruchomościAI: oferty z AI
```
**Znaków: 28** | brand + 2 keywords ("oferty" + "AI")

## Subtitle (≤30 znaków)
```
Analiza ogłoszeń mieszkań
```
**Znaków: 25** | inne keywords niż w Name

## Keywords field (≤100 znaków, bez spacji po przecinku)
```
mieszkanie,kupno,wynajem,domiporta,olx,inwestycje,yield,kalkulator,zakup,nieruchomość,oferta,dzielnica
```
**Znaków: 100** | nie powtarza słów z Name/Subtitle

## Promotional Text (≤170, zmienialne bez review)
```
AI sprawdza ogłoszenia z Domiporty. Pokazuje czy cena jest fair dla okolicy, wykrywa red-flagi w opisie, liczy ROI dla inwestorów. Darmowe 3 wyniki dziennie.
```
**Znaków: 168**

## Description (≤4000 znaków)
```
NieruchomościAI — Twój asystent przy zakupie i inwestowaniu w mieszkania w Polsce.

Aplikacja codziennie pobiera świeże oferty z portali (na start: Domiporta, OLX), analizuje je sztuczną inteligencją i pokazuje to, czego ogłoszenie samo nie powie:

• czy cena jest fair w porównaniu z medianą okolicy (label: poniżej / fair / powyżej + delta %)
• red-flagi w opisie (brak księgi wieczystej, niezgodności metrażu, zawyżona pow. użytkowa)
• kalkulator ROI dla inwestorów — yield brutto, netto, payback w latach, miesięczny cashflow
• estymacja czynszu na bazie stawek dzielnicy
• ranking Top Investments z filtrami: miasto, dzielnica, cena, powierzchnia, oczekiwany yield
• eksport do CSV (Excel) dla inwestorów

Dla kogo:

KUPUJĄCY (plan Free + Standard 39 zł/mc)
- Codzienne dopasowania ofert do Twoich wyszukiwań
- Powiadomienia push o nowych ofertach pasujących do filtrów
- Pełna lista red-flag w każdej ofercie (Standard)
- Mapa wyników z markerami fair-price (Standard)

INWESTORZY (plan Investor 149 zł/mc)
- Wszystko ze Standard
- Kalkulator ROI z aktualnymi stawkami kredytów
- Ranking Top Investments po yield/payback/cashflow
- Eksport CSV ofert do Excela
- Priorytetowe wsparcie

JAK TO DZIAŁA
1. Wybierz miasto, dzielnice, przedział cenowy i metraż
2. App raz dziennie wyśle push z najlepszymi dopasowaniami
3. Otwórz ofertę — zobacz fair-price, red-flagi i (dla Investora) ROI
4. Klik w „Otwórz ogłoszenie" → przejście do oryginalnego portalu

ŹRÓDŁA DANYCH
NieruchomościAI agreguje publiczne RSS feedy portali nieruchomości. Zawsze linkujemy zwrotnie do oryginalnego ogłoszenia. Nie pośredniczymy w transakcjach, nie odpowiadamy za treść ogłoszeń.

DISCLAIMER AI
Modele językowe mogą się mylić. Wszystkie analizy weryfikuj bezpośrednio (notariusz, geodeta, rzeczoznawca). Aplikacja NIE świadczy doradztwa inwestycyjnego, prawnego ani podatkowego.

PRYWATNOŚĆ
RODO-compliant. Hasła hash bcrypt. HTTPS only. Pełna polityka prywatności w aplikacji + Ustawienia → Usuń konto (30 dni). Stripe obsługuje płatności — danych karty nie przechowujemy.

KONTAKT
support@nieruchomosciai.pl
```
**Znaków: ~2350** | pierwsze 2 linie = hook (widoczne przed „more")

## What's New (≤4000 znaków, dla v0.1.0)
```
Pierwsza publiczna wersja NieruchomościAI:

• Codzienne dopasowania ofert z Domiporty
• Fair-price label (poniżej/fair/powyżej + delta %)
• Red-flagi w opisie wykrywane przez Claude AI
• Plan Investor: ROI calculator z yield/payback/cashflow
• Eksport CSV do Excela
• Mapa wyników z markerami fair-price
• Powiadomienia push o nowych ofertach

Daj znać co poprawić: support@nieruchomosciai.pl
```
