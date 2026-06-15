import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { colors, spacing, radii, typography } from '../theme';

/**
 * ErrorBoundary — łapie React errors w drzewie children + wyświetla fallback UI.
 *
 * React class component (functional ErrorBoundary nie jest wspierany w RN/React DOM —
 * componentDidCatch + getDerivedStateFromError są tylko w klasach).
 *
 * Strategie restoracji:
 *   - "Spróbuj ponownie" → reset state + ponowne render dzieci
 *   - "Wróć do startu" → trigger callback z resetem nawigacji (opcjonalne)
 *   - "Skopiuj kod błędu" → request_id albo error message do clipboard
 *
 * Production: errors trafiają do Sentry przez `onError` callback (jeśli skonfigurowany).
 *
 * Usage:
 *   <ErrorBoundary onReset={() => navigation.reset(...)}>
 *     <App />
 *   </ErrorBoundary>
 */

interface Props {
  children: React.ReactNode;
  onError?: (error: Error, info: React.ErrorInfo) => void;
  onReset?: () => void;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.setState({ errorInfo: info });
    // Sentry / analytics hook
    if (typeof this.props.onError === 'function') {
      try { this.props.onError(error, info); } catch { /* no-op */ }
    }
    // Console log (dev mode)
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.error('[ErrorBoundary]', error, info);
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    if (typeof this.props.onReset === 'function') {
      try { this.props.onReset(); } catch { /* no-op */ }
    }
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const errorMessage = this.state.error?.message ?? 'Nieznany błąd';
    const stackPreview = (this.state.error?.stack ?? '').split('\n').slice(0, 4).join('\n');

    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.emoji}>🚨</Text>
          <Text style={styles.title}>
            {this.props.fallbackTitle ?? 'Coś poszło nie tak'}
          </Text>
          <Text style={styles.subtitle}>
            Aplikacja napotkała nieoczekiwany błąd. Spróbuj ponownie albo zgłoś problem
            zespołowi.
          </Text>

          <View style={styles.errorBox}>
            <Text style={styles.errorLabel}>Treść błędu:</Text>
            <Text style={styles.errorMessage} numberOfLines={3}>{errorMessage}</Text>
            {__DEV__ && stackPreview && (
              <>
                <Text style={[styles.errorLabel, { marginTop: spacing.sm }]}>Stack (dev):</Text>
                <Text style={styles.errorStack}>{stackPreview}</Text>
              </>
            )}
          </View>

          <TouchableOpacity style={styles.retryButton} onPress={this.handleReset}>
            <Text style={styles.retryButtonText}>Spróbuj ponownie</Text>
          </TouchableOpacity>

          <Text style={styles.support}>
            Jeśli błąd się powtarza — napisz na support@nieruchomosciai.pl
          </Text>
        </ScrollView>
      </View>
    );
  }
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: {
    flexGrow: 1, justifyContent: 'center', alignItems: 'center',
    padding: spacing.xl,
  },
  emoji: { fontSize: 56, marginBottom: spacing.lg },
  title: { ...typography.h1, color: colors.text, textAlign: 'center' },
  subtitle: {
    ...typography.body, color: colors.textMuted, textAlign: 'center',
    marginTop: spacing.md, marginBottom: spacing.xl,
  },
  errorBox: {
    width: '100%', backgroundColor: '#FEF2F2', borderColor: '#FCA5A5', borderWidth: 1,
    padding: spacing.md, borderRadius: radii.md, marginBottom: spacing.xl,
  },
  errorLabel: { ...typography.tiny, color: '#991B1B', fontWeight: '600' },
  errorMessage: { ...typography.small, color: '#7F1D1D', marginTop: 4 },
  errorStack: { ...typography.tiny, color: '#7F1D1D', marginTop: 4, fontFamily: 'monospace' },
  retryButton: {
    backgroundColor: colors.brand,
    paddingHorizontal: spacing['2xl'], paddingVertical: spacing.md,
    borderRadius: radii.md,
  },
  retryButtonText: { ...typography.h3, color: colors.textInverse },
  support: {
    ...typography.tiny, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xl,
  },
});
