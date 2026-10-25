import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InspectionRepository, Tx } from './inspection.repository';
import { judge, JudgeResult } from './judge';

@Injectable()
export class InspectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: InspectionRepository,
  ) {}

  async recheck(tx: Tx, reservationId: string): Promise<JudgeResult> {
    const r = await tx.reservation.findUnique({
      where: { id: reservationId },
      include: { cleaningTasks: { where: { type: 'CHECKOUT' }, take: 1 } },
    });
    if (!r) throw new NotFoundException('RESERVATION_NOT_FOUND');
    const t = r.cleaningTasks[0];
    const result = judge({
      reservationStatus: r.status,
      checkoutAt: r.checkoutAt,
      checkoutCleaning: t ? { status: t.status, scheduledStartAt: t.scheduledStartAt } : null,
    });
    await this.repo.upsert(tx, reservationId, result, new Date());
    return result;
  }

  async runAll(): Promise<{ checked: number }> {
    const rows = await this.prisma.reservation.findMany({ select: { id: true }, orderBy: { id: 'asc' } });
    for (const { id } of rows) {
      await this.prisma.$transaction((tx) => this.recheck(tx, id));
    }
    return { checked: rows.length };
  }
}
