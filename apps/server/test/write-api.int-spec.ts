import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { EventsService } from '../src/events/events.service';
import { InspectionRepository } from '../src/inspection/inspection.repository';
import { PrismaService } from '../src/prisma/prisma.service';
import { ReservationView } from '../src/reservations/reservation-view';
import { AuditLogView } from '../src/reservations/reservations.service';
import { createTestApp, loginAs, resetDb } from './helpers';

const LATE = { checkoutAt: '2026-10-26T13:00:00+09:00', reason: '고객 요청 레이트 체크아웃', version: 1 };

describe('write api', () => {
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

  async function snapshot() {
    return {
      reservations: await prisma.reservation.findMany({ orderBy: { id: 'asc' } }),
      tasks: await prisma.cleaningTask.findMany({ orderBy: { id: 'asc' } }),
      inspections: await prisma.inspectionResult.findMany({ orderBy: { reservationId: 'asc' } }),
      logs: await prisma.auditLog.count(),
    };
  }

  it('detects conflict when checkout moves 11:00→13:00 while cleaning stays 11:30', async () => {
    const agent = await loginAs(app, 'agent');
    const res = await agent.patch('/api/reservations/R-101/checkout').send(LATE).expect(200);
    expect(res.body.inspection.status).toBe('CONFLICT');
    expect(res.body.inspection.reasonText).toBe('체크아웃 이전에 청소 시작 예정');
    expect(res.body.version).toBe(2);
    expect(res.body.checkoutAt).toBe('2026-10-26T04:00:00.000Z');
  });

  it('becomes NORMAL after ops moves cleaning to 13:30', async () => {
    const agent = await loginAs(app, 'agent');
    const ops = await loginAs(app, 'ops');
    await agent.patch('/api/reservations/R-101/checkout').send(LATE).expect(200);
    const res = await ops
      .patch('/api/cleaning-tasks/C-101/schedule')
      .send({ scheduledStartAt: '2026-10-26T13:30:00+09:00', version: 1 })
      .expect(200);
    expect(res.body.inspection.status).toBe('NORMAL');
    expect(res.body.cleaningTask.version).toBe(2);
    expect(res.body.version).toBe(2);
  });

  it('equal times are NORMAL', async () => {
    const ops = await loginAs(app, 'ops');
    const res = await ops
      .patch('/api/cleaning-tasks/C-101/schedule')
      .send({ scheduledStartAt: '2026-10-26T11:00:00+09:00', version: 1 })
      .expect(200);
    expect(res.body.inspection.status).toBe('NORMAL');
    expect(res.body.version).toBe(1);
  });

  it('audit logs record reason and session actor', async () => {
    const agent = await loginAs(app, 'agent');
    const ops = await loginAs(app, 'ops');
    await agent.patch('/api/reservations/R-101/checkout').send(LATE).expect(200);
    await ops
      .patch('/api/cleaning-tasks/C-101/schedule')
      .send({ scheduledStartAt: '2026-10-26T13:30:00+09:00', reason: '청소 순서 조정', version: 1 })
      .expect(200);
    const res = await ops.get('/api/reservations/R-101/audit-logs').expect(200);
    const logs = res.body as AuditLogView[];
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({
      action: 'CLEANING_RESCHEDULED',
      before: { scheduledStartAt: '2026-10-26T02:30:00.000Z', inspectionStatus: 'CONFLICT' },
      after: { scheduledStartAt: '2026-10-26T04:30:00.000Z', inspectionStatus: 'NORMAL' },
      reason: '청소 순서 조정',
      actor: { id: 'ops-01', role: 'OPERATIONS_MANAGER' },
    });
    expect(logs[1]).toMatchObject({
      action: 'CHECKOUT_CHANGED',
      before: { checkoutAt: '2026-10-26T02:00:00.000Z', inspectionStatus: 'NORMAL' },
      after: { checkoutAt: '2026-10-26T04:00:00.000Z', inspectionStatus: 'CONFLICT' },
      reason: '고객 요청 레이트 체크아웃',
      actor: { id: 'agent-01', role: 'RESERVATION_AGENT' },
    });
  });

  it('stores empty cleaning reason as null', async () => {
    const ops = await loginAs(app, 'ops');
    await ops
      .patch('/api/cleaning-tasks/C-101/schedule')
      .send({ scheduledStartAt: '2026-10-26T13:30:00+09:00', reason: '', version: 1 })
      .expect(200);
    const log = await prisma.auditLog.findFirstOrThrow();
    expect(log.reason).toBeNull();
  });

  it('enforces roles on the server', async () => {
    const before = await snapshot();
    const agent = await loginAs(app, 'agent');
    const ops = await loginAs(app, 'ops');
    await agent
      .patch('/api/cleaning-tasks/C-101/schedule')
      .send({ scheduledStartAt: '2026-10-26T13:30:00+09:00', version: 1 })
      .expect(403);
    await ops.patch('/api/reservations/R-101/checkout').send(LATE).expect(403);
    await request(app.getHttpServer()).patch('/api/reservations/R-101/checkout').send(LATE).expect(401);
    await request(app.getHttpServer())
      .patch('/api/cleaning-tasks/C-101/schedule')
      .send({ scheduledStartAt: '2026-10-26T13:30:00+09:00', version: 1 })
      .expect(401);
    expect(await snapshot()).toEqual(before);
  });

  it('rejects body-supplied actor or role', async () => {
    const before = await snapshot();
    const agent = await loginAs(app, 'agent');
    await agent.patch('/api/reservations/R-101/checkout').send({ ...LATE, actorId: 'ops-01' }).expect(400);
    await agent.patch('/api/reservations/R-101/checkout').send({ ...LATE, role: 'OPERATIONS_MANAGER' }).expect(400);
    const ops = await loginAs(app, 'ops');
    await ops
      .patch('/api/cleaning-tasks/C-101/schedule')
      .send({ scheduledStartAt: '2026-10-26T13:30:00+09:00', version: 1, actorId: 'agent-01' })
      .expect(400);
    expect(await snapshot()).toEqual(before);
  });

  it('rejects invalid input', async () => {
    const before = await snapshot();
    const agent = await loginAs(app, 'agent');
    const bad = [
      { ...LATE, checkoutAt: '2026-10-26T13:00' },
      { ...LATE, checkoutAt: '2026-13-40T99:00:00Z' },
      { ...LATE, checkoutAt: '2026-02-30T10:00:00Z' },
      { ...LATE, checkoutAt: undefined },
      { ...LATE, version: 0 },
      { ...LATE, version: '1' },
      { ...LATE, version: 1.5 },
      { ...LATE, reason: '  ' },
      { ...LATE, reason: undefined },
      { ...LATE, reason: 'x'.repeat(201) },
    ];
    for (const body of bad) {
      await agent.patch('/api/reservations/R-101/checkout').send(body).expect(400);
    }
    const ops = await loginAs(app, 'ops');
    await ops
      .patch('/api/cleaning-tasks/C-101/schedule')
      .send({ scheduledStartAt: '2026-10-26T13:30:00+09:00', reason: 'x'.repeat(201), version: 1 })
      .expect(400);
    await ops.patch('/api/cleaning-tasks/C-101/schedule').send({ scheduledStartAt: 'nope', version: 1 }).expect(400);
    expect(await snapshot()).toEqual(before);
  });

  it('stale version returns 409 with current view and changes nothing', async () => {
    const agent = await loginAs(app, 'agent');
    await agent.patch('/api/reservations/R-101/checkout').send(LATE).expect(200);
    const res = await agent
      .patch('/api/reservations/R-101/checkout')
      .send({ ...LATE, checkoutAt: '2026-10-26T14:00:00+09:00' })
      .expect(409);
    expect(res.body.message).toBe('VERSION_CONFLICT');
    expect(res.body.current.version).toBe(2);
    expect(res.body.current.checkoutAt).toBe('2026-10-26T04:00:00.000Z');
    expect(await prisma.auditLog.count()).toBe(1);

    const ops = await loginAs(app, 'ops');
    await ops
      .patch('/api/cleaning-tasks/C-101/schedule')
      .send({ scheduledStartAt: '2026-10-26T13:30:00+09:00', version: 1 })
      .expect(200);
    const res2 = await ops
      .patch('/api/cleaning-tasks/C-101/schedule')
      .send({ scheduledStartAt: '2026-10-26T15:30:00+09:00', version: 1 })
      .expect(409);
    expect(res2.body.current.cleaningTask.version).toBe(2);
    expect(await prisma.auditLog.count()).toBe(2);
  });

  it('unknown reservation 404, unknown task 404, STAYOVER task 422', async () => {
    const agent = await loginAs(app, 'agent');
    const ops = await loginAs(app, 'ops');
    await agent.patch('/api/reservations/R-999/checkout').send(LATE).expect(404);
    await ops
      .patch('/api/cleaning-tasks/C-999/schedule')
      .send({ scheduledStartAt: '2026-10-26T13:30:00+09:00', version: 1 })
      .expect(404);
    await ops
      .patch('/api/cleaning-tasks/C-103/schedule')
      .send({ scheduledStartAt: '2026-10-26T13:30:00+09:00', version: 1 })
      .expect(422);
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it('cancelled reservation change is 422 and inspection stays EXCLUDED', async () => {
    const before = await snapshot();
    const agent = await loginAs(app, 'agent');
    const ops = await loginAs(app, 'ops');
    const r1 = await agent.patch('/api/reservations/R-105/checkout').send(LATE).expect(422);
    expect(r1.body.message).toBe('RESERVATION_CANCELLED');
    await ops
      .patch('/api/cleaning-tasks/C-105/schedule')
      .send({ scheduledStartAt: '2026-10-26T10:00:00+09:00', version: 1 })
      .expect(422);
    expect(await snapshot()).toEqual(before);
    const i = await prisma.inspectionResult.findUniqueOrThrow({ where: { reservationId: 'R-105' } });
    expect(i.status).toBe('EXCLUDED');
  });

  it('rolls back reservation change when inspection save fails', async () => {
    const failing = await createTestApp((b) =>
      b.overrideProvider(InspectionRepository).useValue({ upsert: () => Promise.reject(new Error('boom')) }),
    );
    try {
      const inspBefore = await prisma.inspectionResult.findUniqueOrThrow({ where: { reservationId: 'R-101' } });
      const agent = await loginAs(failing, 'agent');
      await agent.patch('/api/reservations/R-101/checkout').send(LATE).expect(500);
      const ops = await loginAs(failing, 'ops');
      await ops
        .patch('/api/cleaning-tasks/C-101/schedule')
        .send({ scheduledStartAt: '2026-10-26T10:00:00+09:00', version: 1 })
        .expect(500);
      const r = await prisma.reservation.findUniqueOrThrow({ where: { id: 'R-101' } });
      expect(r.checkoutAt?.toISOString()).toBe('2026-10-26T02:00:00.000Z');
      expect(r.version).toBe(1);
      const t = await prisma.cleaningTask.findUniqueOrThrow({ where: { id: 'C-101' } });
      expect(t.scheduledStartAt?.toISOString()).toBe('2026-10-26T02:30:00.000Z');
      expect(t.version).toBe(1);
      expect(await prisma.auditLog.count()).toBe(0);
      expect(await prisma.inspectionResult.findUniqueOrThrow({ where: { reservationId: 'R-101' } })).toEqual(
        inspBefore,
      );
    } finally {
      await failing.close();
    }
  });

  it('emits SSE only after commit', async () => {
    const emit = jest.spyOn(app.get(EventsService), 'emit');
    try {
      const agent = await loginAs(app, 'agent');
      await agent.patch('/api/reservations/R-101/checkout').send({ ...LATE, version: 9 }).expect(409);
      await agent.patch('/api/reservations/R-105/checkout').send(LATE).expect(422);
      await agent.patch('/api/reservations/R-101/checkout').send({ ...LATE, reason: ' ' }).expect(400);
      expect(emit).not.toHaveBeenCalled();
      await agent.patch('/api/reservations/R-101/checkout').send(LATE).expect(200);
      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith({ type: 'reservation.updated', reservationId: 'R-101', version: 2 });
      const ops = await loginAs(app, 'ops');
      await ops
        .patch('/api/cleaning-tasks/C-101/schedule')
        .send({ scheduledStartAt: '2026-10-26T13:30:00+09:00', version: 1 })
        .expect(200);
      expect(emit).toHaveBeenCalledTimes(2);
      expect(emit).toHaveBeenLastCalledWith({ type: 'reservation.updated', reservationId: 'R-101', version: 2 });
    } finally {
      emit.mockRestore();
    }
  });

  it('emits nothing when the transaction fails', async () => {
    const failing = await createTestApp((b) =>
      b.overrideProvider(InspectionRepository).useValue({ upsert: () => Promise.reject(new Error('boom')) }),
    );
    try {
      const emit = jest.spyOn(failing.get(EventsService), 'emit');
      const agent = await loginAs(failing, 'agent');
      await agent.patch('/api/reservations/R-101/checkout').send(LATE).expect(500);
      expect(emit).not.toHaveBeenCalled();
    } finally {
      await failing.close();
    }
  });

  it('persists after app restart', async () => {
    const agent = await loginAs(app, 'agent');
    await agent.patch('/api/reservations/R-101/checkout').send(LATE).expect(200);
    await app.close();
    app = await createTestApp();
    prisma = app.get(PrismaService);
    const ops = await loginAs(app, 'ops');
    const list = await ops.get('/api/reservations').expect(200);
    const r101 = (list.body as ReservationView[]).find((r) => r.id === 'R-101');
    expect(r101).toMatchObject({ checkoutAt: '2026-10-26T04:00:00.000Z', version: 2 });
    expect(r101?.inspection?.status).toBe('CONFLICT');
    const logs = await ops.get('/api/reservations/R-101/audit-logs').expect(200);
    expect(logs.body).toHaveLength(1);
    expect(logs.body[0]).toMatchObject({ action: 'CHECKOUT_CHANGED', actor: { id: 'agent-01' } });
  });
});
