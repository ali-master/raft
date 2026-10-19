import { createHash } from "node:crypto";
import { CounterStateMachine } from "../state-machines/counter-state-machine";
import type { NodeInfo } from "../utils/cluster-manager";
import type { EventJournal } from "./journal";

export type CommandOperation = "inspect" | "sha256";
export const COMMAND_DEADLINE_MS = 15_000;
export const COMMAND_HISTORY_LIMIT = 40;
export const COMMAND_PAYLOAD_BYTES = 512;

export interface DispatchCommand {
  type: "observatory.dispatch";
  id: string;
  operation: CommandOperation;
  targets: string[];
  payload: string;
}

export interface CommandReceipt {
  nodeId: string;
  status: "waiting" | "succeeded" | "failed" | "expired";
  finishedAt?: number;
  deliveryMs?: number;
  executionMs?: number;
  output?: Record<string, string | number>;
  error?: string;
}

export interface CommandRun extends DispatchCommand {
  leaderId: string;
  term: number;
  createdAt: number;
  expiresAt: number;
  commit: "pending" | "confirmed" | "unknown";
  committedAt?: number;
  error?: string;
  receipts: CommandReceipt[];
}

// Read-only, session-scoped probes: no external side effects or durable job queue.
export class ObservatoryStateMachine extends CounterStateMachine {
  onCommand?: (command: DispatchCommand) => void;

  override async apply(data: unknown): Promise<void> {
    const command = typeof data === "string" ? JSON.parse(data) : data;
    if (command?.type === "observatory.dispatch") {
      this.onCommand?.(command);
      return;
    }
    await super.apply(command);
  }
}

export class CommandCenter {
  private runs: CommandRun[] = [];

  constructor(private journal: EventJournal) {}

  async dispatch(
    leader: NodeInfo,
    targets: string[],
    operation: CommandOperation,
    payload: string,
  ) {
    if (!leader.node.isRunning() || leader.node.getState() !== "leader")
      throw new Error("Only a running leader can dispatch a command");
    if (
      !targets.length ||
      targets.some((id) => typeof id !== "string" || !id) ||
      !["inspect", "sha256"].includes(operation) ||
      typeof payload !== "string" ||
      Buffer.byteLength(payload, "utf8") > COMMAND_PAYLOAD_BYTES
    )
      throw new Error("Invalid command, destinations, or payload");
    const createdAt = Date.now();
    const command: DispatchCommand = {
      type: "observatory.dispatch",
      id: crypto.randomUUID(),
      operation,
      targets: [...new Set(targets)],
      payload,
    };
    const run: CommandRun = {
      ...command,
      leaderId: leader.nodeId,
      term: leader.node.getCurrentTerm(),
      createdAt,
      expiresAt: createdAt + COMMAND_DEADLINE_MS,
      commit: "pending",
      receipts: command.targets.map((nodeId) => ({
        nodeId,
        status: "waiting",
      })),
    };
    this.runs = [run, ...this.runs].slice(0, COMMAND_HISTORY_LIMIT);
    this.journal.publish("command_proposed", leader.nodeId, {
      commandId: run.id,
      operation,
      targets: run.targets,
      message: `${operation} proposed for ${run.targets.join(", ")} · awaiting commit`,
    });
    try {
      await leader.node.appendLog(command);
      return run.id;
    } catch (error) {
      // A timed-out proposal may still commit later; keep tracking its receipts.
      if (run.commit === "pending") run.commit = "unknown";
      run.error = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  applied(info: NodeInfo, command: DispatchCommand) {
    const run = this.runs.find((item) => item.id === command.id);
    if (!run) return; // Old sessions and snapshot replay cannot start new probes.
    if (run.commit !== "confirmed") {
      run.commit = "confirmed";
      run.committedAt = Date.now();
      this.journal.publish("command_committed", info.nodeId, {
        commandId: run.id,
        message: `${run.operation} committed · collecting destination results`,
      });
    }
    this.expire(run);
    const receipt = run.receipts.find((item) => item.nodeId === info.nodeId);
    if (!receipt || receipt.status !== "waiting") return;
    const start = performance.now();
    receipt.deliveryMs = Date.now() - run.createdAt;
    try {
      receipt.output =
        run.operation === "sha256"
          ? {
              sha256: createHash("sha256")
                .update(run.payload, "utf8")
                .digest("hex"),
              bytes: Buffer.byteLength(run.payload, "utf8"),
            }
          : {
              node: info.nodeId,
              role: info.node.getState(),
              term: info.node.getCurrentTerm(),
              commitIndex: info.node.getCommitIndex(),
              lastLogIndex: info.node.getLog().getLastIndex(),
              counter:
                info.stateMachine instanceof CounterStateMachine
                  ? info.stateMachine.getValue()
                  : "KV",
            };
      receipt.status = "succeeded";
    } catch (error) {
      receipt.status = "failed";
      receipt.error = error instanceof Error ? error.message : String(error);
    }
    receipt.finishedAt = Date.now();
    receipt.executionMs = Math.round((performance.now() - start) * 1000) / 1000;
    this.journal.publish("command_result", info.nodeId, {
      commandId: run.id,
      operation: run.operation,
      status: receipt.status,
      deliveryMs: receipt.deliveryMs,
      executionMs: receipt.executionMs,
      message: `${run.operation} ${receipt.status} on ${info.nodeId} · ${receipt.deliveryMs} ms from proposal`,
    });
  }

  private expire(run: CommandRun) {
    if (Date.now() < run.expiresAt) return;
    for (const receipt of run.receipts) {
      if (receipt.status !== "waiting") continue;
      receipt.status = "expired";
      receipt.error =
        "No execution observed before the 15-second deadline. This probe will not run late.";
      this.journal.publish("command_expired", receipt.nodeId, {
        commandId: run.id,
        message: `${run.operation} expired on ${receipt.nodeId} · no execution observed`,
      });
    }
  }

  snapshot() {
    for (const run of this.runs) this.expire(run);
    return this.runs;
  }
}
