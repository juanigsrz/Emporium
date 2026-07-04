import fs from 'fs'
import { test as setup, expect } from '@playwright/test'
import { registerOrLogin, PASSWORD } from '../helpers/api'

const ROLES = ['e2e_organizer', 'e2e_alice', 'e2e_bob', 'e2e_carol']

setup('create role accounts + storage states', async ({ request, browser }) => {
  fs.mkdirSync('.auth', { recursive: true })
  for (const username of ROLES) {
    await registerOrLogin(request, username)
    const page = await browser.newPage()
    await page.goto('/login')
    await page.getByLabel('Username').fill(username)
    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page).not.toHaveURL(/\/login/)
    await page.context().storageState({ path: `.auth/${username}.json` })
    await page.close()
  }
})
