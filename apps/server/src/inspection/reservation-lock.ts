import { NotFoundException } from '@nestjs/common';
import { Tx } from './inspection.repository';

/**
 * Row lock every writer of a reservation's inspection inputs or result takes first
 * (checkout change, cleaning reschedule, re-inspection), so they serialise per reservation.
 */
export async function lockReservation(tx: Tx, id: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM reservations WHERE id = ${id} FOR UPDATE`;
  if (rows.length === 0) throw new NotFoundException('RESERVATION_NOT_FOUND');
}
