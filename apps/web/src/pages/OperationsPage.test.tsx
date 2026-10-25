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
    expect(screen.getByTestId('summary-ACTION_REQUIRED')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('summary-ALL')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(rowIds()).toEqual(['R-101', 'R-103', 'R-104']);
    expect(screen.queryByTestId('inspection-row-R-102')).not.toBeInTheDocument();
    expect(screen.getByTestId('summary-CONFLICT')).toHaveTextContent('1');
    expect(screen.getByTestId('summary-NORMAL')).toHaveTextContent('1');
    expect(screen.getByTestId('summary-EXCLUDED')).toHaveTextContent('0');

    fireEvent.click(screen.getByTestId('summary-ALL'));
    expect(screen.getByTestId('summary-ALL')).toHaveTextContent('전체 4');
    expect(screen.getByTestId('summary-ALL')).toHaveAttribute('aria-pressed', 'true');
    expect(rowIds()).toEqual(['R-101', 'R-103', 'R-104', 'R-102']);
    fireEvent.click(screen.getByTestId('summary-NORMAL'));
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
    // The own save is reported by the recheck result, not by the list announcer.
    await new Promise((r) => setTimeout(r, 80));
    expect(screen.getByTestId('judgment-announcer')).toBeEmptyDOMElement();
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

  it.each([
    [new ApiError(400, { message: ['reason must be shorter than or equal to 200 characters'] })],
    [new ApiError(500, { message: 'Internal server error' })],
    [new ApiError(422, { message: 'SOMETHING_NEW' })],
    [new TypeError('Failed to fetch')],
  ])('shows a generic Korean message for unmapped failures (%s)', async (err) => {
    const user = userEvent.setup();
    mocked.rescheduleCleaning.mockRejectedValue(err);
    renderWithClient(<OperationsPage />);
    await user.click(await screen.findByTestId('inspection-row-R-101'));
    await user.click(screen.getByTestId('cleaning-save'));
    const notice = await screen.findByTestId('error-notice');
    expect(notice).toHaveTextContent('저장에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    expect(notice.textContent).not.toMatch(/[A-Za-z]/);
  });

  it.each([
    [422, 'CLEANING_TASK_CANCELLED', '취소된 청소 작업은 변경할 수 없습니다.'],
    [422, 'RESERVATION_CANCELLED', '취소된 예약은 변경할 수 없습니다.'],
    [404, 'CLEANING_TASK_NOT_FOUND', '청소 작업을 찾을 수 없습니다. 목록을 새로고침해 주세요.'],
    [404, 'RESERVATION_NOT_FOUND', '예약을 찾을 수 없습니다. 목록을 새로고침해 주세요.'],
    [403, 'FORBIDDEN_ROLE', '이 작업을 수행할 권한이 없습니다.'],
  ])('maps %i %s to Korean', async (status, code, text) => {
    const user = userEvent.setup();
    mocked.rescheduleCleaning.mockRejectedValue(new ApiError(status, { message: code }));
    renderWithClient(<OperationsPage />);
    await user.click(await screen.findByTestId('inspection-row-R-101'));
    await user.click(screen.getByTestId('cleaning-save'));
    expect(await screen.findByTestId('error-notice')).toHaveTextContent(text);
  });

  it('caps the memo at 200 characters', async () => {
    const user = userEvent.setup();
    renderWithClient(<OperationsPage />);
    await user.click(await screen.findByTestId('inspection-row-R-101'));
    expect(screen.getByTestId('cleaning-reason')).toHaveAttribute('maxLength', '200');
  });

  it('marks the selected row with aria-current', async () => {
    const user = userEvent.setup();
    renderWithClient(<OperationsPage />);
    const row = await screen.findByTestId('inspection-row-R-101');
    expect(row).not.toHaveAttribute('aria-current');
    await user.click(row);
    expect(row).toHaveAttribute('aria-current', 'true');
    expect(row).not.toHaveAttribute('aria-selected');
  });

  it('the 조치 필요 group label sets the action-required filter', async () => {
    const user = userEvent.setup();
    renderWithClient(<OperationsPage />);
    await screen.findByTestId('inspection-row-R-101');
    await user.click(screen.getByTestId('summary-NORMAL'));
    expect(rowIds()).toEqual(['R-102']);
    const group = screen.getByRole('button', { name: /조치 필요/ });
    expect(group).toHaveAttribute('aria-pressed', 'false');
    await user.click(group);
    expect(screen.getByTestId('summary-NORMAL')).toHaveAttribute('aria-pressed', 'false');
    expect(group).toHaveAttribute('aria-pressed', 'true');
    expect(rowIds()).toEqual(['R-101', 'R-103', 'R-104']);
  });

  it('hides the recheck result once a newer judgment arrives', async () => {
    const user = userEvent.setup();
    const saved = makeReservation('R-101', {
      status: 'NORMAL',
      checkoutAt: '2026-10-26T04:00:00.000Z',
      cleaning: { scheduledStartAt: '2026-10-26T04:30:00.000Z', version: 2 },
    });
    saved.inspection!.checkedAt = '2026-10-25T01:00:00.000Z';
    mocked.rescheduleCleaning.mockResolvedValue(saved);
    const { queryClient } = renderWithClient(<OperationsPage />);
    await user.click(await screen.findByTestId('inspection-row-R-101'));
    mocked.listInspections.mockResolvedValue(fixture().map((r) => (r.id === 'R-101' ? saved : r)));
    fireEvent.change(screen.getByTestId('cleaning-input'), { target: { value: '2026-10-26T13:30' } });
    await user.click(screen.getByTestId('cleaning-save'));
    expect(await screen.findByTestId('recheck-result')).toHaveTextContent('재점검 결과: 정상');

    // the agent moves the checkout again → a newer CONFLICT judgment arrives over SSE
    const later = makeReservation('R-101', {
      status: 'CONFLICT',
      checkoutAt: '2026-10-26T06:00:00.000Z',
      cleaning: { scheduledStartAt: '2026-10-26T04:30:00.000Z', version: 2 },
      version: 3,
    });
    later.inspection!.checkedAt = '2026-10-25T02:00:00.000Z';
    mocked.listInspections.mockResolvedValue(fixture().map((r) => (r.id === 'R-101' ? later : r)));
    await queryClient.invalidateQueries();
    const panel = screen.getByTestId('detail-panel');
    await waitFor(() =>
      expect(within(panel).getAllByTestId('status-badge')[0]).toHaveAttribute('data-status', 'CONFLICT'),
    );
    expect(screen.queryByTestId('recheck-result')).not.toBeInTheDocument();
  });

  // Another manager moves R-101's cleaning to 12:00 KST (version 2); the SSE refetch delivers it.
  const movedByOther = () =>
    fixture().map((r) =>
      r.id === 'R-101'
        ? makeReservation('R-101', {
            status: 'CONFLICT',
            checkoutAt: '2026-10-26T04:00:00.000Z',
            cleaning: { scheduledStartAt: '2026-10-26T03:00:00.000Z', version: 2 },
          })
        : r,
    );

  it('follows a newer cleaning value (and its version) while the input is untouched', async () => {
    const user = userEvent.setup();
    const { queryClient } = renderWithClient(<OperationsPage />);
    await user.click(await screen.findByTestId('inspection-row-R-101'));
    expect(screen.getByTestId('cleaning-input')).toHaveValue('2026-10-26T11:30');
    mocked.listInspections.mockResolvedValue(movedByOther());
    await queryClient.invalidateQueries();
    await waitFor(() => expect(screen.getByTestId('cleaning-input')).toHaveValue('2026-10-26T12:00'));
    expect(screen.queryByTestId('remote-change-notice')).not.toBeInTheDocument();
    mocked.rescheduleCleaning.mockResolvedValue(movedByOther()[2]);
    await user.click(screen.getByTestId('cleaning-save'));
    expect(mocked.rescheduleCleaning).toHaveBeenCalledWith('C-101', {
      scheduledStartAt: '2026-10-26T03:00:00.000Z',
      version: 2,
    });
  });

  it('keeps a typed value and its old version after a remote change, with a notice', async () => {
    const user = userEvent.setup();
    const { queryClient } = renderWithClient(<OperationsPage />);
    await user.click(await screen.findByTestId('inspection-row-R-101'));
    fireEvent.change(screen.getByTestId('cleaning-input'), { target: { value: '2026-10-26T13:30' } });
    mocked.listInspections.mockResolvedValue(movedByOther());
    await queryClient.invalidateQueries();
    expect(await screen.findByTestId('remote-change-notice')).toHaveTextContent(
      '다른 사용자가 12:00으로 변경했습니다.',
    );
    expect(screen.getByTestId('cleaning-input')).toHaveValue('2026-10-26T13:30');
    // Saving anyway sends the version the typed value was based on → 409 from the server.
    mocked.rescheduleCleaning.mockRejectedValue(new ApiError(409, { message: 'VERSION_CONFLICT' }));
    await user.click(screen.getByTestId('cleaning-save'));
    expect(mocked.rescheduleCleaning).toHaveBeenCalledWith('C-101', {
      scheduledStartAt: '2026-10-26T04:30:00.000Z',
      version: 1,
    });
    expect(await screen.findByTestId('conflict-notice')).toBeInTheDocument();
  });

  it('"최신 값 불러오기" adopts the remote value and version', async () => {
    const user = userEvent.setup();
    const { queryClient } = renderWithClient(<OperationsPage />);
    await user.click(await screen.findByTestId('inspection-row-R-101'));
    fireEvent.change(screen.getByTestId('cleaning-input'), { target: { value: '2026-10-26T13:30' } });
    mocked.listInspections.mockResolvedValue(movedByOther());
    await queryClient.invalidateQueries();
    await user.click(await screen.findByTestId('remote-change-reload'));
    expect(screen.getByTestId('cleaning-input')).toHaveValue('2026-10-26T12:00');
    expect(screen.queryByTestId('remote-change-notice')).not.toBeInTheDocument();
    mocked.rescheduleCleaning.mockResolvedValue(movedByOther()[2]);
    await user.click(screen.getByTestId('cleaning-save'));
    expect(mocked.rescheduleCleaning).toHaveBeenCalledWith('C-101', expect.objectContaining({ version: 2 }));
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

describe('OperationsPage live changes', () => {
  it('highlights and announces rows whose judgment changed, not the first load', async () => {
    const { queryClient } = renderWithClient(<OperationsPage />);
    const r101 = await screen.findByTestId('inspection-row-R-101');
    expect(r101.className).not.toMatch(/row-flash/);
    expect(screen.getByTestId('judgment-announcer')).toBeEmptyDOMElement();

    // R-104 gets its checkout (→ NORMAL) and a new conflicting reservation R-107 arrives.
    mocked.listInspections.mockResolvedValue([
      ...fixture().map((r) => (r.id === 'R-104' ? makeReservation('R-104', { status: 'NORMAL' }) : r)),
      makeReservation('R-107', { status: 'CONFLICT' }),
    ]);
    await queryClient.invalidateQueries();
    await waitFor(() => expect(screen.getByTestId('inspection-row-R-107').className).toMatch(/row-flash/));
    expect(screen.getByTestId('inspection-row-R-101').className).not.toMatch(/row-flash/);
    await waitFor(() =>
      expect(screen.getByTestId('judgment-announcer')).toHaveTextContent('R-107 불일치, R-104 정상으로 변경'),
    );
  });

  it('puts the action-required count in the tab title', async () => {
    const { queryClient, unmount } = renderWithClient(<OperationsPage />);
    await screen.findByTestId('inspection-row-R-101');
    expect(document.title).toBe('(3) 청소 일정 점검');
    mocked.listInspections.mockResolvedValue(
      fixture().map((r) => makeReservation(r.id, { status: 'NORMAL' })),
    );
    await queryClient.invalidateQueries();
    await waitFor(() => expect(document.title).toBe('청소 일정 점검'));
    unmount();
    expect(document.title).toBe('청소 일정 점검');
  });
});

describe('OperationsPage list efficiency', () => {
  it('sorts each status group by cleaning start, missing last, then id', async () => {
    mocked.listInspections.mockResolvedValue([
      makeReservation('R-201', { status: 'CONFLICT', cleaning: { scheduledStartAt: '2026-10-26T03:00:00.000Z' } }),
      makeReservation('R-202', { status: 'CONFLICT', cleaning: { scheduledStartAt: '2026-10-26T01:00:00.000Z' } }),
      makeReservation('R-203', { status: 'UNDETERMINED', cleaning: { scheduledStartAt: null } }),
      makeReservation('R-204', { status: 'UNDETERMINED', cleaning: { scheduledStartAt: '2026-10-26T05:00:00.000Z' } }),
      makeReservation('R-200', { status: 'CONFLICT', cleaning: { scheduledStartAt: '2026-10-26T03:00:00.000Z' } }),
      makeReservation('R-205', { status: 'NEEDS_CHECK', cleaning: null }),
    ]);
    renderWithClient(<OperationsPage />);
    await screen.findByTestId('inspection-row-R-201');
    expect(rowIds()).toEqual(['R-202', 'R-200', 'R-201', 'R-205', 'R-204', 'R-203']);
  });

  it('shows how far away each cleaning start is', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-26T00:00:00.000Z'));
    mocked.listInspections.mockResolvedValue([
      makeReservation('R-101', { status: 'CONFLICT', cleaning: { scheduledStartAt: '2026-10-26T02:30:00.000Z' } }),
      makeReservation('R-102', { status: 'CONFLICT', cleaning: { scheduledStartAt: '2026-10-26T00:40:00.000Z' } }),
      makeReservation('R-103', { status: 'CONFLICT', cleaning: { scheduledStartAt: '2026-10-25T23:00:00.000Z' } }),
    ]);
    try {
      renderWithClient(<OperationsPage />);
      const rel = async (id: string) =>
        within(await screen.findByTestId(`inspection-row-${id}`)).getByTestId('cleaning-relative');
      expect(await rel('R-101')).toHaveTextContent('2시간 후');
      expect(await rel('R-102')).toHaveTextContent('40분 후');
      expect(await rel('R-103')).toHaveTextContent('지남');
    } finally {
      vi.mocked(Date.now).mockRestore();
    }
  });

  it('rows are buttons named by reservation; j/k and arrows move the selection', async () => {
    const user = userEvent.setup();
    renderWithClient(<OperationsPage />);
    await screen.findByTestId('inspection-row-R-101');
    const first = screen.getByRole('button', { name: 'R-101 상세 보기' });
    await user.keyboard('j');
    expect(screen.getByTestId('inspection-row-R-101')).toHaveAttribute('aria-current', 'true');
    await waitFor(() => expect(first).toHaveFocus());
    await user.keyboard('j');
    expect(screen.getByTestId('inspection-row-R-103')).toHaveAttribute('aria-current', 'true');
    await user.keyboard('{ArrowDown}');
    expect(screen.getByTestId('inspection-row-R-104')).toHaveAttribute('aria-current', 'true');
    await user.keyboard('k');
    expect(screen.getByTestId('inspection-row-R-103')).toHaveAttribute('aria-current', 'true');
    await user.keyboard('{ArrowUp}');
    expect(screen.getByTestId('inspection-row-R-101')).toHaveAttribute('aria-current', 'true');
    // typing in the form does not move the selection
    await user.type(screen.getByTestId('cleaning-reason'), 'jk');
    expect(screen.getByTestId('inspection-row-R-101')).toHaveAttribute('aria-current', 'true');
  });

  it('Enter on a row opens it and focuses the cleaning input', async () => {
    const user = userEvent.setup();
    renderWithClient(<OperationsPage />);
    await screen.findByTestId('inspection-row-R-101');
    screen.getByRole('button', { name: 'R-101 상세 보기' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('detail-panel')).toHaveTextContent('R-101');
    await waitFor(() => expect(screen.getByTestId('cleaning-input')).toHaveFocus());
  });

  it('목록으로 closes the detail panel and returns focus to the row', async () => {
    const user = userEvent.setup();
    renderWithClient(<OperationsPage />);
    await user.click(await screen.findByTestId('inspection-row-R-101'));
    await user.click(screen.getByRole('button', { name: '목록으로' }));
    expect(screen.queryByTestId('detail-panel')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'R-101 상세 보기' })).toHaveFocus());
  });

  it('shows the checkout next to the cleaning input, fills +30 min and warns when earlier', async () => {
    const user = userEvent.setup();
    renderWithClient(<OperationsPage />);
    await user.click(await screen.findByTestId('inspection-row-R-101'));
    const panel = screen.getByTestId('detail-panel');
    expect(within(panel).getByTestId('cleaning-checkout')).toHaveTextContent('10/26 13:00');
    const input = within(panel).getByTestId('cleaning-input');
    expect(input).toHaveAttribute('aria-describedby', 'cleaning-checkout cleaning-warn');
    expect(document.getElementById('cleaning-checkout')).not.toContainElement(
      within(panel).getByRole('button', { name: '체크아웃 +30분' }),
    );
    // The untouched current value is not warned about (the judgment already says so).
    expect(within(panel).queryByTestId('cleaning-before-checkout')).not.toBeInTheDocument();
    // An entered 11:45 is before the 13:00 checkout: warned in a status region, saving stays possible
    fireEvent.change(input, { target: { value: '2026-10-26T11:45' } });
    expect(within(panel).getByTestId('cleaning-before-checkout')).toHaveTextContent(
      '체크아웃보다 이른 시각입니다.',
    );
    expect(document.getElementById('cleaning-warn')).toHaveAttribute('role', 'status');
    expect(within(panel).getByTestId('cleaning-save')).toBeEnabled();
    await user.click(within(panel).getByRole('button', { name: '체크아웃 +30분' }));
    expect(within(panel).getByTestId('cleaning-input')).toHaveValue('2026-10-26T13:30');
    expect(within(panel).queryByTestId('cleaning-before-checkout')).not.toBeInTheDocument();
  });
});

describe('OperationsPage review fixes', () => {
  const withCleaning = (version: number, at: string) =>
    fixture().map((r) =>
      r.id === 'R-101'
        ? makeReservation('R-101', {
            status: 'CONFLICT',
            checkoutAt: '2026-10-26T04:00:00.000Z',
            cleaning: { scheduledStartAt: at, version },
          })
        : r,
    );

  /** Every text the live region shows, in order (to see clear-then-fill). */
  function recordTexts(el: HTMLElement): string[] {
    const seen: string[] = [];
    new MutationObserver(() => seen.push(el.textContent ?? '')).observe(el, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    return seen;
  }

  it('highlights and announces a data change that keeps the judgment, also when repeated', async () => {
    const { queryClient } = renderWithClient(<OperationsPage />);
    await screen.findByTestId('inspection-row-R-101');
    const live = screen.getByTestId('judgment-announcer');
    const seen = recordTexts(live);

    mocked.listInspections.mockResolvedValue(withCleaning(2, '2026-10-26T02:45:00.000Z'));
    await queryClient.invalidateQueries();
    await waitFor(() => expect(live).toHaveTextContent('R-101 청소 시작 변경'));
    expect(screen.getByTestId('inspection-row-R-101').className).toMatch(/row-flash/);

    mocked.listInspections.mockResolvedValue(withCleaning(3, '2026-10-26T03:00:00.000Z'));
    await queryClient.invalidateQueries();
    await waitFor(() =>
      expect(seen.filter((t) => t === 'R-101 청소 시작 변경')).toHaveLength(2),
    );
    // cleared between the two identical messages so the second one is read out too
    const first = seen.indexOf('R-101 청소 시작 변경');
    expect(seen.slice(first + 1)).toContain('');
  });

  it('j/k do not move away from an edited cleaning time or from inside the form', async () => {
    const user = userEvent.setup();
    renderWithClient(<OperationsPage />);
    await user.click(await screen.findByTestId('inspection-row-R-101'));
    // focus inside the form (save button): no navigation
    screen.getByTestId('cleaning-save').focus();
    await user.keyboard('j');
    expect(screen.getByTestId('inspection-row-R-101')).toHaveAttribute('aria-current', 'true');
    // edited value, focus back on the list: still no navigation, the typed value survives
    fireEvent.change(screen.getByTestId('cleaning-input'), { target: { value: '2026-10-26T13:30' } });
    screen.getByRole('button', { name: 'R-101 상세 보기' }).focus();
    await user.keyboard('j');
    await user.keyboard('{ArrowDown}');
    expect(screen.getByTestId('inspection-row-R-101')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByTestId('cleaning-input')).toHaveValue('2026-10-26T13:30');
  });

  it('j/k work by physical key while a Korean IME is active', async () => {
    renderWithClient(<OperationsPage />);
    await screen.findByTestId('inspection-row-R-101');
    fireEvent.keyDown(document.body, { key: 'ㅓ', code: 'KeyJ' });
    expect(screen.getByTestId('inspection-row-R-101')).toHaveAttribute('aria-current', 'true');
    fireEvent.keyDown(document.body, { key: 'ㅓ', code: 'KeyJ' });
    expect(screen.getByTestId('inspection-row-R-103')).toHaveAttribute('aria-current', 'true');
    fireEvent.keyDown(document.body, { key: 'ㅏ', code: 'KeyK' });
    expect(screen.getByTestId('inspection-row-R-101')).toHaveAttribute('aria-current', 'true');
  });

  it('does not resync the untouched input while it has focus; resyncs on blur', async () => {
    const user = userEvent.setup();
    const { queryClient } = renderWithClient(<OperationsPage />);
    await user.click(await screen.findByTestId('inspection-row-R-101'));
    const input = screen.getByTestId('cleaning-input');
    fireEvent.focus(input);
    mocked.listInspections.mockResolvedValue(withCleaning(2, '2026-10-26T03:00:00.000Z'));
    await queryClient.invalidateQueries();
    await waitFor(() =>
      expect(screen.getByTestId('inspection-row-R-101')).toHaveTextContent('10/26 12:00'),
    );
    expect(input).toHaveValue('2026-10-26T11:30');
    fireEvent.blur(input);
    await waitFor(() => expect(input).toHaveValue('2026-10-26T12:00'));
  });

  it('the remote-change notice appears inside an always-mounted live region', async () => {
    const user = userEvent.setup();
    const { queryClient } = renderWithClient(<OperationsPage />);
    await user.click(await screen.findByTestId('inspection-row-R-101'));
    const form = screen.getByRole('form', { name: 'R-101 청소 일정 수정' });
    const slot = form.querySelector('.live-slot')!;
    expect(slot).toHaveAttribute('aria-live', 'polite');
    expect(slot).toBeEmptyDOMElement();
    fireEvent.change(screen.getByTestId('cleaning-input'), { target: { value: '2026-10-26T13:30' } });
    mocked.listInspections.mockResolvedValue(withCleaning(2, '2026-10-26T03:00:00.000Z'));
    await queryClient.invalidateQueries();
    expect(await within(slot as HTMLElement).findByTestId('remote-change-notice')).toBeInTheDocument();
  });

  it('filters with one row of chips; zero counts are muted', async () => {
    renderWithClient(<OperationsPage />);
    await screen.findByTestId('inspection-row-R-101');
    const group = screen.getByRole('group', { name: '판정별 보기' });
    const labels = within(group)
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(labels).toEqual(['조치 필요 3', '불일치 1', '확인 필요 1', '판정 불가 1', '정상 1', '제외 0', '전체 4']);
    expect(screen.getByTestId('summary-EXCLUDED')).toHaveClass('is-zero');
    expect(screen.getByTestId('summary-CONFLICT')).toHaveClass('has-items');
  });

  it('detail shows id, badge and reason on one line without repeating the row facts', async () => {
    const user = userEvent.setup();
    renderWithClient(<OperationsPage />);
    await user.click(await screen.findByTestId('inspection-row-R-101'));
    const panel = screen.getByTestId('detail-panel');
    const head = panel.querySelector('.detail-head')!;
    expect(head).toHaveTextContent('R-101');
    expect(head).toHaveTextContent('체크아웃 이전에 청소 시작 예정');
    expect(panel).not.toHaveTextContent('고객101');
    expect(panel).not.toHaveTextContent('101호');
  });
});
