export type InspectionStatusCode =
  | 'NORMAL'
  | 'CONFLICT'
  | 'NEEDS_CHECK'
  | 'UNDETERMINED'
  | 'EXCLUDED';

export type ReasonCode =
  | 'RESERVATION_CANCELLED'
  | 'MISSING_CHECKOUT_AT'
  | 'NO_CHECKOUT_CLEANING_TASK'
  | 'MISSING_CLEANING_START'
  | 'CLEANING_BEFORE_CHECKOUT'
  | 'CLEANING_AFTER_CHECKOUT';

export interface JudgeInput {
  reservationStatus: 'CONFIRMED' | 'CANCELLED';
  checkoutAt: Date | null;
  checkoutCleaning: {
    status: 'SCHEDULED' | 'CANCELLED';
    scheduledStartAt: Date | null;
  } | null;
}

export interface JudgeResult {
  status: InspectionStatusCode;
  reasonCode: ReasonCode;
}

export const REASON_TEXT: Record<ReasonCode, string> = {
  RESERVATION_CANCELLED: '취소된 예약으로 점검 대상에서 제외',
  MISSING_CHECKOUT_AT: '체크아웃 예정 시각 없음',
  NO_CHECKOUT_CLEANING_TASK: '대응하는 퇴실 청소 작업 없음',
  MISSING_CLEANING_START: '청소 시작 예정 시각 없음',
  CLEANING_BEFORE_CHECKOUT: '체크아웃 이전에 청소 시작 예정',
  CLEANING_AFTER_CHECKOUT: '체크아웃 이후 청소 시작 예정',
};

export function judge(input: JudgeInput): JudgeResult {
  if (input.reservationStatus === 'CANCELLED') {
    return { status: 'EXCLUDED', reasonCode: 'RESERVATION_CANCELLED' };
  }
  if (!input.checkoutAt) {
    return { status: 'UNDETERMINED', reasonCode: 'MISSING_CHECKOUT_AT' };
  }
  const c = input.checkoutCleaning;
  if (!c || c.status === 'CANCELLED') {
    return { status: 'NEEDS_CHECK', reasonCode: 'NO_CHECKOUT_CLEANING_TASK' };
  }
  if (!c.scheduledStartAt) {
    return { status: 'UNDETERMINED', reasonCode: 'MISSING_CLEANING_START' };
  }
  if (c.scheduledStartAt.getTime() < input.checkoutAt.getTime()) {
    return { status: 'CONFLICT', reasonCode: 'CLEANING_BEFORE_CHECKOUT' };
  }
  return { status: 'NORMAL', reasonCode: 'CLEANING_AFTER_CHECKOUT' };
}
