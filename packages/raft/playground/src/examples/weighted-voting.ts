import { RaftState } from "@usex/raft";
import chalk from "chalk";
import { ClusterManager } from "../utils/cluster-manager";
import { PlaygroundLogger } from "../utils/logger";
import { CounterStateMachine } from "../state-machines/counter-state-machine";

export class WeightedVotingDemo {
  private logger = new PlaygroundLogger();
  private clusterManager = new ClusterManager("weighted-voting-demo");

  async run(): Promise<void> {
    this.logger.section("Weighted Voting Demonstration");

    try {
      // Scenario 1: Basic weighted voting
      await this.demonstrateBasicWeightedVoting();

      // Scenario 2: Weighted voting with node failures
      await this.demonstrateWeightedVotingWithFailures();

      // Scenario 3: Dynamic weight changes
      await this.demonstrateDynamicWeightChanges();

      // Scenario 4: Weighted voting in network partitions
      await this.demonstrateWeightedVotingInPartitions();

      this.logger.result(
        true,
        "All weighted voting scenarios completed successfully!",
      );
    } catch (_error) {
      this.logger.error("Weighted voting demo failed", undefined, _error);
      this.logger.result(false, "Weighted voting demonstration failed");
    } finally {
      await this.cleanup();
    }
  }

  private async demonstrateBasicWeightedVoting(): Promise<void> {
    this.logger.step(1, "Basic Weighted Voting");
    this.logger.info("Creating cluster with different node weights...");

    // Create cluster with weighted nodes
    const nodeWeights = {
      "heavy-node-1": 3, // High weight node
      "heavy-node-2": 3, // High weight node
      "light-node-1": 1, // Low weight node
      "light-node-2": 1, // Low weight node
      "light-node-3": 1, // Low weight node
    };

    await this.clusterManager.createWeightedCluster(nodeWeights, "counter");

    this.logger.info("Node weights configuration:");
    for (const [nodeId, weight] of Object.entries(nodeWeights)) {
      console.log(`  ${nodeId}: Weight ${weight}`);
    }

    const totalWeight = Object.values(nodeWeights).reduce(
      (sum, w) => sum + w,
      0,
    );
    const requiredWeight = Math.floor(totalWeight / 2) + 1;

    this.logger.info(`Total weight: ${totalWeight}`);
    this.logger.info(`Required weight for majority: ${requiredWeight}`);

    // Wait for initial leader election
    await this.trackWeightedElection(15000);

    // Verify leader election with weights
    const leader = this.clusterManager.getLeader();
    if (leader) {
      this.logger.success(`Leader elected: ${leader.nodeId}`);
      await this.displayWeightedClusterState();
    } else {
      this.logger.error("Failed to elect leader in weighted cluster");
    }
  }

  private async demonstrateWeightedVotingWithFailures(): Promise<void> {
    this.logger.step(2, "Weighted Voting with Node Failures");

    // Test scenario: Stop light nodes and verify heavy nodes can still elect leader
    this.logger.info("Testing failure scenarios with weighted nodes...");

    const lightNodes = ["light-node-1", "light-node-2", "light-node-3"];
    this.logger.info(`Stopping light nodes: ${lightNodes.join(", ")}`);

    // Stop all light nodes
    for (const nodeId of lightNodes) {
      await this.clusterManager.stopNode(nodeId);
      await this.delay(500);
    }

    // Heavy nodes (weight 3 each = 6 total) should still form majority (> 4.5)
    this.logger.info(
      "Heavy nodes should maintain/elect leader with combined weight of 6...",
    );

    await this.trackWeightedElection(10000);

    const leader = this.clusterManager.getLeader();
    if (leader) {
      this.logger.success(`Leader maintained by heavy nodes: ${leader.nodeId}`);
    } else {
      this.logger.error("Heavy nodes failed to maintain leadership");
    }

    // Now test the opposite: stop heavy nodes
    this.logger.info("\\nTesting opposite scenario...");

    // Restart light nodes first
    for (const nodeId of lightNodes) {
      await this.clusterManager.startNode(nodeId);
      await this.delay(500);
    }

    await this.delay(2000); // Wait for stabilization

    // Stop heavy nodes
    const heavyNodes = ["heavy-node-1", "heavy-node-2"];
    this.logger.info(`Stopping heavy nodes: ${heavyNodes.join(", ")}`);

    for (const nodeId of heavyNodes) {
      await this.clusterManager.stopNode(nodeId);
      await this.delay(500);
    }

    // Light nodes (weight 1 each = 3 total) should NOT be able to elect leader (< 4.5)
    this.logger.info(
      "Light nodes should NOT be able to elect leader with combined weight of 3...",
    );

    await this.delay(5000); // Wait to see if election fails

    const leaderAfterHeavyFailure = this.clusterManager.getLeader();
    if (!leaderAfterHeavyFailure) {
      this.logger.success(
        "Correctly failed to elect leader without sufficient weight",
      );
    } else {
      this.logger.warn("Unexpected leader election with insufficient weight");
    }

    // Restart one heavy node to restore majority
    this.logger.info("\\nRestarting one heavy node to restore majority...");
    await this.clusterManager.startNode("heavy-node-1");
    await this.delay(2000);

    await this.trackWeightedElection(10000);

    const restoredLeader = this.clusterManager.getLeader();
    if (restoredLeader) {
      this.logger.success(`Leadership restored: ${restoredLeader.nodeId}`);
    }

    // Restart all nodes for next test
    await this.clusterManager.startNode("heavy-node-2");
    await this.delay(2000);
  }

