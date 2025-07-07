export interface StateMachine<TCommand = unknown> {
  apply: (command: TCommand) => Promise<void>;
  getSnapshotData: () => Promise<Buffer>;
  applySnapshot: (data: Buffer) => Promise<void>;
}
