import type { StateMachine } from "@usex/raft";
import { PlaygroundLogger } from "../utils/logger";
import type { UnknownCommand } from "../types/common";

export interface CounterCommand {
  type: "increment" | "decrement" | "set" | "reset";
  value?: number;
  clientId?: string;
}

export interface CounterSnapshot {
  value: number;
  timestamp: number;
  version: number;
}

export class CounterStateMachine implements StateMachine {
  private value = 0;
  private version = 0;
  private logger: PlaygroundLogger;

  constructor(private nodeId: string) {
    this.logger = new PlaygroundLogger();
  }

  async apply(commandData: any): Promise<void> {
    const command: CounterCommand =
      typeof commandData === "string" ? JSON.parse(commandData) : commandData;

    this.logger.debug(
      `Applying command: ${command.type}`,
      this.nodeId,
      command,
    );

    switch (command.type) {
      case "increment":
        this.value += command.value || 1;
        break;
      case "decrement":
        this.value -= command.value || 1;
        break;
      case "set":
        if (command.value !== undefined) {
          this.value = command.value;
        }
        break;
      case "reset":
        this.value = 0;
        break;
      default:
        throw new Error(
          `Unknown command type: ${(command as UnknownCommand).type}`,
        );
    }

    this.version++;

    this.logger.info(
      `Counter updated: ${command.type} -> ${this.value}`,
      this.nodeId,
      { oldValue: this.value - (command.value || 1), newValue: this.value },
    );
  }

  async getSnapshotData(): Promise<Buffer> {
    const snapshot: CounterSnapshot = {
      value: this.value,
      timestamp: Date.now(),
      version: this.version,
    };

    this.logger.info(`Creating snapshot`, this.nodeId, snapshot);
    return Buffer.from(JSON.stringify(snapshot));
  }

  async applySnapshot(data: Buffer): Promise<void> {
    const snapshot: CounterSnapshot = JSON.parse(data.toString());

    this.value = snapshot.value;
    this.version = snapshot.version;

    this.logger.info(`Applied snapshot`, this.nodeId, snapshot);
  }

  // Public getters for playground demonstrations
  getValue(): number {
    return this.value;
  }

  getVersion(): number {
    return this.version;
  }

  getState() {
    return {
      value: this.value,
      version: this.version,
      nodeId: this.nodeId,
    };
  }

  // Helper methods for demonstrations
  createIncrementCommand(value: number = 1, clientId?: string): CounterCommand {
    const command: CounterCommand = { type: "increment", value };
    if (clientId !== undefined) {
      command.clientId = clientId;
    }
    return command;
  }

  createDecrementCommand(value: number = 1, clientId?: string): CounterCommand {
    const command: CounterCommand = { type: "decrement", value };
    if (clientId !== undefined) {
      command.clientId = clientId;
    }
    return command;
  }

  createSetCommand(value: number, clientId?: string): CounterCommand {
    const command: CounterCommand = { type: "set", value };
    if (clientId !== undefined) {
      command.clientId = clientId;
    }
    return command;
  }

  createResetCommand(clientId?: string): CounterCommand {
    const command: CounterCommand = { type: "reset" };
    if (clientId !== undefined) {
      command.clientId = clientId;
    }
    return command;
  }
}
