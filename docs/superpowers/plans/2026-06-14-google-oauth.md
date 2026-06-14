# Google Sign-In Implementation Plan

> **For agentic workers:** Backend provider config + endpoint; frontend GIS button. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let users sign in with Google via the GIS ID-token flow.

**Architecture:** Backend adds the allauth Google provider (settings-based `APP` from env) and a dj-rest-auth `GoogleLogin` endpoint. Frontend loads GIS, renders a button that exchanges the Google `credential` for an app token through that endpoint.

**Tech Stack:** Django + dj-rest-auth 7.2 + allauth 65.18; React + TS; Google Identity Services.

**Testing note:** OAuth round-trip needs real Google JWKS/token, so no automated backend test (per spec). Gate = `manage.py check` + existing suite green; `npm run build`/lint; manual sign-in.

---

### Task 1: Backend provider config

**Files:** Modify `backend/bgtrade/settings.py`.

- [ ] **Step 1:** Add `"allauth.socialaccount.providers.google",` to `INSTALLED_APPS`, immediately after `"allauth.socialaccount",`.

- [ ] **Step 2:** After the existing dj-rest-auth `REST_AUTH = {...}` block, add:
```python
# ---------------------------------------------------------------------------
# Google OAuth (GIS ID-token flow via dj-rest-auth GoogleLogin)
# ---------------------------------------------------------------------------
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

- [ ] **Step 3:** `cd backend && python manage.py check` → no errors.

---

### Task 2: Backend GoogleLogin endpoint

**Files:** Modify `backend/bgtrade/urls.py`.

- [ ] **Step 1:** Add imports near the top:
```python
from allauth.socialaccount.providers.google.views import GoogleOAuth2Adapter
from dj_rest_auth.registration.views import SocialLoginView
```

- [ ] **Step 2:** Remove the `oauth_google_stub` function and the
`api/auth/oauth/google/` route. Add the view (after the `health` helper):
```python
class GoogleLogin(SocialLoginView):
    adapter_class = GoogleOAuth2Adapter
```

- [ ] **Step 3:** Replace the removed stub route with:
```python
    # Google OAuth (GIS ID-token)
    path("api/auth/google/", GoogleLogin.as_view(), name="google-login"),
```

- [ ] **Step 4:** Remove now-unused imports if nothing else in the file uses them
(`api_view`, `permission_classes`, `AllowAny`, `Response`). Keep `JsonResponse`
(used by `health`).

- [ ] **Step 5:** `cd backend && python manage.py check` → clean. Then
`python manage.py test -v0` → stays green.

- [ ] **Step 6: Commit.**
```bash
git add backend/bgtrade/settings.py backend/bgtrade/urls.py
git commit -m "feat(auth): add Google OAuth provider + dj-rest-auth GoogleLogin endpoint"
```

---

### Task 3: Frontend — GIS script, API, types

**Files:** `frontend/index.html`, `frontend/src/api/auth.ts`, `frontend/src/vite-env.d.ts`.

- [ ] **Step 1:** In `frontend/index.html`, add inside `<head>`:
```html
    <script src="https://accounts.google.com/gsi/client" async></script>
```

- [ ] **Step 2:** In `src/api/auth.ts`, add:
```ts
export async function googleLoginApi(idToken: string): Promise<TokenResponse> {
  const { data } = await apiClient.post<TokenResponse>('/auth/google/', { id_token: idToken })
  return data
}
```

- [ ] **Step 3:** In `src/vite-env.d.ts`, append the GIS global type:
```ts
interface Window {
  google?: {
    accounts: {
      id: {
        initialize: (config: {
          client_id: string
          callback: (resp: { credential: string }) => void
        }) => void
        renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void
      }
    }
  }
}
```

---

### Task 4: Frontend — GoogleSignInButton component

**Files:** Create `frontend/src/components/GoogleSignInButton.tsx`.

- [ ] **Step 1:** Create the component:
```tsx
import { useEffect, useRef } from 'react'
import { googleLoginApi, fetchCurrentUser } from '../api/auth'
import { useAuthStore } from '../store/auth'

type Props = {
  onSuccess: () => void
  onError: (message: string) => void
}

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined

