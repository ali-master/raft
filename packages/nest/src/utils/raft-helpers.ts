import { Injectable } from "@nestjs/common";
import type { DiscoveryService } from "@nestjs/core";
import { RAFT_EVENT_METADATA } from "../constants";
import type { RaftEventHandlerMetadata } from "../interfaces";

@Injectable()
export class RaftEventScanner {
  constructor(private readonly discoveryService: DiscoveryService) {}

  public scanForEventHandlers(): RaftEventHandlerMetadata[] {
    const providers = this.discoveryService.getProviders();
    const controllers = this.discoveryService.getControllers();

    const instances = [...providers, ...controllers];
    const eventHandlers: RaftEventHandlerMetadata[] = [];

    for (const wrapper of instances) {
      const { instance } = wrapper;
      if (!instance || !instance.constructor) {
        continue;
      }

      const handlers =
        Reflect.getMetadata(
          RAFT_EVENT_METADATA.EVENT_TYPE,
          instance.constructor,
        ) || [];

      eventHandlers.push(...handlers);
    }

    return eventHandlers;
  }
}

export function createRaftEventHandler(
  eventType: string,
  _handler: (...args: any[]) => any,
): MethodDecorator {
  return (
    target: any,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ) => {
    const metadata: RaftEventHandlerMetadata = {
      eventType: eventType as any,
      target: target.constructor,
      propertyKey,
    };

    const existingHandlers =
      Reflect.getMetadata(RAFT_EVENT_METADATA.EVENT_TYPE, target.constructor) ||
      [];

    existingHandlers.push(metadata);

    Reflect.defineMetadata(
      RAFT_EVENT_METADATA.EVENT_TYPE,
      existingHandlers,
      target.constructor,
    );

    return descriptor;
  };
}
