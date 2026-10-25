import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError, api } from '../api/client';
import { makeReservation, renderWithClient } from '../test/fixtures';
import OperationsPage from './OperationsPage';

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
  makeReservation('R-102', { status: 'NORMAL' }),
  makeReservation('R-104', { checkoutAt: null, status: 'UNDETERMINED' }),
  makeReservation('R-101', {
    status: 'CONFLICT',
    checkoutAt: '2026-10-26T04:00:00.000Z',
    reasonText: '체크아웃 이전에 청소 시작 예정',
  }),
  makeReservation('R-103', { cleaning: null, status: 'NEEDS_CHECK' }),
];

beforeEach(() => {
  vi.resetAllMocks();
  mocked.listInspections.mockResolvedValue(fixture());
  mocked.listReservations.mockResolvedValue(fixture());
  mocked.auditLogs.mockResolvedValue([]);
});

const rowIds = () =>
  screen
    .getAllByTestId(/^inspection-row-/)
    .map((el) => el.getAttribute('data-testid')!.replace('inspection-row-', ''));

describe('OperationsPage', () => {
  it('defaults to action-required filter sorted CONFLICT first', async () => {
    renderWithClient(<OperationsPage />);
    expect(screen.getByRole('heading', { name: '청소 일정 점검' })).toBeInTheDocument();
    await screen.findByTestId('inspection-row-R-101');
    expect((screen.getByTestId('status-filter') as HTMLSelectElement).value).toBe('ACTION_REQUIRED');
    expect(rowIds()).toEqual(['R-101', 'R-103', 'R-104']);
    expect(screen.queryByTestId('inspection-row-R-102')).not.toBeInTheDocument();
    expect(screen.getByTestId('summary-CONFLICT')).toHaveTextContent('1');
    expect(screen.getByTestId('summary-NORMAL')).toHaveTextContent('1');
    expect(screen.getByTestId('summary-EXCLUDED')).toHaveTextContent('0');

    fireEvent.change(screen.getByTestId('status-filter'), { target: { value: 'ALL' } });
    expect(rowIds()).toEqual(['R-101', 'R-103', 'R-104', 'R-102']);
    fireEvent.change(screen.getByTestId('status-filter'), { target: { value: 'NORMAL' } });
    expect(rowIds()).toEqual(['R-102']);
  });

  it('shows 작업 없음 for R-103 and 정보 누락 for R-104', async () => {
    renderWithClient(<OperationsPage />);
    const r103 = await screen.findByTestId('inspection-row-R-103');
    expect(r103).toHaveTextContent('작업 없음');
    const r104 = screen.getByTestId('inspection-row-R-104');
    expect(r104).toHaveTextContent('정보 누락');
    const r101 = screen.getByTestId('inspection-row-R-101');
    expect(r101).toHaveTextContent('10/26 13:00');
    expect(r101).toHaveTextContent('10/26 11:30');
    expect(r101).toHaveTextContent('체크아웃 이전에 청소 시작 예정');
    expect(within(r101).getByTestId('status-badge')).toHaveAttribute('data-status', 'CONFLICT');
  });

  it('saves cleaning schedule and shows recheck result, keeping the detail panel', async () => {
    const user = userEvent.setup();
    const updated = makeReservation('R-101', {
      status: 'NORMAL',
      checkoutAt: '2026-10-26T04:00:00.000Z',
      cleaning: { scheduledStartAt: '2026-10-26T04:30:00.000Z', version: 2 },
    });
    mocked.rescheduleCleaning.mockResolvedValue(updated);
    renderWithClient(<OperationsPage />);
    await user.click(await screen.findByTestId('inspection-row-R-101'));
    const panel = screen.getByTestId('detail-panel');
    expect((within(panel).getByTestId('cleaning-input') as HTMLInputElement).value).toBe(
      '2026-10-26T11:30',
    );
    fireEvent.change(within(panel).getByTestId('cleaning-input'), {
      target: { value: '2026-10-26T13:30' },
    });
    await user.type(within(panel).getByTestId('cleaning-reason'), '체크아웃 지연 반영');
    mocked.listInspections.mockResolvedValue(
      fixture().map((r) => (r.id === 'R-101' ? updated : r)),
    );
    await user.click(within(panel).getByTestId('cleaning-save'));
    expect(mocked.rescheduleCleaning).toHaveBeenCalledWith('C-101', {
      scheduledStartAt: '2026-10-26T04:30:00.000Z',
      reason: '체크아웃 지연 반영',
      version: 1,
    });
    expect(await screen.findByTestId('recheck-result')).toHaveTextContent('재점검 결과: 정상');
    // R-101 is NORMAL now: drops out of the action-required list but stays selected
    await waitFor(() => expect(screen.queryByTestId('inspection-row-R-101')).not.toBeInTheDocument());
    expect(screen.getByTestId('detail-panel')).toHaveTextContent('R-101');
  });

  it('hides the cleaning form when there is no cleaning task', async () => {
    const user = userEvent.setup();
    renderWithClient(<OperationsPage />);
    await user.click(await screen.findByTestId('inspection-row-R-103'));
    expect(screen.getByTestId('detail-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('cleaning-input')).not.toBeInTheDocument();
  });

  it('shows conflict notice on 409 and refetches', async () => {
    const user = userEvent.setup();
    const latest = makeReservation('R-101', {
      status: 'CONFLICT',
      checkoutAt: '2026-10-26T04:00:00.000Z',
      cleaning: { scheduledStartAt: '2026-10-26T03:00:00.000Z', version: 2 },
    });
    mocked.rescheduleCleaning.mockRejectedValue(
      new ApiError(409, { message: 'VERSION_CONFLICT', current: latest }),
    );
    renderWithClient(<OperationsPage />);
    await user.click(await screen.findByTestId('inspection-row-R-101'));
    const callsBefore = mocked.listInspections.mock.calls.length;
    fireEvent.change(screen.getByTestId('cleaning-input'), { target: { value: '2026-10-26T13:30' } });
    await user.click(screen.getByTestId('cleaning-save'));
    expect(await screen.findByTestId('conflict-notice')).toHaveTextContent(
      '다른 사용자가 먼저 수정했습니다. 최신 상태를 불러왔습니다.',
    );
    await waitFor(() =>
      expect(mocked.listInspections.mock.calls.length).toBeGreaterThan(callsBefore),
    );
    // edit value reset to the latest server value (12:00 KST)
    expect((screen.getByTestId('cleaning-input') as HTMLInputElement).value).toBe('2026-10-26T12:00');
  });

  it('shows server error message on other failures', async () => {
    const user = userEvent.setup();
    mocked.rescheduleCleaning.mockRejectedValue(new ApiError(400, { message: ['bad time'] }));
    renderWithClient(<OperationsPage />);
    await user.click(await screen.findByTestId('inspection-row-R-101'));
    await user.click(screen.getByTestId('cleaning-save'));
    expect(await screen.findByTestId('error-notice')).toHaveTextContent('bad time');
  });

  it('sends the cleaning version captured when the panel opened, even after a refetch', async () => {
    const user = userEvent.setup();
    const { queryClient } = renderWithClient(<OperationsPage />);
    await user.click(await screen.findByTestId('inspection-row-R-101'));
    mocked.listInspections.mockResolvedValue(
      fixture().map((r) =>
        r.id === 'R-101'
          ? makeReservation('R-101', {
              status: 'CONFLICT',
              checkoutAt: '2026-10-26T04:00:00.000Z',
              cleaning: { scheduledStartAt: '2026-10-26T03:00:00.000Z', version: 2 },
            })
          : r,
      ),
    );
    await queryClient.invalidateQueries();
    await waitFor(() =>
      expect(screen.getByTestId('inspection-row-R-101')).toHaveTextContent('10/26 12:00'),
    );
    mocked.rescheduleCleaning.mockRejectedValue(new ApiError(409, { message: 'VERSION_CONFLICT' }));
    await user.click(screen.getByTestId('cleaning-save'));
    expect(mocked.rescheduleCleaning).toHaveBeenCalledWith('C-101', {
      scheduledStartAt: '2026-10-26T02:30:00.000Z',
      version: 1,
    });
    expect(await screen.findByTestId('conflict-notice')).toBeInTheDocument();
  });

  it('treats a 409 without current as a conflict: notice, refetch, reset to latest', async () => {
    const user = userEvent.setup();
    mocked.rescheduleCleaning.mockRejectedValue(new ApiError(409, { message: 'VERSION_CONFLICT' }));
    renderWithClient(<OperationsPage />);
    await user.click(await screen.findByTestId('inspection-row-R-101'));
    const callsBefore = mocked.listInspections.mock.calls.length;
    mocked.listInspections.mockResolvedValue(
      fixture().map((r) =>
        r.id === 'R-101'
          ? makeReservation('R-101', {
              status: 'CONFLICT',
              cleaning: { scheduledStartAt: '2026-10-26T03:00:00.000Z', version: 2 },
            })
          : r,
      ),
    );
    await user.click(screen.getByTestId('cleaning-save'));
    expect(await screen.findByTestId('conflict-notice')).toBeInTheDocument();
    expect(screen.queryByTestId('error-notice')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(mocked.listInspections.mock.calls.length).toBeGreaterThan(callsBefore),
    );
    await waitFor(() =>
      expect((screen.getByTestId('cleaning-input') as HTMLInputElement).value).toBe('2026-10-26T12:00'),
    );
    mocked.rescheduleCleaning.mockClear();
    await user.click(screen.getByTestId('cleaning-save'));
    expect(mocked.rescheduleCleaning).toHaveBeenCalledWith('C-101', expect.objectContaining({ version: 2 }));
  });
});
