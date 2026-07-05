// e2e/helpers/seed.ts
import { APIRequestContext, expect } from '@playwright/test'
import {
  API, authHeaders, createEvent, advanceEvent, joinEvent, createCopy,
  addListing, createOfferGroup, createWantGroup, createWish, runMatch,
} from './api'
import { Role, ROLES } from './fixtures'

/**
 * Event with alice/bob/carol joined, matched and DONE, then advanced to
 * SHIPPING — the status the post-match UI actually needs:
 *   - MatchRunPage.tsx `showShipping` (eventStatus === 'SHIPPING' || 'ARCHIVED')
 *     gates the "Shipping & Payments" tab (everyone) and the "Overview" tab
 *     (organizer-only, ShippingOverviewTab + PaymentsOverviewTab).
 *   - backend matching/views.py PaymentDetailView.patch (mark paid / confirm
 *     received) 403s unless event.status === 'SHIPPING' exactly (not ARCHIVED).
 * "My Trades" (the default tab) already works from MATCHING onward, but
 * advancing once here keeps the helper's output usable for every post-match
 * screen instead of gating some tests on the event status they happen to run at.
 *
 * opts.money deviates from a plain barter run: the internal FakeMatcher
 * (matching/fake_matcher.py — what POST /events/{slug}/matches/ i.e. runMatch()
 * runs) never writes TradeAssignment.cash_amount or a MatchRun.result
 * "settlement" plan, no matter what listings are priced. A barter swap is
 * ALSO always cash_amount=null even when both listings carry a sell_price
 * (matching/external_solver.py load_solution only prices `cash_purchases`
 * legs — see MatchRunPage.tsx's "Only CASH legs move money; barter is free"
 * comment). So running the normal 3-cycle through runMatch() with priced
 * listings would leave the Payments tab permanently empty — there's no API
 * path from "priced barter cycle" to a SettlementPayment row.
 * To get a real payable/confirmable payment, money mode instead skips the
 * barter wants/runMatch step and uploads a hand-built solver-output document
 * to POST /events/{slug}/matches/upload/ (the same endpoint the UI's "Upload
 * solution" panel posts to) with one `cash_purchases` leg: alice buys bob's
 * listing outright for $10, no reciprocation. Per matching/services.py
 * ensure_payments(), that yields one SettlementPayment(from=alice, to=bob) —
 * alice (the receiver of the priced copy) owes bob (the giver), matching
 * PaymentPayerCard/PaymentPayeeCard's payer/payee roles.
 */
export async function seedMatchedEvent(
  request: APIRequestContext,
  tokens: Record<Role, string>,
  opts: { money?: boolean } = {},
): Promise<{ slug: string; runId: number }> {
  const event = await createEvent(
    request,
    tokens.organizer,
    `Seeded Match ${Date.now()}`,
    opts.money ? { money_enabled: true } : {},
  )
  const slug = event.slug
  await advanceEvent(request, tokens.organizer, slug, 'SUBMISSIONS_OPEN')

  const players: Role[] = ['alice', 'bob', 'carol']
  const listings: Record<Role, { id: number; listing_code: string }> = {} as never
  for (const [i, role] of players.entries()) {
    await joinEvent(request, tokens[role], slug)
    const copy = await createCopy(request, tokens[role], 900001 + i)
    listings[role] = await addListing(request, tokens[role], slug, copy.id)
    if (opts.money) {
      // Price the listing (inputs are only writable pre-MATCHING) so the
      // solution document below has a real ask to reference.
      await request.patch(`${API}/events/${slug}/listings/${listings[role].id}/`, {
        data: { sell_price: '10.00' },
        headers: authHeaders(tokens[role]),
      })
    }
  }

  let runId: number

  if (opts.money) {
    await advanceEvent(request, tokens.organizer, slug, 'WANTLIST_OPEN')
    await advanceEvent(request, tokens.organizer, slug, 'MATCHING')

    // Hand-built "external solver" output: alice buys bob's listing for $10,
    // no barter reciprocation. See the doc comment above for why this can't
    // be produced via the normal runMatch() path.
    const doc = {
      version: '1.0.0',
      trades: [],
      combos: [],
      cash_purchases: [
        { item: listings.bob.listing_code, from: ROLES.bob, to: ROLES.alice, price: 1000 },
      ],
      cash_summary: [
        { user: ROLES.alice, spent: 1000, earned: 0, net: 1000, cap: null },
        { user: ROLES.bob, spent: 0, earned: 1000, net: -1000, cap: null },
      ],
      settlement: [{ from: ROLES.alice, to: ROLES.bob, amount: 1000 }],
    }
    const res = await request.post(`${API}/events/${slug}/matches/upload/`, {
      data: { output: JSON.stringify(doc) },
      headers: authHeaders(tokens.organizer),
    })
    expect(res.ok(), `POST matches/upload → ${res.status()}: ${await res.text()}`).toBe(true)
    runId = (await res.json()).id
  } else {
    await advanceEvent(request, tokens.organizer, slug, 'WANTLIST_OPEN')
    // alice→bob's, bob→carol's, carol→alice's
    const cycle: [Role, Role][] = [
      ['alice', 'bob'],
      ['bob', 'carol'],
      ['carol', 'alice'],
    ]
    for (const [wanter, owner] of cycle) {
      const og = await createOfferGroup(request, tokens[wanter], slug, {
        name: `og-${wanter}`,
        item_listing_ids: [listings[wanter].id],
      })
      const wg = await createWantGroup(request, tokens[wanter], slug, {
        name: `wg-${wanter}`,
        items: [{ event_listing: listings[owner].id }],
      })
      await createWish(request, tokens[wanter], slug, {
        offer_group: og.id,
        want_group: wg.id,
      })
    }

    await advanceEvent(request, tokens.organizer, slug, 'MATCHING')
    const run = await runMatch(request, tokens.organizer, slug)
    runId = run.id
  }

  await advanceEvent(request, tokens.organizer, slug, 'SHIPPING')

  return { slug, runId }
}
