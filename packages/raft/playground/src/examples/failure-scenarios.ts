import chalk from "chalk";
import { ClusterManager } from "../utils/cluster-manager";
import { PlaygroundLogger } from "../utils/logger";
import { CounterStateMachine } from "../state-machines/counter-state-machine";

export class FailuresScenariosDemo {
  private logger = new PlaygroundLogger();
  private clusterManager = new ClusterManager("failures-demo");

  async run(): Promise<void> {
    this.logger.section("Failure Scenarios and Recovery");

    try {
      // Setup cluster
      await this.setupCluster();

      // Scenario 1: Single node failure
      await this.demonstrateSingleNodeFailure();

      // Scenario 2: Leader failure
      await this.demonstrateLeaderFailure();

      // Scenario 3: Majority failure (should maintain safety)
      await this.demonstrateMajorityFailure();

      // Scenario 4: Network partition (split-brain prevention)
      await this.demonstrateNetworkPartition();

      // Scenario 5: Cascading failures
      await this.demonstrateCascadingFailures();

      // Scenario 6: Recovery scenarios
      await this.demonstrateRecoveryScenarios();

      this.logger.result(true, "All failure scenarios completed successfully!");
    } catch (_error) {
      this.logger.error("Failure scenarios demo failed", undefined, _error);
      this.logger.result(false, "Failure scenarios demonstration failed");
    } finally {
      await this.cleanup();
    }
  }

  private async setupCluster(): Promise<void> {
    this.logger.step(1, "Setting up 5-node cluster for failure testing");
    await this.clusterManager.createCluster(5, "counter");

    // Establish baseline data
    await this.establishBaseline();
    await this.displayClusterStatus();
  }

  private async establishBaseline(): Promise<void> {
    this.logger.info("Establishing baseline data...");

    const stateMachine = new CounterStateMachine("demo");
    const commands = [
      stateMachine.createSetCommand(100, "baseline"),
      stateMachine.createIncrementCommand(25, "baseline-1"),
      stateMachine.createIncrementCommand(15, "baseline-2"),
    ];

    for (const command of commands) {
      await this.clusterManager.appendToLeader(command);
      await this.delay(300);
    }

    this.logger.success("Baseline established");
    await this.verifyDataConsistency();
  }

  private async demonstrateSingleNodeFailure(): Promise<void> {
    this.logger.step(2, "Single Node Failure Recovery");

    const followers = this.clusterManager.getFollowers();
    if (followers.length === 0) {
      this.logger.warn("No followers available for single failure test");
      return;
    }

    const targetNode = followers[0];
    this.logger.info(`Simulating failure of follower ${targetNode.nodeId}...`);

    // Stop the node
    await this.clusterManager.stopNode(targetNode.nodeId);

    // Verify cluster continues to function
    this.logger.info("Testing cluster functionality with failed node...");
    const stateMachine = new CounterStateMachine("demo");
    const testCommands = [
      stateMachine.createIncrementCommand(10, "single-failure-1"),
      stateMachine.createDecrementCommand(5, "single-failure-2"),
    ];

    for (const command of testCommands) {
      try {
        await this.clusterManager.appendToLeader(command);
        this.logger.success(
          `Command processed despite node failure: ${command.type}`,
        );
        await this.delay(500);
      } catch (_error) {
        this.logger.error(
          "Command failed with single node down",
          undefined,
          _error,
        );
      }
    }

    // Restart failed node and verify recovery
    this.logger.info(`Restarting failed node ${targetNode.nodeId}...`);
    await this.clusterManager.startNode(targetNode.nodeId);

    await this.delay(3000); // Wait for recovery

    // Verify node caught up
    await this.verifyNodeRecovery(targetNode.nodeId);
    this.logger.success("Single node failure recovery completed");
  }

