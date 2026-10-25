import { act, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { RealtimeProvider, useRealtime } from './useRealtime';

class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readyState = FakeEventSource.CONNECTING;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }
  emitOpen() {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.(new Event('open'));
  }
  emitMessage(data: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }));
  }
  emitError() {
    this.onerror?.(new Event('error'));
  }
}

let latest: ReturnType<typeof useRealtime> | null = null;
let seenStates: string[] = [];
function Probe() {
  const value = useRealtime();
  // Record every committed value (effects, not render, so the probe stays pure).
  useEffect(() => {
    latest = value;
    seenStates.push(value.state);
  });
  return <span data-testid="state">{value.state}</span>;
}

function setup() {
  const queryClient = new QueryClient();
  const spy = vi.spyOn(queryClient, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <RealtimeProvider enabled>{children}</RealtimeProvider>
    </QueryClientProvider>
  );
  const utils = render(<Probe />, { wrapper });
  return { queryClient, spy, ...utils };
}

const current = () => FakeEventSource.instances[FakeEventSource.instances.length - 1];

beforeEach(() => {
  FakeEventSource.instances = [];
  latest = null;
  seenStates = [];
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('RealtimeProvider', () => {
  it('opens a single EventSource to /api/events', () => {
    setup();
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(current().url).toBe('/api/events');
    expect(latest!.state).toBe('connecting');
  });

  it('invalidates all queries when connection opens', () => {
    const { spy } = setup();
    act(() => current().emitOpen());
    expect(spy).toHaveBeenCalledWith();
    expect(latest!.state).toBe('open');
  });

  it('invalidates reservation queries on reservation.updated', () => {
    const { spy } = setup();
    act(() => current().emitOpen());
    spy.mockClear();
    act(() =>
      current().emitMessage({ type: 'reservation.updated', reservationId: 'R-101', version: 4 }),
    );
    const keys = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toContainEqual(['reservations']);
    expect(keys).toContainEqual(['inspection-results']);
    expect(keys).toContainEqual(['audit-logs', 'R-101']);
    expect(window.__lastSseEvent?.data).toEqual({
      type: 'reservation.updated',
      reservationId: 'R-101',
      version: 4,
    });
  });

  it('ignores heartbeat', () => {
    const { spy } = setup();
    act(() => current().emitOpen());
    spy.mockClear();
    act(() => current().emitMessage({ type: 'heartbeat' }));
    expect(spy).not.toHaveBeenCalled();
  });

  it('goes to reconnecting on error and recreates after 3s when CLOSED', () => {
    vi.useFakeTimers();
    setup();
    act(() => current().emitOpen());
    act(() => current().emitError());
    expect(latest!.state).toBe('reconnecting');
    expect(FakeEventSource.instances).toHaveLength(1);
    act(() => {
      current().readyState = FakeEventSource.CLOSED;
      current().emitError();
    });
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(FakeEventSource.instances).toHaveLength(2);
  });

  it('pause closes the EventSource and sets disconnected', () => {
    setup();
    act(() => current().emitOpen());
    const first = current();
    act(() => latest!.pause());
    expect(first.closed).toBe(true);
    expect(latest!.state).toBe('disconnected');
    expect(latest!.paused).toBe(true);
  });

  it('resume opens a new one', () => {
    setup();
    act(() => current().emitOpen());
    act(() => latest!.pause());
    act(() => latest!.resume());
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(current().closed).toBe(false);
    expect(latest!.paused).toBe(false);
    expect(latest!.state).toBe('connecting');
  });

  it('tracks lastUpdatedAt from reservations query success', async () => {
    const { queryClient } = setup();
    expect(latest!.lastUpdatedAt).toBeNull();
    await act(async () => {
      await queryClient.fetchQuery({ queryKey: ['reservations'], queryFn: async () => [] });
    });
    expect(latest!.lastUpdatedAt).toBeInstanceOf(Date);
  });

  it('starts in connecting (never flashes disconnected) when enabled', () => {
    setup();
    expect(seenStates[0]).toBe('connecting');
    expect(seenStates).not.toContain('disconnected');
  });

  it('starts disconnected when not enabled', () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <RealtimeProvider enabled={false}>
          <Probe />
        </RealtimeProvider>
      </QueryClientProvider>,
    );
    expect(seenStates[0]).toBe('disconnected');
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('resets paused and lastUpdatedAt when disabled (logout) so next login connects', async () => {
    const queryClient = new QueryClient();
    const tree = (enabled: boolean) => (
      <QueryClientProvider client={queryClient}>
        <RealtimeProvider enabled={enabled}>
          <Probe />
        </RealtimeProvider>
      </QueryClientProvider>
    );
    const { rerender } = render(tree(true));
    await act(async () => {
      await queryClient.fetchQuery({ queryKey: ['reservations'], queryFn: async () => [] });
    });
    act(() => current().emitOpen());
    act(() => latest!.pause());
    expect(latest!.paused).toBe(true);
    expect(latest!.lastUpdatedAt).not.toBeNull();

    rerender(tree(false));
    expect(latest!.paused).toBe(false);
    expect(latest!.lastUpdatedAt).toBeNull();
    expect(latest!.state).toBe('disconnected');

    const before = FakeEventSource.instances.length;
    rerender(tree(true));
    expect(FakeEventSource.instances.length).toBe(before + 1);
    expect(current().closed).toBe(false);
    expect(latest!.state).toBe('connecting');
  });
});
