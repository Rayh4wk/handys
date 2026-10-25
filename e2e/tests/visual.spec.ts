import { expect, test, type Page } from '@playwright/test';
import { changeCheckout, inspectionRow, openAs } from '../helpers';

// Layout smoke checks at desktop and phone widths: no horizontal page scroll and the key regions
// are on screen. Screenshots are attached to the report (the curated set for review lives in
// docs/screenshots, captured by `npm run screenshots`). Uses R-103 only, which no other spec
// touches (it stays NEEDS_CHECK either way: its cleaning task is a stayover, not a checkout task).

const WIDTHS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 390, height: 844 },
];

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function check(page: Page, name: string, regions: string[]): Promise<void> {
  for (const size of WIDTHS) {
    await page.setViewportSize(size);
    await expectNoHorizontalScroll(page);
    for (const id of regions) await expect(page.getByTestId(id).first()).toBeVisible();
    await test.info().attach(`${name}-${size.name}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  }
}

test('login screen fits desktop and phone widths', async ({ page }) => {
  await page.goto('/login');
  await check(page, 'login', ['login-username', 'login-password', 'login-submit']);
});

test('role screens fit desktop and phone widths', async ({ browser }) => {
  const A = await openAs(browser, 'agent');
  let B: Awaited<ReturnType<typeof openAs>> | undefined;
  try {
    await check(A.page, 'reservations', ['reservation-row-R-101', 'sse-state', 'logout']);

    const { status } = await changeCheckout(A.page, 'R-103', '2026-10-26T12:30', '고객 요청');
    expect(status).toBe(200);
    await expect(A.page.getByTestId('change-result')).toHaveAttribute('data-result', 'NEEDS_CHECK');
    await check(A.page, 'reservations-result', ['change-result']);

    B = await openAs(browser, 'ops');
    await inspectionRow(B.page, 'R-103').click();
    await expect(B.page.getByTestId('audit-log-item').first()).toBeVisible();
    await check(B.page, 'operations-detail', ['summary-CONFLICT', 'status-filter', 'detail-panel']);
  } finally {
    await A.context.close();
    await B?.context.close();
  }
});
