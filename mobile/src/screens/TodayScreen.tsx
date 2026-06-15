import React, { useState } from 'react';
import { View, Text, FlatList, RefreshControl, TouchableOpacity, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { listListings } from '../services/listings';
import { ListingCard } from '../components/ListingCard';
import { ListingsMapView } from '../components/ListingsMapView';
import { LoadingState, EmptyState } from '../components/StateViews';
import { colors, spacing, radii, typography } from '../theme';

type ViewMode = 'list' | 'map';

export function TodayScreen({ navigation }: any) {
  const { user } = useAuth();
  const isInvestor = user?.user_type === 'investor';
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['today', user?.home_city, user?.user_type],
    queryFn: () => listListings({
      city: user?.home_city ?? undefined,
      order_by: 'recent',
      limit: 10,
    }),
    enabled: Boolean(user),
  });

  if (isLoading) return <LoadingState message="Ładujemy najlepsze oferty…" />;

  return (
    <View style={styles.container}>
      <View style={styles.heroSection}>
        <View style={styles.heroHeader}>
          <Text style={styles.heroTitle}>
            {isInvestor ? '🏢 Dziś dla inwestorów' : '🏠 Dziś dla Ciebie'}
          </Text>
          <ViewToggle mode={viewMode} onChange={setViewMode} />
        </View>
        <Text style={styles.heroSubtitle}>
          {data?.paywall_truncated
            ? `Pokazujemy ${data.tier_limit} z ${data.pagination.total} — aktywuj Standard dla pełnej listy.`
            : `${data?.pagination.total ?? 0} ofert pasujących do Twoich kryteriów.`}
        </Text>
      </View>

      {viewMode === 'list' ? (
        <FlatList
          data={data?.listings ?? []}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <ListingCard
              listing={item}
              onPress={() => navigation.navigate('ListingDetail', { id: item.id })}
            />
          )}
          contentContainerStyle={{ padding: spacing.md, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.brand} />}
          ListEmptyComponent={() => (
            <EmptyState
              emoji="🔍"
              title="Brak ofert do pokazania"
              description="Może zmień zakres ceny lub miasto w zakładce Konto?"
              actionLabel="Otwórz konto"
              onAction={() => navigation.navigate('Account')}
            />
          )}
        />
      ) : (
        <ListingsMapView
          listings={data?.listings ?? []}
          onMarkerPress={(listing) => navigation.navigate('ListingDetail', { id: listing.id })}
          showLegend
        />
      )}
    </View>
  );
}

/** Toggle list/map view — segmented control. */
function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  return (
    <View style={styles.toggleContainer}>
      <TouchableOpacity
        style={[styles.toggleButton, mode === 'list' && styles.toggleButtonActive]}
        onPress={() => onChange('list')}
        accessibilityLabel="Widok listy"
        accessibilityRole="button"
      >
        <Text style={[styles.toggleText, mode === 'list' && styles.toggleTextActive]}>📋</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.toggleButton, mode === 'map' && styles.toggleButtonActive]}
        onPress={() => onChange('map')}
        accessibilityLabel="Widok mapy"
        accessibilityRole="button"
      >
        <Text style={[styles.toggleText, mode === 'map' && styles.toggleTextActive]}>🗺️</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  heroSection: { padding: spacing.lg, backgroundColor: colors.brand },
  heroHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heroTitle: { ...typography.h2, color: colors.textInverse, flex: 1 },
  heroSubtitle: { ...typography.small, color: colors.textInverse, opacity: 0.9, marginTop: spacing.xs },
  toggleContainer: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: radii.md,
    padding: 2,
  },
  toggleButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.sm,
  },
  toggleButtonActive: {
    backgroundColor: colors.textInverse,
  },
  toggleText: { fontSize: 18 },
  toggleTextActive: {},
});
