# Mobile assets — TODO

Ten folder MUSI zawierać następujące pliki PRZED `eas build`:

| Plik | Rozmiar | Co to |
|------|---------|-------|
| `icon.png` | 1024×1024 PNG, no alpha | App icon (App Store + Play) |
| `adaptive-icon.png` | 1080×1080 PNG | Android adaptive icon (foreground) |
| `splash.png` | 1284×2778 PNG | Splash screen (na teal #0D9488 background) |
| `favicon.png` | 512×512 PNG | Web favicon (jeśli ever wsparcie web) |

## Skąd je wziąć

Wszystko z folderu `nieruchomosci-ai/store/` po wygenerowaniu logo. Patrz `PUBLIKACJA_TODO.md` § Logo + brand assets.

Tymczasowo (do testów lokalnych przez `expo start`) — Expo użyje swoich default'ów. Build dla store NIE zadziała bez tych plików.

## Quick gen z PowerShell

Jeśli masz tylko `icon-1024.png`, możesz wygenerować resztę przez Sharp / ImageMagick:

```powershell
# Wymaga ImageMagick zainstalowanego (https://imagemagick.org)
magick icon-1024.png -resize 1080x1080 adaptive-icon.png
magick icon-1024.png -resize 512x512 favicon.png

# Splash — pusty canvas z logo centered (wymaga więcej parametrów)
magick -size 1284x2778 xc:"#0D9488" -gravity center -compose over icon-1024.png -composite splash.png
```

Albo wygeneruj wszystko naraz w https://www.appicon.co (free, 1 upload → wszystkie rozmiary).
