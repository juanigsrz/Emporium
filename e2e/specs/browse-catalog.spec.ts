// e2e/specs/browse-catalog.spec.ts
import { test, expect } from '../helpers/fixtures'
import {
  createEvent, advanceEvent, joinEvent, archiveEvent, createCopy, addListing, API, authHeaders,
} from '../helpers/api'

test.describe('event browse + event-scoped catalog', () => {
  let slug: string
  let eventName: string

  test.beforeAll(async ({ request, tokens }) => {
    eventName = `Browse Event ${Date.now()}`
    const event = await createEvent(request, tokens.organizer, eventName)
    slug = event.slug
    await advanceEvent(request, tokens.organizer, slug, 'SUBMISSIONS_OPEN')
    await joinEvent(request, tokens.alice, slug)
    // Two listed games so filters/ordering have something to bite on.
    for (const bgg of [900001, 900002]) {
      const copy = await createCopy(request, tokens.alice, bgg)
      await addListing(request, tokens.alice, slug, copy.id)
    }
  })

  // The server allows only one non-archived event participation per user —
  // without this, alice stays "stuck" here and the next run's beforeAll 400s
  // trying to join her to a fresh event. Archiving (rather than alice leaving)
  // frees every participant even if beforeAll died between createEvent and
  // joinEvent; the slug guard keeps a pre-createEvent failure from cascading.
  test.afterAll(async ({ request, tokens }) => {
    if (!slug) return
    await archiveEvent(request, tokens.organizer, slug)
  })

  test('events list shows the event; search finds it', async ({ pageAs }) => {
    const page = await pageAs('bob')
    await page.goto('/events')
    // EventsPage's filter input is a real <input type="search">.
    await page.getByRole('searchbox').fill(eventName)
    // Not getByText: EventsPage also renders a '1 event matching "<name>"'
    // results-count paragraph containing the same string, which would make a
    // plain text locator match two elements. The event card's title is a
    // heading (h3), so scope to that.
    await expect(page.getByRole('heading', { name: eventName })).toBeVisible()
  })

  // The event-scoped catalog (search / wishlisted / min-rating filters) does NOT
  // live on EventDetailPage — it's the default "Catalog" tab of My Wants
  // (frontend/src/features/trades/MyWantsPage.tsx, component GameBrowse), at
  // /events/:slug/wants, which is what GET /api/events/{slug}/games/ backs.
  // That route gates on the viewer being a participant AND having at least one
  // of their own event listings (MyWantsPage.tsx ~L1841 and ~L1898) — so alice
  // (joined + listed two games in beforeAll) is the browsing user below, not
  // bob, who never joins this event.
  test('event catalog lists the games with copies', async ({ pageAs }) => {
    const page = await pageAs('alice')
    await page.goto(`/events/${slug}/wants`)
    await expect(page.getByText('E2E Game 01')).toBeVisible()
    await expect(page.getByText('E2E Game 02')).toBeVisible()
  })

  test('game search filter narrows the event catalog', async ({ pageAs }) => {
    const page = await pageAs('alice')
    await page.goto(`/events/${slug}/wants`)
    // GameBrowse's search box is a plain <input placeholder="Search games
    // available in this event…">, not a searchbox role.
    await page.getByPlaceholder(/search games available/i).fill('E2E Game 01')
    await expect(page.getByText('E2E Game 01')).toBeVisible()
    await expect(page.getByText('E2E Game 02')).not.toBeVisible()
  })

  test('wishlist a game, then filter by wishlisted', async ({ pageAs, request, tokens }) => {
    const res = await request.post(`${API}/wishlists/`, {
      data: { board_game_bgg_id: 900001 },
      headers: authHeaders(tokens.alice),
    })
    // 400 = already wishlisted from a prior local run — Wishlist has a
    // unique_together(user, board_game_bgg_id) and, unlike game-ratings, POST
    // here isn't an upsert. reuseExistingServer keeps the sqlite DB warm across
    // local runs, so a repeat POST 400s; the entry exists either way, which is
    // all this test needs.
    expect([200, 201, 400], await res.text()).toContain(res.status())

    const page = await pageAs('alice')
    await page.goto(`/events/${slug}/wants`)
    // The wishlist filter is a checkbox inside a <label>text: "In my BGG
    // wishlist" — implicit label association gives it that accessible name.
    await page.getByRole('checkbox', { name: /in my bgg wishlist/i }).click()
    await expect(page.getByText('E2E Game 01')).toBeVisible()
    await expect(page.getByText('E2E Game 02')).not.toBeVisible()
  })

  test('personal rating powers the min-rating filter', async ({ pageAs, request, tokens }) => {
    // Rate Game 01 a 9.0 via the API (game-ratings POST is an upsert on
    // (user, board_game), so safe to re-run), then use the UI's min-rating
    // filter.
    const res = await request.post(`${API}/game-ratings/`, {
      data: { board_game: 900001, value: '9.0' },
      headers: authHeaders(tokens.alice),
    })
    expect(res.ok(), await res.text()).toBe(true)

    const page = await pageAs('alice')
    await page.goto(`/events/${slug}/wants`)
    // "Min personal rating" labels a number input (implicit <label> wrapping).
    await page.getByLabel(/min personal rating/i).fill('8')
    await expect(page.getByText('E2E Game 01')).toBeVisible()
    await expect(page.getByText('E2E Game 02')).not.toBeVisible()
  })
})
