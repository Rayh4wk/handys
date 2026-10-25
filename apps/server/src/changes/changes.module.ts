import { Module } from '@nestjs/common';
import { CleaningController } from '../cleaning/cleaning.controller';
import { EventsModule } from '../events/events.module';
import { InspectionModule } from '../inspection/inspection.module';
import { ReservationsController } from '../reservations/reservations.controller';
import { ReservationsModule } from '../reservations/reservations.module';
import { ChangeService } from './change.service';

// ReservationsController is registered here (not in ReservationsModule) because its PATCH
// needs ChangeService, and ChangesModule -> InspectionModule -> ReservationsModule would
// otherwise form a module import cycle.
@Module({
  imports: [ReservationsModule, InspectionModule, EventsModule],
  controllers: [ReservationsController, CleaningController],
  providers: [ChangeService],
})
export class ChangesModule {}
