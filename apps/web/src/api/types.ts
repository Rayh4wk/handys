export type InspectionStatus = 'NORMAL' | 'CONFLICT' | 'NEEDS_CHECK' | 'UNDETERMINED' | 'EXCLUDED';
export type Role = 'RESERVATION_AGENT' | 'OPERATIONS_MANAGER';

export interface Me {
  username: string;
  displayName: string;
  role: Role;
}

export interface ReservationView {
  id: string;
  roomId: string;
  guestName: string;
  checkoutAt: string | null;
  status: 'CONFIRMED' | 'CANCELLED';
  version: number;
  cleaningTask: {
    id: string;
    scheduledStartAt: string | null;
    status: 'SCHEDULED' | 'CANCELLED';
    version: number;
  } | null;
  inspection: {
    status: InspectionStatus;
    reasonCode: string;
    reasonText: string;
    checkedAt: string;
  } | null;
}

export interface AuditSnapshot {
  checkoutAt?: string | null;
  scheduledStartAt?: string | null;
  inspectionStatus: InspectionStatus | null;
}

export type AuditAction = 'CHECKOUT_CHANGED' | 'CLEANING_RESCHEDULED';

export interface AuditLogView {
  id: string;
  action: AuditAction;
  before: AuditSnapshot;
  after: AuditSnapshot;
  reason: string | null;
  actor: { id: string; displayName: string; role: Role };
  createdAt: string;
}

export const STATUS_LABEL: Record<InspectionStatus, string> = {
  NORMAL: '정상',
  CONFLICT: '불일치',
  NEEDS_CHECK: '확인 필요',
  UNDETERMINED: '판정 불가',
  EXCLUDED: '점검 대상 제외',
};

export const ROLE_LABEL: Record<Role, string> = {
  RESERVATION_AGENT: '예약·고객 응대',
  OPERATIONS_MANAGER: '현장 운영',
};

export const ACTION_LABEL: Record<AuditAction, string> = {
  CHECKOUT_CHANGED: '체크아웃 변경',
  CLEANING_RESCHEDULED: '청소 일정 수정',
};

export const ROLE_HOME: Record<Role, string> = {
  RESERVATION_AGENT: '/reservations',
  OPERATIONS_MANAGER: '/operations',
};
