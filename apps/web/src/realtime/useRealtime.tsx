import { useQueryClient } from '@tanstack/react-query';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { RealtimeContext, type RealtimeState, type RealtimeValue } from './realtimeContext';

declare global {
  interface Window {
    __lastSseEvent?: { receivedAt: number; data: unknown };
  }
}

const RECONNECT_DELAY_MS = 3000;
const TRACKED_KEYS = new Set(['reservations', 'inspection-results']);

interface SseEvent {
  type?: unknown;
  reservationId?: unknown;
}

export function RealtimeProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const queryClient = useQueryClient();
  const [paused, setPaused] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [generation, setGeneration] = useState(0);
  // State reported by the EventSource of a given generation. A newer generation (or a fresh
  // enable) has not reported yet, so it is 'connecting' — no "disconnected" flash on start.
  const [conn, setConn] = useState<{ generation: number; state: RealtimeState } | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // On logout (enabled → false) forget pause/last-updated so the next login starts clean.
  const [prevEnabled, setPrevEnabled] = useState(enabled);
  if (prevEnabled !== enabled) {
    setPrevEnabled(enabled);
    if (!enabled) {
      setPaused(false);
      setLastUpdatedAt(null);
      setConn(null);
    }
  }

  const active = enabled && !paused;
  const state: RealtimeState = !active
    ? 'disconnected'
    : conn && conn.generation === generation
      ? conn.state
      : 'connecting';

  // lastUpdatedAt: last successful fetch of reservations / inspection-results queries.
  useEffect(() => {
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated' || event.action.type !== 'success') return;
      const head = event.query.queryKey[0];
      if (typeof head === 'string' && TRACKED_KEYS.has(head)) {
        setLastUpdatedAt(new Date(event.query.state.dataUpdatedAt || Date.now()));
      }
    });
  }, [queryClient]);

  useEffect(() => {
    if (!active) return;
    const report = (s: RealtimeState) => setConn({ generation, state: s });
    const es = new EventSource('/api/events');
    es.onopen = () => {
      report('open');
      void queryClient.invalidateQueries();
    };
    es.onmessage = (ev: MessageEvent) => {
      let data: SseEvent | null;
      try {
        data = JSON.parse(String(ev.data)) as SseEvent | null;
      } catch {
        return;
      }
      window.__lastSseEvent = { receivedAt: Date.now(), data };
      if (data?.type === 'reservation.updated') {
        void queryClient.invalidateQueries({ queryKey: ['reservations'] });
        void queryClient.invalidateQueries({ queryKey: ['inspection-results'] });
        if (typeof data.reservationId === 'string') {
          void queryClient.invalidateQueries({ queryKey: ['audit-logs', data.reservationId] });
        }
      }
      // heartbeat and unknown types: ignored
    };
    es.onerror = () => {
      report('reconnecting');
      // The browser auto-reconnects unless the source is CLOSED; then we recreate it ourselves.
      if (es.readyState === EventSource.CLOSED && !retryTimer.current) {
        retryTimer.current = setTimeout(() => {
          retryTimer.current = null;
          setGeneration((g) => g + 1);
        }, RECONNECT_DELAY_MS);
      }
    };
    return () => {
      es.onopen = es.onmessage = es.onerror = null;
      es.close();
      if (retryTimer.current) {
        clearTimeout(retryTimer.current);
        retryTimer.current = null;
      }
    };
  }, [active, generation, queryClient]);

  const pause = useCallback(() => setPaused(true), []);
  const resume = useCallback(() => {
    setPaused(false);
    setGeneration((g) => g + 1);
  }, []);

  const value = useMemo<RealtimeValue>(
    () => ({ state, lastUpdatedAt, paused, pause, resume }),
    [state, lastUpdatedAt, paused, pause, resume],
  );

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}
