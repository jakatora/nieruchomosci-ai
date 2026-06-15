import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { setPushToken } from './auth';

/**
 * Expo Push registration — wywołane po loginu.
 * Token wysyłany na backend (`/auth/me/push-token`) — backend używa go w cron'ie
 * przy dziennych powiadomieniach o nowych dopasowaniach.
 */

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    console.warn('Push notifications only on physical devices, not simulators.');
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') {
    console.warn('Push notifications permission denied');
    return null;
  }

  const tokenObj = await Notifications.getExpoPushTokenAsync();
  const token = tokenObj.data;

  // Setup Android channel (recommended).
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#0D9488',
    });
  }

  // Zarejestruj na backendzie.
  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  try {
    await setPushToken(token, platform);
  } catch (err) {
    console.warn('setPushToken backend call failed:', err);
  }

  return token;
}
