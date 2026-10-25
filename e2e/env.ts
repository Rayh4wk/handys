/** Shared settings for the e2e run (Playwright config, global setup and specs). */
export const E2E_PORT = 3100;
export const BASE_URL = `http://localhost:${E2E_PORT}`;
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? 'postgresql://hskim@localhost:5432/handys_e2e';
