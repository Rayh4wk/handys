// Captures the demo story (GOAL.md §14) at 1280px and 390px for visual review.
//
//   npm run setup                      # fresh seed (R-101: checkout 11:00, cleaning 11:30)
//   npm run dev
//   npm run screenshots                # → docs/screenshots/*.png
//
// Env: SCREENSHOT_URL (default http://localhost:5300), SCREENSHOT_DIR (default docs/screenshots).
// It changes R-101 through the UI, so run `npm run setup` again before re-capturing.
/* global document */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.SCREENSHOT_URL ?? 'http://localhost:5300';
const OUT = resolve(root, process.env.SCREENSHOT_DIR ?? 'docs/screenshots');
const WIDTHS = { desktop: { width: 1280, height: 800 }, mobile: { width: 390, height: 844 } };

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

async function shoot(page, name) {
  await page.evaluate(() => document.fonts.ready);
  for (const [label, size] of Object.entries(WIDTHS)) {
    await page.setViewportSize(size);
    await page.waitForTimeout(150);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    if (overflow > 0) console.warn(`  ! ${name} @${size.width}: horizontal overflow ${overflow}px`);
    const file = join(OUT, `${name}-${label}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log(`  ${file}`);
  }
  await page.setViewportSize(WIDTHS.desktop);
}

async function waitForRealtime(page) {
  await page.getByTestId('sse-state').and(page.locator('[data-state="open"]')).waitFor();
}

async function login(role) {
  const context = await browser.newContext({ viewport: WIDTHS.desktop, locale: 'ko-KR' });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByTestId('login-username').fill(role);
  await page.getByTestId('login-password').fill('demo1234');
  await page.getByTestId('login-submit').click();
  await waitForRealtime(page);
  return { context, page };
}

try {
  const anon = await browser.newContext({ viewport: WIDTHS.desktop, locale: 'ko-KR' });
  const loginPage = await anon.newPage();
  await loginPage.goto(`${BASE}/login`);
  await loginPage.getByTestId('login-submit').waitFor();
  await shoot(loginPage, '01-login');

  const A = await login('agent');
  const logs = await A.page.request.get(`${BASE}/api/reservations/R-101/audit-logs`);
  if ((await logs.json()).length > 0) {
    throw new Error('R-101 already has changes — run `npm run setup` first for a clean seed.');
  }
  await A.page.getByTestId('reservation-row-R-101').waitFor();
  await shoot(A.page, '02-reservations');

  const row = A.page.getByTestId('reservation-row-R-101');
  await row.click();
  await A.page.getByRole('region', { name: '선택한 예약' }).getByRole('button', { name: '체크아웃 변경' }).click();
  const editor = A.page.getByTestId('checkout-editor');
  await editor.getByTestId('checkout-input').fill('2026-10-26T13:00');
  await editor.getByTestId('checkout-reason').fill('고객 요청');
  await shoot(A.page, '03-reservations-editor');
  await editor.getByTestId('checkout-save').click();
  await A.page.locator('[data-testid="change-result"][data-result="CONFLICT"]').waitFor();
  await shoot(A.page, '04-reservations-conflict');

  const B = await login('ops');
  await B.page.getByTestId('inspection-row-R-101').waitFor();
  await shoot(B.page, '05-operations-action-required');

  await B.page.getByTestId('inspection-row-R-101').click();
  const panel = B.page.getByTestId('detail-panel');
  await panel.getByTestId('audit-log-item').first().waitFor();
  await shoot(B.page, '06-operations-detail');

  await panel.getByTestId('cleaning-input').fill('2026-10-26T13:30');
  await panel.getByTestId('cleaning-reason').fill('체크아웃 지연 반영');
  await panel.getByTestId('cleaning-save').click();
  await panel.getByTestId('recheck-result').waitFor();
  await panel.getByTestId('audit-log-item').nth(1).waitFor();
  await shoot(B.page, '07-operations-normal');

  await A.page.locator('[data-testid="change-result"][data-result="NORMAL"]').waitFor();
  await shoot(A.page, '08-reservations-normal');

  // Only the last shot needs the disconnect toggle, which appears with ?demo=1.
  await B.page.goto(`${BASE}/operations?demo=1`);
  await B.page.reload();
  await waitForRealtime(B.page);
  await B.page.getByTestId('summary-ALL').waitFor();
  await B.page.getByTestId('sse-toggle').click();
  await B.page.getByTestId('sse-warning').waitFor();
  await shoot(B.page, '09-operations-disconnected');
} finally {
  await browser.close();
}
