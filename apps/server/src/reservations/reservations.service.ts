import { Injectable, NotFoundException } from '@nestjs/common';
import { findAccountById } from '../auth/accounts';
import { Tx } from '../inspection/inspection.repository';
import { PrismaService } from '../prisma/prisma.service';
import { RESERVATION_VIEW_INCLUDE, ReservationView, toReservationView } from './reservation-view';

export interface AuditLogView {
  id: string;
  action: string;
  before: unknown;
  after: unknown;
  reason: string | null;
  actor: { id: string; displayName: string; role: string };
  createdAt: string;
}

@Injectable()
export class ReservationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<ReservationView[]> {
    const rows = await this.prisma.reservation.findMany({
      include: RESERVATION_VIEW_INCLUDE,
      orderBy: { id: 'asc' },
    });
    return rows.map(toReservationView);
  }

  async getView(db: Tx | PrismaService, id: string): Promise<ReservationView> {
    const row = await db.reservation.findUnique({ where: { id }, include: RESERVATION_VIEW_INCLUDE });
    if (!row) throw new NotFoundException('RESERVATION_NOT_FOUND');
    return toReservationView(row);
  }

  async auditLogs(id: string): Promise<AuditLogView[]> {
    const exists = await this.prisma.reservation.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException('RESERVATION_NOT_FOUND');
    const logs = await this.prisma.auditLog.findMany({
      where: { reservationId: id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return logs.map((l) => {
      const acc = findAccountById(l.actorId);
      return {
        id: l.id.toString(),
        action: l.action,
        before: l.before,
        after: l.after,
        reason: l.reason,
        actor: acc
          ? { id: acc.id, displayName: acc.displayName, role: acc.role }
          : { id: l.actorId, displayName: l.actorId, role: l.actorRole },
        createdAt: l.createdAt.toISOString(),
      };
    });
  }
}
