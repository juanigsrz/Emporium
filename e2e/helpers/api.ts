import { APIRequestContext, expect } from '@playwright/test'

export const API = 'http://localhost:8000/api'
export const PASSWORD = 'e2e-Sup3r-secret!'

export function authHeaders(token: string) {
  return { Authorization: `Token ${token}` }
}

async function post(
  request: APIRequestContext,
  path: string,
  data: object,
  token?: string,
) {
  return request.post(`${API}${path}`, {
    data,
    // Explicitly blank the Cookie header: registration auto-establishes a
    // Django session (allauth's complete_signup logs the user in regardless
    // of REST_AUTH.SESSION_LOGIN), and Playwright's request context persists
    // cookies across calls. Without this, a second registerOrLogin() call in
    // the same test would carry the previous user's sessionid cookie, DRF's
    // SessionAuthentication would authenticate as that stale user, and CSRF
    // enforcement would reject the anonymous POST with a 403.
    headers: { ...(token ? authHeaders(token) : {}), Cookie: '' },
  })
}

async function postOk(
  request: APIRequestContext,
  path: string,
  data: object,
  token?: string,
) {
  const res = await post(request, path, data, token)
  expect(res.ok(), `POST ${path} → ${res.status()}: ${await res.text()}`).toBe(true)
  return res.json()
}

export async function registerOrLogin(
  request: APIRequestContext,
  username: string,
): Promise<string> {
  const reg = await post(request, '/auth/registration/', {
    username,
    email: `${username}@e2e.local`,
    password1: PASSWORD,
    password2: PASSWORD,
  })
  if (reg.ok()) return (await reg.json()).key
  // Locally the server may be reused across runs (reuseExistingServer),
  // so the account can already exist — fall back to login.
  const body = await postOk(request, '/auth/login/', { username, password: PASSWORD })
  return body.key
}

export async function createEvent(
  request: APIRequestContext,
  token: string,
  name: string,
  extra: object = {},
): Promise<{ slug: string; name: string }> {
  return postOk(request, '/events/', { name, ...extra }, token)
}

const CHAIN = [
  'SUBMISSIONS_OPEN',
  'WANTLIST_OPEN',
  'MATCHING',
  'MATCH_REVIEW',
  'FINALIZATION',
  'SHIPPING',
  'ARCHIVED',
]

/** Walk an event forward from its current status to `target`. */
export async function advanceEvent(
  request: APIRequestContext,
  token: string,
  slug: string,
  target: string,
): Promise<void> {
  const cur = await request.get(`${API}/events/${slug}/`, { headers: authHeaders(token) })
  const status = (await cur.json()).status
  const start = CHAIN.indexOf(status) + 1 // -1+1 = 0 for DRAFT
  const end = CHAIN.indexOf(target)
  if (end < 0) throw new Error(`unknown target status ${target}`)
  for (const to of CHAIN.slice(start, end + 1)) {
    await postOk(request, `/events/${slug}/transition/`, { to }, token)
  }
}

export async function joinEvent(
  request: APIRequestContext,
  token: string,
  slug: string,
  body: object = {},
): Promise<void> {
  await postOk(request, `/events/${slug}/join/`, body, token)
}

// A user can only participate in one non-archived event at a time (server
// enforces this — see events/views.py _enforce_single_event), so specs that
// join a shared fixture role (alice/bob/...) to a throwaway event should leave
// it afterwards or the *next* run's joinEvent() 400s on "already participating".
export async function leaveEvent(
  request: APIRequestContext,
  token: string,
  slug: string,
): Promise<void> {
  const res = await request.delete(`${API}/events/${slug}/leave/`, {
    headers: authHeaders(token),
  })
  expect(res.ok(), `DELETE /events/${slug}/leave/ → ${res.status()}: ${await res.text()}`).toBe(true)
}

/** Archive an event so its participants are freed for the next test
 *  (the backend allows one active event participation per user). */
export async function archiveEvent(
  request: APIRequestContext,
  token: string,
  slug: string,
): Promise<void> {
  await advanceEvent(request, token, slug, 'ARCHIVED')
}

export async function createCopy(
  request: APIRequestContext,
  token: string,
  bggId: number,
): Promise<{ id: number }> {
  return postOk(
    request,
    '/copies/',
    { board_game: bggId, condition: 'GOOD', language: 'English' },
    token,
  )
}

export async function addListing(
  request: APIRequestContext,
  token: string,
  slug: string,
  copyId: number,
): Promise<{ id: number; listing_code: string }> {
  return postOk(request, `/events/${slug}/listings/`, { copy: copyId }, token)
}

export async function createOfferGroup(
  request: APIRequestContext,
  token: string,
  slug: string,
  body: { name: string; item_listing_ids: number[] },
): Promise<{ id: number }> {
  return postOk(request, `/events/${slug}/offer-groups/`, body, token)
}

export async function createWantGroup(
  request: APIRequestContext,
  token: string,
  slug: string,
  body: { name: string; items: { event_listing: number }[] },
): Promise<{ id: number }> {
  return postOk(request, `/events/${slug}/want-groups/`, body, token)
}

export async function createWish(
  request: APIRequestContext,
  token: string,
  slug: string,
  body: { offer_group: number; want_group: number },
): Promise<{ id: number }> {
  return postOk(request, `/events/${slug}/wishes/`, body, token)
}

export async function runMatch(
  request: APIRequestContext,
  token: string,
  slug: string,
): Promise<{ id: number; status: string }> {
  const run = await postOk(request, `/events/${slug}/matches/`, {}, token)
  // Celery is eager, so the run is usually DONE already; poll to be safe.
  await expect
    .poll(
      async () => {
        const res = await request.get(`${API}/events/${slug}/matches/${run.id}/`, {
          headers: authHeaders(token),
        })
        return (await res.json()).status
      },
      { timeout: 30_000 },
    )
    .toMatch(/DONE|FAILED/)
  const final = await request.get(`${API}/events/${slug}/matches/${run.id}/`, {
    headers: authHeaders(token),
  })
  const body = await final.json()
  expect(body.status, `match run failed: ${body.log}`).toBe('DONE')
  return body
}
