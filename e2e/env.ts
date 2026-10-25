import { userInfo } from 'os';

/** Shared settings for the e2e run (Playwright config and specs). */
export const E2E_PORT = 3100;
export const BASE_URL = `http://localhost:${E2E_PORT}`;
// Same convention as apps/server/scripts/test-int.js: local Postgres, current OS user, no password.
const user = process.env.USER || userInfo().username;
export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? `postgresql://${user}@localhost:5432/handys_e2e`;