export default function GoogleSignInButton({ onSuccess, onError }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const setSession = useAuthStore((s) => s.setSession)

  useEffect(() => {
    if (!CLIENT_ID || !ref.current) return
    let cancelled = false

    async function handleCredential(resp: { credential: string }) {
      try {
        const { key } = await googleLoginApi(resp.credential)
        useAuthStore.setState({ token: key })
        const user = await fetchCurrentUser()
        setSession(key, user)
        onSuccess()
      } catch {
        onError('Google sign-in failed. Please try again.')
      }
    }

    // The GIS script loads async; poll until window.google is ready.
    const timer = setInterval(() => {
      if (cancelled || !window.google?.accounts?.id || !ref.current) return
      clearInterval(timer)
      window.google.accounts.id.initialize({
        client_id: CLIENT_ID!,
        callback: handleCredential,
      })
      window.google.accounts.id.renderButton(ref.current, {
        theme: 'outline',
        size: 'large',
        width: 320,
      })
    }, 100)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!CLIENT_ID) return null
  return <div ref={ref} className="flex justify-center" />
}
```

---

### Task 5: Frontend — add button to Login + Register

**Files:** `frontend/src/features/login/LoginPage.tsx`, `frontend/src/features/auth/RegisterPage.tsx`.

- [ ] **Step 1: LoginPage.** Import `GoogleSignInButton`. After the `</form>`
(inside the card), add a divider + button:
```tsx
          <div className="my-4 flex items-center gap-3 text-xs text-moss/60">
            <span className="h-px flex-1 bg-ink/10" />
            or
            <span className="h-px flex-1 bg-ink/10" />
          </div>
          <GoogleSignInButton
            onSuccess={() => navigate(from, { replace: true })}
            onError={setServerError}
          />
```

- [ ] **Step 2: RegisterPage.** Read the file first; mirror Step 1 using the page's
existing post-register navigation target (`navigate('/', { replace: true })`) and its
existing server-error setter. If RegisterPage's error state has a different name, use
that setter; if it lacks one, pass `onError={() => {}}` and rely on the existing error
surface — but prefer wiring to the real setter.

- [ ] **Step 3: Build + lint.**
Run: `cd frontend && npm run build` (succeeds) and `npm run lint` (no new warnings).

- [ ] **Step 4: Commit.**
```bash
git add frontend/index.html frontend/src/api/auth.ts frontend/src/vite-env.d.ts \
  frontend/src/components/GoogleSignInButton.tsx \
  frontend/src/features/login/LoginPage.tsx frontend/src/features/auth/RegisterPage.tsx
git commit -m "feat(auth): Google Sign-In button on login + register"
```

---

### Task 6: Local env + README

**Files:** `frontend/.env` (gitignored), `README.md`.

- [ ] **Step 1:** Add `VITE_GOOGLE_CLIENT_ID=<value>` to `frontend/.env`, using the
client ID from the environment (`$GOOGLE_OAUTH_CLIENT_ID`) if available, else a
placeholder for the user to fill. (This file is gitignored — not committed.)

- [ ] **Step 2:** In `README.md`, document the three env vars under the backend/
frontend setup: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` (backend),
and `VITE_GOOGLE_CLIENT_ID` (frontend). Commit the README change only.

```bash
git add README.md
git commit -m "docs: document Google OAuth env vars"
```

---

### Task 7: Manual verification

- [ ] `cd backend && python manage.py runserver` (with the env vars exported);
`POST /api/auth/google/` exists (Swagger or `curl` returns 400 "id_token or code
required", not 404/501).
- [ ] `cd frontend && npm run dev`; the Google button appears on Login + Register.
- [ ] Click the button, choose an account → logged in, session persists on refresh,
role-gated sections reflect the user (cache cleared by the B1 subscription).

---

## Self-Review

- **Spec coverage:** provider config → Task 1; endpoint → Task 2; GIS script/API/types
  → Task 3; button component → Task 4; page wiring → Task 5; env/README → Task 6. ✓
- **Placeholder scan:** none (RegisterPage step is conditional-but-explicit; resolved
  by reading the file during implementation). ✓
- **Type consistency:** `googleLoginApi` returns `TokenResponse` (`{ key }`), same as
  `loginApi`; `window.google` typed in `vite-env.d.ts`; `GoogleSignInButton` props
  `{ onSuccess, onError }` match both call sites. ✓
