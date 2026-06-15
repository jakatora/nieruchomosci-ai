import React from 'react';
import { Text, FlatList, RefreshControl, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { listListings } from '../services/listings';
import { ListingCard } from '../components/ListingCard';
import { LoadingState, EmptyState, ErrorState } from '../components/StateViews';
import { colors, spacing, typography } from '../theme';

export function ListingsScreen({ navigation }: any) {
  const { user } = useAuth();
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['listings', user?.home_city],
    queryFn: () => listListings({
      city: user?.home_city ?? undefined,
      order_by: 'ppm2_asc',
      limit: 50,
    }),
  });

  if (isLoading) return <LoadingState message="Ładujemy oferty…" />;
  if (isError) return <ErrorState description="Nie udało się pobrać ofert." onRetry={refetch} />;

  return (
    <FlatList
      data={data?.listings ?? []}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <ListingCard listing={item} onPress={() => navigation.navigate('ListingDetail', { id: item.id })} />
      )}
      contentContainerStyle={{ padding: spacing.md, backgroundColor: colors.background, flexGrow: 1 }}
      ListHeaderComponent={() => (
        <Text style={styles.header}>
          {data?.pagination.total ?? 0} ofert (sortowane od najtańszego m²)
        </Text>
      )}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.brand} />}
      ListEmptyComponent={() => (
        <EmptyState
          title="Brak ofert"
          description="Spróbuj zmienić miasto w zakładce Konto."
          actionLabel="Otwórz konto"
          onAction={() => navigation.navigate('Account')}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  header: { ...typography.small, color: colors.textMuted, padding: spacing.md, paddingTop: 0 },
});
