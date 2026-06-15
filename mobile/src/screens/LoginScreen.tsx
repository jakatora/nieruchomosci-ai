import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Alert, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { colors, spacing, radii, typography } from '../theme';

export function LoginScreen({ navigation }: any) {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    if (!email || !password) {
      Alert.alert('Brak danych', 'Podaj email i hasło.');
      return;
    }
    setLoading(true);
    try {
      await login(email.trim().toLowerCase(), password);
    } catch (err) {
      Alert.alert('Logowanie nieudane', (err as Error).message || 'Sprawdź email i hasło.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
      <View style={styles.brandBg}>
        <Text style={styles.brandTitle}>🏠 NieruchomościAI</Text>
        <Text style={styles.brandSubtitle}>AI analizuje oferty mieszkań</Text>
      </View>
      <View style={styles.form}>
        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="jan@example.pl"
        />
        <Text style={styles.label}>Hasło</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="••••••••"
        />
        <TouchableOpacity style={styles.button} onPress={onSubmit} disabled={loading}>
          {loading ? <ActivityIndicator color={colors.textInverse} /> : <Text style={styles.buttonText}>Zaloguj się</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={styles.linkButton} onPress={() => navigation.navigate('Register')}>
          <Text style={styles.linkText}>Nie masz konta? Zarejestruj się</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  brandBg: { backgroundColor: colors.brand, paddingTop: 80, paddingBottom: spacing['3xl'], paddingHorizontal: spacing.xl, alignItems: 'center' },
  brandTitle: { ...typography.h1, color: colors.textInverse, fontSize: 32 },
  brandSubtitle: { ...typography.body, color: colors.textInverse, opacity: 0.9, marginTop: spacing.sm },
  form: { padding: spacing.xl },
  label: { ...typography.small, color: colors.textMuted, marginBottom: spacing.xs, marginTop: spacing.md },
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
  linkButton: { alignItems: 'center', marginTop: spacing.lg },
  linkText: { ...typography.small, color: colors.brand },
});
