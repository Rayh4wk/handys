import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError, api } from '../api/client';
import { makeReservation, renderWithClient } from '../test/fixtures';
import ReservationsPage from './ReservationsPage';

vi.mock('../api/client', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../api/client')>();
  return {
    ...orig,
    api: {
      listReservations: vi.fn(),
      listInspections: vi.fn(),
      auditLogs: vi.fn(),
      changeCheckout: vi.fn(),
      rescheduleCleaning: vi.fn(),
    },
  };
});

const mocked = vi.mocked(api);

const fixture = () => [
  makeReservation('R-102', { checkoutAt: '2026-10-26T04:00:00.000Z' }),
  // R-101: checkout 11:00 KST, cleaning 11:30 KST
  makeReservation('R-101'),
  makeReservation('R-104', { checkoutAt: null, status: 'UNDETERMINED' }),
  makeReservation('R-105', { cancelled: true, status: 'EXCLUDED' }),
];

const conflictResponse = makeReservation('R-101', {
  checkoutAt: '2026-10-26T04:00:00.000Z',
  status: 'CONFLICT',
  version: 2,
});

beforeEach(() => {
  vi.resetAllMocks();
  mocked.listReservations.mockResolvedValue(fixture());
  mocked.auditLogs.mockResolvedValue([]);
});

/** Select the row, then use the detail panel's single 체크아웃 변경 action. */
async function openFromRow(user: ReturnType<typeof userEvent.setup>, row: HTMLElement) {
  await user.click(row);
  const detail = screen.getByRole('region', { name: '선택한 예약' });
  await user.click(within(detail).getByRole('button', { name: '체크아웃 변경' }));
}

async function openEditor(id = 'R-101') {
  const user = userEvent.setup();
  const { queryClient } = renderWithClient(<ReservationsPage />);
  const row = await screen.findByTestId(`reservation-row-${id}`);
  await openFromRow(user, row);
  return { user, queryClient, editor: screen.getByTestId('checkout-editor') };
}

