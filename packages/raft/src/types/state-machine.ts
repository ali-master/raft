export interface StateMachine {
  apply: (command: any) => Promise<void>;
  getSnapshotData: () => Promise<Buffer>;
  applySnapshot: (data: Buffer) => Promise<void>;
}
