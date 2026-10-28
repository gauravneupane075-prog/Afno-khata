# Khata – private personal finance tracker

Offline-first web app (PWA). Data lives in the phone's IndexedDB and is never sent anywhere.

## Run locally
    npm install
    npm test            # unit + UI smoke tests
    npx serve www       # or any static server; service workers need https or localhost

## Deploy and install (automatic updates)
1. GitHub repo → Settings → Pages → Source: **GitHub Actions** (free Pages needs a public repo).
2. Push to `main`. The workflow runs checks and tests, stamps the release into `sw.js`, and publishes `www/`.
3. On the phone open `https://<user>.github.io/<repo>/` in Chrome → menu → **Install app**.
4. After each push, the installed app notices the new version (on open, and hourly) and shows **Update now**.
   Tapping it swaps to the new files and reloads. Saved records are untouched. The first visit and each update need internet.

## First launch, updates, restores
- New install: all accounts are Cash/Bank/Wallet/Savings at 0, no transactions. Set real starting money under Menu → Accounts → Opening.
- Update: existing data is migrated by schema version, never reset. Restore: Menu → Import JSON (merge or replace; replace downloads a safety backup first).
- Old v1 backups from the first APK import fine.

## APK (optional)
Actions → "Build Android APK (manual)". Changes to `www/` only reach an installed APK by installing a new APK (and it is debug-signed, so
uninstall/reinstall wipes data: export a backup first). Prefer the installed web app.

## Security notes
CSP blocks all network except the app's own origin. All stored text is HTML-escaped; imports are validated and size-limited.
Not done: `unsafe-inline` is still allowed for scripts (inline handlers), no encryption at rest, no app lock. GitHub Pages cannot set HTTP security headers.
