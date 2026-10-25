import { expect, test } from '@playwright/test';
import { DEMO_PASSWORD, openAs } from '../helpers';

test('agent cannot open the operations screen', async ({ browser }) => {
  const A = await openAs(browser, 'agent');
  await A.page.goto('/operations');
  await expect(A.page.getByTestId('forbidden-notice')).toBeVisible();
  await expect(A.page.getByTestId('inspection-row-R-101')).toHaveCount(0);
  await A.context.close();
});

test('agent session gets 403 on the cleaning schedule API', async ({ browser }) => {
  const A = await openAs(browser, 'agent');
  const res = await A.page.request.patch('/api/cleaning-tasks/C-102/schedule', {
    data: { scheduledStartAt: '2026-10-26T13:45:00+09:00', version: 1 },
  });
  expect(res.status()).toBe(403);
  await A.context.close();
});

test('anonymous visitor is sent to the login page', async ({ page }) => {
  await page.goto('/reservations');
  await page.waitForURL('**/login');
  await expect(page.getByTestId('login-submit')).toBeVisible();
});

test('wrong password shows a login error', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('login-username').fill('agent');
  await page.getByTestId('login-password').fill(`${DEMO_PASSWORD}-wrong`);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('login-error')).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});
