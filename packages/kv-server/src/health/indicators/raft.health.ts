import { Injectable } from "@nestjs/common";
import type { HealthIndicatorResult } from "@nestjs/terminus";
import type { RaftService } from "../../raft/raft.service";
import { RaftState } from "@usex/raft";
import { BaseHealthIndicator } from "../../shared";

@Injectable()
export class RaftHealthIndicator extends BaseHealthIndicator {
  constructor(private readonly raftService: RaftService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    return this.checkHealth(
      key,
      async () => {
        const nodeId = this.raftService.getNodeId();
        const state = this.raftService.getState();
        const isLeader = this.raftService.isLeader();
        const metrics = this.raftService.getMetrics();

        const isHealthy = state !== RaftState.FOLLOWER || isLeader;

        return {
          isHealthy,
          nodeId,
          state: RaftState[state],
          isLeader,
          lastHeartbeat: metrics?.lastHeartbeat,
          term: metrics?.currentTerm,
          commitIndex: metrics?.commitIndex,
        };
      },
      (result) => ({
        nodeId: result.nodeId,
        state: result.state,
        isLeader: result.isLeader,
        lastHeartbeat: result.lastHeartbeat,
        term: result.term,
        commitIndex: result.commitIndex,
      }),
    );
  }
}
