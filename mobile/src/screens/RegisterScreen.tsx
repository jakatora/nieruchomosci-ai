import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Alert, StyleSheet, ScrollView } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { colors, spacing, radii, typography } from '../theme';

export function RegisterScreen() {
  const { register } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [userType, setUserType] = useState<'consumer' | 'investor'>('consumer');
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    if (!email || password.length < 8) {
      Alert.alert('Błąd', 'Podaj email i hasło (min. 8 znaków).');
      return;
    }
    setLoading(true);
    try {
      await register({ email: email.trim().toLowerCase(), password, user_type: userType });
    } catch (err) {
      Alert.alert('Rejestracja nieudana', (err as Error).message || 'Spróbuj ponownie.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Założ konto</Text>
      <Text style={styles.subtitle}>Wybierz typ profilu, by aplikacja dopasowała funkcje.</Text>

      <View style={styles.typeRow}>
        <TouchableOpacity
          style={[styles.typeCard, userType === 'consumer' && styles.typeCardActive]}
          onPress={() => setUserType('consumer')}>
          <Text style={styles.typeEmoji}>🏠</Text>
          <Text style={styles.typeLabel}>Kupuję dla siebie</Text>
          <Text style={styles.typeDesc}>Szukam mieszkania. AI wykrywa red-flagi + ostrzega gdy przepłacam.</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.typeCard, userType === 'investor' && styles.typeCardActive]}
          onPress={() => setUserType('investor')}>
          <Text style={styles.typeEmoji}>🏢</Text>
          <Text style={styles.typeLabel}>Inwestor</Text>
          <Text style={styles.typeDesc}>Kupuję pod wynajem. AI liczy yield, payback i cashflow z kredytem.</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.label}>Email</Text>
      <TextInput style={styles.input} value={email} onChangeText={setEmail}
        keyboardType="email-address" autoCapitalize="none" autoCorrect={false} placeholder="jan@example.pl" />
      <Text style={styles.label}>Hasło (min. 8 znaków)</Text>
      <TextInput style={styles.input} value={password} onChangeText={setPassword}
        secureTextEntry placeholder="••••••••" />

      <TouchableOpacity style={styles.button} onPress={onSubmit} disabled={loading}>
        {loading ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.buttonText}>Utwórz konto</Text>}
      </TouchableOpacity>

      <Text style={styles.legal}>
        Tworząc konto akceptujesz Regulamin i Politykę prywatności.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.xl, backgroundColor: colors.background, minHeight: '100%' },
  title: { ...typography.h1, color: colors.text },
  subtitle: { ...typography.body, color: colors.textMuted, marginTop: spacing.sm, marginBottom: spacing.lg },
  typeRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg },
  typeCard: {
    flex: 1, padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.card,
    borderWidth: 2, borderColor: colors.border,
  },
  typeCardActive: { borderColor: colors.brand, backgroundColor: '#F0FDFA' },
  typeEmoji: { fontSize: 28 },
  typeLabel: { ...typography.h3, color: colors.text, marginTop: spacing.xs },
  typeDesc: { ...typography.small, color: colors.textMuted, marginTop: spacing.xs },
  label: { ...typography.small, color: colors.textMuted, marginTop: spacing.md, marginBottom: spacing.xs },
  input: {
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card,
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
    borderRadius: radii.md, ...typography.body, color: colors.text,
  },
  button: {
    backgroundColor: colors.brand, padding: spacing.lg, borderRadius: radii.md,
    alignItems: 'center', marginTop: spacing.xl,
  },
  buttonText: { ...typography.h3, color: colors.textInverse },
  legal: { ...typography.tiny, color: colors.textMuted, textAlign: 'center', marginTop: spacing.lg },
});
