import React from 'react';
import { View, Text, FlatList, ActivityIndicator, TouchableOpacity, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { useSubscription } from '../contexts/SubscriptionContext';
import { fetchInvestorDashboard } from '../services/investor';
import { PriceFairnessBadge } from '../components/PriceFairnessBadge';
import { colors, spacing, radii, typography } from '../theme';

export function InvestorScreen({ navigation }: any) {
  const { user } = useAuth();
  const { isInvestor, startUpgrade } = useSubscription();

  const { data, isLoading } = useQuery({
    queryKey: ['investor-dashboard', user?.home_city],
    queryFn: () => fetchInvestorDashboard({
      city: user?.home_city ?? undefined,
      sort_by: 'yield_net',
      limit: 20,
    }),
    enabled: isInvestor,
  });

  if (!isInvestor) {
    return (
      <View style={styles.paywallContainer}>
        <Text style={styles.paywallEmoji}>🏢</Text>
        <Text style={styles.paywallTitle}>Dashboard inwestora</Text>
        <Text style={styles.paywallDesc}>
          Top oferty wg yield, payback i cashflow. Eksport CSV.{'\n\n'}
          Plan Investor (149 PLN/mc).
        </Text>
        <TouchableOpacity style={styles.paywallButton} onPress={() => startUpgrade('investor')}>
          <Text style={styles.paywallButtonText}>Aktywuj Investor</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (isLoading || !data) {
    return <View style={styles.center}><ActivityIndicator size="large" color={colors.brand} /></View>;
  }

  const s = data.summary as Record<string, number>;
  return (
    <View style={styles.container}>
      <View style={styles.summary}>
        <Text style={styles.summaryTitle}>Podsumowanie ({user?.home_city})</Text>
        <View style={styles.summaryGrid}>
          <Stat label="Median yield net" value={`${s.median_yield_net_pct}%`} />
          <Stat label="Best yield" value={`${s.best_yield_net_pct}%`} />
          <Stat label="Median payback" value={`${s.median_payback_years} lat`} />
          <Stat label="Analiz" value={String(s.total_analyzed)} />
        </View>
      </View>
      <FlatList
        data={data.rankings}
        keyExtractor={(r) => r.listing.id}
        contentContainerStyle={{ padding: spacing.md }}
        renderItem={({ item, index }) => (
          <TouchableOpacity style={styles.rankCard} onPress={() => navigation.navigate('ListingDetail', { id: item.listing.id })}>
            <Text style={styles.rankNumber}>#{index + 1}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.rankTitle} numberOfLines={1}>{item.listing.title}</Text>
              <Text style={styles.rankMeta}>{item.listing.district || item.listing.city} • {item.listing.area_m2}m² • {item.listing.price_pln?.toLocaleString('pl-PL')} PLN</Text>
              <View style={styles.rankStats}>
                <Text style={styles.rankYield}>yield {item.investor_analysis.yield_net_pct.toFixed(2)}%</Text>
                <Text style={styles.rankPayback}>· {item.investor_analysis.payback_years.toFixed(1)} lat</Text>
                <PriceFairnessBadge fairness={item.fairness.label} deltaPct={item.fairness.delta_pct} small />
              </View>
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statBox}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  paywallContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl, backgroundColor: colors.background },
  paywallEmoji: { fontSize: 64 },
  paywallTitle: { ...typography.h1, color: colors.text, marginTop: spacing.md },
  paywallDesc: { ...typography.body, color: colors.textMuted, textAlign: 'center', marginTop: spacing.md, marginBottom: spacing.xl },
  paywallButton: { backgroundColor: colors.accent, paddingHorizontal: spacing['2xl'], paddingVertical: spacing.lg, borderRadius: radii.md },
  paywallButtonText: { ...typography.h3, color: colors.textInverse },
  summary: { backgroundColor: colors.brand, padding: spacing.lg },
  summaryTitle: { ...typography.h3, color: colors.textInverse },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.md, gap: spacing.md },
  statBox: { flex: 1, minWidth: '40%' },
  statValue: { ...typography.h2, color: colors.textInverse },
  statLabel: { ...typography.tiny, color: colors.textInverse, opacity: 0.9 },
  rankCard: {
    flexDirection: 'row', backgroundColor: colors.card, padding: spacing.md,
    borderRadius: radii.md, marginBottom: spacing.sm, gap: spacing.md,
  },
  rankNumber: { ...typography.h2, color: colors.brand, width: 40 },
  rankTitle: { ...typography.h3, color: colors.text },
  rankMeta: { ...typography.small, color: colors.textMuted, marginTop: spacing.xs },
  rankStats: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs },
  rankYield: { ...typography.body, color: colors.brand, fontWeight: '700' },
  rankPayback: { ...typography.small, color: colors.textMuted },
});
