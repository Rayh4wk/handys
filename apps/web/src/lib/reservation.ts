import type { QueryClient } from '@tanstack/react-query';
import { ApiError, queryKeys } from '../api/client';
import type { InspectionStatus, ReservationView } from '../api/types';
import { formatKst, formatKstTime } from './kst';

export const MISSING = '정보 누락';
export const NO_TASK = '작업 없음';

/** The checkout-cleaning task that counts for inspection (a cancelled task counts as none). */
export function activeCleaning(r: ReservationView): ReservationView['cleaningTask'] {
  return r.cleaningTask && r.cleaningTask.status !== 'CANCELLED' ? r.cleaningTask : null;
}

/** "MM/DD HH:mm" or "정보 누락" */
export function checkoutText(r: ReservationView): string {
  return r.checkoutAt ? formatKst(r.checkoutAt) : MISSING;
}

/** "MM/DD HH:mm", "작업 없음" or "정보 누락" */
export function cleaningText(r: ReservationView): string {
  const task = activeCleaning(r);
  if (!task) return NO_TASK;
  return task.scheduledStartAt ? formatKst(task.scheduledStartAt) : MISSING;
}

/** "HH:mm", "작업 없음" or "정보 누락" */
export function cleaningTimeText(r: ReservationView): string {
  const task = activeCleaning(r);
  if (!task) return NO_TASK;
  return task.scheduledStartAt ? formatKstTime(task.scheduledStartAt) : MISSING;
}

/** "HH:mm" or "정보 누락" */
export function timeOrMissing(iso: string | null): string {
  return iso ? formatKstTime(iso) : MISSING;
}

export function statusOf(r: ReservationView | null | undefined): InspectionStatus | null {
  return r?.inspection?.status ?? null;
}

export const STATUS_ORDER: InspectionStatus[] = [
  'CONFLICT',
  'NEEDS_CHECK',
  'UNDETERMINED',
  'NORMAL',
  'EXCLUDED',
];

export const ACTION_REQUIRED: ReadonlySet<InspectionStatus> = new Set([
  'CONFLICT',
  'NEEDS_CHECK',
  'UNDETERMINED',
]);

const rank = (r: ReservationView) => {
  const s = statusOf(r);
  return s ? STATUS_ORDER.indexOf(s) : STATUS_ORDER.length;
};

export function byPriorityThenId(a: ReservationView, b: ReservationView): number {
  return rank(a) - rank(b) || a.id.localeCompare(b.id);
}

export function byId(a: ReservationView, b: ReservationView): number {
  return a.id.localeCompare(b.id);
}

export type SaveNotice = { kind: 'conflict' } | { kind: 'error'; message: string };

export function isConflict(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409;
}

/** On 409 VERSION_CONFLICT the server normally sends the latest view. */
export function conflictCurrent(err: unknown): ReservationView | null {
  if (!isConflict(err)) return null;
  const body = (err as ApiError).body;
  if (body && typeof body === 'object' && 'current' in body) {
    return (body as { current: ReservationView | null }).current ?? null;
  }
  return null;
}

export const SAVE_FAILED = '저장에 실패했습니다. 잠시 후 다시 시도해 주세요.';

const ERROR_TEXT: Record<string, string> = {
  RESERVATION_CANCELLED: '취소된 예약은 변경할 수 없습니다.',
  CLEANING_TASK_CANCELLED: '취소된 청소 작업은 변경할 수 없습니다.',
  NOT_CHECKOUT_CLEANING: '퇴실 청소 작업만 변경할 수 있습니다.',
  RESERVATION_NOT_FOUND: '예약을 찾을 수 없습니다. 목록을 새로고침해 주세요.',
  CLEANING_TASK_NOT_FOUND: '청소 작업을 찾을 수 없습니다. 목록을 새로고침해 주세요.',
};

/** Korean message for a failed save; server/validation text never reaches the screen. */
export function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return '로그인이 만료되었습니다. 다시 로그인해 주세요.';
    if (err.status === 403) return '이 작업을 수행할 권한이 없습니다.';
    const known = Object.prototype.hasOwnProperty.call(ERROR_TEXT, err.message);
    if (known) return ERROR_TEXT[err.message];
  }
  return SAVE_FAILED;
}

/** Put a fresh view into every cached reservation list, then refetch everything related. */
export function applyServerView(queryClient: QueryClient, view: ReservationView): void {
  const replace = (old: ReservationView[] | undefined) =>
    old?.map((r) => (r.id === view.id ? view : r));
  queryClient.setQueriesData<ReservationView[]>({ queryKey: queryKeys.reservations }, replace);
  queryClient.setQueriesData<ReservationView[]>({ queryKey: ['inspection-results'] }, replace);
  void queryClient.invalidateQueries({ queryKey: queryKeys.reservations });
  void queryClient.invalidateQueries({ queryKey: ['inspection-results'] });
  void queryClient.invalidateQueries({ queryKey: queryKeys.auditLogs(view.id) });
}

/**
 * After any 409: adopt the server's `current` view if present, refetch the related queries, and
 * resolve with the latest known view (from the body, or from the refetched cache).
 */
export async function refreshAfterConflict(
  queryClient: QueryClient,
  err: unknown,
  reservationId: string,
): Promise<ReservationView | null> {
  const current = conflictCurrent(err);
  if (current) {
    applyServerView(queryClient, current);
    return current;
  }
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.reservations }),
    queryClient.invalidateQueries({ queryKey: ['inspection-results'] }),
    queryClient.invalidateQueries({ queryKey: queryKeys.auditLogs(reservationId) }),
  ]);
  const lists = [
    ...queryClient.getQueriesData<ReservationView[]>({ queryKey: queryKeys.reservations }),
    ...queryClient.getQueriesData<ReservationView[]>({ queryKey: ['inspection-results'] }),
  ];
  for (const [, list] of lists) {
    const found = list?.find((r) => r.id === reservationId);
    if (found) return found;
  }
  return null;
}