  private async demonstrateDynamicWeightChanges(): Promise<void> {
    this.logger.step(3, "Dynamic Weight Changes");
    this.logger.info("Demonstrating dynamic weight adjustments...");

    // This is a conceptual demonstration since actual weight changes would
    // require cluster membership changes in a real implementation

    this.logger.info("Current cluster weights:");
    await this.displayWeightedClusterState();

    // Simulate a scenario where we need to adjust weights
    this.logger.info("\\nSimulating weight adjustment scenario...");
    this.logger.info(
      "Scenario: Data center with heavy nodes experiences issues",
    );

    // Submit some operations before weight change
    const stateMachine = new CounterStateMachine("weight-test");

    this.logger.info("Submitting operations before weight change...");
    for (let i = 0; i < 5; i++) {
      await this.clusterManager.appendToLeader(
        stateMachine.createIncrementCommand(1, `pre-weight-${i}`),
      );
    }

    // Simulate weight adjustment by stopping and restarting nodes
    this.logger.info("\\nSimulating weight redistribution...");

    // In a real implementation, this would involve:
    // 1. Proposing a configuration change
    // 2. Getting consensus on the new weights
    // 3. Applying the new weights

    this.logger.info("Configuration change proposal (simulated):");
    console.log("  heavy-node-1: 3 → 2 (reduced due to datacenter issues)");
    console.log("  heavy-node-2: 3 → 2 (reduced due to datacenter issues)");
    console.log("  light-node-1: 1 → 2 (promoted for reliability)");
    console.log("  light-node-2: 1 → 2 (promoted for reliability)");
    console.log("  light-node-3: 1 → 1 (unchanged)");

    // Simulate the new configuration by restarting cluster
    this.logger.info("\\nApplying new weight configuration...");

    // Submit operations after weight change
    this.logger.info("Submitting operations after weight change...");
    for (let i = 0; i < 5; i++) {
      await this.clusterManager.appendToLeader(
        stateMachine.createIncrementCommand(1, `post-weight-${i}`),
      );
    }

    await this.delay(2000);

    // Verify consistency after weight changes
    const finalState = await this.verifyConsistency();
    if (finalState) {
      this.logger.success("Consistency maintained through weight changes");
    } else {
      this.logger.error("Consistency issues detected after weight changes");
    }
  }

  private async demonstrateWeightedVotingInPartitions(): Promise<void> {
    this.logger.step(4, "Weighted Voting in Network Partitions");
    this.logger.info(
      "Testing weighted voting behavior during network partitions...",
    );

    // Create partitions with different total weights
    const partition1 = ["heavy-node-1", "light-node-1"]; // Weight: 3 + 1 = 4
    const partition2 = ["heavy-node-2", "light-node-2", "light-node-3"]; // Weight: 3 + 1 + 1 = 5

    this.logger.info("Creating network partitions:");
    this.logger.info(`  Partition 1 (weight 4): ${partition1.join(", ")}`);
    this.logger.info(`  Partition 2 (weight 5): ${partition2.join(", ")}`);
    this.logger.info("  Required weight for majority: 5");

    // Create the partition
    await this.clusterManager.simulateNetworkPartition(partition1, partition2);

    // Wait for partition to take effect
    await this.delay(3000);

    // Check which partition maintains leadership
    this.logger.info("\\nChecking partition leadership...");

    const leader = this.clusterManager.getLeader();
    if (leader) {
      const leaderPartition = partition1.includes(leader.nodeId) ? 1 : 2;
      const leaderPartitionWeight = leaderPartition === 1 ? 4 : 5;

      this.logger.info(
        `Leader ${leader.nodeId} in partition ${leaderPartition} (weight ${leaderPartitionWeight})`,
      );

      if (leaderPartition === 2) {
        this.logger.success(
          "Correct: Partition with majority weight maintains leadership",
        );
      } else {
        this.logger.warn(
          "Unexpected: Partition without majority weight has leadership",
        );
      }
    } else {
      this.logger.warn(
        "No leader during partition (possible split-brain prevention)",
      );
    }

    // Test operations in the majority partition
    if (leader && partition2.includes(leader.nodeId)) {
      this.logger.info("\\nTesting operations in majority partition...");

      const stateMachine = new CounterStateMachine("partition-test");

      try {
        for (let i = 0; i < 3; i++) {
          await this.clusterManager.appendToLeader(
            stateMachine.createIncrementCommand(1, `partition-op-${i}`),
          );
        }
        this.logger.success("Operations successful in majority partition");
      } catch (_error) {
        this.logger.error(
          "Operations failed in majority partition",
          undefined,
          _error,
        );
      }
    }

    // Heal the partition
    this.logger.info("\\nHealing network partition...");
    await this.clusterManager.healNetworkPartition(partition1);

    await this.delay(3000);

    // Verify final state
    const finalLeader = this.clusterManager.getLeader();
    if (finalLeader) {
      this.logger.success(
        `Cluster reunified with leader: ${finalLeader.nodeId}`,
      );
      await this.displayWeightedClusterState();
    } else {
      this.logger.error("Failed to reunify cluster");
    }
  }

