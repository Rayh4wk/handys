import { INestApplication } from '@nestjs/common';
import { Server } from 'http';
import { AddressInfo } from 'net';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, loginAs, resetDb } from './helpers';

describe('events (SSE)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let base: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await app.listen(0);
    const port = (app.getHttpServer().address() as AddressInfo).port;
    base = `http://127.0.0.1:${port}`;
  });
  beforeEach(async () => {
    await resetDb(prisma);
  });
  afterAll(async () => {
    (app.getHttpServer() as Server).closeAllConnections();
    await app.close();
  });

  async function opsCookie(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'ops', password: 'demo1234' })
      .expect(200);
    const sid = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('sid='))!;
    return sid.split(';')[0];
  }

  it('streams reservation.updated as an unnamed event after a change', async () => {
    const ctrl = new AbortController();
    const res = await fetch(`${base}/api/events`, { headers: { cookie: await opsCookie(), connection: 'close' }, signal: ctrl.signal });
    try {
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();

      const agent = await loginAs(app, 'agent');
      await agent
        .patch('/api/reservations/R-101/checkout')
        .send({ checkoutAt: '2026-10-26T13:00:00+09:00', reason: '고객 요청 레이트 체크아웃', version: 1 })
        .expect(200);

      const expected = 'data: {"type":"reservation.updated","reservationId":"R-101","version":2}';
      let buf = '';
      const deadline = Date.now() + 2000;
      while (!buf.includes(expected)) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error(`timed out; got: ${JSON.stringify(buf)}`);
        let timer: NodeJS.Timeout | undefined;
        const chunk = await Promise.race([
          reader.read(),
          new Promise<never>((_, rej) => {
            timer = setTimeout(() => rej(new Error(`timed out; got: ${JSON.stringify(buf)}`)), remaining);
          }),
        ]).finally(() => clearTimeout(timer));
        if (chunk.done) break;
        buf += decoder.decode(chunk.value, { stream: true });
      }
      expect(buf).toContain(expected);
      const frame = buf.split('\n\n').find((f) => f.includes(expected))!;
      expect(frame.split('\n').some((l) => l.startsWith('event:'))).toBe(false);
      expect(buf).not.toMatch(/^event:/m);
    } finally {
      ctrl.abort();
    }
  });

  it('requires login', async () => {
    const res = await fetch(`${base}/api/events`, { headers: { connection: 'close' } });
    expect(res.status).toBe(401);
    await res.body?.cancel();
  });
});
