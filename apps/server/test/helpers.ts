import { INestApplication } from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { seedDatabase } from '../prisma/seed';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/main';

export async function resetDb(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE audit_logs, inspection_results, cleaning_tasks, reservations RESTART IDENTITY CASCADE',
  );
  await seedDatabase(prisma);
}

export async function createTestApp(
  override?: (b: TestingModuleBuilder) => TestingModuleBuilder,
): Promise<INestApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (override) builder = override(builder);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}
