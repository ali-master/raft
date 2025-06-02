export const RAFT_MODULE_OPTIONS = Symbol("RAFT_MODULE_OPTIONS");
export const RAFT_ENGINE = Symbol("RAFT_ENGINE");
export const RAFT_NODE = Symbol("RAFT_NODE");
export const RAFT_EVENT_BUS = Symbol("RAFT_EVENT_BUS");

export const RAFT_EVENT_METADATA = {
  HANDLER: "raft:event:handler",
  EVENT_TYPE: "raft:event:type",
} as const;

export const RAFT_METADATA = {
  MODULE: "raft:module",
  NODE: "raft:node",
  EVENT_HANDLERS: "raft:event:handlers",
} as const;

// Re-export from main package
export { LogLevel, MessageType, RaftEventType, RaftState } from "@usex/raft";
