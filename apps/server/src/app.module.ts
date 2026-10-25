import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { InspectionModule } from './inspection/inspection.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReservationsModule } from './reservations/reservations.module';

@Module({ imports: [PrismaModule, AuthModule, ReservationsModule, InspectionModule] })
export class AppModule {}
