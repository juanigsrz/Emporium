// e2e/specs/auth-profile.spec.ts
import { test, expect, ROLES } from '../helpers/fixtures'
import { PASSWORD } from '../helpers/api'

test('register a brand-new user through the UI', async ({ page }) => {
  const username = `e2e_reg_${Date.now()}`
  await page.goto('/register')
  await page.getByLabel('Username').fill(username)
  await page.getByLabel(/email/i).fill(`${username}@e2e.local`)
  // Register form has two password fields; fill both.
  const pw = page.getByLabel(/password/i)
  await pw.first().fill(PASSWORD)
  await pw.last().fill(PASSWORD)
  await page.getByRole('button', { name: /register|sign up|create/i }).click()
  await expect(page).not.toHaveURL(/\/register/)
})

test('bad credentials show an error and stay on /login', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Username').fill('e2e_alice')
  await page.getByLabel('Password').fill('wrong-password')
  // exact: true — the page also renders a "Sign in with Google" button, whose
  // accessible name contains "Sign in" as a substring.
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  // Regression guard for qa/BUG-004: backend returns 400, UI must show an
  // error and stay on /login. LoginPage.tsx (onSubmit catch, ~line 52-55)
  // prefers the backend's non_field_errors message over the local
  // login.errors.invalidCredentials fallback when the API includes one; DRF's
  // default login serializer (dj_rest_auth) returns exactly this string, so
  // that — not the i18n fallback the brief assumed — is what's on screen.
  await expect(page.getByText('Unable to log in with provided credentials.')).toBeVisible()
  await expect(page).toHaveURL(/\/login/)
})

test('logged-in user edits profile and sees public profile', async ({ pageAs }) => {
  const page = await pageAs('alice')
  await page.goto('/profile')
  const bio = page.getByLabel(/bio|about/i)
  await bio.fill('E2E bio text')
  await page.getByRole('button', { name: /save/i }).click()
  await expect(page.getByText(/saved|updated/i)).toBeVisible()

  await page.goto(`/u/${ROLES.alice}`)
  // "@username" is the unique fingerprint of the profile header (the display
  // name, shown separately, may or may not equal the username).
  await expect(page.getByText(`@${ROLES.alice}`)).toBeVisible()
  await expect(page.getByText('E2E bio text')).toBeVisible()
})

test('language switch changes visible UI strings', async ({ pageAs }) => {
  const page = await pageAs('alice')
  await page.goto('/')
  // The language switcher (frontend/src/components/LanguageSwitcher.tsx) is a
  // native <select aria-label="Language">, not a button+listbox combobox —
  // drive it with selectOption instead of click + option.
  await page.getByLabel('Language').selectOption('es')
  // exact: true — the homepage also has an "Explorar eventos" CTA and a
  // "...Eventos de intercambio" card link, both of which contain "Eventos".
  await expect(page.getByRole('link', { name: 'Eventos', exact: true })).toBeVisible()
})
