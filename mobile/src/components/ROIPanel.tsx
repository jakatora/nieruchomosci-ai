import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { InvestorAnalysis } from '../services/listings';
import { colors, spacing, radii, typography } from '../theme';

export function ROIPanel({ data }: { data: InvestorAnalysis }) {
  const cashflow = Math.round(data.cashflow_monthly);
  const cashflowColor = cashflow >= 0 ? colors.success : colors.danger;
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>🏢 Analiza inwestycyjna</Text>
      </View>
      <View style={styles.grid}>
        <Cell label="Czynsz miesięczny" value={`${data.estimated_rent.toLocaleString('pl-PL')} PLN`} />
        <Cell label="Yield gross" value={`${data.yield_gross_pct.toFixed(2)}%`} highlight />
        <Cell label="Yield net" value={`${data.yield_net_pct.toFixed(2)}%`} highlight />
        <Cell label="Payback" value={`${data.payback_years.toFixed(1)} lat`} />
        <Cell label="Cashflow / mc" value={`${cashflow.toLocaleString('pl-PL')} PLN`} color={cashflowColor} />
      </View>
      <Text style={styles.source}>
        Stawka czynszu: {data.rent_source}
      </Text>
      <Text style={styles.assumptions}>
        Założenia: wkład {data.assumptions.downPaymentPct}% • rata {data.assumptions.mortgageRatePct}% / {data.assumptions.mortgageYears}y • vacancy {data.assumptions.vacancyPct}% • zarządzanie {data.assumptions.mgmtCostPct}%
      </Text>
    </View>
  );
}

function Cell({ label, value, highlight, color }: { label: string; value: string; highlight?: boolean; color?: string }) {
  return (
    <View style={styles.cell}>
      <Text style={styles.cellValue} numberOfLines={1}>
        <Text style={[
          highlight ? { color: colors.brand } : undefined,
          color ? { color } : undefined,
        ]}>{value}</Text>
      </Text>
      <Text style={styles.cellLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.card, margin: spacing.md, borderRadius: radii.lg, overflow: 'hidden' },
  header: { backgroundColor: colors.brand, padding: spacing.md },
  headerTitle: { ...typography.h3, color: colors.textInverse },
  grid: { flexDirection: 'row', flexWrap: 'wrap', padding: spacing.md },
  cell: { width: '50%', paddingVertical: spacing.sm },
  cellValue: { ...typography.h3, color: colors.text },
  cellLabel: { ...typography.tiny, color: colors.textMuted, marginTop: 2 },
  source: { ...typography.tiny, color: colors.textMuted, paddingHorizontal: spacing.md, paddingBottom: spacing.xs },
  assumptions: { ...typography.tiny, color: colors.textMuted, paddingHorizontal: spacing.md, paddingBottom: spacing.md },
});
