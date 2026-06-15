import React, { createContext, useContext, useCallback } from 'react';
import * as WebBrowser from 'expo-web-browser';
import { Alert } from 'react-native';
import { useAuth } from './AuthContext';
import { requestUpgradeLink } from '../services/auth';

interface SubscriptionContextValue {
  isPremium: boolean;
  isInvestor: boolean;
  startUpgrade: (plan: 'standard' | 'investor') => Promise<void>;
}

const SubscriptionContext = createContext<SubscriptionContextValue | null>(null);

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const { user, refresh } = useAuth();

  const isPremium = user ? user.premium_tier !== 'free' : false;
  const isInvestor = user?.premium_tier === 'investor';

  const startUpgrade = useCallback(async (plan: 'standard' | 'investor') => {
    if (!user) {
      Alert.alert('Brak konta', 'Zaloguj się aby aktywować subskrypcję.');
      return;
    }
    try {
      const { url } = await requestUpgradeLink(plan);
      // External browser — strategia iOS bypass Apple 30% (DEC-009).
      const result = await WebBrowser.openBrowserAsync(url);
      // Po zamknięciu external browsera odświeżamy stan usera (webhook Stripe
      // mógł właśnie zaktualizować premium_tier).
      if (result.type === 'cancel' || result.type === 'dismiss') {
        await refresh();
      }
    } catch (err) {
      const msg = (err as Error)?.message ?? 'Nieznany błąd';
      Alert.alert('Błąd aktywacji', msg);
    }
  }, [user, refresh]);

  return (
    <SubscriptionContext.Provider value={{ isPremium, isInvestor, startUpgrade }}>
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription(): SubscriptionContextValue {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) throw new Error('useSubscription must be used within SubscriptionProvider');
  return ctx;
}
