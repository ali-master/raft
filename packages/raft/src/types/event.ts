import type { RaftEventType } from "../constants";

export class RaftEvent<TData = Record<string, unknown>> {
  public readonly type: RaftEventType;
  public readonly timestamp: Date;
  public readonly nodeId: string;
  public readonly data: TData;

  constructor(type: RaftEventType, nodeId: string, data: TData = {} as TData) {
    this.type = type;
    this.timestamp = new Date();
    this.nodeId = nodeId;
    this.data = data;
  }
}
