// e2e/specs/trade-loop.spec.ts
//
// The core end-to-end journey: EVERY step goes through the UI.
// organizer creates event → alice/bob/carol join → each adds a copy →
// each lists it → each builds a forced 3-cycle want → organizer opens
// phases + runs the match → all three see their assigned trade.
//
// Only the final cleanup (archiving the event so the shared role accounts
// are freed — the backend allows one non-archived event per user) uses the
// API, via the same archiveEvent() helper other specs rely on.
import { test, expect, Role } from '../helpers/fixtures'
import type { Page } from '@playwright/test'
import { archiveEvent } from '../helpers/api'

// Organizer lifecycle transitions live on the EVENT DETAIL page
// (EventDetailPage.tsx OrganizerLifecycleControls, ~L221) — NOT on
// /events/:slug/manage, which is the per-participant admin view. Each
// transition is a two-step UI flow: "Advance to <label>" then a confirm
// dialog ("Advance event status?" → Confirm). `nextButton` is the
// following state's transition button — its appearance proves the
// transition landed (labels are unique per state, so no ambiguity).
async function advanceViaUI(org: Page, label: string, nextButton: string) {
  await org.getByRole('button', { name: `Advance to ${label}` }).click()
  await org.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(org.getByRole('button', { name: `Advance to ${nextButton}` })).toBeVisible()
}

