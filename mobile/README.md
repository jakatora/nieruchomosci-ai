# NieruchomościAI — mobile app (Android + iOS)

React Native + Expo SDK 51 z TypeScript. Spina się z backendem `nieruchomosci-ai/backend` (lokalnie `http://localhost:3000`, w prod URL Railway).

## Architektura

```
mobile/
├── App.tsx                                    Root + providers (Auth, Subscription, Query)
├── app.json                                   Expo config (package pl.nieruchomosciai.app + bundle iOS)
├── index.ts                                   Entry point
├── src/
│   ├── theme.ts                              Brand colors (teal #0D9488 + coral #FB7185)
│   ├── services/
│   │   ├── api.ts                           Fetch wrapper + Bearer token
│   │   ├── auth.ts                          /auth endpoints
│   │   ├── listings.ts, searches.ts, investor.ts
│   │   ├── storage.ts                       SecureStore JWT
│   │   └── notifications.ts                 Expo Push registration
│   ├── contexts/
│   │   ├── AuthContext.tsx                  Token bootstrap + login/register
│   │   └── SubscriptionContext.tsx          Stripe upgrade via external browser
│   ├── navigation/
│   │   ├── AppNavigator.tsx                 Stack + Tabs (Today / Listings / Investor / Account)
│   │   └── linking.ts                       Deep linking (nieruchomosciai://...)
│   ├── screens/
│   │   ├── LoginScreen, RegisterScreen, OnboardingScreen
│   │   ├── TodayScreen, ListingsScreen, ListingDetailScreen
│   │   ├── InvestorScreen, AccountScreen
│   └── components/
│       ├── ListingCard, PriceFairnessBadge, ROIPanel
└── README.md (ten plik)
```

## Setup

```bash
cd mobile
npm install
# Expo Go App (Android / iOS) — zeskanuj QR z `npm start`
npm start
# albo bezpośrednio:
npm run android   # Android emulator/device
npm run ios       # iOS simulator (tylko macOS)
```

## Konfiguracja API URL

Backend URL żyje w [app.json](app.json#L43) → `expo.extra.apiBaseUrl`:

- **Dev** (lokalnie): `http://localhost:3000` — działa w Expo Go gdy backend uruchomiony
- **Dev (telefon)**: zmień na `http://<TWOJ_IP_LAN>:3000` — backend musi nasłuchiwać na 0.0.0.0
- **Prod**: `https://nieruchomosciai.up.railway.app` (Railway URL — ustaw przed EAS build)

## Funkcje (wszystko działa z backendem)

- **Auth**: email + hasło, magic-link (passwordless dla iOS — nie zaimplementowany w UI jeszcze; flow gotowy w `services/auth.ts`)
- **Onboarding split**: krok 1 wybór profilu (Kupujący / Inwestor) → krok 2 setup miasta + zakres ceny → tworzy pierwszy search
- **Today**: top 10 nowych ofert + paywall przy free tier (3 z N)
- **Listings**: pełna lista z fair-price badge, sortowanie po cenie m²
- **Detail**: ListingCard + Comparables + ROI (jeśli Investor) + paywall blok + link „Otwórz na Domiporta"
- **Investor dashboard**: top 20 wg yield_net, summary stats, ranking z fairness badge
- **Account**: zmiana user_type, push/email toggle, upgrade do Standard/Investor (otwiera external browser → backend `/upgrade`)
- **Push**: registracja po loginu, token wysłany na backend, daily cron wyśle powiadomienia

## Build do produkcji

```bash
# Wymaga konta Expo + EAS CLI: npm i -g eas-cli; eas login
eas build --platform android --profile preview        # APK do testów lokalnie
eas build --platform android --profile production     # AAB do Google Play
eas build --platform ios --profile production         # IPA do App Store (wymaga Apple Developer)
eas submit --platform android                         # auto-upload do Google Play Console
eas submit --platform ios                             # auto-upload do App Store Connect
```

Przed `eas build`:

1. **Apple Developer account** ($99/rok) — bundle ID `pl.nieruchomosciai.app` zarejestrowany
2. **Google Play Console** ($25 jednorazowo) — package `pl.nieruchomosciai.app` zarejestrowany
3. **eas.json** (do utworzenia) — profile config z env vars (`apiBaseUrl` = Railway URL)
4. **Icon + splash** — 1024×1024 PNG w `assets/` (gdy logo gotowe — patrz BLK-03)

## Testowanie lokalnie

Backend musi być uruchomiony na `localhost:3000`:

```bash
# Terminal 1
cd ../backend && npm start

# Terminal 2
cd mobile && npm start
# Zeskanuj QR code z aplikacji Expo Go na telefonie
```

Konto testowe (z backendu):

- `jakub.consumer@test.local` / `haslo123!` (premium_tier: free)
- `jakub.investor@test.local` / `haslo123!` (premium_tier: investor)

## Brakujące przed publikacją (TODO)

- `assets/icon.png` (1024×1024), `assets/splash.png` (1284×2778) — logo (BLK-03)
- `assets/adaptive-icon.png` (1080×1080) — Android adaptive icon
- `mobile/eas.json` z deploy profiles
- Apple Developer account + bundle ID rejestracja
- Google Play Console + package rejestracja
- Privacy Policy URL (już istnieje pod `<API>/legal/privacy`)
- App Store + Google Play store listings (screenshoty, copy)

Patrz `nieruchomosci-ai/store/README.md` (gdy utworzony) dla wymagań materiałów store.
