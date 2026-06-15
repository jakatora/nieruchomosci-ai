import React, { useMemo, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import MapView, { Marker, Callout, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import { Listing } from '../services/listings';
import { formatPLN, formatArea } from '../utils/format';
import { colors, spacing, radii, typography } from '../theme';

/**
 * ListingsMapView — interaktywna mapa z markerami listings.
 *
 * Strategia:
 *   - iOS: Apple Maps (default provider) — taniej, lepsza native integration.
 *   - Android: Google Maps (PROVIDER_GOOGLE) — wymaga `GOOGLE_MAPS_API_KEY_ANDROID`
 *     w `app.json#android.config.googleMaps.apiKey` (już skonfigurowane z vault).
 *
 * Marker pin colors odzwierciedlają fair-price:
 *   - green: BELOW (okazja)
 *   - blue: FAIR
 *   - red: ABOVE
 *   - gray: UNKNOWN (no comparable data)
 *
 * Callout pokazuje: title, price, area, fairness delta % — tap → onMarkerPress callback.
 *
 * Auto-fit: gdy `listings` zmienia się, mapa auto-dopasowuje viewport (max 50 markerów
 * — powyżej tego performance degraduje).
 */

interface Props {
  listings: Listing[];
  onMarkerPress?: (listing: Listing) => void;
  initialRegion?: Region;
  /** Bez markerów - przydatne dla "no results" empty state z visible map */
  showLegend?: boolean;
}

const MAX_MARKERS = 50;

// Default region — Warszawa center
const DEFAULT_REGION: Region = {
  latitude: 52.2297,
  longitude: 21.0122,
  latitudeDelta: 0.1,
  longitudeDelta: 0.1,
};

const PIN_COLORS = {
  below: '#16A34A',   // green
  fair: '#0D9488',    // teal brand
  above: '#DC2626',   // red
  unknown: '#94A3B8', // gray
};

export function ListingsMapView({
  listings,
  onMarkerPress,
  initialRegion,
  showLegend = true,
}: Props) {
  const mapRef = useRef<MapView | null>(null);

  // Tylko listings z lat+lng — pozostałe nie pokażą się na mapie.
  const geocoded = useMemo(
    () => listings
      .filter((l) => l.lat != null && l.lng != null)
      .slice(0, MAX_MARKERS),
    [listings],
  );

  // Auto-fit viewport gdy markery się zmienią.
  useEffect(() => {
    if (geocoded.length === 0 || !mapRef.current) return;
    const coords = geocoded.map((l) => ({ latitude: l.lat!, longitude: l.lng! }));
    mapRef.current.fitToCoordinates(coords, {
      edgePadding: { top: 80, right: 40, bottom: 80, left: 40 },
      animated: true,
    });
  }, [geocoded]);

  if (listings.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyEmoji}>🗺️</Text>
        <Text style={styles.emptyText}>Brak ofert do pokazania na mapie</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        initialRegion={initialRegion ?? DEFAULT_REGION}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass={true}
        toolbarEnabled={false}
      >
        {geocoded.map((l) => {
          const fairness = l.price_fairness ?? 'unknown';
          const pinColor = PIN_COLORS[fairness] ?? PIN_COLORS.unknown;
          return (
            <Marker
              key={l.id}
              coordinate={{ latitude: l.lat!, longitude: l.lng! }}
              pinColor={pinColor}
              onPress={() => onMarkerPress?.(l)}
            >
              <Callout tooltip={false} onPress={() => onMarkerPress?.(l)}>
                <View style={styles.callout}>
                  <Text style={styles.calloutTitle} numberOfLines={2}>{l.title}</Text>
                  <Text style={styles.calloutPrice}>{formatPLN(l.price_pln)}</Text>
                  <Text style={styles.calloutMeta}>
                    {formatArea(l.area_m2)}{l.rooms ? ` · ${l.rooms} pok.` : ''}
                  </Text>
                  {l.fairness_delta_pct != null && (
                    <Text style={[styles.calloutFair, { color: pinColor }]}>
                      {l.fairness_delta_pct > 0 ? '+' : ''}{l.fairness_delta_pct.toFixed(1)}%
                      {' vs okolica'}
                    </Text>
                  )}
                </View>
              </Callout>
            </Marker>
          );
        })}
      </MapView>

      {showLegend && (
        <View style={styles.legend}>
          <LegendItem color={PIN_COLORS.below} label="Okazja" />
          <LegendItem color={PIN_COLORS.fair} label="Fair" />
          <LegendItem color={PIN_COLORS.above} label="Drożej" />
        </View>
      )}

      {geocoded.length < listings.length && (
        <View style={styles.warning}>
          <Text style={styles.warningText}>
            {geocoded.length} z {listings.length} ofert ma lokalizację
          </Text>
        </View>
      )}
    </View>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { flex: 1 },
  empty: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    backgroundColor: colors.background, padding: spacing['2xl'],
  },
  emptyEmoji: { fontSize: 48 },
  emptyText: { ...typography.body, color: colors.textMuted, marginTop: spacing.md },
  callout: {
    minWidth: 180, maxWidth: 240,
    padding: spacing.sm,
  },
  calloutTitle: { ...typography.small, color: colors.text, fontWeight: '600' },
  calloutPrice: { ...typography.h3, color: colors.brand, marginTop: spacing.xs },
  calloutMeta: { ...typography.small, color: colors.textMuted, marginTop: 2 },
  calloutFair: { ...typography.small, fontWeight: '600', marginTop: spacing.xs },
  legend: {
    position: 'absolute', bottom: spacing.lg, left: spacing.md,
    flexDirection: 'row', gap: spacing.md,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radii.lg,
    shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendLabel: { ...typography.tiny, color: colors.text, fontWeight: '500' },
  warning: {
    position: 'absolute', top: spacing.md, left: spacing.md, right: spacing.md,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radii.md,
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  warningText: { ...typography.tiny, color: colors.textMuted, textAlign: 'center' },
});