  private async demonstrateLeaderFailure(): Promise<void> {
    this.logger.step(3, "Leader Failure and Election");

    const leader = this.clusterManager.getLeader();
    if (!leader) {
      this.logger.error("No leader available for failure test");
      return;
    }

    const originalLeaderId = leader.nodeId;
    const originalTerm = leader.node.getCurrentTerm();

    this.logger.info(
      `Simulating leader failure: ${originalLeaderId} (term ${originalTerm})`,
    );

    // Stop the leader
    await this.clusterManager.stopNode(originalLeaderId);

    // Monitor election process
    this.logger.info("Monitoring leader election process...");
    const electionStartTime = Date.now();
    let newLeader: any = null;

    while (Date.now() - electionStartTime < 15000) {
      // 15 second timeout
      newLeader = this.clusterManager.getLeader();
      if (newLeader) {
        const electionTime = Date.now() - electionStartTime;
        this.logger.success(
          `New leader elected: ${newLeader.nodeId} in ${electionTime}ms`,
        );
        break;
      }
      await this.delay(100);
    }

    if (!newLeader) {
      this.logger.error("Failed to elect new leader within timeout");
      return;
    }

    // Verify new term
    const newTerm = newLeader.node.getCurrentTerm();
    if (newTerm > originalTerm) {
      this.logger.success(
        `Term correctly incremented: ${originalTerm} → ${newTerm}`,
      );
    } else {
      this.logger.warn("Term did not increment as expected");
    }

    // Test new leader functionality
    this.logger.info("Testing new leader functionality...");
    const stateMachine = new CounterStateMachine("demo");
    await this.clusterManager.appendToLeader(
      stateMachine.createIncrementCommand(20, "new-leader-test"),
    );

    await this.delay(2000);

    // Restart original leader and verify it becomes follower
    this.logger.info(`Restarting original leader ${originalLeaderId}...`);
    await this.clusterManager.startNode(originalLeaderId);
    await this.delay(3000);

    const restartedNode = this.clusterManager.getNode(originalLeaderId);
    if (restartedNode) {
      const restartedState = restartedNode.node.getState();
      if (restartedState === "follower") {
        this.logger.success(
          "Original leader correctly became follower after restart",
        );
      } else {
        this.logger.warn(
          `Original leader state after restart: ${restartedState}`,
        );
      }
    }
  }

  private async demonstrateMajorityFailure(): Promise<void> {
    this.logger.step(4, "Majority Failure (Safety Preservation)");
    this.logger.info("Testing cluster behavior when majority of nodes fail...");

    const allNodes = this.clusterManager.getAllNodes();
    const majorityCount = Math.ceil(allNodes.length / 2);
    const nodesToStop = allNodes.slice(0, majorityCount);

    this.logger.info(
      `Stopping ${majorityCount} out of ${allNodes.length} nodes...`,
    );

    // Stop majority of nodes
    for (const nodeInfo of nodesToStop) {
      await this.clusterManager.stopNode(nodeInfo.nodeId);
      this.logger.info(`Stopped ${nodeInfo.nodeId}`);
      await this.delay(500);
    }

    // Verify no leader can be elected
    this.logger.info(
      "Verifying that no leader can be elected without majority...",
    );
    await this.delay(5000); // Wait for election attempts

    const leader = this.clusterManager.getLeader();
    if (!leader) {
      this.logger.success(
        "✅ Correctly prevented leader election without majority",
      );
    } else {
      this.logger.warn(`⚠️ Unexpected leader found: ${leader.nodeId}`);
    }

    // Try to submit command (should fail)
    try {
      const stateMachine = new CounterStateMachine("demo");
      await this.clusterManager.appendToLeader(
        stateMachine.createIncrementCommand(1, "majority-failure-test"),
      );
      this.logger.warn("Command unexpectedly succeeded without majority");
    } catch {
      this.logger.success("✅ Correctly rejected commands without majority");
    }

    // Restore majority
    this.logger.info("Restoring majority of nodes...");
    const nodesToRestart = nodesToStop.slice(
      0,
      Math.ceil(majorityCount / 2) + 1,
    );

    for (const nodeInfo of nodesToRestart) {
      await this.clusterManager.startNode(nodeInfo.nodeId);
      this.logger.info(`Restarted ${nodeInfo.nodeId}`);
      await this.delay(1000);
    }

    // Wait for leader election
    await this.clusterManager.waitForStability();

    const restoredLeader = this.clusterManager.getLeader();
    if (restoredLeader) {
      this.logger.success(
        `Cluster recovered with leader: ${restoredLeader.nodeId}`,
      );

      // Test functionality
      const stateMachine = new CounterStateMachine("demo");
      await this.clusterManager.appendToLeader(
        stateMachine.createIncrementCommand(50, "majority-restored-test"),
      );
      this.logger.success("Cluster functionality restored");
    }
  }

