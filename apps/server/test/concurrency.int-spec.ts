import { INestApplication } from '@nestjs/common';
import { judge } from '../src/inspection/judge';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, loginAs, resetDb } from './helpers';

describe('concurrency', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => {
    await resetDb(prisma);
  });
  afterAll(async () => {
    await app.close();
  });

  it('only one of two concurrent writers with same version wins', async () => {
    const a1 = await loginAs(app, 'agent');
    const a2 = await loginAs(app, 'agent');
    const results = await Promise.all([
      a1.patch('/api/reservations/R-101/checkout').send({ checkoutAt: '2026-10-26T13:00:00+09:00', reason: 'a', version: 1 }),
      a2.patch('/api/reservations/R-101/checkout').send({ checkoutAt: '2026-10-26T10:00:00+09:00', reason: 'b', version: 1 }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const r = await prisma.reservation.findUniqueOrThrow({ where: { id: 'R-101' } });
    expect(r.version).toBe(2);
    expect(await prisma.auditLog.count()).toBe(1);
  });

  it('concurrent checkout and cleaning edits leave inspection consistent with final values', async () => {
    const agent = await loginAs(app, 'agent');
    const ops = await loginAs(app, 'ops');
    for (let i = 0; i < 20; i++) {
      const r = await prisma.reservation.findUniqueOrThrow({ where: { id: 'R-101' } });
      const t = await prisma.cleaningTask.findUniqueOrThrow({ where: { id: 'C-101' } });
      // Alternate: even -> checkout late / cleaning early (CONFLICT); odd -> checkout early / cleaning late (NORMAL)
      const hh = (n: number) => String(n).padStart(2, '0');
      const checkout = i % 2 === 0 ? `2026-10-26T${hh(13 + (i % 3))}:00:00+09:00` : `2026-10-26T${hh(9 + (i % 2))}:00:00+09:00`;
      const cleaning = i % 2 === 0 ? `2026-10-26T${hh(10 + (i % 2))}:15:00+09:00` : `2026-10-26T${hh(15 + (i % 3))}:45:00+09:00`;
      const [a, o] = await Promise.all([
        agent.patch('/api/reservations/R-101/checkout').send({ checkoutAt: checkout, reason: `iter ${i}`, version: r.version }),
        ops.patch('/api/cleaning-tasks/C-101/schedule').send({ scheduledStartAt: cleaning, version: t.version }),
      ]);
      expect([a.status, o.status]).toEqual([200, 200]);

      const fr = await prisma.reservation.findUniqueOrThrow({ where: { id: 'R-101' } });
      const ft = await prisma.cleaningTask.findUniqueOrThrow({ where: { id: 'C-101' } });
      const stored = await prisma.inspectionResult.findUniqueOrThrow({ where: { reservationId: 'R-101' } });
      const expected = judge({
        reservationStatus: fr.status,
        checkoutAt: fr.checkoutAt,
        checkoutCleaning: { status: ft.status, scheduledStartAt: ft.scheduledStartAt },
      });
      expect({ status: stored.status, reasonCode: stored.reasonCode }).toEqual(expected);
      expect(expected.status).toBe(i % 2 === 0 ? 'CONFLICT' : 'NORMAL');
    }
    expect(await prisma.auditLog.count()).toBe(40);
  });
});
