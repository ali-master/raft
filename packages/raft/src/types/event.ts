import type { RaftEventType } from "../constants";

export class RaftEvent {
  public readonly type: RaftEventType;
  public readonly timestamp: Date;
  public readonly nodeId: string;
  public readonly data: any;

  constructor(type: RaftEventType, nodeId: string, data: any = {}) {
    this.type = type;
    this.timestamp = new Date();
    this.nodeId = nodeId;
    this.data = data;
  }
}
