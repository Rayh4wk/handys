import { PrismaClient, CleaningType, ReservationStatus } from '@prisma/client';
import { judge } from '../src/inspection/judge';

const at = (hhmm: string) => new Date(`2026-10-26T${hhmm}:00+09:00`);

type Row = {
  id: string;
  room: string;
  guest: string;
  checkout: string | null;
  status: ReservationStatus;
  task: { id: string; type: CleaningType; start: string };
};

const ROWS: Row[] = [
  { id: 'R-101', room: '301', guest: '김가람', checkout: '11:00', status: 'CONFIRMED', task: { id: 'C-101', type: 'CHECKOUT', start: '11:30' } },
  { id: 'R-102', room: '302', guest: '이나래', checkout: '13:00', status: 'CONFIRMED', task: { id: 'C-102', type: 'CHECKOUT', start: '13:30' } },
  { id: 'R-103', room: '303', guest: '박다온', checkout: '12:00', status: 'CONFIRMED', task: { id: 'C-103', type: 'STAYOVER', start: '14:00' } },
  { id: 'R-104', room: '304', guest: '최라온', checkout: null, status: 'CONFIRMED', task: { id: 'C-104', type: 'CHECKOUT', start: '12:30' } },
  { id: 'R-105', room: '305', guest: '정마루', checkout: '11:00', status: 'CANCELLED', task: { id: 'C-105', type: 'CHECKOUT', start: '12:00' } },
  { id: 'R-106', room: '306', guest: '한바다', checkout: '11:00', status: 'CONFIRMED', task: { id: 'C-106', type: 'CHECKOUT', start: '11:00' } },
];

export async function seedDatabase(prisma: PrismaClient): Promise<void> {
  for (const r of ROWS) {
    await prisma.reservation.create({
      data: {
        id: r.id,
        roomId: r.room,
        guestName: r.guest,
        checkoutAt: r.checkout ? at(r.checkout) : null,
        status: r.status,
      },
    });
    await prisma.cleaningTask.create({
      data: {
        id: r.task.id,
        reservationId: r.id,
        type: r.task.type,
        scheduledStartAt: at(r.task.start),
        status: 'SCHEDULED',
      },
    });
  }

  const now = new Date();
  for (const r of ROWS) {
    const result = judge({
      reservationStatus: r.status,
      checkoutAt: r.checkout ? at(r.checkout) : null,
      checkoutCleaning:
        r.task.type === 'CHECKOUT' ? { status: 'SCHEDULED', scheduledStartAt: at(r.task.start) } : null,
    });
    await prisma.inspectionResult.create({
      data: { reservationId: r.id, status: result.status, reasonCode: result.reasonCode, checkedAt: now },
    });
  }
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seedDatabase(prisma)
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
