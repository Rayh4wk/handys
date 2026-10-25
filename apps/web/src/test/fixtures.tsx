import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import type { InspectionStatus, ReservationView } from '../api/types';

export function makeReservation(
  id: string,
  opts: {
    checkoutAt?: string | null;
    cleaning?: { scheduledStartAt: string | null; version?: number } | null;
    status?: InspectionStatus;
    reasonText?: string;
    cancelled?: boolean;
    version?: number;
  } = {},
): ReservationView {
  const n = id.replace(/\D/g, '');
  return {
    id,
    roomId: `${n}호`,
    guestName: `고객${n}`,
    checkoutAt: opts.checkoutAt === undefined ? '2026-10-26T02:00:00.000Z' : opts.checkoutAt,
    status: opts.cancelled ? 'CANCELLED' : 'CONFIRMED',
    version: opts.version ?? 1,
    cleaningTask:
      opts.cleaning === null
        ? null
        : {
            id: `C-${n}`,
            scheduledStartAt:
              opts.cleaning === undefined ? '2026-10-26T02:30:00.000Z' : opts.cleaning.scheduledStartAt,
            status: 'SCHEDULED',
            version: opts.cleaning?.version ?? 1,
          },
    inspection: {
      status: opts.status ?? 'NORMAL',
      reasonCode: 'X',
      reasonText: opts.reasonText ?? '근거 문구',
      checkedAt: '2026-10-25T00:00:00.000Z',
    },
  };
}

export function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const utils = render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
  return { queryClient, ...utils };
}
