import type { RaftState } from "../constants";
import type { SystemMetricsSnapshot } from "./metrics";

export interface PeerInfo {
  nodeId: string;
  clusterId: string;
  httpHost: string;
  httpPort: number;
  state: RaftState;
  term: number;
  lastSeen: Date;
  weight: number;
  metrics: SystemMetricsSnapshot;
}
