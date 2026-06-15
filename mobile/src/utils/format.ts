/**
 * Format helpers — pl-PL locale, defensive null/undefined handling.
 *
 * Wzorzec `value?.toLocaleString('pl-PL')` był powtórzony w 6+ miejscach (ListingCard,
 * ListingDetailScreen, InvestorScreen, etc.). DRY + null safety w jednym miejscu.
 */

/** "950 000 PLN" — z separatorami tysięcy po polsku, "—" gdy null/undefined/NaN. */
export function formatPLN(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return '—';
  return `${amount.toLocaleString('pl-PL')} PLN`;
}

/** "16 000" — bez waluty (gdy dorzucasz PLN/m² ręcznie). */
export function formatNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toLocaleString('pl-PL');
}

/** "12 000 PLN/m²" — dla ceny za m². */
export function formatPricePerM2(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value.toLocaleString('pl-PL')} PLN/m²`;
}

/** "50 m²" — defensywnie. */
export function formatArea(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value} m²`;
}

/** "+12.5%" / "-3.1%" — z plus sign dla pozytywnych, "—" gdy null. */
export function formatPercent(value: number | null | undefined, decimals = 1): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}%`;
}

/** Skraca tekst do `max` znaków z "…" na końcu (defensywnie obsługuje null). */
export function truncate(text: string | null | undefined, max: number): string {
  if (!text) return '';
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}
