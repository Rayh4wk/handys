import { Controller, Get, Param } from '@nestjs/common';
import { ReservationView } from './reservation-view';
import { AuditLogView, ReservationsService } from './reservations.service';

@Controller('reservations')
export class ReservationsController {
  constructor(private readonly service: ReservationsService) {}

  @Get()
  list(): Promise<ReservationView[]> {
    return this.service.list();
  }

  @Get(':id/audit-logs')
  auditLogs(@Param('id') id: string): Promise<AuditLogView[]> {
    return this.service.auditLogs(id);
  }
}
