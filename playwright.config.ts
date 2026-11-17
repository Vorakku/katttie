import { defineConfig } from '@playwright/test';

const external = process.env.E2E_BASE_URL;
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  reporter: 'list',
  use: { baseURL: external || 'http://127.0.0.1:3000', trace: 'retain-on-failure' },
  projects: [
    { name: 'chrome', use: { browserName: 'chromium', channel: 'chrome' } },
    { name: 'edge', use: { browserName: 'chromium', channel: 'msedge' } },
  ],
  webServer: external ? undefined : {
    command: 'npm run build && node --import tsx e2e/server.ts', url: 'http://127.0.0.1:3000/api/health',
    reuseExistingServer: false, timeout: 30000,
  },
});
