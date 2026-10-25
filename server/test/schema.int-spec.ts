import { PrismaClient } from '@prisma/client';
import { resetDb } from './helpers';

describe('schema', () => {
  const prisma = new PrismaClient();
  beforeEach(() => resetDb(prisma));
  afterAll(() => prisma.$disconnect());

  it('seeds six reservations', async () => {
    expect(await prisma.reservation.count()).toBe(6);
  });

  it('rejects a second CHECKOUT task for the same reservation', async () => {
    await expect(
      prisma.cleaningTask.create({
        data: { id: 'C-X', reservationId: 'R-102', type: 'CHECKOUT', status: 'SCHEDULED' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('allows a STAYOVER task next to a CHECKOUT task', async () => {
    const t = await prisma.cleaningTask.create({
      data: { id: 'C-Y', reservationId: 'R-102', type: 'STAYOVER', status: 'SCHEDULED' },
    });
    expect(t.id).toBe('C-Y');
  });

  it('stores timestamptz', async () => {
    const r = await prisma.reservation.findUniqueOrThrow({ where: { id: 'R-101' } });
    expect(r.checkoutAt!.toISOString()).toBe('2026-10-26T02:00:00.000Z');
  });
});
