# Translations

UI text lives in `locales/<code>.json`, nested by feature namespace. `en.json`
is the base — its keys are the source of truth.

## Add a language

1. Copy `locales/en.json` to `locales/<code>.json` (e.g. `fr.json`).
2. Translate every value. Leave the keys unchanged.
3. In `locales/index.ts`, add one `import` and one entry to both `resources`
   and `languages`.
4. From `frontend/`, run `npm run check:i18n` — it must pass (every locale
   must have exactly the base's keys **and** be wired into `index.ts`), then
   open your PR.

Interpolation uses `{{name}}`. Plurals use `key` / `key_other` (see i18next
docs); a language with extra plural categories may add `_few` / `_many` keys —
if so, add the matching keys to `en.json` too so parity holds.