describe('ReservationsPage', () => {
  it('renders the table with 정보 누락 for missing checkout and no change action for cancelled', async () => {
    renderWithClient(<ReservationsPage />);
    expect(screen.getByRole('heading', { name: '예약 관리' })).toBeInTheDocument();
    const r101 = await screen.findByTestId('reservation-row-R-101');
    expect(r101).toHaveTextContent('101호');
    expect(r101).toHaveTextContent('고객101');
    expect(r101).toHaveTextContent('10/26 11:00');
    expect(screen.getByTestId('reservation-row-R-104')).toHaveTextContent('정보 누락');
    // rows carry no per-row action; the cancelled row is marked by its tag and badge
    expect(screen.queryAllByRole('button', { name: '체크아웃 변경' })).toHaveLength(0);
    const r105 = screen.getByTestId('reservation-row-R-105');
    expect(r105).toHaveTextContent('취소');
    expect(within(r105).getByTestId('status-badge')).toHaveAttribute('data-status', 'EXCLUDED');
    fireEvent.click(r105);
    const detail = screen.getByRole('region', { name: '선택한 예약' });
    expect(detail).toHaveTextContent('취소된 예약은 변경할 수 없습니다.');
    expect(within(detail).queryByRole('button', { name: '체크아웃 변경' })).not.toBeInTheDocument();
  });

  it('the detail panel does not repeat the row facts', async () => {
    const user = userEvent.setup();
    renderWithClient(<ReservationsPage />);
    await user.click(await screen.findByTestId('reservation-row-R-101'));
    const detail = screen.getByRole('region', { name: '선택한 예약' });
    expect(detail).not.toHaveTextContent('고객101');
    expect(detail).not.toHaveTextContent('101호');
  });

  it('selects a row from the keyboard (cancelled rows included)', async () => {
    const user = userEvent.setup();
    renderWithClient(<ReservationsPage />);
    const r105 = await screen.findByTestId('reservation-row-R-105');
    within(r105).getByRole('button', { name: 'R-105 상세 보기' }).focus();
    await user.keyboard('{Enter}');
    const panel = screen.getByRole('region', { name: '선택한 예약' });
    expect(panel).toHaveTextContent('R-105');
    expect(panel).toHaveTextContent('취소된 예약은 변경할 수 없습니다.');
    expect(r105).toHaveAttribute('aria-current', 'true');
    expect(screen.getByTestId('reservation-row-R-101')).not.toHaveAttribute('aria-current');
  });

  it('save disabled without reason', async () => {
    const { user, editor } = await openEditor();
    expect(editor).toHaveTextContent('10/26 11:00');
    expect((within(editor).getByTestId('checkout-input') as HTMLInputElement).value).toBe(
      '2026-10-26T11:00',
    );
    const save = within(editor).getByTestId('checkout-save');
    expect(save).toBeDisabled();
    await user.type(within(editor).getByTestId('checkout-reason'), '   ');
    expect(save).toBeDisabled();
    await user.type(within(editor).getByTestId('checkout-reason'), '고객 요청');
    expect(save).toBeEnabled();
  });

  it('sends checkoutAt as UTC ISO and reason', async () => {
    mocked.changeCheckout.mockResolvedValue(conflictResponse);
    const { user, editor } = await openEditor();
    fireEvent.change(within(editor).getByTestId('checkout-input'), {
      target: { value: '2026-10-26T13:00' },
    });
    await user.type(within(editor).getByTestId('checkout-reason'), '고객 요청');
    await user.click(within(editor).getByTestId('checkout-save'));
    expect(mocked.changeCheckout).toHaveBeenCalledWith('R-101', {
      checkoutAt: '2026-10-26T04:00:00.000Z',
      reason: '고객 요청',
      version: 1,
    });
  });

  it('shows 청소 일정 조정 필요 result after CONFLICT response', async () => {
    mocked.changeCheckout.mockResolvedValue(conflictResponse);
    const { user, editor } = await openEditor();
    fireEvent.change(within(editor).getByTestId('checkout-input'), {
      target: { value: '2026-10-26T13:00' },
    });
    await user.type(within(editor).getByTestId('checkout-reason'), '고객 요청');
    mocked.listReservations.mockResolvedValue(
      fixture().map((r) => (r.id === 'R-101' ? conflictResponse : r)),
    );
    await user.click(within(editor).getByTestId('checkout-save'));
    const panel = await screen.findByTestId('change-result');
    expect(panel).toHaveAttribute('data-result', 'CONFLICT');
    expect(panel).toHaveTextContent('예약 변경 완료');
    expect(panel).toHaveTextContent('체크아웃: 11:00 → 13:00');
    expect(panel).toHaveTextContent('기존 청소 시작: 11:30');
    expect(panel).toHaveTextContent('청소 일정 조정 필요');
    expect(panel).toHaveTextContent(
      '체크아웃 이전에 청소가 예정되어 있습니다. 운영 담당자의 일정 조정이 필요합니다.',
    );
  });

  it('result panel follows the current judgment after refetch', async () => {
    mocked.changeCheckout.mockResolvedValue(conflictResponse);
    const { user, editor } = await openEditor();
    fireEvent.change(within(editor).getByTestId('checkout-input'), {
      target: { value: '2026-10-26T13:00' },
    });
    await user.type(within(editor).getByTestId('checkout-reason'), '고객 요청');
    const normalLater = { ...conflictResponse, inspection: { ...conflictResponse.inspection!, status: 'NORMAL' as const } };
    mocked.listReservations.mockResolvedValue(
      fixture().map((r) => (r.id === 'R-101' ? normalLater : r)),
    );
    await user.click(within(editor).getByTestId('checkout-save'));
    await waitFor(() =>
      expect(screen.getByTestId('change-result')).toHaveAttribute('data-result', 'NORMAL'),
    );
    expect(screen.getByTestId('change-result')).toHaveTextContent('청소 일정과 충돌하지 않습니다.');
    expect(screen.getByTestId('change-result')).not.toHaveTextContent('청소 일정 조정 필요');
  });

  it('shows conflict notice on 409, refetches and resets the input to the latest value', async () => {
    const latest = makeReservation('R-101', { checkoutAt: '2026-10-26T03:00:00.000Z', version: 3 });
    mocked.changeCheckout.mockRejectedValue(
      new ApiError(409, { message: 'VERSION_CONFLICT', current: latest }),
    );
    const { user, editor } = await openEditor();
    const callsBefore = mocked.listReservations.mock.calls.length;
    fireEvent.change(within(editor).getByTestId('checkout-input'), {
      target: { value: '2026-10-26T13:00' },
    });
    await user.type(within(editor).getByTestId('checkout-reason'), '고객 요청');
    await user.click(within(editor).getByTestId('checkout-save'));
    expect(await screen.findByTestId('conflict-notice')).toHaveTextContent(
      '다른 사용자가 먼저 수정했습니다. 최신 상태를 불러왔습니다.',
    );
    await waitFor(() =>
      expect(mocked.listReservations.mock.calls.length).toBeGreaterThan(callsBefore),
    );
    expect((screen.getByTestId('checkout-input') as HTMLInputElement).value).toBe('2026-10-26T12:00');
  });

  it('shows error notice on other failures', async () => {
    mocked.changeCheckout.mockRejectedValue(new ApiError(400, { message: 'checkoutAt must be ISO' }));
    const { user, editor } = await openEditor();
    await user.type(within(editor).getByTestId('checkout-reason'), '고객 요청');
    await user.click(within(editor).getByTestId('checkout-save'));
    const notice = await screen.findByTestId('error-notice');
    expect(notice).toHaveTextContent('저장에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    expect(notice).not.toHaveTextContent('checkoutAt');
  });

  it('caps the reason at 200 characters', async () => {
    const { editor } = await openEditor();
    expect(within(editor).getByTestId('checkout-reason')).toHaveAttribute('maxLength', '200');
  });

  it('keeps the cleaning start from save time and shows the current one when it changes', async () => {
    mocked.changeCheckout.mockResolvedValue(conflictResponse);
    const { user, editor } = await openEditor();
    fireEvent.change(within(editor).getByTestId('checkout-input'), {
      target: { value: '2026-10-26T13:00' },
    });
    await user.type(within(editor).getByTestId('checkout-reason'), '고객 요청');
    // ops later moves the cleaning to 13:30 KST; the refetch delivers it
    const fixedLater = makeReservation('R-101', {
      checkoutAt: '2026-10-26T04:00:00.000Z',
      cleaning: { scheduledStartAt: '2026-10-26T04:30:00.000Z', version: 2 },
      status: 'NORMAL',
      version: 2,
    });
    mocked.listReservations.mockResolvedValue(
      fixture().map((r) => (r.id === 'R-101' ? fixedLater : r)),
    );
    await user.click(within(editor).getByTestId('checkout-save'));
    const panel = await screen.findByTestId('change-result');
    await waitFor(() => expect(panel).toHaveAttribute('data-result', 'NORMAL'));
    expect(panel).toHaveTextContent('기존 청소 시작: 11:30');
    expect(within(panel).getByTestId('current-cleaning')).toHaveTextContent('현재 청소 시작: 13:30');
  });

  // another user changed the checkout to 12:00 (version 2); the SSE refetch delivers it
  const movedByOther = () =>
    fixture().map((r) =>
      r.id === 'R-101' ? makeReservation('R-101', { checkoutAt: '2026-10-26T03:00:00.000Z', version: 2 }) : r,
    );

  it('follows a newer checkout (and its version) while the input is untouched', async () => {
    const user = userEvent.setup();
    const { queryClient } = renderWithClient(<ReservationsPage />);
    const row = await screen.findByTestId('reservation-row-R-101');
    await openFromRow(user, row);
    mocked.listReservations.mockResolvedValue(movedByOther());
    await queryClient.invalidateQueries();
    await waitFor(() => expect(screen.getByTestId('checkout-input')).toHaveValue('2026-10-26T12:00'));
    expect(screen.queryByTestId('remote-change-notice')).not.toBeInTheDocument();
    mocked.changeCheckout.mockResolvedValue(conflictResponse);
    await user.type(screen.getByTestId('checkout-reason'), '고객 요청');
    await user.click(screen.getByTestId('checkout-save'));
    expect(mocked.changeCheckout).toHaveBeenCalledWith('R-101', {
      checkoutAt: '2026-10-26T03:00:00.000Z',
      reason: '고객 요청',
      version: 2,
    });
  });

  it('keeps a typed checkout and its old version after a remote change, with a notice', async () => {
    const user = userEvent.setup();
    const { queryClient } = renderWithClient(<ReservationsPage />);
    const row = await screen.findByTestId('reservation-row-R-101');
    await openFromRow(user, row);
    fireEvent.change(screen.getByTestId('checkout-input'), { target: { value: '2026-10-26T14:00' } });
    mocked.listReservations.mockResolvedValue(movedByOther());
    await queryClient.invalidateQueries();
    await waitFor(() =>
      expect(screen.getByTestId('reservation-row-R-101')).toHaveTextContent('10/26 12:00'),
    );
    expect(screen.getByTestId('remote-change-notice')).toHaveTextContent(
      '다른 사용자가 12:00으로 변경했습니다.',
    );
    expect(screen.getByTestId('checkout-input')).toHaveValue('2026-10-26T14:00');
    mocked.changeCheckout.mockRejectedValue(new ApiError(409, { message: 'VERSION_CONFLICT' }));
    await user.type(screen.getByTestId('checkout-reason'), '고객 요청');
    await user.click(screen.getByTestId('checkout-save'));
    expect(mocked.changeCheckout).toHaveBeenCalledWith('R-101', {
      checkoutAt: '2026-10-26T05:00:00.000Z',
      reason: '고객 요청',
      version: 1,
    });
    expect(await screen.findByTestId('conflict-notice')).toBeInTheDocument();
  });

  it('"최신 값 불러오기" adopts the remote checkout and version', async () => {
    const user = userEvent.setup();
    const { queryClient } = renderWithClient(<ReservationsPage />);
    const row = await screen.findByTestId('reservation-row-R-101');
    await openFromRow(user, row);
    fireEvent.change(screen.getByTestId('checkout-input'), { target: { value: '2026-10-26T14:00' } });
    mocked.listReservations.mockResolvedValue(movedByOther());
    await queryClient.invalidateQueries();
    await user.click(await screen.findByTestId('remote-change-reload'));
    expect(screen.getByTestId('checkout-input')).toHaveValue('2026-10-26T12:00');
    expect(screen.queryByTestId('remote-change-notice')).not.toBeInTheDocument();
    mocked.changeCheckout.mockResolvedValue(conflictResponse);
    await user.type(screen.getByTestId('checkout-reason'), '고객 요청');
    await user.click(screen.getByTestId('checkout-save'));
    expect(mocked.changeCheckout).toHaveBeenCalledWith('R-101', expect.objectContaining({ version: 2 }));
  });

  it('treats a 409 without current as a conflict: notice, refetch, reset to latest', async () => {
    mocked.changeCheckout.mockRejectedValue(new ApiError(409, { message: 'VERSION_CONFLICT' }));
    const { user, editor } = await openEditor();
    const callsBefore = mocked.listReservations.mock.calls.length;
    mocked.listReservations.mockResolvedValue(
      fixture().map((r) =>
        r.id === 'R-101' ? makeReservation('R-101', { checkoutAt: '2026-10-26T03:00:00.000Z', version: 2 }) : r,
      ),
    );
    await user.type(within(editor).getByTestId('checkout-reason'), '고객 요청');
    await user.click(within(editor).getByTestId('checkout-save'));
    expect(await screen.findByTestId('conflict-notice')).toBeInTheDocument();
    expect(screen.queryByTestId('error-notice')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(mocked.listReservations.mock.calls.length).toBeGreaterThan(callsBefore),
    );
    await waitFor(() =>
      expect((screen.getByTestId('checkout-input') as HTMLInputElement).value).toBe('2026-10-26T12:00'),
    );
    // the next save uses the refreshed version
    mocked.changeCheckout.mockClear();
    await user.click(screen.getByTestId('checkout-save'));
    expect(mocked.changeCheckout).toHaveBeenCalledWith('R-101', expect.objectContaining({ version: 2 }));
  });
});

describe('ReservationsPage change result', () => {
  async function saveConflict() {
    mocked.changeCheckout.mockResolvedValue(conflictResponse);
    const { user, editor, queryClient } = await openEditor();
    fireEvent.change(within(editor).getByTestId('checkout-input'), {
      target: { value: '2026-10-26T13:00' },
    });
    await user.type(within(editor).getByTestId('checkout-reason'), '고객 요청');
    mocked.listReservations.mockResolvedValue(
      fixture().map((r) => (r.id === 'R-101' ? conflictResponse : r)),
    );
    await user.click(within(editor).getByTestId('checkout-save'));
    return { user, queryClient, panel: await screen.findByTestId('change-result') };
  }

  it('announces through a live region that exists before the result', async () => {
    renderWithClient(<ReservationsPage />);
    const live = screen.getByTestId('result-announcer');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live).toBeEmptyDOMElement();
    cleanup();
    await saveConflict();
    await waitFor(() =>
      expect(screen.getByTestId('result-announcer')).toHaveTextContent(
        'R-101 예약 변경 완료. 청소 일정 조정 필요.',
      ),
    );
    expect(screen.getByTestId('change-result')).not.toHaveAttribute('aria-live');
  });

  it('shows one judgment badge and demotes the change button while a result is shown', async () => {
    const { panel } = await saveConflict();
    expect(within(panel).queryByTestId('status-badge')).not.toBeInTheDocument();
    const detail = screen.getByRole('region', { name: '선택한 예약' });
    expect(within(detail).getAllByTestId('status-badge')).toHaveLength(1);
    const again = within(detail).getByRole('button', { name: '체크아웃 변경' });
    expect(again).not.toHaveClass('primary');
  });

  it('credits the operations fix when the judgment becomes NORMAL', async () => {
    mocked.auditLogs.mockResolvedValue([
      {
        id: '1',
        action: 'CHECKOUT_CHANGED',
        before: { checkoutAt: '2026-10-26T02:00:00.000Z', inspectionStatus: 'NORMAL' },
        after: { checkoutAt: '2026-10-26T04:00:00.000Z', inspectionStatus: 'CONFLICT' },
        reason: '고객 요청',
        actor: { id: 'agent-01', displayName: '예약 담당 김예약', role: 'RESERVATION_AGENT' },
        createdAt: '2026-10-25T00:00:00.000Z',
      },
    ]);
    const { panel, queryClient } = await saveConflict();
    expect(within(panel).queryByTestId('result-resolved')).not.toBeInTheDocument();

    const fixed = makeReservation('R-101', {
      checkoutAt: '2026-10-26T04:00:00.000Z',
      cleaning: { scheduledStartAt: '2026-10-26T04:30:00.000Z', version: 2 },
      status: 'NORMAL',
      version: 2,
    });
    fixed.inspection!.checkedAt = '2026-10-25T12:47:00.000Z';
    mocked.listReservations.mockResolvedValue(fixture().map((r) => (r.id === 'R-101' ? fixed : r)));
    mocked.auditLogs.mockResolvedValue([
      {
        id: '2',
        action: 'CLEANING_RESCHEDULED',
        before: { scheduledStartAt: '2026-10-26T02:30:00.000Z', inspectionStatus: 'CONFLICT' },
        after: { scheduledStartAt: '2026-10-26T04:30:00.000Z', inspectionStatus: 'NORMAL' },
        reason: null,
        actor: { id: 'ops-01', displayName: '현장 운영 박현장', role: 'OPERATIONS_MANAGER' },
        createdAt: '2026-10-25T12:47:00.000Z',
      },
    ]);
    await queryClient.invalidateQueries();
    await waitFor(() => expect(panel).toHaveAttribute('data-result', 'NORMAL'));
    expect(await within(panel).findByTestId('result-resolved')).toHaveTextContent(
      '청소 일정 조정됨 · 현장 운영 박현장 10/25 21:47',
    );
  });

  it('adds dates to the result when the times span two days', async () => {
    const late = makeReservation('R-101', { checkoutAt: '2026-10-26T15:30:00.000Z', status: 'NORMAL', version: 2 });
    mocked.changeCheckout.mockResolvedValue(late);
    const { user, editor } = await openEditor();
    fireEvent.change(within(editor).getByTestId('checkout-input'), {
      target: { value: '2026-10-27T00:30' },
    });
    await user.type(within(editor).getByTestId('checkout-reason'), '고객 요청');
    await user.click(within(editor).getByTestId('checkout-save'));
    const panel = await screen.findByTestId('change-result');
    expect(panel).toHaveTextContent('체크아웃: 10/26 11:00 → 10/27 00:30');
    expect(panel).toHaveTextContent('기존 청소 시작: 10/26 11:30');
  });

  it('announces a second, identically worded result again', async () => {
    const { user, panel } = await saveConflict();
    void panel;
    const live = screen.getByTestId('result-announcer');
    const text = `R-101 예약 변경 완료. 청소 일정 조정 필요. ${'체크아웃 이전에 청소가 예정되어 있습니다. 운영 담당자의 일정 조정이 필요합니다.'}`;
    await waitFor(() => expect(live).toHaveTextContent(text));
    const seen: string[] = [];
    new MutationObserver(() => seen.push(live.textContent ?? '')).observe(live, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    // same change saved again (e.g. after the guest confirms): same wording
    mocked.changeCheckout.mockResolvedValue({ ...conflictResponse, version: 3 });
    const detail = screen.getByRole('region', { name: '선택한 예약' });
    await user.click(within(detail).getByRole('button', { name: '체크아웃 변경' }));
    const editor = screen.getByTestId('checkout-editor');
    await user.type(within(editor).getByTestId('checkout-reason'), '고객 재확인');
    await user.click(within(editor).getByTestId('checkout-save'));
    await waitFor(() => expect(seen).toEqual(['', text]));
  });
});
