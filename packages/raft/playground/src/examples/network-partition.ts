import chalk from "chalk";
import { RaftState } from "@usex/raft";
import { ClusterManager } from "../utils/cluster-manager.js";
import { PlaygroundLogger } from "../utils/logger.js";
import { CounterStateMachine } from "../state-machines/counter-state-machine.js";

export class NetworkPartitionDemo {
  private logger = new PlaygroundLogger();
  private clusterManager = new ClusterManager("network-partition-demo");

  async run(): Promise<void> {
    this.logger.section("Network Partition Scenarios");

    try {
      // Scenario 1: Basic network partition
      await this.demonstrateBasicPartition();

      // Scenario 2: Partition with operations
      await this.demonstratePartitionWithOperations();

      // Scenario 3: Multiple partitions
      await this.demonstrateMultiplePartitions();

      // Scenario 4: Partition healing and consistency
      await this.demonstratePartitionHealing();

      // Scenario 5: Rolling partitions
      await this.demonstrateRollingPartitions();

      this.logger.result(
        true,
        "All network partition scenarios completed successfully!",
      );
    } catch (_error) {
      this.logger.error("Network partition demo failed", undefined, _error);
      this.logger.result(false, "Network partition demonstration failed");
    } finally {
      await this.cleanup();
    }
  }

  private async demonstrateBasicPartition(): Promise<void> {
    this.logger.step(1, "Basic Network Partition");
    this.logger.info(
      "Creating 5-node cluster and simulating network partition...",
    );

    // Create cluster
    await this.clusterManager.createCluster(5, "counter");

    // Wait for initial stability
    await this.delay(3000);

    const allNodes = this.clusterManager.getAllNodes().map((n) => n.nodeId);
    const majorityPartition = allNodes.slice(0, 3); // 3 nodes (majority)
    const minorityPartition = allNodes.slice(3); // 2 nodes (minority)

    this.logger.info("Initial cluster state:");
    await this.displayClusterState();

    this.logger.info(`\\nCreating network partition:`);
    this.logger.info(
      `  Majority partition (${majorityPartition.length} nodes): ${majorityPartition.join(", ")}`,
    );
    this.logger.info(
      `  Minority partition (${minorityPartition.length} nodes): ${minorityPartition.join(", ")}`,
    );

    // Create partition
    await this.clusterManager.simulateNetworkPartition(
      majorityPartition,
      minorityPartition,
    );

    // Wait for partition effects
    await this.delay(5000);

    this.logger.info("\\nCluster state after partition:");
    await this.displayClusterState();

    // Verify only majority partition has leader
    const leader = this.clusterManager.getLeader();
    if (leader && majorityPartition.includes(leader.nodeId)) {
      this.logger.success(
        `Majority partition correctly maintains leader: ${leader.nodeId}`,
      );
    } else if (!leader) {
      this.logger.info("No leader detected (election may be in progress)");
    } else {
      this.logger.warn("Unexpected leader location or behavior");
    }

    // Check that minority partition has no leader
    const minorityNodes = minorityPartition
      .map((id) => this.clusterManager.getNode(id)!)
      .filter((n) => n);
    const minorityLeaders = minorityNodes.filter(
      (n) => n.node.getState() === RaftState.LEADER,
    );

    if (minorityLeaders.length === 0) {
      this.logger.success("Minority partition correctly has no leader");
    } else {
      this.logger.warn(
        `Minority partition unexpectedly has ${minorityLeaders.length} leader(s)`,
      );
    }
  }

