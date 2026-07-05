// e2e/specs/post-match.spec.ts
//
// The post-match screens on MatchRunPage (frontend/src/features/matching/
// MatchRunPage.tsx): the default "My Trades" tab (give + receive), the
// "Shipping & Payments" tab's payer/payee payment cards, and the
// organizer-only "Overview" tab's shipping rollup. Setup goes entirely
// through the API via seedMatchedEvent — only the post-match screens
// themselves are exercised through the UI.
import { test, expect } from '../helpers/fixtures'
import { archiveEvent } from '../helpers/api'
import { seedMatchedEvent } from '../helpers/seed'

test.describe('post-match screens', () => {
  let slug: string | undefined

  // Safety net: free the shared role accounts even if a test fails mid-way
  // (the backend allows one active event participation per user).
  test.afterEach(async ({ request, tokens }) => {
    if (slug) {
      await archiveEvent(request, tokens.organizer, slug)
      slug = undefined
    }
  })

  test('results page shows my assignments (give and receive)', async ({ pageAs, request, tokens }) => {
    ;({ slug } = await seedMatchedEvent(request, tokens))

    // Forced 3-cycle: alice offers her own listing and wants bob's, so she
    // gives E2E Game 01 (to carol) and receives E2E Game 02 (from bob).
    const page = await pageAs('alice')
    await page.goto(`/events/${slug}/matches`)
    await expect(page.getByText('You give')).toBeVisible()
    await expect(page.getByText('E2E Game 01').first()).toBeVisible()
    await expect(page.getByText('You receive')).toBeVisible()
    await expect(page.getByText('E2E Game 02').first()).toBeVisible()
  })

  test('payments: payer marks paid, receiver confirms', async ({ pageAs, request, tokens }) => {
    ;({ slug } = await seedMatchedEvent(request, tokens, { money: true }))

    // alice buys bob's priced listing outright, so alice is the payer and
    // bob is the payee (PaymentPayerCard / PaymentPayeeCard in MatchRunPage.tsx).
    const alice = await pageAs('alice')
    await alice.goto(`/events/${slug}/matches`)
    await alice.getByRole('button', { name: 'Shipping & Payments', exact: true }).click()
    await expect(alice.getByRole('button', { name: 'Mark paid' })).toBeVisible()
    await alice.getByRole('button', { name: 'Mark paid' }).click()
    await expect(alice.getByRole('button', { name: 'Mark paid' })).toBeHidden()

    const bob = await pageAs('bob')
    await bob.goto(`/events/${slug}/matches`)
    await bob.getByRole('button', { name: 'Shipping & Payments', exact: true }).click()
    await expect(bob.getByRole('button', { name: 'Confirm received' })).toBeVisible()
    await bob.getByRole('button', { name: 'Confirm received' }).click()
    await expect(bob.getByRole('button', { name: 'Confirm received' })).toBeHidden()
    await expect(bob.getByText('Confirmed', { exact: true })).toBeVisible()
  })

  test('shipping overview lists who ships to whom', async ({ pageAs, request, tokens }) => {
    ;({ slug } = await seedMatchedEvent(request, tokens))

    // ShippingOverviewTab is organizer-only, under the "Overview" tab.
    const page = await pageAs('organizer')
    await page.goto(`/events/${slug}/matches`)
    await page.getByRole('button', { name: 'Overview', exact: true }).click()

    // Alice gives Game 01 to carol (carol wanted alice's copy) — assert the
    // game name and its receiver show up together in the same shipment row.
    const row = page.locator('div')
      .filter({ hasText: 'E2E Game 01' })
      .filter({ hasText: 'e2e_carol' })
      .last()
    await expect(row).toBeVisible()
  })
})
