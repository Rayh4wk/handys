import { expect, test, type Page } from '@playwright/test';
import { writeFileSync } from 'fs';
import { join } from 'path';
import {
  addMinutes,
  badge,
  changeCheckout,
  changeCleaning,
  displayOf,
  inspectionRow,
  openAs,
  openCheckoutEditor,
  openTab,
  opsCell,
  setOpsFilter,
} from '../helpers';

const LATENCY_FILE = join(__dirname, '..', 'latency.json');

/** Current checkout of a reservation as a datetime-local value, read from the agent editor. */
async function currentCheckout(page: Page, id: string): Promise<string> {
  const editor = await openCheckoutEditor(page, id);
  const value = await editor.getByTestId('checkout-input').inputValue();
  await editor.getByRole('button', { name: '취소' }).click();
  return value;
}

/** Ops: current cleaning start (datetime-local) from the detail panel form. */
async function currentCleaning(page: Page, id: string): Promise<string> {
  await inspectionRow(page, id).click();
  return page.getByTestId('detail-panel').getByTestId('cleaning-input').inputValue();
}

/**
 * Resolves (in the page) with Date.now() at the first DOM change where the badge of `rowTestId`
 * no longer has `from` as data-status.
 */
function badgeChangeAt(page: Page, rowTestId: string, from: string): Promise<number> {
  return page.evaluate(
    ([testId, before]) =>
      new Promise<number>((resolve) => {
        const current = () =>
          document
            .querySelector(`[data-testid="${testId}"] [data-testid="status-badge"]`)
            ?.getAttribute('data-status');
        const observer = new MutationObserver(() => {
          const s = current();
          if (s && s !== before) {
            observer.disconnect();
            resolve(Date.now());
          }
        });
        observer.observe(document.body, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ['data-status'],
        });
      }),
    [rowTestId, from] as const,
  );
}

test('measures cross-screen latency', async ({ browser }) => {
  const A = await openAs(browser, 'agent');
  const B = await openAs(browser, 'ops');
  await setOpsFilter(B.page, 'ALL');
  const row = inspectionRow(B.page, 'R-106');

  // R-106: cleaning 11:00. Checkout 12:00 → CONFLICT, 10:30 → NORMAL. Alternate from the current state.
  const samples: {
    run: number;
    from: string;
    to: string;
    /** ops badge change − agent PATCH response end (what GOAL calls "screen-to-screen"). */
    latencyMs: number;
    /** ops badge change − agent PATCH request start (includes the save round trip). */
    fromRequestStartMs: number;
  }[] = [];
  for (let run = 1; run <= 5; run++) {
    const from = (await badge(row).getAttribute('data-status')) ?? 'UNKNOWN';
    const target = from === 'CONFLICT' ? '2026-10-26T10:30' : '2026-10-26T12:00';
    const to = from === 'CONFLICT' ? 'NORMAL' : 'CONFLICT';

    const changed = badgeChangeAt(B.page, 'inspection-row-R-106', from);
    const { requestedAt, respondedAt, status } = await changeCheckout(A.page, 'R-106', target, `지연 측정 ${run}`);
    expect(status).toBe(200);
    const changedAt = await Promise.race([
      changed,
      new Promise<number>((_, reject) => setTimeout(() => reject(new Error('no badge change in 5s')), 5_000)),
    ]);
    await expect(badge(row)).toHaveAttribute('data-status', to);
    const latencyMs = Math.round(changedAt - respondedAt);
    const fromRequestStartMs = Math.round(changedAt - requestedAt);
    samples.push({ run, from, to, latencyMs, fromRequestStartMs });
    expect(latencyMs).toBeLessThan(2_000);
    expect(fromRequestStartMs).toBeLessThan(2_000);
  }

  const values = samples.map((s) => s.latencyMs);
  const fromStart = samples.map((s) => s.fromRequestStartMs);
  writeFileSync(
    LATENCY_FILE,
    `${JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        reservation: 'R-106',
        method:
          'agent browser PATCH timing (request start / response end, epoch ms from Playwright request.timing()) → ops browser badge data-status change (MutationObserver, Date.now() in page); both browsers on the same machine clock. The server emits the SSE event right after commit, before writing the PATCH response, so latencyMs is only a few ms on localhost; fromRequestStartMs includes the save round trip.',
        thresholdMs: 2000,
        samples,
        minMs: Math.min(...values),
        maxMs: Math.max(...values),
        avgMs: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
        fromRequestStart: {
          minMs: Math.min(...fromStart),
          maxMs: Math.max(...fromStart),
          avgMs: Math.round(fromStart.reduce((a, b) => a + b, 0) / fromStart.length),
        },
      },
      null,
      2,
    )}\n`,
  );

  await A.context.close();
  await B.context.close();
});

