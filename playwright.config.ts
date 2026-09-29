import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'test',
  use: { baseURL: 'http://localhost:8080' },
  webServer: { command: 'node scripts/serve.js', url: 'http://localhost:8080/app/' },
  projects: [
    { name: 'chromium', use: devices['Desktop Chrome'] },
    { name: 'firefox', use: devices['Desktop Firefox'] },
    { name: 'webkit', use: devices['Desktop Safari'] },
  ],
})
