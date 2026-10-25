import { Module } from '@nestjs/common';
import { ReservationsService } from './reservations.service';

// ReservationsController is declared in ChangesModule (see comment there).
@Module({
  providers: [ReservationsService],
  exports: [ReservationsService],
})
export class ReservationsModule {}
