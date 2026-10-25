import { createContext, useContext } from 'react';

export type RealtimeState = 'connecting' | 'open' | 'reconnecting' | 'disconnected';

export interface RealtimeValue {
  state: RealtimeState;
  lastUpdatedAt: Date | null;
  paused: boolean;
  pause(): void;
  resume(): void;
}

export const RealtimeContext = createContext<RealtimeValue | null>(null);

export function useRealtime(): RealtimeValue {
  const ctx = useContext(RealtimeContext);
  if (!ctx) throw new Error('useRealtime must be used within RealtimeProvider');
  return ctx;
}
