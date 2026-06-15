import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, radii, typography } from '../theme';

type Fairness = 'below' | 'fair' | 'above' | 'unknown';

const LABELS: Record<Fairness, { text: string; emoji: string; color: string }> = {
  below:   { text: 'OKAZJA',   emoji: '🟢', color: colors.fairnessBelow },
  fair:    { text: 'FAIR',     emoji: '🟦', color: colors.fairnessFair },
  above:   { text: 'DROŻEJ',   emoji: '🔴', color: colors.fairnessAbove },
  unknown: { text: 'BRAK DANYCH', emoji: '⚪', color: colors.fairnessUnknown },
};

export function PriceFairnessBadge({
  fairness,
  deltaPct,
  small,
}: {
  fairness: Fairness;
  deltaPct: number | null | undefined;
  small?: boolean;
}) {
  const cfg = LABELS[fairness] ?? LABELS.unknown;
  const sign = deltaPct != null && deltaPct > 0 ? '+' : '';
  const deltaText = deltaPct != null ? `${sign}${deltaPct.toFixed(1)}%` : '';
  return (
    <View style={[
      styles.badge,
      { backgroundColor: cfg.color },
      small && styles.badgeSmall,
    ]}>
      <Text style={[styles.text, small && styles.textSmall]}>
        {cfg.text}{deltaText ? ` ${deltaText}` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radii.full,
    alignSelf: 'flex-start',
  },
  badgeSmall: { paddingHorizontal: spacing.xs, paddingVertical: 2 },
  text: { ...typography.tiny, color: colors.textInverse, fontWeight: '700' },
  textSmall: { fontSize: 10 },
});
