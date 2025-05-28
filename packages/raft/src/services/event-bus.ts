import { EventEmitter } from "node:events";
import type { RaftEventType } from "../constants";
import type { RaftEvent } from "../types";

export class RaftEventBus extends EventEmitter {
  private readonly events: Map<string, RaftEvent[]> = new Map();
  private readonly maxEvents: number = 10000;

  public publish(event: RaftEvent): void {
    const key = `${event.nodeId}:${event.type}`;
    const eventList = this.events.get(key) || [];

    eventList.push(event);
    if (eventList.length > this.maxEvents) {
      eventList.shift();
    }

    this.events.set(key, eventList);
    this.emit(event.type, event);
  }

  public getEvents(nodeId: string, type?: RaftEventType): RaftEvent[] {
    if (type) {
      return this.events.get(`${nodeId}:${type}`) || [];
    }

    const allEvents: RaftEvent[] = [];
    for (const [key, events] of this.events) {
      if (key.startsWith(nodeId)) {
        allEvents.push(...events);
      }
    }

    return allEvents.sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
    );
  }
}
