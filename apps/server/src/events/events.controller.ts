import { Controller, MessageEvent, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';
import { EventsService } from './events.service';

@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  // Login required (global guard), both roles allowed.
  @Sse()
  stream(): Observable<MessageEvent> {
    return this.events.stream();
  }
}
