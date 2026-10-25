import { expect, test } from '@playwright/test';
import {
  badge,
  changeCheckout,
  inspectionRow,
  openAs,
  opsCell,
  reservationRow,
  setOpsFilter,
} from '../helpers';

// Assumes the seed state right after the webServer's DB reset: R-101 checkout 11:00, cleaning 11:30.
test('demo flow: checkout change → conflict on ops → ops reschedules → agent sees normal', async ({
  browser,
}) => {
  const A = await openAs(browser, 'agent');
  const B = await openAs(browser, 'ops');

  await setOpsFilter(B.page, 'ALL');
  const opsRow = inspectionRow(B.page, 'R-101');
  await expect(badge(opsRow)).toHaveAttribute('data-status', 'NORMAL');

  // Agent changes the checkout to 13:00 (KST) for a guest request.
  const { status } = await changeCheckout(A.page, 'R-101', '2026-10-26T13:00', '고객 요청');
  expect(status).toBe(200);
  const result = A.page.getByTestId('change-result');
  await expect(result).toContainText('예약 변경 완료');
  await expect(result).toContainText('체크아웃: 11:00 → 13:00');
  await expect(result).toContainText('기존 청소 시작: 11:30');
  await expect(result).toContainText('청소 일정 조정 필요');
  await expect(result).toHaveAttribute('data-result', 'CONFLICT');

  // Ops screen reflects it within 2 seconds, without reload.
  await expect(badge(opsRow)).toHaveAttribute('data-status', 'CONFLICT', { timeout: 2_000 });
  await expect(opsRow).toContainText('체크아웃 이전에 청소 시작 예정', { timeout: 2_000 });

  // "조치 필요" puts the conflict first.
  await setOpsFilter(B.page, 'ACTION_REQUIRED');
  const firstRow = B.page.locator('tbody tr').first();
  await expect(firstRow).toHaveAttribute('data-testid', 'inspection-row-R-101');

  await opsRow.click();
  const panel = B.page.getByTestId('detail-panel');
  await expect(panel).toContainText('고객 요청');
  await expect(panel).toContainText('예약 담당 김예약');
  await expect(panel.getByTestId('audit-log-item')).toHaveCount(1);

  await panel.getByTestId('cleaning-input').fill('2026-10-26T13:30');
  await panel.getByTestId('cleaning-save').click();
  await expect(panel.getByTestId('recheck-result')).toContainText('정상');
  // The panel stays open even though R-101 left the "조치 필요" list.
  await expect(panel).toContainText('10/26 13:30');
  await expect(panel.getByTestId('audit-log-item')).toHaveCount(2);

  await setOpsFilter(B.page, 'ALL');
  await expect(opsCell(B.page, 'R-101', 'cleaning')).toHaveText('10/26 13:30');
  await expect(badge(opsRow)).toHaveAttribute('data-status', 'NORMAL');

  // Agent screen follows the operations fix within 2 seconds.
  await expect(badge(reservationRow(A.page, 'R-101'))).toHaveAttribute('data-status', 'NORMAL', {
    timeout: 2_000,
  });
  await expect(result).toHaveAttribute('data-result', 'NORMAL', { timeout: 2_000 });
  await expect(result).not.toContainText('청소 일정 조정 필요');

  await A.context.close();
  await B.context.close();
});
