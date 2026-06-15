import * as Linking from 'expo-linking';
import type { LinkingOptions } from '@react-navigation/native';

/**
 * Deep linking config — pozwala backend `/upgrade/success` na otwarcie aplikacji
 * przez `nieruchomosciai://upgrade-complete`.
 *
 * Type: any (deep nested navigator schemas są łatwiejsze gdy luźno typowane —
 * React Navigation generates types automatically when you use `Navigator.Screen`
 * z konkretnymi nazwami).
 */

export const linking: LinkingOptions<any> = {
  prefixes: [Linking.createURL('/'), 'nieruchomosciai://'],
  config: {
    screens: {
      Login: 'login',
      Register: 'register',
      MainTabs: {
        screens: {
          Today: 'today',
          Listings: 'listings',
          Investor: 'investor',
          Account: 'account',
        },
      },
      UpgradeComplete: 'upgrade-complete',
    },
  },
};
