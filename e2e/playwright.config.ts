import { defineConfig, devices } from '@playwright/test';
import { BASE_URL, E2E_DATABASE_URL, E2E_PORT } from './env';

export default defineConfig({
  testDir: './tests',
  // Tests share one database and one server; each test owns its own reservation (see helpers).
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 5_000 },
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: BASE_URL,
    timezoneId: 'America/New_York',
    trace: 'retain-on-failure',
  },
  webServer: {
    // Resets handys_e2e (guarded: name must contain "e2e"), then runs the production build
    // (root `npm run build` happens first in `npm run e2e`).
    command: 'node start-server.js',
    cwd: __dirname,
    url: `${BASE_URL}/login`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      PORT: String(E2E_PORT),
      DATABASE_URL: E2E_DATABASE_URL,
      SESSION_SECRET: 'e2e-session-secret',
    },
  },
});
