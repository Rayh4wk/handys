import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type RealtimeState = 'connecting' | 'open' | 'reconnecting' | 'disconnected';

export interface RealtimeValue {
  state: RealtimeState;
  lastUpdatedAt: Date | null;
  paused: boolean;
  pause(): void;
  resume(): void;
}

declare global {
  interface Window {
    __lastSseEvent?: { receivedAt: number; data: unknown };
  }
}

const RECONNECT_DELAY_MS = 3000;
const TRACKED_KEYS = new Set(['reservations', 'inspection-results']);

const RealtimeContext = createContext<RealtimeValue | null>(null);

export function RealtimeProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<RealtimeState>('disconnected');
  const [paused, setPaused] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [generation, setGeneration] = useState(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (!enabled || paused) {
      setState('disconnected');
      return;
    }
    setState('connecting');
    const es = new EventSource('/api/events');
    es.onopen = () => {
      setState('open');
      void queryClient.invalidateQueries();
    };
    es.onmessage = (ev: MessageEvent) => {
      let data: any;
      try {
        data = JSON.parse(ev.data);
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
      setState('reconnecting');
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
  }, [enabled, paused, generation, queryClient]);

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

export function useRealtime(): RealtimeValue {
  const ctx = useContext(RealtimeContext);
  if (!ctx) throw new Error('useRealtime must be used within RealtimeProvider');
  return ctx;
}
