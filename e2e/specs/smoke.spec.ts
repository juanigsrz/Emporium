import { test, expect } from '@playwright/test'

test('home page renders and API is reachable', async ({ page, request }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/Emporium/)
  const games = await request.get('http://localhost:8000/api/games/?search=E2E Game')
  expect(games.ok()).toBe(true)
  expect((await games.json()).count).toBeGreaterThanOrEqual(20)
})