  private async demonstratePartitionWithOperations(): Promise<void> {
    this.logger.step(2, "Partition with Operations");
    this.logger.info("Testing operations during network partition...");

    const stateMachine = new CounterStateMachine("partition-ops");

    // Try operations on majority partition
    this.logger.info("\\nTesting operations on majority partition...");

    const majoritySuccesses = [];
    const majorityFailures = [];

    for (let i = 0; i < 5; i++) {
      try {
        await this.clusterManager.appendToLeader(
          stateMachine.createIncrementCommand(1, `majority-op-${i}`),
        );
        majoritySuccesses.push(i);
        this.logger.success(`Operation ${i} succeeded on majority partition`);
      } catch (_error) {
        majorityFailures.push(i);
        this.logger.error(
          `Operation ${i} failed on majority partition`,
          undefined,
          _error,
        );
      }

      await this.delay(500);
    }

    this.logger.info(
      `\\nMajority partition results: ${majoritySuccesses.length} successes, ${majorityFailures.length} failures`,
    );

    // Check state consistency in majority partition
    const majorityNodes = this.clusterManager.getAllNodes().slice(0, 3);
    const majorityStates = majorityNodes.map((nodeInfo) => {
      const sm = nodeInfo.stateMachine as CounterStateMachine;
      return sm.getState();
    });

    const majorityConsistent = majorityStates.every(
      (state) =>
        state.value === majorityStates[0].value &&
        state.version === majorityStates[0].version,
    );

    if (majorityConsistent) {
      this.logger.success("Majority partition maintains internal consistency");
    } else {
      this.logger.error("Majority partition has consistency issues");
    }

    // Display state values
    this.logger.info("\\nState machine values in majority partition:");
    for (const state of majorityStates) {
      console.log(
        `  ${state.nodeId}: Value=${state.value}, Version=${state.version}`,
      );
    }
  }

  private async demonstrateMultiplePartitions(): Promise<void> {
    this.logger.step(3, "Multiple Partitions");
    this.logger.info("Creating multiple network partitions...");

    // First heal existing partition
    await this.clusterManager.healNetworkPartition(["node-3", "node-4"]);
    await this.delay(2000);

    // Create cluster with 7 nodes for multiple partitions
    await this.clusterManager.cleanup();
    await this.clusterManager.createCluster(7, "counter");
    await this.delay(3000);

    const allNodes = this.clusterManager.getAllNodes().map((n) => n.nodeId);

    // Create 3 partitions
    const partition1 = allNodes.slice(0, 3); // 3 nodes (majority)
    const partition2 = allNodes.slice(3, 5); // 2 nodes
    const partition3 = allNodes.slice(5); // 2 nodes

    this.logger.info("Creating three-way partition:");
    this.logger.info(
      `  Partition 1 (${partition1.length} nodes): ${partition1.join(", ")}`,
    );
    this.logger.info(
      `  Partition 2 (${partition2.length} nodes): ${partition2.join(", ")}`,
    );
    this.logger.info(
      `  Partition 3 (${partition3.length} nodes): ${partition3.join(", ")}`,
    );

    // Simulate multiple partitions by isolating groups
    await this.clusterManager.simulateNetworkPartition(partition1, [
      ...partition2,
      ...partition3,
    ]);

    // Additional isolation (in real scenario, partition2 and partition3 would also be isolated from each other)
    await this.delay(5000);

    this.logger.info("\\nCluster state after multiple partitions:");
    await this.displayClusterState();

    // Only partition1 should have leader
    const leader = this.clusterManager.getLeader();
    if (leader && partition1.includes(leader.nodeId)) {
      this.logger.success(
        `Only majority partition has leader: ${leader.nodeId}`,
      );
    } else {
      this.logger.warn("Unexpected leader behavior in multiple partitions");
    }

    // Test operations
    const stateMachine = new CounterStateMachine("multi-partition");

    try {
      await this.clusterManager.appendToLeader(
        stateMachine.createIncrementCommand(10, "multi-partition-test"),
      );
      this.logger.success("Operations successful in majority partition");
    } catch (_error) {
      this.logger.error(
        "Operations failed in majority partition",
        undefined,
        _error,
      );
    }
  }

