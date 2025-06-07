import { StateMachine } from "../../../src/types";

export class MockStateMachine implements StateMachine {
  public commands: any[] = [];
  public snapshotApplied: boolean = false;
  public appliedSnapshotData: Buffer | null = null;
  private snapshotDataToReturn: Buffer = Buffer.from("default_snapshot_data");

  async apply(command: any): Promise<void> {
    this.commands.push(command);
  }

  async getSnapshotData(): Promise<Buffer> {
    return this.snapshotDataToReturn;
  }

  async applySnapshot(data: Buffer): Promise<void> {
    this.appliedSnapshotData = data;
    this.snapshotApplied = true;
  }

  // Test utility to set the data that getSnapshotData() will return
  setSnapshotDataToReturn(data: Buffer): void {
    this.snapshotDataToReturn = data;
  }

  // Test utility to reset mock state
  reset(): void {
    this.commands = [];
    this.snapshotApplied = false;
    this.appliedSnapshotData = null;
    this.snapshotDataToReturn = Buffer.from("default_snapshot_data");
  }
}
