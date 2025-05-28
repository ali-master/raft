import type { RaftState } from "../constants";

export interface SystemMetricsSnapshot {
  cpuUsage: number;
  memoryUsage: number;
  diskUsage: number;
  networkLatency: number;
  loadAverage: number[];
  uptime: number;
}

export interface RaftMetrics {
  currentTerm: number;
  state: RaftState;
  votedFor: string | null;
  commitIndex: number;
  lastApplied: number;
  logLength: number;
  leaderHeartbeats: number;
  electionCount: number;
  voteCount: number;
  appendEntriesCount: number;
  peerCount: number;
  systemMetrics: SystemMetricsSnapshot;
}
