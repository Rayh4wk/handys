import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { ChangesModule } from './changes/changes.module';
import { EventsModule } from './events/events.module';
import { InspectionModule } from './inspection/inspection.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReservationsModule } from './reservations/reservations.module';

@Module({ imports: [PrismaModule, AuthModule, ReservationsModule, InspectionModule, EventsModule, ChangesModule] })
export class AppModule {}
