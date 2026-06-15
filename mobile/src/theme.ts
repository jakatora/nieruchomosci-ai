/**
 * Brand colors (DEC-003): teal #0D9488 + coral #FB7185.
 * Wartości pre-final — do potwierdzenia user'a w Tydz. 2 (BLK-03).
 */

export const colors = {
  brand: '#0D9488',
  brandLight: '#14B8A6',
  brandDark: '#0F766E',
  accent: '#FB7185',
  accentDark: '#E11D48',

  // Semantic
  success: '#16A34A',
  warning: '#F59E0B',
  danger: '#DC2626',
  info: '#2563EB',

  // Fairness badges
  fairnessBelow: '#16A34A',  // okazja
  fairnessFair: '#0D9488',
  fairnessAbove: '#DC2626',  // drożej niż okolica
  fairnessUnknown: '#94A3B8',

  // Surfaces
  background: '#F8FAFC',
  card: '#FFFFFF',
  border: '#E2E8F0',

  // Text
  text: '#0F172A',
  textMuted: '#64748B',
  textInverse: '#FFFFFF',
};

export const spacing = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 24, '2xl': 32, '3xl': 48,
};

export const radii = {
  sm: 4, md: 8, lg: 12, xl: 16, full: 999,
};

export const typography = {
  h1: { fontSize: 28, fontWeight: '700' as const, lineHeight: 32 },
  h2: { fontSize: 22, fontWeight: '700' as const, lineHeight: 28 },
  h3: { fontSize: 18, fontWeight: '600' as const, lineHeight: 24 },
  body: { fontSize: 15, fontWeight: '400' as const, lineHeight: 22 },
  small: { fontSize: 13, fontWeight: '400' as const, lineHeight: 18 },
  tiny: { fontSize: 11, fontWeight: '500' as const, lineHeight: 14 },
};
