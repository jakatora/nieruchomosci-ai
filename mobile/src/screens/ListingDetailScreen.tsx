import React from 'react';
import { View, Text, ScrollView, Image, Linking, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { getListing } from '../services/listings';
import { useSubscription } from '../contexts/SubscriptionContext';
import { PriceFairnessBadge } from '../components/PriceFairnessBadge';
import { ROIPanel } from '../components/ROIPanel';
import { colors, spacing, radii, typography } from '../theme';

export function ListingDetailScreen({ route }: any) {
  const { id } = route.params as { id: string };
  const { isInvestor, startUpgrade } = useSubscription();
  const { data, isLoading } = useQuery({
    queryKey: ['listing', id],
    queryFn: () => getListing(id),
  });

  if (isLoading || !data) {
    return <View style={styles.center}><ActivityIndicator size="large" color={colors.brand} /></View>;
  }
  const { listing, comparables, investor_analysis, paywall_locked } = data;
  const photo = listing.photos?.[0];

  return (
    <ScrollView style={styles.container}>
      {photo && <Image source={{ uri: photo }} style={styles.image} resizeMode="cover" />}
      <View style={styles.section}>
        <Text style={styles.title}>{listing.title}</Text>
        <Text style={styles.location}>
          {listing.city}{listing.district ? `, ${listing.district}` : ''}
        </Text>
        <View style={styles.priceRow}>
          <Text style={styles.price}>
            {listing.price_pln?.toLocaleString('pl-PL')} PLN
          </Text>
          {listing.price_per_m2 && (
            <Text style={styles.pricePerM2}>{listing.price_per_m2.toLocaleString('pl-PL')} PLN/m²</Text>
          )}
        </View>
        <View style={styles.statsRow}>
          {listing.area_m2 && <Text style={styles.stat}>📐 {listing.area_m2} m²</Text>}
          {listing.rooms && <Text style={styles.stat}>🚪 {listing.rooms} pokoje</Text>}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Cena vs okolica</Text>
        <PriceFairnessBadge fairness={comparables.fairness_label} deltaPct={comparables.delta_pct} />
        {comparables.median_price_per_m2 && (
          <Text style={styles.metaText}>
            Mediana w {comparables.source === 'district' ? 'tej dzielnicy' : 'tym mieście'}: {comparables.median_price_per_m2.toLocaleString('pl-PL')} PLN/m² ({comparables.sample_size} ofert)
          </Text>
        )}
      </View>

      {investor_analysis && <ROIPanel data={investor_analysis} />}

      {paywall_locked.includes('investor_analysis') && !isInvestor && (
        <View style={styles.section}>
          <View style={styles.paywallCard}>
            <Text style={styles.paywallTitle}>🔒 Analiza inwestorska</Text>
            <Text style={styles.paywallDesc}>Yield, payback, cashflow z kredytem — w planie Investor (149 PLN/mc).</Text>
            <TouchableOpacity style={styles.paywallButton} onPress={() => startUpgrade('investor')}>
              <Text style={styles.paywallButtonText}>Aktywuj Investor</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <View style={styles.section}>
        <TouchableOpacity style={styles.sourceButton} onPress={() => Linking.openURL(listing.url)}>
          <Text style={styles.sourceButtonText}>Otwórz na {listing.source === 'domiporta' ? 'Domiporta' : listing.source} ↗</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background },
  image: { width: '100%', height: 240 },
  section: { padding: spacing.lg, backgroundColor: colors.card, marginBottom: spacing.md },
  sectionTitle: { ...typography.h3, color: colors.text, marginBottom: spacing.md },
  title: { ...typography.h2, color: colors.text },
  location: { ...typography.body, color: colors.textMuted, marginTop: spacing.xs },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: spacing.md, gap: spacing.md },
  price: { ...typography.h1, color: colors.brand },
  pricePerM2: { ...typography.body, color: colors.textMuted },
  statsRow: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.md },
  stat: { ...typography.body, color: colors.text },
  metaText: { ...typography.small, color: colors.textMuted, marginTop: spacing.sm },
  paywallCard: {
    backgroundColor: '#FFF7ED', padding: spacing.lg, borderRadius: radii.lg,
    borderWidth: 1, borderColor: '#FED7AA',
  },
  paywallTitle: { ...typography.h3, color: '#9A3412' },
  paywallDesc: { ...typography.body, color: '#9A3412', marginTop: spacing.sm, marginBottom: spacing.md },
  paywallButton: { backgroundColor: '#EA580C', padding: spacing.md, borderRadius: radii.md, alignItems: 'center' },
  paywallButtonText: { ...typography.h3, color: colors.textInverse },
  sourceButton: { backgroundColor: colors.brand, padding: spacing.lg, borderRadius: radii.md, alignItems: 'center' },
  sourceButtonText: { ...typography.h3, color: colors.textInverse },
});
