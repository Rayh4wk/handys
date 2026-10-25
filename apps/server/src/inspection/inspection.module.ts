import { Module } from '@nestjs/common';
import { ReservationsModule } from '../reservations/reservations.module';
import { InspectionController } from './inspection.controller';
import { InspectionRepository } from './inspection.repository';
import { InspectionService } from './inspection.service';

@Module({
  imports: [ReservationsModule],
  controllers: [InspectionController],
  providers: [InspectionService, InspectionRepository],
  exports: [InspectionService, InspectionRepository],
})
export class InspectionModule {}
