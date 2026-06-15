import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useAuth } from '../contexts/AuthContext';
import { LoginScreen } from '../screens/LoginScreen';
import { RegisterScreen } from '../screens/RegisterScreen';
import { TodayScreen } from '../screens/TodayScreen';
import { ListingsScreen } from '../screens/ListingsScreen';
import { ListingDetailScreen } from '../screens/ListingDetailScreen';
import { InvestorScreen } from '../screens/InvestorScreen';
import { AccountScreen } from '../screens/AccountScreen';
import { OnboardingScreen } from '../screens/OnboardingScreen';
import { colors } from '../theme';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function MainTabs() {
  const { user } = useAuth();
  return (
    <Tab.Navigator
      screenOptions={{
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.textMuted,
        headerStyle: { backgroundColor: colors.brand },
        headerTintColor: colors.textInverse,
      }}>
      <Tab.Screen name="Today" component={TodayScreen} options={{ title: 'Dziś' }} />
      <Tab.Screen name="Listings" component={ListingsScreen} options={{ title: 'Oferty' }} />
      {user?.user_type === 'investor' && (
        <Tab.Screen name="Investor" component={InvestorScreen} options={{ title: 'Inwestor' }} />
      )}
      <Tab.Screen name="Account" component={AccountScreen} options={{ title: 'Konto' }} />
    </Tab.Navigator>
  );
}

export function AppNavigator() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: colors.brand }, headerTintColor: colors.textInverse }}>
      {!user ? (
        <>
          <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Register" component={RegisterScreen} options={{ title: 'Rejestracja' }} />
        </>
      ) : !user.home_city ? (
        <Stack.Screen name="Onboarding" component={OnboardingScreen} options={{ headerShown: false }} />
      ) : (
        <>
          <Stack.Screen name="MainTabs" component={MainTabs} options={{ headerShown: false }} />
          <Stack.Screen name="ListingDetail" component={ListingDetailScreen} options={{ title: 'Oferta' }} />
        </>
      )}
    </Stack.Navigator>
  );
}
