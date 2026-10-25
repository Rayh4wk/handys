import { BadRequestException, Controller, Get, Post, Query } from '@nestjs/common';
import { ReservationsService } from '../reservations/reservations.service';
import { ReservationView } from '../reservations/reservation-view';
import { InspectionService } from './inspection.service';

const STATUSES = ['NORMAL', 'CONFLICT', 'NEEDS_CHECK', 'UNDETERMINED', 'EXCLUDED'];

@Controller('inspection-results')
export class InspectionController {
  constructor(
    private readonly inspection: InspectionService,
    private readonly reservations: ReservationsService,
  ) {}

  @Get()
  async list(@Query('status') status?: string): Promise<ReservationView[]> {
    if (status !== undefined && !STATUSES.includes(status)) {
      throw new BadRequestException('INVALID_STATUS');
    }
    const all = await this.reservations.list();
    return status ? all.filter((r) => r.inspection?.status === status) : all;
  }

  @Post('run')
  run(): Promise<{ checked: number }> {
    return this.inspection.runAll();
  }
}
