import { test, expect } from '@playwright/test'
import {
  registerOrLogin, createEvent, advanceEvent, joinEvent,
  createCopy, addListing, createOfferGroup, createWantGroup,
  createWish, runMatch,
} from '../helpers/api'

test('helpers drive a full 2-cycle through the API', async ({ request }) => {
  const t1 = await registerOrLogin(request, 'e2e_api_u1')
  const t2 = await registerOrLogin(request, 'e2e_api_u2')

  const event = await createEvent(request, t1, `API Helper Event ${Date.now()}`)
  await advanceEvent(request, t1, event.slug, 'SUBMISSIONS_OPEN')
  await joinEvent(request, t1, event.slug)
  await joinEvent(request, t2, event.slug)

  const c1 = await createCopy(request, t1, 900001)
  const c2 = await createCopy(request, t2, 900002)
  const l1 = await addListing(request, t1, event.slug, c1.id)
  const l2 = await addListing(request, t2, event.slug, c2.id)

  await advanceEvent(request, t1, event.slug, 'WANTLIST_OPEN')
  // u1 offers l1, wants l2; u2 offers l2, wants l1 → forced 2-cycle
  const og1 = await createOfferGroup(request, t1, event.slug, { name: 'og1', item_listing_ids: [l1.id] })
  const wg1 = await createWantGroup(request, t1, event.slug, { name: 'wg1', items: [{ event_listing: l2.id }] })
  await createWish(request, t1, event.slug, { offer_group: og1.id, want_group: wg1.id })
  const og2 = await createOfferGroup(request, t2, event.slug, { name: 'og2', item_listing_ids: [l2.id] })
  const wg2 = await createWantGroup(request, t2, event.slug, { name: 'wg2', items: [{ event_listing: l1.id }] })
  await createWish(request, t2, event.slug, { offer_group: og2.id, want_group: wg2.id })

  await advanceEvent(request, t1, event.slug, 'MATCHING')
  const run = await runMatch(request, t1, event.slug)
  expect(run.status).toBe('DONE')
})