  private async demonstratePartitionHealing(): Promise<void> {
    this.logger.step(4, "Partition Healing and Consistency");
    this.logger.info(
      "Demonstrating partition healing and consistency recovery...",
    );

    // Record state before healing
    const beforeHealing = await this.captureClusterState();

    this.logger.info("\\nState before healing:");
    this.displayCapturedState(beforeHealing);

    // Heal partitions gradually
    this.logger.info("\\nGradually healing network partitions...");

    // First, heal one partition
    this.logger.info("Healing first partition...");
    await this.clusterManager.healNetworkPartition(["node-3", "node-4"]);
    await this.delay(3000);

    const afterFirstHeal = await this.captureClusterState();
    this.logger.info("\\nState after first heal:");
    this.displayCapturedState(afterFirstHeal);

    // Then heal the remaining partition
    this.logger.info("\\nHealing remaining partition...");
    await this.clusterManager.healNetworkPartition(["node-5", "node-6"]);
    await this.delay(3000);

    const afterFullHeal = await this.captureClusterState();
    this.logger.info("\\nState after full healing:");
    this.displayCapturedState(afterFullHeal);

    // Verify final consistency
    const finalConsistency = await this.verifyFullConsistency();
    if (finalConsistency) {
      this.logger.success("Cluster achieved full consistency after healing");
    } else {
      this.logger.error("Consistency issues remain after healing");
    }

    // Test operations after healing
    this.logger.info("\\nTesting operations after healing...");
    const stateMachine = new CounterStateMachine("post-heal");

    for (let i = 0; i < 3; i++) {
      try {
        await this.clusterManager.appendToLeader(
          stateMachine.createIncrementCommand(1, `post-heal-${i}`),
        );
        this.logger.success(`Post-heal operation ${i} succeeded`);
      } catch (_error) {
        this.logger.error(`Post-heal operation ${i} failed`, undefined, _error);
      }

      await this.delay(500);
    }

    // Final consistency check
    await this.delay(2000);
    const finalCheck = await this.verifyFullConsistency();
    if (finalCheck) {
      this.logger.success("Final consistency check passed");
    } else {
      this.logger.error("Final consistency check failed");
    }
  }

  private async demonstrateRollingPartitions(): Promise<void> {
    this.logger.step(5, "Rolling Partitions");
    this.logger.info("Demonstrating rolling network partitions...");

    // Create a series of different partitions over time
    const allNodes = this.clusterManager.getAllNodes().map((n) => n.nodeId);

    const partitionScenarios = [
      {
        name: "Scenario A",
        partition1: allNodes.slice(0, 3),
        partition2: allNodes.slice(3),
      },
      {
        name: "Scenario B",
        partition1: [allNodes[0], allNodes[2], allNodes[4]],
        partition2: [allNodes[1], allNodes[3]],
      },
      {
        name: "Scenario C",
        partition1: allNodes.slice(1, 4),
        partition2: [allNodes[0], ...allNodes.slice(4)],
      },
    ];

    for (let i = 0; i < partitionScenarios.length; i++) {
      const scenario = partitionScenarios[i];

      this.logger.info(`\\n${scenario.name}:`);
      this.logger.info(`  Partition 1: ${scenario.partition1.join(", ")}`);
      this.logger.info(`  Partition 2: ${scenario.partition2.join(", ")}`);

      // Heal previous partition
      if (i > 0) {
        await this.clusterManager.healNetworkPartition(
          partitionScenarios[i - 1].partition2,
        );
        await this.delay(2000);
      }

      // Create new partition
      await this.clusterManager.simulateNetworkPartition(
        scenario.partition1,
        scenario.partition2,
      );
      await this.delay(3000);

      // Check leader
      const leader = this.clusterManager.getLeader();
      if (leader) {
        const leaderPartition = scenario.partition1.includes(leader.nodeId)
          ? 1
          : 2;
        this.logger.info(
          `  Leader: ${leader.nodeId} (Partition ${leaderPartition})`,
        );
      } else {
        this.logger.info("  Leader: None");
      }

      // Test quick operation
      const stateMachine = new CounterStateMachine(`rolling-${i}`);

      try {
        await this.clusterManager.appendToLeader(
          stateMachine.createIncrementCommand(1, `rolling-${i}`),
        );
        this.logger.success(`  Operation succeeded in ${scenario.name}`);
      } catch (_error) {
        this.logger.error(
          `  Operation failed in ${scenario.name}`,
          undefined,
          _error,
        );
      }
    }

    // Final healing
    this.logger.info("\\nHealing all partitions...");
    const lastScenario = partitionScenarios[partitionScenarios.length - 1];
    await this.clusterManager.healNetworkPartition(lastScenario.partition2);
    await this.delay(3000);

    // Final state
    this.logger.info("\\nFinal cluster state after rolling partitions:");
    await this.displayClusterState();

    const finalConsistency = await this.verifyFullConsistency();
    if (finalConsistency) {
      this.logger.success("Cluster recovered from rolling partitions");
    } else {
      this.logger.error("Issues remain after rolling partitions");
    }
  }

