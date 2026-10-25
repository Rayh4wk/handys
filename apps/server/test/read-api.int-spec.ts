import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, loginAs, resetDb } from './helpers';

interface Row {
  id: string;
  checkoutAt: string | null;
  inspection: { status: string; reasonText: string; checkedAt: string };
  cleaningTask: unknown;
}

describe('read api', () => {
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

  it('requires login', async () => {
    await request(app.getHttpServer()).get('/api/reservations').expect(401);
  });

  it.each(['ops', 'agent'] as const)('lists judged reservations for %s', async (who) => {
    const a = await loginAs(app, who);
    const res = await a.get('/api/reservations').expect(200);
    const rows = res.body as Row[];
    expect(rows.map((r) => r.id)).toEqual(['R-101', 'R-102', 'R-103', 'R-104', 'R-105', 'R-106']);
    expect(rows.map((r) => r.inspection.status)).toEqual([
      'NORMAL', 'NORMAL', 'NEEDS_CHECK', 'UNDETERMINED', 'EXCLUDED', 'NORMAL',
    ]);
    expect(rows[2].cleaningTask).toBeNull();
    expect(rows[3].inspection.reasonText).toBe('체크아웃 예정 시각 없음');
    expect(rows[3].checkoutAt).toBeNull();
    expect(typeof rows[0].checkoutAt).toBe('string');
    expect(typeof rows[0].inspection.checkedAt).toBe('string');
    expect(rows[0].cleaningTask).toEqual({
      id: 'C-101',
      scheduledStartAt: expect.any(String),
      status: 'SCHEDULED',
      version: 1,
    });
  });

  it('filters by status', async () => {
    const a = await loginAs(app, 'ops');
    const res = await a.get('/api/inspection-results?status=NEEDS_CHECK').expect(200);
    expect((res.body as Array<{ id: string }>).map((r) => r.id)).toEqual(['R-103']);
    await a.get('/api/inspection-results?status=BOGUS').expect(400);
  });

  it('run is ops-only and idempotent', async () => {
    const agent = await loginAs(app, 'agent');
    await agent.post('/api/inspection-results/run').expect(403);
    const a = await loginAs(app, 'ops');
    for (let i = 0; i < 3; i++) {
      const res = await a.post('/api/inspection-results/run').expect(200);
      expect(res.body).toEqual({ checked: 6 });
    }
    expect(await prisma.inspectionResult.count()).toBe(6);
    const list = await a.get('/api/reservations').expect(200);
    expect(list.body.map((r: Row) => r.inspection.status)).toEqual([
      'NORMAL', 'NORMAL', 'NEEDS_CHECK', 'UNDETERMINED', 'EXCLUDED', 'NORMAL',
    ]);
  });

  it('audit logs', async () => {
    const a = await loginAs(app, 'ops');
    await a.get('/api/reservations/R-999/audit-logs').expect(404);
    const res = await a.get('/api/reservations/R-101/audit-logs').expect(200);
    expect(res.body).toEqual([]);
  });
});
