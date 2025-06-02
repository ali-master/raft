import { Injectable } from "@nestjs/common";
import {
  OnRaftStateChange,
  OnRaftLeaderElected,
  OnRaftError,
  OnRaftHeartbeat,
  OnRaftElectionTimeout,
  OnRaftVoteGranted,
  OnRaftVoteDenied,
  OnRaftLogReplicated,
  OnRaftLogCommitted,
  OnRaftPeerDiscovered,
  OnRaftPeerLost,
} from "@usex/raft-nestjs";
import { LoggerService } from "@/shared/services/logger.service";
import { MetricsService } from "@/shared/services/metrics.service";

@Injectable()
export class MonitoringEventHandler {
  private readonly nodeId: string;

  constructor(
    private readonly logger: LoggerService,
    private readonly metrics: MetricsService,
  ) {
    this.nodeId = process.env.NODE_ID || "unknown";
  }

  @OnRaftStateChange()
  handleStateChange(data: { from: string; to: string }) {
    this.logger.logRaftEvent("state_change", this.nodeId, data);
    this.metrics.incrementCounter("raft_state_changes_total", {
      node: this.nodeId,
      from: data.from,
      to: data.to,
    });
  }

  @OnRaftLeaderElected()
  handleLeaderElected(data: { leaderId: string; term: number }) {
    this.logger.logRaftEvent("leader_elected", this.nodeId, data);
    this.metrics.incrementCounter("raft_elections_total", {
      node: this.nodeId,
      result: "elected",
    });
  }

  @OnRaftError()
  handleError(error: any) {
    this.logger.logRaftEvent("error_occurred", this.nodeId, error);
    this.metrics.incrementCounter("raft_errors_total", {
      node: this.nodeId,
      type: error.type || "unknown",
    });
  }

  @OnRaftHeartbeat()
  handleHeartbeat(data: { from: string; term: number }) {
    this.logger.verbose(
      `Heartbeat from ${data.from} (term: ${data.term})`,
      "MonitoringEventHandler",
    );
    this.metrics.incrementCounter("raft_heartbeats_total", {
      node: this.nodeId,
      from: data.from,
    });
  }

  @OnRaftElectionTimeout()
  handleElectionTimeout() {
    this.logger.logRaftEvent("election_timeout", this.nodeId);
    this.metrics.incrementCounter("raft_election_timeouts_total", {
      node: this.nodeId,
    });
  }

  @OnRaftVoteGranted()
  handleVoteGranted(data: { to: string; term: number }) {
    this.logger.logRaftEvent("vote_granted", this.nodeId, data);
    this.metrics.incrementCounter("raft_votes_total", {
      node: this.nodeId,
      type: "granted",
      granted: "true",
    });
  }

  @OnRaftVoteDenied()
  handleVoteDenied(data: { to: string; term: number; reason: string }) {
    this.logger.logRaftEvent("vote_denied", this.nodeId, data);
    this.metrics.incrementCounter("raft_votes_total", {
      node: this.nodeId,
      type: "denied",
      granted: "false",
    });
  }

  @OnRaftLogReplicated()
  handleLogReplicated(entry: any) {
    this.metrics.incrementCounter("raft_log_entries_total", {
      node: this.nodeId,
    });
  }

  @OnRaftLogCommitted()
  handleLogCommitted(entry: any) {
    this.metrics.incrementCounter("raft_log_commits_total", {
      node: this.nodeId,
    });
  }

  @OnRaftPeerDiscovered()
  handlePeerDiscovered(data: { peerId: string }) {
    this.logger.logRaftEvent("peer_discovered", this.nodeId, data);
    this.metrics.incrementCounter("raft_peer_discoveries_total", {
      node: this.nodeId,
    });
  }

  @OnRaftPeerLost()
  handlePeerLost(data: { peerId: string; reason: string }) {
    this.logger.logRaftEvent("peer_lost", this.nodeId, data);
    this.metrics.incrementCounter("raft_peer_losses_total", {
      node: this.nodeId,
      reason: data.reason,
    });
  }
}
