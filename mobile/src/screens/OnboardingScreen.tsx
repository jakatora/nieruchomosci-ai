import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Alert, StyleSheet, ScrollView } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { updateProfile } from '../services/auth';
import { createSearch } from '../services/searches';
import { colors, spacing, radii, typography } from '../theme';

/**
 * Onboarding po pierwszym register — pyta o miasto + zakres ceny → tworzy pierwszy search.
 * Po setupie user przechodzi na MainTabs (Today screen).
 */
const POPULAR_CITIES = ['Warszawa', 'Kraków', 'Wrocław', 'Gdańsk', 'Poznań', 'Łódź'];

export function OnboardingScreen() {
  const { user, refresh } = useAuth();
  const isInvestor = user?.user_type === 'investor';

  const [city, setCity] = useState('Warszawa');
  const [maxPrice, setMaxPrice] = useState(isInvestor ? '1000000' : '800000');
  const [minArea, setMinArea] = useState('35');
  const [maxArea, setMaxArea] = useState(isInvestor ? '70' : '80');
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    if (!city) { Alert.alert('Wybierz miasto'); return; }
    setLoading(true);
    try {
      await updateProfile({ home_city: city });
      await createSearch({
        name: `Moje wyszukiwanie — ${city}`,
        city,
        districts: [],
        radius_km: 5,
        center_lat: null, center_lng: null,
        min_price: null,
        max_price: Number(maxPrice) || null,
        min_area: Number(minArea) || null,
        max_area: Number(maxArea) || null,
        rooms: [],
        enabled: true,
      });
      await refresh();
    } catch (err) {
      Alert.alert('Błąd', (err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Powiedz nam o sobie 👋</Text>
      <Text style={styles.subtitle}>
        {isInvestor
          ? 'W którym mieście szukasz inwestycji? AI policzy ROI dla pasujących ofert.'
          : 'W którym mieście szukasz mieszkania? AI wyśle Ci codziennie najlepsze trafienia.'}
      </Text>

      <Text style={styles.label}>Miasto</Text>
      <View style={styles.chipsRow}>
        {POPULAR_CITIES.map((c) => (
          <TouchableOpacity key={c} onPress={() => setCity(c)}
            style={[styles.chip, city === c && styles.chipActive]}>
            <Text style={[styles.chipText, city === c && styles.chipTextActive]}>{c}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Maksymalna cena (PLN)</Text>
      <TextInput style={styles.input} value={maxPrice} onChangeText={setMaxPrice} keyboardType="numeric" />

      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Min powierzchnia (m²)</Text>
          <TextInput style={styles.input} value={minArea} onChangeText={setMinArea} keyboardType="numeric" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Max powierzchnia (m²)</Text>
          <TextInput style={styles.input} value={maxArea} onChangeText={setMaxArea} keyboardType="numeric" />
        </View>
      </View>

      <TouchableOpacity style={styles.button} onPress={onSubmit} disabled={loading}>
        {loading ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.buttonText}>Zacznij szukać</Text>}
      </TouchableOpacity>

      <Text style={styles.hint}>
        Możesz to wszystko zmienić później w zakładce Konto.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.xl, backgroundColor: colors.background, minHeight: '100%' },
  title: { ...typography.h1, color: colors.text, marginTop: spacing.xl },
  subtitle: { ...typography.body, color: colors.textMuted, marginTop: spacing.sm, marginBottom: spacing.xl },
  label: { ...typography.small, color: colors.textMuted, marginTop: spacing.md, marginBottom: spacing.xs },
  input: {
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    borderRadius: radii.md, ...typography.body, color: colors.text,
  },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderRadius: radii.full, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { ...typography.small, color: colors.text },
  chipTextActive: { color: colors.textInverse, fontWeight: '600' },
  row: { flexDirection: 'row', gap: spacing.md },
  button: {
    backgroundColor: colors.brand, padding: spacing.lg, borderRadius: radii.md,
    alignItems: 'center', marginTop: spacing.xl,
  },
  buttonText: { ...typography.h3, color: colors.textInverse },
  hint: { ...typography.small, color: colors.textMuted, textAlign: 'center', marginTop: spacing.lg },
});
