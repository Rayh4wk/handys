import { Prisma } from '@prisma/client';
import { REASON_TEXT, ReasonCode } from '../inspection/judge';

export const RESERVATION_VIEW_INCLUDE = {
  cleaningTasks: { where: { type: 'CHECKOUT' as const }, take: 1 },
  inspectionResult: true,
} satisfies Prisma.ReservationInclude;

export type ReservationRow = Prisma.ReservationGetPayload<{ include: typeof RESERVATION_VIEW_INCLUDE }>;

export interface ReservationView {
  id: string;
  roomId: string;
  guestName: string;
  checkoutAt: string | null;
  status: string;
  version: number;
  cleaningTask: {
    id: string;
    scheduledStartAt: string | null;
    status: string;
    version: number;
  } | null;
  inspection: {
    status: string;
    reasonCode: string;
    reasonText: string;
    checkedAt: string;
  } | null;
}

export function toReservationView(row: ReservationRow): ReservationView {
  const t = row.cleaningTasks[0];
  const i = row.inspectionResult;
  return {
    id: row.id,
    roomId: row.roomId,
    guestName: row.guestName,
    checkoutAt: row.checkoutAt ? row.checkoutAt.toISOString() : null,
    status: row.status,
    version: row.version,
    cleaningTask: t
      ? {
          id: t.id,
          scheduledStartAt: t.scheduledStartAt ? t.scheduledStartAt.toISOString() : null,
          status: t.status,
          version: t.version,
        }
      : null,
    inspection: i
      ? {
          status: i.status,
          reasonCode: i.reasonCode,
          reasonText: REASON_TEXT[i.reasonCode as ReasonCode] ?? i.reasonCode,
          checkedAt: i.checkedAt.toISOString(),
        }
      : null,
  };
}
