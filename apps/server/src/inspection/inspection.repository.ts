import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { JudgeResult } from './judge';

export type Tx = Prisma.TransactionClient;

@Injectable()
export class InspectionRepository {
  async upsert(tx: Tx, reservationId: string, result: JudgeResult, checkedAt: Date): Promise<void> {
    await tx.inspectionResult.upsert({
      where: { reservationId },
      create: { reservationId, status: result.status, reasonCode: result.reasonCode, checkedAt },
      update: { status: result.status, reasonCode: result.reasonCode, checkedAt },
    });
  }
}