  private async displayClusterState(): Promise<void> {
    const nodes = this.clusterManager.getAllNodes();
    const metrics = await this.clusterManager.getMetrics();

    console.log(chalk.cyan("  Cluster State:"));
    console.log(`    Leader: ${metrics.leader || "None"}`);
    console.log(`    Term: ${metrics.term}`);
    console.log(`    Followers: ${metrics.followers.length}`);
    console.log(`    Candidates: ${metrics.candidates.length}`);

    console.log(chalk.cyan("  Node Details:"));
    for (const nodeInfo of nodes) {
      const state = nodeInfo.node.getState();
      const term = nodeInfo.node.getCurrentTerm();
      const commitIndex = nodeInfo.node.getCommitIndex();

      let stateIcon = "";
      switch (state) {
        case RaftState.LEADER:
          stateIcon = "👑";
          break;
        case RaftState.FOLLOWER:
          stateIcon = "👤";
          break;
        case RaftState.CANDIDATE:
          stateIcon = "🗳️";
          break;
      }

      console.log(
        `    ${stateIcon} ${nodeInfo.nodeId}: ${state} | Term: ${term} | Commit: ${commitIndex}`,
      );
    }
  }

  private async captureClusterState(): Promise<any> {
    const nodes = this.clusterManager.getAllNodes();
    const metrics = await this.clusterManager.getMetrics();

    return {
      leader: metrics.leader,
      term: metrics.term,
      nodes: nodes.map((nodeInfo) => ({
        nodeId: nodeInfo.nodeId,
        state: nodeInfo.node.getState(),
        term: nodeInfo.node.getCurrentTerm(),
        commitIndex: nodeInfo.node.getCommitIndex(),
        stateMachineState: (
          nodeInfo.stateMachine as CounterStateMachine
        ).getState(),
      })),
    };
  }

  private displayCapturedState(state: any): void {
    console.log(chalk.cyan(`    Leader: ${state.leader || "None"}`));
    console.log(chalk.cyan(`    Term: ${state.term}`));
    console.log(chalk.cyan("    Nodes:"));

    for (const node of state.nodes) {
      let stateIcon = "";
      switch (node.state) {
        case RaftState.LEADER:
          stateIcon = "👑";
          break;
        case RaftState.FOLLOWER:
          stateIcon = "👤";
          break;
        case RaftState.CANDIDATE:
          stateIcon = "🗳️";
          break;
      }

      console.log(
        `      ${stateIcon} ${node.nodeId}: ${node.state} | Term: ${node.term} | SM: ${node.stateMachineState.value}`,
      );
    }
  }

  private async verifyFullConsistency(): Promise<boolean> {
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
    this.logger.info("Cleaning up network partition demo...");
    await this.clusterManager.cleanup();
  }
}
