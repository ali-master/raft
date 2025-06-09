import { EventsHandler } from "@nestjs/cqrs";
import type { IEventHandler, IEvent } from "@nestjs/cqrs";
import { Logger, Injectable } from "@nestjs/common";

export class ValueSetEvent implements IEvent {
  constructor(public readonly key: string) {}
}

@Injectable()
@EventsHandler(ValueSetEvent)
export class ValueSetHandler implements IEventHandler<ValueSetEvent> {
  private readonly logger = new Logger(ValueSetHandler.name);

  async handle(event: ValueSetEvent): Promise<void> {
    this.logger.log(`Value set for key: ${event.key}`);
  }
}