test('recovers after SSE disconnect', async ({ browser }) => {
  const A = await openAs(browser, 'agent');
  const B = await openAs(browser, 'ops');
  await setOpsFilter(B.page, 'ALL');

  // R-102: cleaning 13:30. Move checkout an hour (13:00 ↔ 14:00) relative to the current value.
  const before = await currentCheckout(A.page, 'R-102');
  const next = before === '2026-10-26T14:00' ? '2026-10-26T13:00' : '2026-10-26T14:00';
  const checkoutCell = opsCell(B.page, 'R-102', 'checkout');
  await expect(checkoutCell).toHaveText(displayOf(before));
  const statusBefore = await badge(inspectionRow(B.page, 'R-102')).getAttribute('data-status');

  await B.page.getByTestId('sse-toggle').click();
  await expect(B.page.getByTestId('sse-state')).toHaveAttribute('data-state', 'disconnected');
  await expect(B.page.getByTestId('sse-warning')).toBeVisible();

  const { status } = await changeCheckout(A.page, 'R-102', next, 'SSE 끊김 시험');
  expect(status).toBe(200);

  // Disconnected screen keeps showing the old state.
  await B.page.waitForTimeout(2_000);
  await expect(checkoutCell).toHaveText(displayOf(before));
  await expect(badge(inspectionRow(B.page, 'R-102'))).toHaveAttribute('data-status', statusBefore ?? '');

  await B.page.getByTestId('sse-toggle').click();
  await expect(checkoutCell).toHaveText(displayOf(next), { timeout: 2_000 });
  await expect(B.page.getByTestId('sse-state')).toHaveAttribute('data-state', 'open', { timeout: 2_000 });

  await A.context.close();
  await B.context.close();
});

test('recovers after network offline', async ({ browser }) => {
  const B = await openAs(browser, 'ops');
  const C = await openAs(browser, 'ops'); // a second operations manager makes the change
  await setOpsFilter(B.page, 'ALL');
  await setOpsFilter(C.page, 'ALL');

  const before = await currentCleaning(C.page, 'R-102');
  const next = addMinutes(before, before.endsWith('13:30') ? 60 : -30);
  const cleaningCell = opsCell(B.page, 'R-102', 'cleaning');
  await expect(cleaningCell).toHaveText(displayOf(before));

  await B.context.setOffline(true);
  expect(await changeCleaning(C.page, 'R-102', next, '오프라인 시험')).toBe(200);
  await B.page.waitForTimeout(1_000);
  await expect(cleaningCell).toHaveText(displayOf(before));

  await B.context.setOffline(false);
  await expect(cleaningCell).toHaveText(displayOf(next), { timeout: 10_000 });
  await expect(B.page.getByTestId('sse-state')).toHaveAttribute('data-state', 'open', {
    timeout: 10_000,
  });

  await B.context.close();
  await C.context.close();
});

test('stale tab gets conflict notice', async ({ browser }) => {
  const tab1 = (await openAs(browser, 'ops')).page;
  const context = tab1.context();
  const tab2 = await openTab(context, '/operations');

  // R-104 is UNDETERMINED (checkout missing), so it stays in the default "조치 필요" list.
  const before = await currentCleaning(tab1, 'R-104');
  expect(await currentCleaning(tab2, 'R-104')).toBe(before);

  await tab2.getByTestId('sse-toggle').click();
  await expect(tab2.getByTestId('sse-state')).toHaveAttribute('data-state', 'disconnected');

  expect(await changeCleaning(tab1, 'R-104', addMinutes(before, 30), '탭1 저장')).toBe(200);
  await expect(tab1.getByTestId('recheck-result')).toBeVisible();

  // Tab 2 still shows the old version and saves on top of it → 409 → notice + latest values.
  const panel2 = tab2.getByTestId('detail-panel');
  await expect(panel2.getByTestId('cleaning-input')).toHaveValue(before);
  expect(await changeCleaning(tab2, 'R-104', addMinutes(before, 60), '탭2 저장')).toBe(409);
  await expect(panel2.getByTestId('conflict-notice')).toBeVisible();
  await expect(panel2.getByTestId('conflict-notice')).toContainText('다른 사용자가 먼저 수정했습니다');
  await expect(panel2.getByTestId('cleaning-input')).toHaveValue(addMinutes(before, 30));

  await context.close();
});

test('open ops form follows a remote change until edited', async ({ browser }) => {
  const B = await openAs(browser, 'ops');
  const C = await openAs(browser, 'ops'); // a second operations manager makes the changes

  // R-104 stays in the default "조치 필요" list (checkout missing).
  const before = await currentCleaning(B.page, 'R-104');
  const input = B.page.getByTestId('detail-panel').getByTestId('cleaning-input');

  // Untouched input: follows the other manager's change.
  expect(await changeCleaning(C.page, 'R-104', addMinutes(before, 15), '원격 변경 1')).toBe(200);
  await expect(input).toHaveValue(addMinutes(before, 15), { timeout: 2_000 });
  await expect(B.page.getByTestId('remote-change-notice')).toHaveCount(0);

  // Edited input: keeps the typed value and offers the latest one.
  await input.fill(addMinutes(before, 45));
  const latest = addMinutes(before, 30);
  expect(await changeCleaning(C.page, 'R-104', latest, '원격 변경 2')).toBe(200);
  const notice = B.page.getByTestId('remote-change-notice');
  await expect(notice).toContainText(`다른 사용자가 ${latest.slice(11)}으로 변경했습니다.`, {
    timeout: 2_000,
  });
  await expect(input).toHaveValue(addMinutes(before, 45));
  await notice.getByTestId('remote-change-reload').click();
  await expect(input).toHaveValue(latest);

  await B.context.close();
  await C.context.close();
});
