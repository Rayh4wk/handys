import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Account } from '../auth/accounts';
import { EventsService } from '../events/events.service';
import { Tx } from '../inspection/inspection.repository';
import { InspectionService } from '../inspection/inspection.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReservationView } from '../reservations/reservation-view';
import { ReservationsService } from '../reservations/reservations.service';
import { ChangeCheckoutDto, RescheduleCleaningDto } from './dto';

// Generous so that serialised writers queued on the row lock (concurrency test) don't time out.
const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

@Injectable()
export class ChangeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inspection: InspectionService,
    private readonly reservations: ReservationsService,
    private readonly events: EventsService,
  ) {}

  async changeCheckout(reservationId: string, dto: ChangeCheckoutDto, actor: Account): Promise<ReservationView> {
    const view = await this.prisma.$transaction(async (tx) => {
      await this.lockReservation(tx, reservationId);
      const r = await tx.reservation.findUniqueOrThrow({
        where: { id: reservationId },
        include: { inspectionResult: true },
      });
      if (r.status === 'CANCELLED') throw new UnprocessableEntityException({ message: 'RESERVATION_CANCELLED' });
      if (r.version !== dto.version) await this.conflict(tx, reservationId);

      const checkoutAt = new Date(dto.checkoutAt);
      await tx.reservation.update({
        where: { id: reservationId },
        data: { checkoutAt, version: { increment: 1 } },
      });
      const result = await this.inspection.recheck(tx, reservationId);
      await tx.auditLog.create({
        data: {
          reservationId,
          action: 'CHECKOUT_CHANGED',
          before: {
            checkoutAt: r.checkoutAt ? r.checkoutAt.toISOString() : null,
            inspectionStatus: r.inspectionResult?.status ?? null,
          },
          after: { checkoutAt: checkoutAt.toISOString(), inspectionStatus: result.status },
          reason: dto.reason,
          actorId: actor.id,
          actorRole: actor.role,
        },
      });
      return this.reservations.getView(tx, reservationId);
    }, TX_OPTIONS);
    this.events.emit({ type: 'reservation.updated', reservationId, version: view.version });
    return view;
  }

  async rescheduleCleaning(taskId: string, dto: RescheduleCleaningDto, actor: Account): Promise<ReservationView> {
    const found = await this.prisma.cleaningTask.findUnique({
      where: { id: taskId },
      select: { reservationId: true, type: true },
    });
    if (!found) throw new NotFoundException('CLEANING_TASK_NOT_FOUND');
    if (found.type !== 'CHECKOUT') {
      throw new UnprocessableEntityException({ message: 'NOT_CHECKOUT_CLEANING' });
    }
    const { reservationId } = found;

    const view = await this.prisma.$transaction(async (tx) => {
      await this.lockReservation(tx, reservationId);
      const r = await tx.reservation.findUniqueOrThrow({
        where: { id: reservationId },
        include: { inspectionResult: true },
      });
      if (r.status === 'CANCELLED') throw new UnprocessableEntityException({ message: 'RESERVATION_CANCELLED' });
      // Re-read under the reservation lock: every writer of this task holds the same lock.
      const t = await tx.cleaningTask.findUniqueOrThrow({ where: { id: taskId } });
      if (t.version !== dto.version) await this.conflict(tx, reservationId);

      const scheduledStartAt = new Date(dto.scheduledStartAt);
      await tx.cleaningTask.update({
        where: { id: taskId },
        data: { scheduledStartAt, version: { increment: 1 } },
      });
      const result = await this.inspection.recheck(tx, reservationId);
      await tx.auditLog.create({
        data: {
          reservationId,
          action: 'CLEANING_RESCHEDULED',
          before: {
            scheduledStartAt: t.scheduledStartAt ? t.scheduledStartAt.toISOString() : null,
            inspectionStatus: r.inspectionResult?.status ?? null,
          },
          after: { scheduledStartAt: scheduledStartAt.toISOString(), inspectionStatus: result.status },
          reason: dto.reason ? dto.reason : null,
          actorId: actor.id,
          actorRole: actor.role,
        },
      });
      return this.reservations.getView(tx, reservationId);
    }, TX_OPTIONS);
    this.events.emit({ type: 'reservation.updated', reservationId, version: view.version });
    return view;
  }

  private async lockReservation(tx: Tx, id: string): Promise<void> {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM reservations WHERE id = ${id} FOR UPDATE`;
    if (rows.length === 0) throw new NotFoundException('RESERVATION_NOT_FOUND');
  }

  /** Throws 409 with the latest committed view (read while holding the lock; the tx then rolls back). */
  private async conflict(tx: Tx, reservationId: string): Promise<never> {
    const current = await this.reservations.getView(tx, reservationId);
    throw new ConflictException({ message: 'VERSION_CONFLICT', current });
  }
}