test.describe('full trade loop through the UI', () => {
  let slug: string | undefined

  // Safety net: if the test fails mid-journey the event must still be
  // archived, or the next run's joins 400 ("already participating").
  // advanceEvent walks from the CURRENT status, so this is a no-op when
  // the test body already archived the event.
  test.afterAll(async ({ request, tokens }) => {
    if (slug) await archiveEvent(request, tokens.organizer, slug)
  })

  test('create → join → list → want → match → results', async ({ pageAs, request, tokens }) => {
    test.setTimeout(180_000) // multi-user journey, generous budget

    const eventName = `Trade Loop ${Date.now()}`

    // --- Organizer creates the event through the UI ---
    const org = await pageAs('organizer')
    await org.goto('/events')
    await org.getByRole('button', { name: 'Create event' }).click()
    // CreateEventModal is role=dialog aria-label "Create trade event". Its
    // name <label> has no htmlFor, so getByLabel can't reach the input —
    // target the placeholder instead. The submit button repeats the page
    // header's "Create event" text, so scope to the dialog.
    const createDialog = org.getByRole('dialog', { name: 'Create trade event' })
    await createDialog.getByPlaceholder('e.g. Spring 2026 Math Trade').fill(eventName)
    await createDialog.getByRole('button', { name: 'Create event' }).click()
    // On success the modal navigates straight to the event detail page.
    await org.waitForURL(/\/events\/[^/]+$/)
    slug = new URL(org.url()).pathname.split('/')[2]
    await expect(org.getByRole('heading', { name: eventName })).toBeVisible()

    // --- Organizer opens submissions (DRAFT → SUBMISSIONS_OPEN) ---
    await advanceViaUI(org, 'Open Submissions', 'Open Want Lists')

    // --- Alice, Bob, Carol: join, add a copy, list it ---
    // Forced 3-cycle setup: alice owns 01, bob owns 02, carol owns 03.
    const players: { role: Role; game: string; edition: string }[] = [
      { role: 'alice', game: 'E2E Game 01', edition: 'E2E Edition 01 (English)' },
      { role: 'bob', game: 'E2E Game 02', edition: 'E2E Edition 02 (English)' },
      { role: 'carol', game: 'E2E Game 03', edition: 'E2E Edition 03 (English)' },
    ]
    const pages = {} as Record<Role, Page>

    for (const p of players) {
      const page = await pageAs(p.role)
      pages[p.role] = page

      // Join the event.
      await page.goto(`/events/${slug}`)
      await page.getByRole('button', { name: 'Join event' }).click()
      await expect(page.getByText("You're participating")).toBeVisible()

      // Add a copy on My Copies (AddCopyModal: catalog typeahead → pick game
      // → CopyForm). The opener is "Add a copy", the submit is "Add copy".
      // first(): when the player owns no copies yet, the empty state renders
      // a second "Add a copy" CTA below the header button — both open the
      // same modal, and whether both exist depends on whether the copies
      // query resolves before the click (a race the header button avoids).
      await page.goto('/my-copies')
      await page.getByRole('button', { name: 'Add a copy' }).first().click()
      const copyDialog = page.getByRole('dialog', { name: 'Add a copy' })
      await copyDialog.getByPlaceholder('Search the catalog for a game you own…').fill(p.game)
      await copyDialog.getByRole('button', { name: p.game }).click()
      // CopyForm's only required choice is the edition (version_sel) — its
      // label has no htmlFor, so use the first combobox in the form (edition,
      // condition, sleeved render in that DOM order). Condition defaults to
      // Good. Picking the real seeded edition gives the copy language
      // "English", keeping is_pending false so it can be listed.
      await copyDialog.getByRole('combobox').first().selectOption({ label: p.edition })
      await copyDialog.getByRole('button', { name: 'Add copy', exact: true }).click()
      await expect(copyDialog).toBeHidden()
      // MyCopyCard titles are h3 headings. first(): local reruns against a
      // warm DB can leave an older copy of the same game.
      await expect(page.getByRole('heading', { name: p.game }).first()).toBeVisible()

      // List the copy in the event (EventDetailPage → MyListingsSection →
      // AddListingForm: a select with aria-label "Select copy to add" + an
      // "Add to event" button). Option labels embed the random listing code,
      // so resolve the option's value by its game-name text instead.
      await page.goto(`/events/${slug}`)
      const copySelect = page.getByLabel('Select copy to add')
      const option = copySelect.locator('option').filter({ hasText: p.game }).first()
      await expect(option).toBeAttached()
      await copySelect.selectOption((await option.getAttribute('value'))!)
      await page.getByRole('button', { name: 'Add to event' }).click()
      // The listing card's Remove button (aria-label "Remove listing") only
      // exists once the listing was created; the select option disappears too.
      const listings = page.locator('section').filter({ hasText: 'My Listings in This Event' })
      await expect(listings.getByRole('button', { name: 'Remove listing' })).toBeVisible()
      // visible-filter: if the player owns a SECOND copy of the same game
      // (browse-catalog's leftovers give alice one), the add-listing select
      // still holds a hidden <option> with this text — only the listing
      // card's name is actually visible.
      await expect(listings.getByText(p.game).filter({ visible: true }).first()).toBeVisible()
    }

    // --- Organizer opens the want-list phase (SUBMISSIONS_OPEN → WANTLIST_OPEN) ---
    await advanceViaUI(org, 'Open Want Lists', 'Start Matching')

    // --- Forced 3-cycle wants via the My Wants catalog UI ---
    // alice wants bob's 02, bob wants carol's 03, carol wants alice's 01.
    // Flow per player (GameBrowse, MyWantsPage.tsx): search the target game,
    // click "+ Want any copy" (stages every other-owned copy as a target and
    // auto-expands the card), then tick the own item under "Your items that
    // offer this game" — only that toggle stages a saveable change — then Save.
    const wants: { role: Role; own: string; target: string }[] = [
      { role: 'alice', own: 'E2E Game 01', target: 'E2E Game 02' },
      { role: 'bob', own: 'E2E Game 02', target: 'E2E Game 03' },
      { role: 'carol', own: 'E2E Game 03', target: 'E2E Game 01' },
    ]
    for (const w of wants) {
      const page = pages[w.role]
      await page.goto(`/events/${slug}/wants`)
      await page.getByPlaceholder('Search games available in this event…').fill(w.target)
      // Wait for the search to narrow the grid to the one matching card so
      // the un-scoped "+ Want any copy" click can't hit another game's card.
      await expect(page.getByRole('button', { name: '+ Want any copy' })).toHaveCount(1)
      await page.getByRole('button', { name: '+ Want any copy' }).click()
      // Offer checkbox's implicit-label name is "<game name> <listing code>".
      await page.getByRole('checkbox', { name: w.own }).check()
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      // The sticky save bar disappears once persistChanges + refetch land.
      await expect(page.getByText(/unsaved change/)).toBeHidden()
      await expect(page.getByRole('button', { name: 'Wanted ✓' })).toBeVisible()
    }

    // --- Organizer moves to MATCHING and runs the match ---
    await advanceViaUI(org, 'Start Matching', 'Open Match Review')
    // The run trigger lives on the matches page (MatchRunPage.tsx,
    // TriggerRunButton), organizer-only and MATCHING-only.
    await org.goto(`/events/${slug}/matches`)
    await org.getByRole('button', { name: 'Run matching' }).click()
    // Celery is eager so the run completes near-instantly; the "Done" status
    // pill renders in both the run list and the live run view — first() picks
    // whichever lands first.
    await expect(org.getByText('Done', { exact: true }).first()).toBeVisible({ timeout: 30_000 })

    // --- All three users see their assigned trade in the results UI ---
    for (const w of wants) {
      const page = pages[w.role]
      await page.goto(`/events/${slug}/matches`)
      // Default tab is My Trades: one giving card (own game) and one
      // receiving card (the wanted game) close the forced 3-cycle.
      await expect(page.getByText('You receive')).toBeVisible()
      await expect(page.getByText(w.target).first()).toBeVisible()
      await expect(page.getByText('You give')).toBeVisible()
      await expect(page.getByText(w.own).first()).toBeVisible()
    }

    // Free the shared role accounts for the next iteration/run here in the
    // test body: with --repeat-each the afterAll only runs once after ALL
    // iterations, so iteration 2's joins would 400 if this waited for it.
    await archiveEvent(request, tokens.organizer, slug)
  })
})
