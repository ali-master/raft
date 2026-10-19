import { EventEmitter } from "node:events";

export const playgroundTelemetry = new EventEmitter();

export interface PlaygroundMessage {
  type: string;
  message: string;
  nodeId?: string;
}

export function report(type: string, message: string, nodeId?: string) {
  playgroundTelemetry.emit("message", { type, message, nodeId });
}
