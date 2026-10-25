import { Body, Controller, Param, Patch } from '@nestjs/common';
import { Account } from '../auth/accounts';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { ChangeService } from '../changes/change.service';
import { RescheduleCleaningDto } from '../changes/dto';
import { ReservationView } from '../reservations/reservation-view';

@Controller('cleaning-tasks')
export class CleaningController {
  constructor(private readonly changes: ChangeService) {}

  @Patch(':id/schedule')
  @Roles('OPERATIONS_MANAGER')
  schedule(
    @Param('id') id: string,
    @Body() dto: RescheduleCleaningDto,
    @CurrentUser() actor: Account,
  ): Promise<ReservationView> {
    return this.changes.rescheduleCleaning(id, dto, actor);
  }
}
