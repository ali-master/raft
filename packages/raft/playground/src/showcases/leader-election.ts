import chalk from "chalk";
import { RaftState } from "@usex/raft";
import { ClusterManager } from "../utils/cluster-manager";
import { PlaygroundLogger } from "../utils/logger";

export class LeaderElectionShowcase {
  private logger = new PlaygroundLogger();
  private clusterManager = new ClusterManager("election-showcase");

  async run(): Promise<void> {
    this.logger.section("Leader Election Scenarios");

    try {
      // Scenario 1: Initial leader election
      await this.demonstrateInitialElection();

      // Scenario 2: Leader failure and re-election
      await this.demonstrateLeaderFailure();

      // Scenario 3: Split vote scenario
      await this.demonstrateSplitVote();

      // Scenario 4: Network partition election
      await this.demonstratePartitionElection();

      this.logger.result(
        true,
        "All leader election scenarios completed successfully!",
      );
    } catch (_error) {
      this.logger.error("Leader election showcase failed", undefined, _error);
      this.logger.result(false, "Leader election demonstration failed");
    } finally {
      await this.cleanup();
    }
  }

  private async demonstrateInitialElection(): Promise<void> {
    this.logger.step(1, "Initial Leader Election");
    this.logger.info(
      "Creating 5-node cluster and observing initial leader election...",
    );

    await this.clusterManager.createCluster(5, "counter");

    // Track election process
    await this.trackElectionProgress(15000); // 15 seconds timeout

    const metrics = await this.clusterManager.getMetrics();
    if (metrics.leader) {
      this.logger.success(
        `Initial leader elected: ${metrics.leader} in term ${metrics.term}`,
      );
    } else {
      this.logger.error("Failed to elect initial leader");
    }

    await this.displayDetailedNodeStates();
  }

  private async demonstrateLeaderFailure(): Promise<void> {
    this.logger.step(2, "Leader Failure and Re-election");

    const leader = this.clusterManager.getLeader();
    if (!leader) {
      this.logger.error("No leader available for failure showcase");
      return;
    }

    const originalTerm = leader.node.getCurrentTerm();
    this.logger.info(`Current leader: ${leader.nodeId} (term ${originalTerm})`);

    // Stop the leader
    this.logger.warn(`Stopping leader ${leader.nodeId}...`);
    await this.clusterManager.stopNode(leader.nodeId);

    // Track re-election
    this.logger.info("Tracking re-election process...");
    await this.trackElectionProgress(10000);

    const newLeader = this.clusterManager.getLeader();
    if (newLeader) {
      const newTerm = newLeader.node.getCurrentTerm();
      this.logger.success(
        `New leader elected: ${newLeader.nodeId} (term ${newTerm})`,
      );

      if (newTerm > originalTerm) {
        this.logger.success("Term correctly incremented during election");
      } else {
        this.logger.warn("Term did not increment as expected");
      }
    } else {
      this.logger.error("Failed to elect new leader after failure");
    }

    // Restart the failed node and observe behavior
    this.logger.info(`Restarting failed node ${leader.nodeId}...`);
    await this.clusterManager.restartNode(leader.nodeId);
    await this.delay(3000);

    const restartedNode = this.clusterManager.getNode(leader.nodeId);
    if (restartedNode && restartedNode.node.getState() === RaftState.FOLLOWER) {
      this.logger.success("Restarted node correctly became follower");
    }
  }

  private async demonstrateSplitVote(): Promise<void> {
    this.logger.step(3, "Split Vote Scenario");
    this.logger.info(
      "Creating scenario with even number of nodes to increase split vote chance...",
    );

    // Clean up and create 4-node cluster for split vote possibility
    await this.clusterManager.cleanup();
    await this.delay(3000); // Wait longer for cleanup to complete

    // Create new cluster
    await this.clusterManager.createCluster(4, "counter");

    // Reset circuit breakers after cluster creation and allow time for initialization
    this.clusterManager.resetAllCircuitBreakers();
    await this.delay(2000); // Allow reset to take effect and cluster to stabilize

    // Stop current leader to force election
    const leader = this.clusterManager.getLeader();
    if (leader) {
      await this.clusterManager.stopNode(leader.nodeId);
    }

    // Monitor for potential split votes and re-elections
    this.logger.info(
      "Monitoring for split votes and multiple election rounds...",
    );
    const startTime = Date.now();
    let electionRounds = 0;
    let lastTerm = 0;

    while (Date.now() - startTime < 15000) {
      // 15 second timeout
      const metrics = await this.clusterManager.getMetrics();

      if (metrics.term > lastTerm) {
        electionRounds++;
        lastTerm = metrics.term;
        this.logger.info(
          `Election round ${electionRounds} - Term ${metrics.term}`,
        );

        if (metrics.candidates.length > 1) {
          this.logger.warn(
            `Multiple candidates detected: ${metrics.candidates.join(", ")}`,
          );
        }
      }

      if (metrics.leader) {
        this.logger.success(
          `Leader elected after ${electionRounds} rounds: ${metrics.leader}`,
        );
        break;
      }

      await this.delay(200);
    }

    if (electionRounds > 1) {
      this.logger.success(
        "Successfully demonstrated multiple election rounds (likely split votes)",
      );
    } else {
      this.logger.info("Election completed quickly (no split vote occurred)");
    }
  }

