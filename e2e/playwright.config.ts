import { defineConfig, devices } from '@playwright/test';
import { join } from 'path';
import { BASE_URL, E2E_DATABASE_URL, E2E_PORT } from './env';

const serverDir = join(__dirname, '..', 'apps', 'server');

export default defineConfig({
  testDir: './tests',
  // Tests share one database and one server; each test owns its own reservation (see helpers).
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 5_000 },
  reporter: [['list']],
  globalSetup: require.resolve('./global-setup'),
  use: {
    ...devices['Desktop Chrome'],
    baseURL: BASE_URL,
    timezoneId: 'America/New_York',
    trace: 'retain-on-failure',
  },
  webServer: {
    // Runs the production build (root `npm run build` happens first in `npm run e2e`).
    command: 'node dist/main.js',
    cwd: serverDir,
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
