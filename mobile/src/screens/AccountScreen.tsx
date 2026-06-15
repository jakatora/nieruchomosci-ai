import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, Switch, Alert, Linking, StyleSheet } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import { useSubscription } from '../contexts/SubscriptionContext';
import { updateNotifPrefs, updateProfile } from '../services/auth';
import { colors, spacing, radii, typography } from '../theme';

export function AccountScreen() {
  const { user, logout, refresh } = useAuth();
  const { isPremium, isInvestor, startUpgrade } = useSubscription();

  if (!user) return null;

  const toggleUserType = async () => {
    const newType = user.user_type === 'consumer' ? 'investor' : 'consumer';
    Alert.alert(
      'Zmiana profilu',
      `Przełączyć profil na ${newType === 'investor' ? 'Inwestor' : 'Kupujący'}? Aplikacja dostosuje funkcje.`,
      [
        { text: 'Anuluj', style: 'cancel' },
        { text: 'Zmień', onPress: async () => {
          try { await updateProfile({ user_type: newType }); await refresh(); }
          catch (err) { Alert.alert('Błąd', (err as Error).message); }
        }},
      ],
    );
  };

  const togglePush = async (value: boolean) => {
    try { await updateNotifPrefs({ notif_push: value }); await refresh(); }
    catch (err) { Alert.alert('Błąd', (err as Error).message); }
  };

  const toggleEmail = async (value: boolean) => {
    try { await updateNotifPrefs({ notif_email: value }); await refresh(); }
    catch (err) { Alert.alert('Błąd', (err as Error).message); }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Konto</Text>
        <Row label="Email" value={user.email} />
        <Row label="Plan" value={
          user.premium_tier === 'free' ? 'Free (darmowy)'
          : user.premium_tier === 'standard' ? 'Standard (39 PLN/mc)'
          : 'Investor (149 PLN/mc)'
        } highlight={isPremium} />
        <Row label="Miasto" value={user.home_city ?? 'nie ustawione'} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Profil</Text>
        <TouchableOpacity onPress={toggleUserType} style={styles.profileToggle}>
          <View style={{ flex: 1 }}>
            <Text style={styles.profileLabel}>
              {user.user_type === 'investor' ? '🏢 Profil: Inwestor' : '🏠 Profil: Kupujący'}
            </Text>
            <Text style={styles.profileSub}>
              {user.user_type === 'investor' ? 'AI liczy ROI, yield, payback' : 'AI ostrzega o red-flagach i cenie'}
            </Text>
          </View>
          <Text style={styles.changeText}>Zmień →</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Powiadomienia</Text>
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Push (nowe oferty)</Text>
          <Switch value={Boolean(user.notif_push)} onValueChange={togglePush}
            trackColor={{ true: colors.brand, false: colors.border }} />
        </View>
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Email (digest dzienny)</Text>
          <Switch value={Boolean(user.notif_email)} onValueChange={toggleEmail}
            trackColor={{ true: colors.brand, false: colors.border }} />
        </View>
      </View>

      {!isPremium && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Aktywuj subskrypcję</Text>
          <TouchableOpacity style={styles.planCard} onPress={() => startUpgrade('standard')}>
            <Text style={styles.planTitle}>Standard — 39 PLN/mc</Text>
            <Text style={styles.planDesc}>Nielimitowane wyniki, push, red-flagi, mapa.</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.planCard, styles.planCardInvestor]} onPress={() => startUpgrade('investor')}>
            <Text style={styles.planTitle}>Investor — 149 PLN/mc</Text>
            <Text style={styles.planDesc}>Wszystko z Standard + ROI calc + CSV export.</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.section}>
        <TouchableOpacity onPress={() => Linking.openURL('https://nieruchomosciai.up.railway.app/legal/privacy')} style={styles.linkRow}>
          <Text style={styles.linkText}>Polityka prywatności</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => Linking.openURL('https://nieruchomosciai.up.railway.app/legal/terms')} style={styles.linkRow}>
          <Text style={styles.linkText}>Regulamin</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => Linking.openURL('mailto:support@nieruchomosciai.pl')} style={styles.linkRow}>
          <Text style={styles.linkText}>Kontakt: support@nieruchomosciai.pl</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <TouchableOpacity style={styles.logoutButton} onPress={() => {
          Alert.alert('Wyloguj', 'Wylogować się?', [
            { text: 'Anuluj', style: 'cancel' },
            { text: 'Wyloguj', style: 'destructive', onPress: logout },
          ]);
        }}>
          <Text style={styles.logoutText}>Wyloguj</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, highlight && { color: colors.brand, fontWeight: '700' }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  section: { backgroundColor: colors.card, padding: spacing.lg, marginBottom: spacing.md },
  sectionTitle: { ...typography.h3, color: colors.text, marginBottom: spacing.md },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs },
  rowLabel: { ...typography.body, color: colors.textMuted },
  rowValue: { ...typography.body, color: colors.text, flex: 1, textAlign: 'right' },
  profileToggle: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  profileLabel: { ...typography.h3, color: colors.text },
  profileSub: { ...typography.small, color: colors.textMuted, marginTop: spacing.xs },
  changeText: { ...typography.body, color: colors.brand, fontWeight: '600' },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm },
  switchLabel: { ...typography.body, color: colors.text },
  planCard: { backgroundColor: '#F0FDFA', padding: spacing.md, borderRadius: radii.md, marginBottom: spacing.sm, borderLeftWidth: 4, borderLeftColor: colors.brand },
  planCardInvestor: { backgroundColor: '#FFF1F2', borderLeftColor: colors.accent },
  planTitle: { ...typography.h3, color: colors.text },
  planDesc: { ...typography.small, color: colors.textMuted, marginTop: spacing.xs },
  linkRow: { paddingVertical: spacing.sm },
  linkText: { ...typography.body, color: colors.brand },
  logoutButton: { padding: spacing.md, alignItems: 'center' },
  logoutText: { ...typography.body, color: colors.danger, fontWeight: '600' },
});
