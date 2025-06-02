import type { Provider } from "@nestjs/common";
import { DiscoveryService } from "@nestjs/core";
import type { RaftNode } from "@usex/raft";
import type { EventEmitter } from "eventemitter3";
import { RAFT_NODE, RAFT_EVENT_METADATA, RAFT_EVENT_BUS } from "../constants";
import type { RaftEventHandlerMetadata } from "../interfaces";

export const raftEventBusProvider: Provider = {
  provide: RAFT_EVENT_BUS,
  useFactory: (node: RaftNode) => {
    // Since RaftNode extends EventEmitter, we can use it as the event bus
    return node as unknown as EventEmitter;
  },
  inject: [RAFT_NODE],
};

export const raftEventHandlerProvider: Provider = {
  provide: Symbol("RAFT_EVENT_HANDLER_INIT"),
  useFactory: async (discovery: DiscoveryService, eventBus: EventEmitter) => {
    const providers = discovery.getProviders();
    const controllers = discovery.getControllers();

    const instances = [...providers, ...controllers];

    for (const wrapper of instances) {
      const { instance } = wrapper;
      if (!instance || !instance.constructor) {
        continue;
      }

      const eventHandlers =
        Reflect.getMetadata(
          RAFT_EVENT_METADATA.EVENT_TYPE,
          instance.constructor,
        ) || [];

      for (const handler of eventHandlers as RaftEventHandlerMetadata[]) {
        const handlerMethod = instance[handler.propertyKey];
        if (typeof handlerMethod === "function") {
          eventBus.on(handler.eventType, handlerMethod.bind(instance));
        }
      }
    }
  },
  inject: [DiscoveryService, RAFT_EVENT_BUS],
};