  private async demonstratePartitionElection(): Promise<void> {
    this.logger.step(4, "Network Partition Election");

    // Create 5-node cluster
    await this.clusterManager.cleanup();
    await this.clusterManager.createCluster(5, "counter");

    const allNodes = this.clusterManager.getAllNodes().map((n) => n.nodeId);
    const partition1 = allNodes.slice(0, 3); // Majority partition
    const partition2 = allNodes.slice(3); // Minority partition

    this.logger.info(`Creating network partition:`);
    this.logger.info(
      `  Majority partition (${partition1.length}): ${partition1.join(", ")}`,
    );
    this.logger.info(
      `  Minority partition (${partition2.length}): ${partition2.join(", ")}`,
    );

    // Create partition
    await this.clusterManager.simulateNetworkPartition(partition1, partition2);

    // Wait for majority partition to elect leader
    this.logger.info(
      "Waiting for majority partition to elect/maintain leader...",
    );
    await this.delay(5000);

    // Check that only majority partition has leader
    // const _activeNodes = partition1
    //   .map((id) => this.clusterManager.getNode(id))
    //   .filter((n) => n);
    const leader = this.clusterManager.getLeader();

    if (leader && partition1.includes(leader.nodeId)) {
      this.logger.success(`Majority partition has leader: ${leader.nodeId}`);
    } else {
      this.logger.warn("Majority partition failed to maintain/elect leader");
    }

    // Heal partition
    this.logger.info("Healing network partition...");
    await this.clusterManager.healNetworkPartition(partition2);

    // Verify cluster reunification
    await this.delay(3000);
    const finalLeader = this.clusterManager.getLeader();
    const finalMetrics = await this.clusterManager.getMetrics();

    if (finalLeader && finalMetrics.followers.length === 4) {
      this.logger.success("Cluster successfully reunified with single leader");
    } else {
      this.logger.warn("Cluster reunification may have issues");
    }
  }

  private async trackElectionProgress(timeoutMs: number): Promise<void> {
    const startTime = Date.now();
    let lastUpdate = "";

    while (Date.now() - startTime < timeoutMs) {
      const metrics = await this.clusterManager.getMetrics();
      const status = `Term: ${metrics.term} | Leader: ${metrics.leader || "None"} | Candidates: ${metrics.candidates.length}`;

      if (status !== lastUpdate) {
        this.logger.info(`Election Status - ${status}`);
        lastUpdate = status;
      }

      if (metrics.leader) {
        break; // Leader elected
      }

      await this.delay(100);
    }
  }

  private async displayDetailedNodeStates(): Promise<void> {
    this.logger.info("\n📋 Detailed Node States:");
    const nodes = this.clusterManager.getAllNodes();

    for (const nodeInfo of nodes) {
      const state = nodeInfo.node.getState();
      const term = nodeInfo.node.getCurrentTerm();
      const commitIndex = nodeInfo.node.getCommitIndex();

      let stateIcon = "";
      let stateColor = chalk.white;

      switch (state) {
        case RaftState.LEADER:
          stateIcon = "👑";
          stateColor = chalk.green;
          break;
        case RaftState.FOLLOWER:
          stateIcon = "👤";
          stateColor = chalk.blue;
          break;
        case RaftState.CANDIDATE:
          stateIcon = "🗳️";
          stateColor = chalk.yellow;
          break;
      }

      console.log(
        `  ${stateIcon} ${stateColor(nodeInfo.nodeId)}: ${state} | Term: ${term} | Commit: ${commitIndex}`,
      );
    }
    console.log();
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async cleanup(): Promise<void> {
    this.logger.info("Cleaning up leader election showcase...");
    await this.clusterManager.cleanup();
  }
}
