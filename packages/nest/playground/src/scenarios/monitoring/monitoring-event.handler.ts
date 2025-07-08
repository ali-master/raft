import { Injectable } from "@nestjs/common";
import {
  OnStateChange,
  OnLeaderElected,
  OnRaftError,
  OnHeartbeat,
  OnElectionTimeout,
  OnVoteGranted,
  OnVoteDenied,
  OnLogReplicated,
  OnLogCommitted,
  OnPeerDiscovered,
  OnPeerLost,
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

  @OnStateChange()
  handleStateChange(data: { from: string; to: string }) {
    this.logger.logRaftEvent("state_change", this.nodeId, data);
    this.metrics.incrementCounter("raft_state_changes_total", {
      node: this.nodeId,
      from: data.from,
      to: data.to,
    });
  }

  @OnLeaderElected()
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

  @OnHeartbeat()
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

  @OnElectionTimeout()
  handleElectionTimeout() {
    this.logger.logRaftEvent("election_timeout", this.nodeId);
    this.metrics.incrementCounter("raft_election_timeouts_total", {
      node: this.nodeId,
    });
  }

  @OnVoteGranted()
  handleVoteGranted(data: { to: string; term: number }) {
    this.logger.logRaftEvent("vote_granted", this.nodeId, data);
    this.metrics.incrementCounter("raft_votes_total", {
      node: this.nodeId,
      type: "granted",
      granted: "true",
    });
  }

  @OnVoteDenied()
  handleVoteDenied(data: { to: string; term: number; reason: string }) {
    this.logger.logRaftEvent("vote_denied", this.nodeId, data);
    this.metrics.incrementCounter("raft_votes_total", {
      node: this.nodeId,
      type: "denied",
      granted: "false",
    });
  }

  @OnLogReplicated()
  handleLogReplicated(_entry: any) {
    this.metrics.incrementCounter("raft_log_entries_total", {
      node: this.nodeId,
    });
  }

  @OnLogCommitted()
  handleLogCommitted(_entry: any) {
    this.metrics.incrementCounter("raft_log_commits_total", {
      node: this.nodeId,
    });
  }

  @OnPeerDiscovered()
  handlePeerDiscovered(data: { peerId: string }) {
    this.logger.logRaftEvent("peer_discovered", this.nodeId, data);
    this.metrics.incrementCounter("raft_peer_discoveries_total", {
      node: this.nodeId,
    });
  }

  @OnPeerLost()
  handlePeerLost(data: { peerId: string; reason: string }) {
    this.logger.logRaftEvent("peer_lost", this.nodeId, data);
    this.metrics.incrementCounter("raft_peer_losses_total", {
      node: this.nodeId,
      reason: data.reason,
    });
  }
}
