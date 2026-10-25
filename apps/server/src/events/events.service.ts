import { Injectable, MessageEvent, OnModuleDestroy } from '@nestjs/common';
import { interval, map, merge, Observable, Subject, takeUntil } from 'rxjs';

export interface ReservationUpdatedEvent {
  type: 'reservation.updated';
  reservationId: string;
  version: number;
}

export const HEARTBEAT_MS = 25_000;

@Injectable()
export class EventsService implements OnModuleDestroy {
  private readonly subject = new Subject<ReservationUpdatedEvent>();
  private readonly destroy$ = new Subject<void>();

  emit(e: ReservationUpdatedEvent): void {
    this.subject.next(e);
  }

  // MessageEvents carry only `data` so frames are unnamed (`data: {...}`) and
  // reach EventSource.onmessage on the client.
  stream(): Observable<MessageEvent> {
    return merge(
      this.subject.pipe(map((e): MessageEvent => ({ data: e }))),
      interval(HEARTBEAT_MS).pipe(map((): MessageEvent => ({ data: { type: 'heartbeat' } }))),
    ).pipe(takeUntil(this.destroy$));
  }

  /** Completes open streams so app.close()/SIGTERM is not held up by connected SSE clients. */
  onModuleDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.subject.complete();
  }
}