  private async trackWeightedElection(timeoutMs: number): Promise<void> {
    const startTime = Date.now();
    let lastUpdate = "";

    while (Date.now() - startTime < timeoutMs) {
      const metrics = await this.clusterManager.getMetrics();
      const status = `Term: ${metrics.term} | Leader: ${metrics.leader || "None"} | Candidates: ${metrics.candidates.length}`;

      if (status !== lastUpdate) {
        this.logger.info(`Weighted Election Status - ${status}`);
        lastUpdate = status;
      }

      if (metrics.leader) {
        break; // Leader elected
      }

      await this.delay(100);
    }
  }

  private async displayWeightedClusterState(): Promise<void> {
    this.logger.info("\\n📊 Weighted Cluster State:");
    const nodes = this.clusterManager.getAllNodes();

    // Note: In a real implementation, weights would be stored in configuration
    const simulatedWeights: Record<string, number> = {
      "heavy-node-1": 3,
      "heavy-node-2": 3,
      "light-node-1": 1,
      "light-node-2": 1,
      "light-node-3": 1,
    };

    let totalActiveWeight = 0;

    for (const nodeInfo of nodes) {
      const state = nodeInfo.node.getState();
      const term = nodeInfo.node.getCurrentTerm();
      const weight = simulatedWeights[nodeInfo.nodeId] || 1;

      let stateIcon = "";
      let stateColor = chalk.white;

      switch (state) {
        case RaftState.LEADER:
          stateIcon = "👑";
          stateColor = chalk.green;
          totalActiveWeight += weight;
          break;
        case RaftState.FOLLOWER:
          stateIcon = "👤";
          stateColor = chalk.blue;
          totalActiveWeight += weight;
          break;
        case RaftState.CANDIDATE:
          stateIcon = "🗳️";
          stateColor = chalk.yellow;
          totalActiveWeight += weight;
          break;
      }

      console.log(
        `  ${stateIcon} ${stateColor(nodeInfo.nodeId)}: ${state} | Term: ${term} | Weight: ${weight}`,
      );
    }

    const totalWeight = Object.values(simulatedWeights).reduce(
      (sum, w) => sum + w,
      0,
    );
    const requiredWeight = Math.floor(totalWeight / 2) + 1;

    console.log(`\\n  Total cluster weight: ${totalWeight}`);
    console.log(`  Active weight: ${totalActiveWeight}`);
    console.log(`  Required for majority: ${requiredWeight}`);
    console.log(
      `  Majority status: ${totalActiveWeight >= requiredWeight ? "YES" : "NO"}`,
    );
    console.log();
  }

  private async verifyConsistency(): Promise<boolean> {
    const nodes = this.clusterManager.getAllNodes();
    const stateMachineStates = nodes.map((nodeInfo) => {
      const sm = nodeInfo.stateMachine as CounterStateMachine;
      return sm.getState();
    });

    const uniqueValues = new Set(stateMachineStates.map((s) => s.value));
    const uniqueVersions = new Set(stateMachineStates.map((s) => s.version));

    const isConsistent = uniqueValues.size === 1 && uniqueVersions.size === 1;

    this.logger.info("\\n🔍 Consistency Check:");
    for (const state of stateMachineStates) {
      console.log(
        `  ${state.nodeId}: Value=${state.value}, Version=${state.version}`,
      );
    }

    return isConsistent;
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async cleanup(): Promise<void> {
    this.logger.info("Cleaning up weighted voting demo...");
    await this.clusterManager.cleanup();
  }
}
