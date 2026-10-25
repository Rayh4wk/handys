import { Controller, Get, INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Roles } from '../src/auth/roles.decorator';
import { createTestApp, loginAs } from './helpers';

@Controller('test-roles')
class TestRolesController {
  @Get('ops-only')
  @Roles('OPERATIONS_MANAGER')
  opsOnly(): { ok: boolean } {
    return { ok: true };
  }
}

describe('auth', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('rejects a wrong password', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'agent', password: 'nope' })
      .expect(401)
      .expect((r) => expect(r.body.message).toBe('INVALID_CREDENTIALS'));
  });

  it('logs in with an HttpOnly sid cookie', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'agent', password: 'demo1234' })
      .expect(200);
    expect(res.body).toMatchObject({ role: 'RESERVATION_AGENT', displayName: '예약 담당 김예약' });
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('sid='));
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/HttpOnly/i);
  });

  it('me returns the logged-in account; 401 without or with tampered cookie', async () => {
    const ops = await loginAs(app, 'ops');
    const me = await ops.get('/api/auth/me').expect(200);
    expect(me.body).toMatchObject({ username: 'ops', role: 'OPERATIONS_MANAGER' });
    await request(app.getHttpServer()).get('/api/auth/me').expect(401);
    await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', 'sid=ops-01.tampered').expect(401);
  });

  it('logout clears the session', async () => {
    const agent = await loginAs(app, 'agent');
    await agent.post('/api/auth/logout').expect(204);
    await agent.get('/api/auth/me').expect(401);
  });

  describe('role guard', () => {
    let guarded: INestApplication;
    beforeAll(async () => {
      const { Test } = await import('@nestjs/testing');
      const { AppModule } = await import('../src/app.module');
      const { configureApp } = await import('../src/main');
      const moduleRef = await Test.createTestingModule({
        imports: [AppModule],
        controllers: [TestRolesController],
      }).compile();
      guarded = moduleRef.createNestApplication();
      configureApp(guarded);
      await guarded.init();
    });
    afterAll(async () => {
      await guarded.close();
    });

    it('agent gets 403, ops gets 200, anonymous gets 401', async () => {
      const agent = await loginAs(guarded, 'agent');
      await agent
        .get('/api/test-roles/ops-only')
        .expect(403)
        .expect((r) => expect(r.body.message).toBe('FORBIDDEN_ROLE'));
      const ops = await loginAs(guarded, 'ops');
      await ops.get('/api/test-roles/ops-only').expect(200);
      await request(guarded.getHttpServer()).get('/api/test-roles/ops-only').expect(401);
    });
  });
});
