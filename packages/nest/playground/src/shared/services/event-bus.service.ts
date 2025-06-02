import { Injectable } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Observable, Subject } from "rxjs";
import { filter } from "rxjs/operators";

export interface AppEvent {
  type: string;
  nodeId: string;
  timestamp: Date;
  data?: any;
}

@Injectable()
export class EventBusService {
  private readonly eventSubject = new Subject<AppEvent>();

  constructor(private readonly eventEmitter: EventEmitter2) {}

  emit(event: AppEvent) {
    this.eventSubject.next(event);
    this.eventEmitter.emit(event.type, event);
  }

  on(eventType: string): Observable<AppEvent> {
    return this.eventSubject.pipe(filter((event) => event.type === eventType));
  }

  onPattern(pattern: RegExp): Observable<AppEvent> {
    return this.eventSubject.pipe(filter((event) => pattern.test(event.type)));
  }

  getAllEvents(): Observable<AppEvent> {
    return this.eventSubject.asObservable();
  }

  // Convenience methods for common events
  emitCacheEvent(operation: string, key: string, value?: any) {
    this.emit({
      type: `cache.${operation}`,
      nodeId: process.env.NODE_ID || "unknown",
      timestamp: new Date(),
      data: { key, value },
    });
  }

  emitTaskEvent(operation: string, taskId: string, data?: any) {
    this.emit({
      type: `task.${operation}`,
      nodeId: process.env.NODE_ID || "unknown",
      timestamp: new Date(),
      data: { taskId, ...data },
    });
  }

  emitLockEvent(operation: string, resource: string, clientId: string) {
    this.emit({
      type: `lock.${operation}`,
      nodeId: process.env.NODE_ID || "unknown",
      timestamp: new Date(),
      data: { resource, clientId },
    });
  }

  emitGameEvent(operation: string, data: any) {
    this.emit({
      type: `game.${operation}`,
      nodeId: process.env.NODE_ID || "unknown",
      timestamp: new Date(),
      data,
    });
  }
}