  private async demonstrateNetworkPartition(): Promise<void> {
    this.logger.step(5, "Network Partition (Split-Brain Prevention)");

    const allNodes = this.clusterManager.getAllNodes().map((n) => n.nodeId);
    const partition1 = allNodes.slice(0, 3); // Majority
    const partition2 = allNodes.slice(3); // Minority

    this.logger.info("Creating network partition:");
    this.logger.info(`  Majority partition: ${partition1.join(", ")}`);
    this.logger.info(`  Minority partition: ${partition2.join(", ")}`);

    // Create partition
    await this.clusterManager.simulateNetworkPartition(partition1, partition2);

    // Wait for partition effects
    await this.delay(5000);

    // Check that only majority partition has leader
    // const _activeNodes = partition1
    //   .map((id) => this.clusterManager.getNode(id))
    //   .filter((n) => n);
    const leader = this.clusterManager.getLeader();

    if (leader && partition1.includes(leader.nodeId)) {
      this.logger.success(
        `✅ Majority partition maintained leader: ${leader.nodeId}`,
      );

      // Test that majority partition can process commands
      const stateMachine = new CounterStateMachine("demo");
      try {
        await this.clusterManager.appendToLeader(
          stateMachine.createIncrementCommand(30, "partition-test"),
        );
        this.logger.success(
          "✅ Majority partition processing commands correctly",
        );
      } catch (_error) {
        this.logger.error(
          "Majority partition failed to process commands",
          undefined,
          _error,
        );
      }
    } else {
      this.logger.warn("Majority partition does not have leader");
    }

    // Heal partition
    this.logger.info("Healing network partition...");
    await this.clusterManager.healNetworkPartition(partition2);

    // Verify reunion
    await this.delay(5000);
    const reunifiedLeader = this.clusterManager.getLeader();
    const metrics = await this.clusterManager.getMetrics();

    if (reunifiedLeader && metrics.activeNodes === allNodes.length) {
      this.logger.success("✅ Cluster successfully reunified");
      await this.verifyDataConsistency();
    } else {
      this.logger.warn("Cluster reunification issues detected");
    }
  }

  private async demonstrateCascadingFailures(): Promise<void> {
    this.logger.step(6, "Cascading Failures");
    this.logger.info(
      "Testing cluster resilience to cascading node failures...",
    );

    const allNodes = this.clusterManager.getAllNodes();
    if (allNodes.length < 4) {
      this.logger.warn("Not enough nodes for cascading failure test");
      return;
    }

    // Fail nodes one by one rapidly
    const failureCount = Math.floor(allNodes.length / 2) - 1; // Keep majority
    this.logger.info(`Simulating ${failureCount} cascading failures...`);

    for (let i = 0; i < failureCount; i++) {
      const followers = this.clusterManager.getFollowers();
      if (followers.length > 0) {
        const nodeToFail = followers[0];
        this.logger.warn(
          `Cascading failure ${i + 1}: stopping ${nodeToFail.nodeId}`,
        );
        await this.clusterManager.stopNode(nodeToFail.nodeId);

        // Very short delay to simulate rapid failures
        await this.delay(500);

        // Check if cluster still has leader
        const leader = this.clusterManager.getLeader();
        if (leader) {
          this.logger.info(`Cluster still has leader: ${leader.nodeId}`);
        } else {
          this.logger.warn("Cluster lost leader during cascading failures");
        }
      }
    }

    // Test remaining cluster functionality
    this.logger.info("Testing remaining cluster functionality...");
    try {
      const stateMachine = new CounterStateMachine("demo");
      await this.clusterManager.appendToLeader(
        stateMachine.createIncrementCommand(40, "cascading-test"),
      );
      this.logger.success("✅ Cluster survived cascading failures");
    } catch (_error) {
      this.logger.error(
        "Cluster functionality compromised by cascading failures",
        undefined,
        _error,
      );
    }
  }

