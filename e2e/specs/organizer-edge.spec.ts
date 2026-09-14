// e2e/specs/organizer-edge.spec.ts
//
// Organizer/participant edge cases that the happy-path trade-loop spec never
// exercises: the wantlist going read-only once MATCHING starts, the
// require_location join gate, a pending (unlistable) copy, which lifecycle
// transitions the organizer control surfaces for the CURRENT status, that a
// non-organizer never sees organizer/manage affordances, and the advanced
// X-to-Y builder's caps (OfferGroup.max_give) + combo bundling.
//
// Lifecycle transition controls live on the EVENT DETAIL page
// (EventDetailPage.tsx OrganizerLifecycleControls, ~L221) — NOT on
// /events/:slug/manage (ManageEventPage.tsx is the per-participant admin view:
// listings/offer-groups/want-groups/wishes/kick for one selected participant).
import { execSync } from 'child_process'
import path from 'path'
import { test, expect } from '../helpers/fixtures'
import {
  API, authHeaders, createEvent, advanceEvent, joinEvent, createCopy, addListing,
  archiveEvent,
} from '../helpers/api'

test.describe('organizer edge cases', () => {
  let slug: string | undefined

  // Safety net: free the shared role accounts even if a test fails mid-way
  // (the backend allows one active event participation per user).
  test.afterEach(async ({ request, tokens }) => {
    if (slug) {
      await archiveEvent(request, tokens.organizer, slug)
      slug = undefined
    }
  })

  test('wantlist is read-only once event reaches MATCHING', async ({ pageAs, request, tokens }) => {
    const event = await createEvent(request, tokens.organizer, `Lock Event ${Date.now()}`)
    slug = event.slug
    await advanceEvent(request, tokens.organizer, slug, 'SUBMISSIONS_OPEN')
    await joinEvent(request, tokens.alice, slug)
    const copy = await createCopy(request, tokens.alice, 900001)
    await addListing(request, tokens.alice, slug, copy.id)
    await advanceEvent(request, tokens.organizer, slug, 'MATCHING')

    // MyWantsPage.tsx renders trades.lockedBanner when event.inputs_locked
    // (true from MATCHING onward) and hides the sticky Save bar entirely.
    const page = await pageAs('alice')
    await page.goto(`/events/${slug}/wants`)
    await expect(page.getByText(/locked for matching/i)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0)
  })

  test('join gate: require_location blocks a user without a location', async ({ pageAs, request, tokens }) => {
    const event = await createEvent(request, tokens.organizer, `Gated Event ${Date.now()}`, {
      require_location: true,
    })
    slug = event.slug
    await advanceEvent(request, tokens.organizer, slug, 'SUBMISSIONS_OPEN')

    // bob (a shared role account) has no profile location set — the backend's
    // _enforce_location_gate rejects the join with a "location" field error,
    // which JoinLeaveButton surfaces inline next to the Join button. Assert
    // the EXACT backend error string (events/views.py _enforce_location_gate):
    // a loose /location/i would always match the static "Location required"
    // badge the header renders for any require_location event, and would pass
    // even if the gate were broken and the join succeeded.
    const page = await pageAs('bob')
    await page.goto(`/events/${slug}`)
    await page.getByRole('button', { name: 'Join event' }).click()
    await expect(
      page.getByText('Set your location on your profile to join this event.'),
    ).toBeVisible()
    // And the join really failed: still a Join button, no participating state.
    await expect(page.getByRole('button', { name: 'Join event' })).toBeVisible()
    await expect(page.getByText("You're participating")).toHaveCount(0)
  })

  test('pending copy cannot be listed (400 surfaced at the API)', async ({ request, tokens }) => {
    const event = await createEvent(request, tokens.organizer, `Pending Event ${Date.now()}`)
    slug = event.slug
    await advanceEvent(request, tokens.organizer, slug, 'SUBMISSIONS_OPEN')
    await joinEvent(request, tokens.alice, slug)

    // A pending copy is NOT creatable through the public API: POST /copies/
    // never recomputes is_pending (CopySerializer.create in
    // copies/serializers.py), so even a condition-less copy lands with
    // is_pending=False. Pending copies are only born in the BGG importer
    // (bgg/importers.py: Copy(...) + recompute_pending()), which needs live
    // BGG fetches. Seed one the exact way the importer does, straight into
    // the E2E database (E2E_TESTS=1 → e2e.sqlite3, same DB the server uses).
    const backend = path.resolve(__dirname, '../../backend')
    const out = execSync(
      `"${backend}/.venv/bin/python3" manage.py shell -c "` +
      `from django.contrib.auth import get_user_model; from copies.models import Copy; ` +
      `u = get_user_model().objects.get(username='e2e_alice'); ` +
      `c = Copy(owner=u, board_game_id=900005, import_source='BGG_OWNED'); ` +
      `c.recompute_pending(); c.save(); print(c.id)"`,
      { encoding: 'utf8', cwd: backend, env: { ...process.env, E2E_TESTS: '1' } },
    )
    const copyId = Number(out.trim().split('\n').pop())
    expect(Number.isInteger(copyId)).toBe(true)

    // The API agrees the copy is pending…
    const copyRes = await request.get(`${API}/copies/${copyId}/`, {
      headers: authHeaders(tokens.alice),
    })
    expect((await copyRes.json()).is_pending).toBe(true)

    // …and the add-listing endpoint rejects it (events/views.py is_pending guard).
    const listing = await request.post(`${API}/events/${slug}/listings/`, {
      data: { copy: copyId },
      headers: authHeaders(tokens.alice),
    })
    expect(listing.status()).toBe(400)
    expect(await listing.text()).toContain('incomplete')
  })

  test('organizer sees only allowed transitions for current status', async ({ pageAs, request, tokens }) => {
    const event = await createEvent(request, tokens.organizer, `Transitions ${Date.now()}`)
    slug = event.slug

    // A freshly-created event is DRAFT, whose only allowed transition is
    // SUBMISSIONS_OPEN (ALLOWED_TRANSITIONS in events/models.py) — the
    // organizer's lifecycle controls should render exactly that one button.
    const page = await pageAs('organizer')
    await page.goto(`/events/${slug}`)
    await expect(page.getByRole('button', { name: 'Advance to Open Submissions', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Advance to/ })).toHaveCount(1)
    await expect(page.getByRole('button', { name: /finalization/i })).toHaveCount(0)
  })

  test('non-organizer sees no organizer/manage controls', async ({ pageAs, request, tokens }) => {
    const event = await createEvent(request, tokens.organizer, `NoManage ${Date.now()}`)
    slug = event.slug

    const page = await pageAs('alice')

    // ManageEventPage.tsx checks event.is_organizer and renders an inline
    // "not organizer" message instead of the admin panels — no route bounce.
    await page.goto(`/events/${slug}/manage`)
    await expect(page.getByText('Only the organizer can manage this event.')).toBeVisible()
    await expect(page.getByRole('button', { name: /kick/i })).toHaveCount(0)

    // The organizer-only lifecycle transition controls (EventDetailPage.tsx
    // OrganizerLifecycleControls) must not render for alice either.
    await page.goto(`/events/${slug}`)
    await expect(page.getByRole('button', { name: /advance to/i })).toHaveCount(0)
  })

  test('builder advanced panel exposes caps and combos', async ({ pageAs, request, tokens }) => {
    const event = await createEvent(request, tokens.organizer, `Caps ${Date.now()}`)
    slug = event.slug
    // Deliberately stays at SUBMISSIONS_OPEN (the brief advanced to
    // WANTLIST_OPEN): combos lock once want-lists open (combo_views.py
    // _assert_editable → submissions_locked), so the combo seed below must
    // happen before that anyway, and the builder's edit affordances render in
    // both statuses (its `locked` = inputs_locked, which only flips at MATCHING).
    await advanceEvent(request, tokens.organizer, slug, 'SUBMISSIONS_OPEN')
    await joinEvent(request, tokens.alice, slug)
    const copy1 = await createCopy(request, tokens.alice, 900001)
    const copy2 = await createCopy(request, tokens.alice, 900002)
    const listing1 = await addListing(request, tokens.alice, slug, copy1.id)
    const listing2 = await addListing(request, tokens.alice, slug, copy2.id)

    // A combo bundles 2+ of alice's own listings. No helper exists for this
    // endpoint, so hit it directly (same pattern as the pending-copy test).
    const comboRes = await request.post(`${API}/events/${slug}/combos/`, {
      data: { name: 'Bundle', item_listing_ids: [listing1.id, listing2.id] },
      headers: authHeaders(tokens.alice),
    })
    expect(comboRes.ok(), `POST combos → ${comboRes.status()}: ${await comboRes.text()}`).toBe(true)

    const page = await pageAs('alice')
    await page.goto(`/events/${slug}/builder`)

    // Offer Groups tab (default): X is how many of the group alice gives
    // (exactly X, the solver's NforM semantics; the field is still called
    // max_give in the API). Since she owns a combo, the form also offers
    // bundling it in as a single give-unit.
    await page.getByRole('button', { name: '+ New offer group' }).click()
    await expect(page.getByText(/give \(x\)/i).first()).toBeVisible()
    await expect(page.getByText(/combo/i).first()).toBeVisible()

    // Caps tab: TAKE/GIVE caps are a separate advanced-builder-only affordance.
    await page.getByRole('button', { name: 'Caps', exact: true }).click()
    await expect(page.getByRole('button', { name: '+ New cap' })).toBeVisible()
  })
})
