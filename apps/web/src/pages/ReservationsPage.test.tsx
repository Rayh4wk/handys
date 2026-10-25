import { fireEvent, screen, waitFor, within } from '@testing-library/react';
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

async function openEditor(id = 'R-101') {
  const user = userEvent.setup();
  renderWithClient(<ReservationsPage />);
  const row = await screen.findByTestId(`reservation-row-${id}`);
  await user.click(within(row).getByRole('button', { name: '체크아웃 변경' }));
  return { user, editor: screen.getByTestId('checkout-editor') };
}

describe('ReservationsPage', () => {
  it('renders the table with 정보 누락 for missing checkout and disabled change for cancelled', async () => {
    renderWithClient(<ReservationsPage />);
    expect(screen.getByRole('heading', { name: '예약·고객 응대' })).toBeInTheDocument();
    const r101 = await screen.findByTestId('reservation-row-R-101');
    expect(r101).toHaveTextContent('101호');
    expect(r101).toHaveTextContent('고객101');
    expect(r101).toHaveTextContent('10/26 11:00');
    expect(screen.getByTestId('reservation-row-R-104')).toHaveTextContent('정보 누락');
    expect(
      within(screen.getByTestId('reservation-row-R-105')).getByRole('button', { name: '체크아웃 변경' }),
    ).toBeDisabled();
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
    expect(await screen.findByTestId('error-notice')).toHaveTextContent('checkoutAt must be ISO');
  });

  it('sends the version captured when the editor opened, even after a refetch', async () => {
    const { user, queryClient } = await (async () => {
      const u = userEvent.setup();
      const utils = renderWithClient(<ReservationsPage />);
      const row = await screen.findByTestId('reservation-row-R-101');
      await u.click(within(row).getByRole('button', { name: '체크아웃 변경' }));
      return { user: u, queryClient: utils.queryClient };
    })();
    // another user changed the checkout to 12:00 (version 2); SSE refetch delivers it
    mocked.listReservations.mockResolvedValue(
      fixture().map((r) =>
        r.id === 'R-101' ? makeReservation('R-101', { checkoutAt: '2026-10-26T03:00:00.000Z', version: 2 }) : r,
      ),
    );
    await queryClient.invalidateQueries();
    await waitFor(() =>
      expect(screen.getByTestId('reservation-row-R-101')).toHaveTextContent('10/26 12:00'),
    );
    mocked.changeCheckout.mockRejectedValue(new ApiError(409, { message: 'VERSION_CONFLICT' }));
    const editor = screen.getByTestId('checkout-editor');
    await user.type(within(editor).getByTestId('checkout-reason'), '고객 요청');
    await user.click(within(editor).getByTestId('checkout-save'));
    expect(mocked.changeCheckout).toHaveBeenCalledWith('R-101', {
      checkoutAt: '2026-10-26T02:00:00.000Z',
      reason: '고객 요청',
      version: 1,
    });
    expect(await screen.findByTestId('conflict-notice')).toBeInTheDocument();
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