  private async demonstrateRecoveryScenarios(): Promise<void> {
    this.logger.step(7, "Recovery Scenarios");
    this.logger.info("Testing various recovery patterns...");

    // Get current failed nodes
    const allNodeIds = ["node-0", "node-1", "node-2", "node-3", "node-4"];
    const activeNodes = this.clusterManager.getAllNodes();
    const activeNodeIds = activeNodes.map((n) => n.nodeId);
    const failedNodeIds = allNodeIds.filter(
      (id) => !activeNodeIds.includes(id),
    );

    if (failedNodeIds.length === 0) {
      this.logger.info("No failed nodes to recover");
      return;
    }

    // Scenario 1: Sequential recovery
    this.logger.info("Scenario 1: Sequential node recovery");
    for (const nodeId of failedNodeIds) {
      this.logger.info(`Recovering ${nodeId}...`);
      try {
        await this.clusterManager.startNode(nodeId);
        await this.delay(2000);

        // Verify node recovery
        await this.verifyNodeRecovery(nodeId);
      } catch (_error) {
        this.logger.warn(`Failed to recover ${nodeId}`, undefined, _error);
      }
    }

    // Final consistency check
    this.logger.info("Final recovery verification...");
    await this.delay(3000);
    await this.verifyDataConsistency();

    const finalMetrics = await this.clusterManager.getMetrics();
    this.logger.success(
      `Recovery completed. Active nodes: ${finalMetrics.activeNodes}`,
    );
  }

  private async verifyNodeRecovery(nodeId: string): Promise<void> {
    const node = this.clusterManager.getNode(nodeId);
    if (!node) {
      this.logger.error(`Node ${nodeId} not found for recovery verification`);
      return;
    }

    // Check if node is running and has reasonable state
    const state = node.node.getState();
    const commitIndex = node.node.getCommitIndex();

    this.logger.info(
      `${nodeId} recovery status: ${state}, commit=${commitIndex}`,
    );

    // Wait a bit for catch-up
    await this.delay(2000);

    // Compare with leader state
    const leader = this.clusterManager.getLeader();
    if (leader && leader.nodeId !== nodeId) {
      const leaderCommitIndex = leader.node.getCommitIndex();
      const commitDifference = leaderCommitIndex - commitIndex;

      if (commitDifference <= 5) {
        // Allow small difference
        this.logger.success(
          `${nodeId} successfully caught up (commit difference: ${commitDifference})`,
        );
      } else {
        this.logger.warn(
          `${nodeId} may still be catching up (commit difference: ${commitDifference})`,
        );
      }
    }
  }

  private async verifyDataConsistency(): Promise<void> {
    const nodes = this.clusterManager.getAllNodes();
    if (nodes.length === 0) return;

    const states = nodes.map((nodeInfo) => {
      const stateMachine = nodeInfo.stateMachine as CounterStateMachine;
      const stateData = stateMachine.getState();
      return {
        ...stateData,
        nodeId: nodeInfo.nodeId,
      };
    });

    const firstState = states[0];
    const allConsistent = states.every(
      (state) =>
        state.value === firstState.value &&
        state.version === firstState.version,
    );

    if (allConsistent) {
      this.logger.success(
        `✅ All ${states.length} nodes are consistent (value=${firstState.value})`,
      );
    } else {
      this.logger.error("❌ Data consistency violation detected!");
      states.forEach((state) => {
        const isConsistent =
          state.value === firstState.value &&
          state.version === firstState.version;
        const marker = isConsistent ? "✅" : "❌";
        console.log(
          `  ${marker} ${state.nodeId}: value=${state.value}, version=${state.version}`,
        );
      });
    }
  }

  private async displayClusterStatus(): Promise<void> {
    const metrics = await this.clusterManager.getMetrics();

    console.log(chalk.cyan("\n📊 Cluster Status:"));
    console.log(`  Total Nodes: ${metrics.totalNodes}`);
    console.log(`  Active Nodes: ${metrics.activeNodes}`);
    console.log(`  Leader: ${chalk.green(metrics.leader || "None")}`);
    console.log(
      `  Followers: ${chalk.blue(metrics.followers.join(", ") || "None")}`,
    );
    console.log(`  Term: ${metrics.term}`);
    console.log(`  Commit Index: ${metrics.commitIndex}\n`);
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async cleanup(): Promise<void> {
    this.logger.info("Cleaning up failure scenarios demo...");
    await this.clusterManager.cleanup();
  }
}
