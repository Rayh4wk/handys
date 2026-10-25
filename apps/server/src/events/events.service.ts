import { Injectable, MessageEvent } from '@nestjs/common';
import { interval, map, merge, Observable, Subject } from 'rxjs';

export interface ReservationUpdatedEvent {
  type: 'reservation.updated';
  reservationId: string;
  version: number;
}

export const HEARTBEAT_MS = 25_000;

@Injectable()
export class EventsService {
  private readonly subject = new Subject<ReservationUpdatedEvent>();

  emit(e: ReservationUpdatedEvent): void {
    this.subject.next(e);
  }

  // MessageEvents carry only `data` so frames are unnamed (`data: {...}`) and
  // reach EventSource.onmessage on the client.
  stream(): Observable<MessageEvent> {
    return merge(
      this.subject.pipe(map((e): MessageEvent => ({ data: e }))),
      interval(HEARTBEAT_MS).pipe(map((): MessageEvent => ({ data: { type: 'heartbeat' } }))),
    );
  }
}
