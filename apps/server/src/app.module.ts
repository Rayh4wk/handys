import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { AuthModule } from './auth/auth.module';
import { ChangesModule } from './changes/changes.module';
import { EventsModule } from './events/events.module';
import { InspectionModule } from './inspection/inspection.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReservationsModule } from './reservations/reservations.module';

// Built SPA: apps/web/dist (same relative path from src/ and dist/). WEB_DIST overrides (Docker).
const WEB_DIST = process.env.WEB_DIST ?? join(__dirname, '..', '..', 'web', 'dist');

@Module({
  imports: [
    // Plain express static + index.html fallback for client routes (/reservations, /operations,
    // /login). It runs outside Nest's router, so the global AuthGuard never sees these requests.
    ServeStaticModule.forRoot({ rootPath: WEB_DIST, exclude: ['/api/(.*)'] }),
    PrismaModule,
    AuthModule,
    ReservationsModule,
    InspectionModule,
    EventsModule,
    ChangesModule,
  ],
})
export class AppModule {}
