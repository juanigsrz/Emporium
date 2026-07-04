import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './specs',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    locale: 'en-US',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      // Fresh DB every run: delete-first here rather than in globalSetup,
      // because Playwright starts webServers before globalSetup runs.
      command:
        'cd ../backend && rm -f e2e.sqlite3 && E2E_TESTS=1 .venv/bin/python3 manage.py migrate --no-input && E2E_TESTS=1 .venv/bin/python3 manage.py seed_e2e_catalog && E2E_TESTS=1 .venv/bin/python3 manage.py runserver 8000 --noreload',
      url: 'http://localhost:8000/api/schema/',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'cd ../frontend && npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
})
