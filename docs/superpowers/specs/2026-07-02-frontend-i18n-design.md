# Frontend internationalization (i18n) — design

Date: 2026-07-02

Add internationalization to the React frontend so users can pick a display
language, and congregate all user-facing UI text into per-language files that
outside contributors can extend with a new language in a single PR.

**Scope: frontend UI only.** Backend-generated text (Django email templates,
notification bodies, API error messages) is explicitly out of scope for this
work and stays English. Date/number localization is also out of scope. Both are
noted as follow-ups at the end.

---

## Goals

1. Every hardcoded, user-visible string in `frontend/src` is served through a
   translation lookup instead of being inlined in JSX.
2. A user can select a language from the navbar; the choice persists across
   reloads and is applied on next visit.
3. Adding a new language is a low-friction PR: copy one file, translate its
   values, register it in one place.
4. A guard prevents contributor PRs from silently shipping a locale with missing
   or extra keys relative to the English base.

Ships with two real locales: **English** (base) and **Spanish**.

---

## Approach

Use **react-i18next** (`i18next` + `react-i18next` +
`i18next-browser-languagedetector`). It is the standard React i18n stack, uses
plain JSON locale files, and supports interpolation and pluralization, which the
app already needs (e.g. "1 copy" / "N copies", notification counts).

Rejected alternatives:

- **FormatJS / react-intl** — powerful ICU tooling but a heavier API
  (`defineMessages`, message extraction build step). Overkill for ~25
  components.
- **Custom React context + `t()`** — zero dependencies, but reinvents
  interpolation, pluralization, and language detection, and gives contributors a
  non-standard workflow.

New dependencies (frontend): `i18next`, `react-i18next`,
`i18next-browser-languagedetector`.

---

## File layout

One JSON file per language keeps the contributor workflow to a single file to
copy and translate.

```
frontend/src/i18n/
  index.ts            # i18next initialization
  locales/
    index.ts          # registry: locale resources + languages[] metadata
    en.json           # base locale; source of truth for key shape
    es.json           # Spanish; identical key shape, translated values
```

`en.json` is nested by feature namespace, mirroring `frontend/src/features/`:

```json
{
  "common":   { "save": "Save", "cancel": "Cancel", "loading": "Loading…", ... },
  "nav":      { "events": "Events", "myCopies": "My copies", ... },
  "auth":     { ... },
  "login":    { ... },
  "home":     { ... },
  "events":   { ... },
  "trades":   { ... },
  "copies":   { ... },
  "matching": { ... },
  "profile":  { ... }
}
```

Keys are referenced dot-namespaced, e.g. `t('common.save')`,
`t('events.createTitle')`. Generic, reused strings (Save, Cancel, Delete,
Loading, error toasts) live under `common` so they are translated once.

`locales/index.ts` is the single registration point:

```ts
import en from './en.json';
import es from './es.json';

export const resources = { en: { translation: en }, es: { translation: es } };

export const languages = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
];
```

---

## Adding a language (contributor PR workflow)

Documented in a short `frontend/src/i18n/README.md`:

1. Copy `locales/en.json` to `locales/<code>.json`.
2. Translate every value; leave the keys unchanged.
3. In `locales/index.ts`, add one import and one entry to both `resources` and
   `languages`.
4. Run `npm run check:i18n` to confirm key parity, then open the PR.

Two files touched, both mechanical.

---

## Initialization and language selection

`i18n/index.ts` initializes i18next with the registry `resources`,
`fallbackLng: 'en'`, and `i18next-browser-languagedetector` configured to read
in order: **localStorage → browser `navigator.language` → `en`**, and to write
the chosen language back to localStorage (key `i18nextLng`). Imported once for
its side effect in `main.tsx` before the app renders.

**Language switcher.** A globe-icon dropdown added to `NavBar`, listing
`languages[]` by label. `onChange` calls `i18n.changeLanguage(code)`; the
detector persists the choice. The current language is read from
`i18n.resolvedLanguage`.

No backend or user-profile field — persistence is client-side only, consistent
with the frontend-only scope.

---

## Extraction

The bulk of the work: replace inline strings with `t('ns.key')` via the
`useTranslation` hook, one feature at a time, populating `en.json` and `es.json`
as each file is converted.

Namespaces and their source files:

- `common` — shared across features: `components/` (`NavBar`, `BackButton`,
  `ConfirmDialog`, `GoogleSignInButton`, `RequireAuth`), generic buttons/toasts.
- `nav` — `components/NavBar.tsx`.
- `auth` / `login` — `features/auth/RegisterPage.tsx`,
  `features/login/LoginPage.tsx`.
- `home` — `features/home/HomePage.tsx`.
- `events` — `features/events/` (`EventsPage`, `EventDetailPage`,
  `ManageEventPage`, `StatusBadge`).
- `trades` — `features/trades/` (`MyWantsPage`, `WantListBuilderPage`).
- `copies` — `features/copies/` (`MyCopiesPage`, `CopyForm`).
- `matching` — `features/matching/` (`MatchRunPage`, `PaymentsOverviewTab`,
  `ShippingOverviewTab`).
- `profile` — `features/profile/` (`ProfilePage`, `PublicProfilePage`).

Interpolation and plurals use i18next syntax: `t('copies.count', { count })`
with `copies.count` / `copies.count_other` plural keys where a count is shown.

Zod form validation messages are moved into locale keys and passed through `t()`
at schema construction (or via a small message map), so form errors are also
translated.

---

## Guardrail: locale key parity

`scripts/check-i18n.mjs`, run via `npm run check:i18n`, loads every file in
`locales/`, deep-flattens each to its set of dot-keys, and compares every locale
against `en.json`. It exits non-zero and prints the offending keys if any locale
is missing a key or has an extra one. No new test-runner dependency — a plain
Node script. This is the CI-friendly gate for contributor PRs.

---

## Verification

- `npm run check:i18n` passes for `en` and `es`.
- `npm run build` (`tsc -b && vite build`) succeeds — no untyped `t` keys break
  the type check.
- Manual: switching the navbar language flips all visible text; a hard reload
  keeps the chosen language; clearing localStorage and setting the browser to an
  unsupported language falls back to English.
- Spot-check a pluralized string (copies count / notifications) in both locales.

---

## Out of scope (follow-ups)

- Backend text: Django email templates, notification bodies, API error strings
  (would use Django's `gettext` — a separate effort spanning the backend).
- Date, number, and currency localization via `Intl` / i18next formatters.
- Persisting language choice to the user's server-side profile for cross-device
  sync.
