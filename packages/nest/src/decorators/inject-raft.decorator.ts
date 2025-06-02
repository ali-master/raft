import { Inject } from "@nestjs/common";
import { RAFT_NODE, RAFT_EVENT_BUS, RAFT_ENGINE } from "../constants";

export const InjectRaftEngine = () => Inject(RAFT_ENGINE);
export const InjectRaftNode = (nodeId?: string) => {
  if (nodeId) {
    return Inject(Symbol.for(`RAFT_NODE_${nodeId}`));
  }
  return Inject(RAFT_NODE);
};
export const InjectRaftEventBus = () => Inject(RAFT_EVENT_BUS);
