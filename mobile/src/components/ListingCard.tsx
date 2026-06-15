import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { Listing } from '../services/listings';
import { PriceFairnessBadge } from './PriceFairnessBadge';
import { formatPLN, formatPricePerM2, formatArea } from '../utils/format';
import { colors, spacing, radii, typography } from '../theme';

export function ListingCard({ listing, onPress }: { listing: Listing; onPress: () => void }) {
  const photo = listing.photos?.[0];
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      {photo ? (
        <Image source={{ uri: photo }} style={styles.image} resizeMode="cover" />
      ) : (
        <View style={[styles.image, styles.imagePlaceholder]}>
          <Text style={styles.placeholderText}>🏠</Text>
        </View>
      )}
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>{listing.title}</Text>
        <Text style={styles.location} numberOfLines={1}>
          {listing.city}{listing.district ? `, ${listing.district}` : ''}
        </Text>
        <View style={styles.row}>
          <Text style={styles.price}>{formatPLN(listing.price_pln)}</Text>
          {listing.price_per_m2 != null && (
            <Text style={styles.pricePerM2}>{formatPricePerM2(listing.price_per_m2)}</Text>
          )}
        </View>
        <View style={styles.metaRow}>
          {listing.area_m2 != null && <Text style={styles.meta}>{formatArea(listing.area_m2)}</Text>}
          {listing.rooms != null && <Text style={styles.meta}>{listing.rooms} pokoje</Text>}
          {listing.price_fairness && (
            <PriceFairnessBadge
              fairness={listing.price_fairness}
              deltaPct={listing.fairness_delta_pct ?? null}
              small
            />
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.lg,
    marginBottom: spacing.md,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  image: { width: '100%', height: 180, backgroundColor: colors.border },
  imagePlaceholder: { justifyContent: 'center', alignItems: 'center' },
  placeholderText: { fontSize: 48 },
  body: { padding: spacing.md },
  title: { ...typography.h3, color: colors.text },
  location: { ...typography.small, color: colors.textMuted, marginTop: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'baseline', marginTop: spacing.sm, gap: spacing.md },
  price: { ...typography.h2, color: colors.brand },
  pricePerM2: { ...typography.small, color: colors.textMuted },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm },
  meta: { ...typography.small, color: colors.textMuted },
});
