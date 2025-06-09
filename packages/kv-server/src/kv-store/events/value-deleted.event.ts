import { EventsHandler } from "@nestjs/cqrs";
import type { IEventHandler, IEvent } from "@nestjs/cqrs";
import { Logger, Injectable } from "@nestjs/common";

export class ValueDeletedEvent implements IEvent {
  constructor(public readonly key: string) {}
}

@Injectable()
@EventsHandler(ValueDeletedEvent)
export class ValueDeletedHandler implements IEventHandler<ValueDeletedEvent> {
  private readonly logger = new Logger(ValueDeletedHandler.name);

  async handle(event: ValueDeletedEvent): Promise<void> {
    this.logger.log(`Value deleted for key: ${event.key}`);
  }
}
