import React from 'react';
import { View, Text, ActivityIndicator, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, spacing, radii, typography } from '../theme';

/**
 * Trzy współdzielone state views: Loading, Empty, Error.
 *
 * Wzorzec z reuse_plan.md (kopiowane z PrzetargAI) — DRY dla TodayScreen,
 * ListingsScreen, InvestorScreen, AccountScreen. Konsystentny UX +
 * łatwo zmienić wygląd w jednym miejscu.
 *
 * Każdy state przyjmuje opcjonalny tytuł/opis/action — minimum to działa
 * z samymi defaultami.
 */

export function LoadingState({ message }: { message?: string }) {
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={colors.brand} />
      {message && <Text style={styles.message}>{message}</Text>}
    </View>
  );
}

export function EmptyState({
  emoji = '🔍',
  title = 'Brak wyników',
  description,
  actionLabel,
  onAction,
}: {
  emoji?: string;
  title?: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.container}>
      <Text style={styles.emoji}>{emoji}</Text>
      <Text style={styles.title}>{title}</Text>
      {description && <Text style={styles.description}>{description}</Text>}
      {actionLabel && onAction && (
        <TouchableOpacity style={styles.button} onPress={onAction} activeOpacity={0.7}>
          <Text style={styles.buttonText}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

export function ErrorState({
  title = 'Coś poszło nie tak',
  description,
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <View style={styles.container}>
      <Text style={styles.emoji}>⚠️</Text>
      <Text style={[styles.title, { color: colors.danger }]}>{title}</Text>
      {description && <Text style={styles.description}>{description}</Text>}
      {onRetry && (
        <TouchableOpacity style={styles.button} onPress={onRetry} activeOpacity={0.7}>
          <Text style={styles.buttonText}>Spróbuj ponownie</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    backgroundColor: colors.background,
  },
  emoji: { fontSize: 64, marginBottom: spacing.md },
  title: { ...typography.h2, color: colors.text, textAlign: 'center' },
  description: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
    maxWidth: 280,
  },
  message: { ...typography.body, color: colors.textMuted, marginTop: spacing.md },
  button: {
    backgroundColor: colors.brand,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    marginTop: spacing.lg,
  },
  buttonText: { ...typography.h3, color: colors.textInverse },
});
