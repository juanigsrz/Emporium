# Google Sign-In (GIS ID-token)

**Date:** 2026-06-14
**Batch:** B2 (Auth, second half) — Google OAuth login.
**Scope:** Backend (`bgtrade/settings.py`, `bgtrade/urls.py`) + frontend
(`index.html`, `api/auth.ts`, new `components/GoogleSignInButton.tsx`, `LoginPage`,
`RegisterPage`, a type decl, `frontend/.env`). No data-model change, no migration.

## Problem

The app advertises OAuth-readiness but Google login is only a `501` stub. Users
should be able to sign in with Google.

## Approach

Google Identity Services (GIS) **ID-token** flow:

1. Frontend renders the GIS "Sign in with Google" button (needs only the OAuth
   **client ID** + an authorized JavaScript origin — already set to
   `http://localhost:5173`; no redirect URI required).
2. On success GIS returns a `credential` (a Google-signed ID token JWT).
3. Frontend `POST`s `{ id_token: credential }` to dj-rest-auth's `GoogleLogin`.
4. dj-rest-auth 7.2 `SocialLoginSerializer` accepts `id_token`; allauth 65.18
   `GoogleOAuth2Adapter.complete_login` verifies the JWT signature against Google's
   JWKS and validates `aud` against the configured client ID, then logs in / signs
   up the user and returns a dj-rest-auth token `{ "key": "..." }`.

Verified locally: `SocialLoginSerializer` has an `id_token` field; the Google adapter
`_verify_and_decode`s an `id_token`. The existing `post_save` signal on `User`
(`accounts/signals.py`) auto-creates the `Profile` for social signups too.

## Backend

### `bgtrade/settings.py`

- Add `"allauth.socialaccount.providers.google"` to `INSTALLED_APPS` (after
  `"allauth.socialaccount"`).
- Add provider config (settings-based `APP`, so no DB `SocialApp` row is needed):

```python
GOOGLE_OAUTH_CLIENT_ID = os.environ.get("GOOGLE_OAUTH_CLIENT_ID", "")
GOOGLE_OAUTH_CLIENT_SECRET = os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET", "")

SOCIALACCOUNT_PROVIDERS = {
    "google": {
        "APP": {
            "client_id": GOOGLE_OAUTH_CLIENT_ID,
            "secret": GOOGLE_OAUTH_CLIENT_SECRET,
            "key": "",
        },
        "SCOPE": ["profile", "email"],
        "AUTH_PARAMS": {"access_type": "online"},
    }
}
```

The `secret` is read from the environment only — never committed. (For the ID-token
flow the signature is verified via JWKS using the public client ID; the secret is
present for provider-config completeness.)

### `bgtrade/urls.py`

- Remove `oauth_google_stub` (and its `api/auth/oauth/google/` route) plus the now
  unused `api_view` / `permission_classes` / `AllowAny` / `Response` imports if no
  longer referenced elsewhere in the file.
- Add:

```python
from allauth.socialaccount.providers.google.views import GoogleOAuth2Adapter
from dj_rest_auth.registration.views import SocialLoginView


class GoogleLogin(SocialLoginView):
    adapter_class = GoogleOAuth2Adapter
```

- Route: `path("api/auth/google/", GoogleLogin.as_view(), name="google-login")`.

No migration: the Google provider ships no models of its own.

## Frontend

### `index.html`

Add before `</body>` (or in `<head>`): `<script src="https://accounts.google.com/gsi/client" async></script>`.

### `src/api/auth.ts`

```ts
export async function googleLoginApi(idToken: string): Promise<TokenResponse> {
  const { data } = await apiClient.post<TokenResponse>('/auth/google/', { id_token: idToken })
  return data
}
```

### `src/components/GoogleSignInButton.tsx` (new)

- Reads `const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined`.
  If falsy → render `null` (feature simply absent when unconfigured).
- `useEffect`: poll for `window.google?.accounts?.id` (the GIS script may still be
  loading); once present, `initialize({ client_id: clientId, callback })` and
  `renderButton(ref.current, { theme: 'outline', size: 'large', width: 320 })`.
- `callback(response: { credential: string })`:
  - `const { key } = await googleLoginApi(response.credential)`
  - `useAuthStore.setState({ token: key })` (so the next request is authenticated)
  - `const user = await fetchCurrentUser(); setSession(key, user)`
  - on error: surface via an `onError(message)` prop.
  - navigate via an `onSuccess()` prop (page decides where to go).
- Props: `{ onSuccess: () => void; onError: (msg: string) => void }`.
- B1's auth-store subscription clears the React Query cache automatically when the
  token changes — no extra handling here.

### `src/vite-env.d.ts` (or a small new `google-gsi.d.ts`)

Add a minimal global declaration:

```ts
interface Window {
  google?: {
    accounts: {
      id: {
        initialize: (config: { client_id: string; callback: (resp: { credential: string }) => void }) => void
        renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void
      }
    }
  }
}
```

### `LoginPage.tsx` / `RegisterPage.tsx`

Below the existing form, add an "or" divider and `<GoogleSignInButton onSuccess={() => navigate(from /* '/' for register */ , { replace: true })} onError={setServerError} />`. Reuse each page's existing `navigate` and error state.

### `frontend/.env` (gitignored)

Add `VITE_GOOGLE_CLIENT_ID=` — the user pastes the client ID value locally. Document
the var in `README.md` (the env file itself is not committed).

## Out of scope

- Account linking by email (left at allauth default: auto-signup creates a distinct
  user from the Google profile; `ACCOUNT_EMAIL_VERIFICATION` is already `"none"`).
- One Tap / auto-select prompt, refresh tokens, logout-from-Google.
- Backend automated tests for the OAuth round-trip (would require mocking Google JWKS
  + a signed token; manual verification for this test-version feature). `manage.py
  check` and the existing suite must stay green.

## Verification

- `cd backend && python manage.py check` passes; `python manage.py test` stays green;
  with env vars set, `manage.py runserver` exposes `POST /api/auth/google/`.
- `cd frontend && npm run build` + `npm run lint` (no new warnings).
- Manual (with `VITE_GOOGLE_CLIENT_ID` + backend env vars set): the Google button
  appears on Login/Register; clicking it and choosing an account logs in, persists the
  session across refresh, and role-gated sections reflect the signed-in user.

## Risk / Rollback

Moderate (auth surface). Additive endpoint + provider config + frontend button; no
schema or existing-flow change (password login untouched). If `VITE_GOOGLE_CLIENT_ID`
is unset the button is absent and nothing else changes. Rollback = revert the branch.
