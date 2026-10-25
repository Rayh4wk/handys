import { expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { BASE_URL } from './env';

export type DemoRole = 'agent' | 'ops';

const HOME: Record<DemoRole, string> = { agent: '/reservations', ops: '/operations' };
export const DEMO_PASSWORD = 'demo1234';

export interface RolePage {
  context: BrowserContext;
  page: Page;
}

/**
 * New isolated browser context (own cookies — a separate "person"), logged in as `role`, sitting
 * on the role's home page with the realtime (SSE) connection open.
 */
export async function openAs(
  browser: Browser,
  role: DemoRole,
  opts: { context?: BrowserContext } = {},
): Promise<RolePage> {
  const context =
    opts.context ?? (await browser.newContext({ baseURL: BASE_URL, timezoneId: 'America/New_York' }));
  const page = await context.newPage();
  // ?demo=1 shows the demo-only realtime disconnect toggle (data-testid="sse-toggle").
  await page.goto('/login?demo=1');
  if (!page.url().endsWith(HOME[role])) {
    await page.getByTestId('login-username').fill(role);
    await page.getByTestId('login-password').fill(DEMO_PASSWORD);
    await page.getByTestId('login-submit').click();
  }
  await page.waitForURL(`**${HOME[role]}`);
  await expect(page.getByTestId('sse-state')).toHaveAttribute('data-state', 'open');
  return { context, page };
}

/** Second tab in an existing (logged-in) context. */
export async function openTab(context: BrowserContext, path: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${path}${path.includes('?') ? '&' : '?'}demo=1`);
  await expect(page.getByTestId('sse-state')).toHaveAttribute('data-state', 'open');
  return page;
}

export function reservationRow(page: Page, id: string): Locator {
  return page.getByTestId(`reservation-row-${id}`);
}

export function inspectionRow(page: Page, id: string): Locator {
  return page.getByTestId(`inspection-row-${id}`);
}

/**
 * Ops table columns: 0 id, 1 room, 2 checkout, 3 cleaning, 4 badge, 5 reason. The cleaning cell
 * also carries a relative line ("N시간 후"), so its time is read from `.time-main`.
 */
export function opsCell(page: Page, id: string, col: 'checkout' | 'cleaning'): Locator {
  const cell = inspectionRow(page, id).locator('td');
  return col === 'checkout' ? cell.nth(2) : cell.nth(3).locator('.time-main');
}

export function badge(row: Locator): Locator {
  return row.getByTestId('status-badge');
}

/** Ops list filter via the summary tiles: 'ALL', 'ACTION_REQUIRED' or a judgment status. */
export async function setOpsFilter(page: Page, value: string): Promise<void> {
  const tile = page.getByTestId(`summary-${value}`);
  await tile.click();
  await expect(tile).toHaveAttribute('aria-pressed', 'true');
}

/** Opens the checkout editor on the agent screen: select the row, then the detail panel's action. */
export async function openCheckoutEditor(page: Page, id: string): Promise<Locator> {
  await reservationRow(page, id).click();
  await page.getByRole('region', { name: '선택한 예약' }).getByRole('button', { name: '체크아웃 변경' }).click();
  const editor = page.getByTestId('checkout-editor');
  await expect(editor).toBeVisible();
  return editor;
}

/**
 * Agent: change checkout via the UI. Times are the browser's own wall-clock timing of the PATCH
 * (Resource Timing via Playwright: request start and response end, epoch ms).
 */
export async function changeCheckout(
  page: Page,
  id: string,
  local: string,
  reason: string,
): Promise<{ requestedAt: number; respondedAt: number; status: number }> {
  const editor = await openCheckoutEditor(page, id);
  await editor.getByTestId('checkout-input').fill(local);
  await editor.getByTestId('checkout-reason').fill(reason);
  const [res] = await Promise.all([
    page.waitForResponse(
      (r) => r.request().method() === 'PATCH' && r.url().includes(`/api/reservations/${id}/checkout`),
    ),
    editor.getByTestId('checkout-save').click(),
  ]);
  await res.finished();
  const t = res.request().timing();
  const respondedAt = t.responseEnd >= 0 ? t.startTime + t.responseEnd : Date.now();
  return { requestedAt: t.startTime, respondedAt, status: res.status() };
}

/** Ops: open the detail panel and change the cleaning start via the UI. */
export async function changeCleaning(page: Page, id: string, local: string, reason?: string): Promise<number> {
  await inspectionRow(page, id).click();
  const panel = page.getByTestId('detail-panel');
  await panel.getByTestId('cleaning-input').fill(local);
  if (reason) await panel.getByTestId('cleaning-reason').fill(reason);
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes('/api/cleaning-tasks/')),
    panel.getByTestId('cleaning-save').click(),
  ]);
  return res.status();
}

/** "YYYY-MM-DDTHH:mm" + minutes, as a datetime-local string (pure wall-clock arithmetic). */
export function addMinutes(local: string, minutes: number): string {
  const [d, t] = local.split('T');
  const [y, mo, day] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, day, h, mi + minutes));
  return dt.toISOString().slice(0, 16);
}

/** "2026-10-26T13:30" → "10/26 13:30" (how the tables render KST date-times). */
export function displayOf(local: string): string {
  const [d, t] = local.split('T');
  const [, mo, day] = d.split('-');
  return `${mo}/${day} ${t}`;
}
