import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { Account } from '../auth/accounts';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { ChangeService } from '../changes/change.service';
import { ChangeCheckoutDto } from '../changes/dto';
import { ReservationView } from './reservation-view';
import { AuditLogView, ReservationsService } from './reservations.service';

@Controller('reservations')
export class ReservationsController {
  constructor(
    private readonly service: ReservationsService,
    private readonly changes: ChangeService,
  ) {}

  @Get()
  list(): Promise<ReservationView[]> {
    return this.service.list();
  }

  @Get(':id/audit-logs')
  auditLogs(@Param('id') id: string): Promise<AuditLogView[]> {
    return this.service.auditLogs(id);
  }

  @Patch(':id/checkout')
  @Roles('RESERVATION_AGENT')
  changeCheckout(
    @Param('id') id: string,
    @Body() dto: ChangeCheckoutDto,
    @CurrentUser() actor: Account,
  ): Promise<ReservationView> {
    return this.changes.changeCheckout(id, dto, actor);
  }
}
