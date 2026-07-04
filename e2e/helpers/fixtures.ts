import { test as base, Page } from '@playwright/test'
import { registerOrLogin } from './api'

export const ROLES = {
  organizer: 'e2e_organizer',
  alice: 'e2e_alice',
  bob: 'e2e_bob',
  carol: 'e2e_carol',
} as const
export type Role = keyof typeof ROLES

type Fixtures = {
  pageAs: (role: Role) => Promise<Page>
  tokens: Record<Role, string>
}

export const test = base.extend<Fixtures>({
  pageAs: async ({ browser }, use) => {
    const pages: Page[] = []
    await use(async (role: Role) => {
      const context = await browser.newContext({
        storageState: `.auth/${ROLES[role]}.json`,
      })
      const page = await context.newPage()
      pages.push(page)
      return page
    })
    for (const p of pages) await p.context().close()
  },
  tokens: async ({ request }, use) => {
    const entries = await Promise.all(
      (Object.keys(ROLES) as Role[]).map(async (r) => [
        r,
        await registerOrLogin(request, ROLES[r]),
      ]),
    )
    await use(Object.fromEntries(entries) as Record<Role, string>)
  },
})

export { expect } from '@playwright/test'
