import chalk from "chalk";
import { RaftState } from "@usex/raft";
import { ClusterManager } from "../utils/cluster-manager";
import { PlaygroundLogger } from "../utils/logger";
import { CounterStateMachine } from "../state-machines/counter-state-machine";

export class RecoveryDemo {
  private logger = new PlaygroundLogger();
  private clusterManager = new ClusterManager("recovery-demo");

  async run(): Promise<void> {
    this.logger.section("Recovery and Disaster Scenarios");

    try {
      // Setup cluster
      await this.setupCluster();

      // Scenario 1: Single node recovery
      await this.demonstrateSingleNodeRecovery();

      // Scenario 2: Multiple node failures and recovery
      await this.demonstrateMultipleNodeRecovery();

      // Scenario 3: Catastrophic failure recovery
      await this.demonstrateCatastrophicRecovery();

      // Scenario 4: Rolling restart recovery
      await this.demonstrateRollingRestartRecovery();

      // Scenario 5: Data corruption recovery
      await this.demonstrateDataCorruptionRecovery();

      this.logger.result(
        true,
        "All recovery scenarios completed successfully!",
      );
    } catch (_error) {
      this.logger.error("Recovery demo failed", undefined, _error);
      this.logger.result(false, "Recovery demonstration failed");
    } finally {
      await this.cleanup();
    }
  }

  private async setupCluster(): Promise<void> {
    this.logger.step(1, "Setting up cluster for recovery scenarios");
    await this.clusterManager.createCluster(5, "counter");

    // Wait for stability
    await this.delay(3000);

    // Initialize with some data
    const stateMachine = new CounterStateMachine("recovery-init");

    this.logger.info("Initializing cluster with baseline data...");

    for (let i = 0; i < 10; i++) {
      await this.clusterManager.appendToLeader(
        stateMachine.createIncrementCommand(1, `init-${i}`),
      );
    }

    await this.delay(2000);

    const leader = this.clusterManager.getLeader();
    if (leader) {
      this.logger.success(`Cluster initialized with leader: ${leader.nodeId}`);
    } else {
      this.logger.error("Failed to initialize cluster");
    }

    await this.displayClusterState();
  }

  private async demonstrateSingleNodeRecovery(): Promise<void> {
    this.logger.step(2, "Single Node Recovery");
    this.logger.info("Testing single node failure and recovery...");

    // Capture initial state
    // const _initialState = await this.captureClusterState();

    // Pick a follower to fail
    const followers = this.clusterManager
      .getAllNodes()
      .filter((n) => n.node.getState() === RaftState.FOLLOWER);

    if (followers.length === 0) {
      this.logger.error("No followers available for failure test");
      return;
    }

    const failedNode = followers[0];

    this.logger.info(`Failing node: ${failedNode.nodeId}`);
    await this.clusterManager.stopNode(failedNode.nodeId);

    // Submit operations while node is down
    this.logger.info("Submitting operations while node is down...");

    const stateMachine = new CounterStateMachine("single-recovery");

    for (let i = 0; i < 5; i++) {
      await this.clusterManager.appendToLeader(
        stateMachine.createIncrementCommand(1, `while-down-${i}`),
      );
      await this.delay(200);
    }

    // Capture state before recovery
    // const _beforeRecoveryState = await this.captureClusterState();

    // Restart the failed node
    this.logger.info(`Restarting failed node: ${failedNode.nodeId}`);
    await this.clusterManager.startNode(failedNode.nodeId);

    // Wait for recovery
    await this.delay(3000);

    // Verify recovery
    // const _afterRecoveryState = await this.captureClusterState();

    const recoveredNode = this.clusterManager.getNode(failedNode.nodeId);
    if (recoveredNode && recoveredNode.node.getState() === RaftState.FOLLOWER) {
      this.logger.success(
        `Node ${failedNode.nodeId} successfully recovered as follower`,
      );
    } else {
      this.logger.error(`Node ${failedNode.nodeId} failed to recover properly`);
    }

    // Verify consistency
    const consistency = await this.verifyConsistency();
    if (consistency) {
      this.logger.success(
        "Cluster consistency maintained after single node recovery",
      );
    } else {
      this.logger.error("Consistency issues after single node recovery");
    }

    // Test operations after recovery
    this.logger.info("Testing operations after recovery...");

    for (let i = 0; i < 3; i++) {
      await this.clusterManager.appendToLeader(
        stateMachine.createIncrementCommand(1, `after-recovery-${i}`),
      );
      await this.delay(200);
    }

    await this.delay(2000);

    const finalConsistency = await this.verifyConsistency();
    if (finalConsistency) {
      this.logger.success("Operations successful after node recovery");
    } else {
      this.logger.error("Issues with operations after node recovery");
    }
  }

  private async demonstrateMultipleNodeRecovery(): Promise<void> {
    this.logger.step(3, "Multiple Node Recovery");
    this.logger.info(
      "Testing multiple simultaneous node failures and recovery...",
    );

    // Fail multiple nodes (but not majority)
    const allNodes = this.clusterManager.getAllNodes();
    const nodesToFail = allNodes.slice(0, 2); // Fail 2 out of 5 nodes

    this.logger.info(
      `Failing nodes: ${nodesToFail.map((n) => n.nodeId).join(", ")}`,
    );

    // Stop multiple nodes
    for (const node of nodesToFail) {
      await this.clusterManager.stopNode(node.nodeId);
      await this.delay(500);
    }

    // Verify cluster can still operate
    await this.delay(2000);

    const leader = this.clusterManager.getLeader();
    if (leader) {
      this.logger.success(
        `Cluster maintains leader ${leader.nodeId} with ${nodesToFail.length} nodes down`,
      );
    } else {
      this.logger.error("Cluster lost leadership with multiple node failures");
    }

    // Submit operations with reduced cluster
    this.logger.info("Testing operations with reduced cluster...");

    const stateMachine = new CounterStateMachine("multiple-recovery");

    for (let i = 0; i < 5; i++) {
      try {
        await this.clusterManager.appendToLeader(
          stateMachine.createIncrementCommand(1, `reduced-cluster-${i}`),
        );
        this.logger.info(`Operation ${i} successful with reduced cluster`);
      } catch (_error) {
        this.logger.error(
          `Operation ${i} failed with reduced cluster`,
          undefined,
          _error,
        );
      }
      await this.delay(300);
    }

    // Restart nodes one by one
    this.logger.info("Restarting failed nodes one by one...");

    for (let i = 0; i < nodesToFail.length; i++) {
      const node = nodesToFail[i];

      this.logger.info(
        `Restarting node ${i + 1}/${nodesToFail.length}: ${node.nodeId}`,
      );
      await this.clusterManager.startNode(node.nodeId);

      await this.delay(3000); // Wait for recovery

      // Check recovery status
      const recoveredNode = this.clusterManager.getNode(node.nodeId);
      if (recoveredNode) {
        this.logger.success(
          `Node ${node.nodeId} recovered with state: ${recoveredNode.node.getState()}`,
        );
      } else {
        this.logger.error(`Node ${node.nodeId} failed to recover`);
      }
    }

    // Final verification
    await this.delay(3000);

    const finalConsistency = await this.verifyConsistency();
    if (finalConsistency) {
      this.logger.success("All nodes recovered and cluster is consistent");
    } else {
      this.logger.error("Consistency issues after multiple node recovery");
    }

    await this.displayClusterState();
  }

  private async demonstrateCatastrophicRecovery(): Promise<void> {
    this.logger.step(4, "Catastrophic Failure Recovery");
    this.logger.info(
      "Testing recovery from catastrophic failure (majority of nodes down)...",
    );

    // Save current state for reference
    // const _preFailureState = await this.captureClusterState();

    // Fail majority of nodes (3 out of 5)
    const allNodes = this.clusterManager.getAllNodes();
    const nodesToFail = allNodes.slice(0, 3); // Fail 3 out of 5 nodes

    this.logger.info(
      `Simulating catastrophic failure - failing ${nodesToFail.length} nodes:`,
    );
    for (const node of nodesToFail) {
      console.log(`  ${node.nodeId}`);
    }

    // Stop majority of nodes
    for (const node of nodesToFail) {
      await this.clusterManager.stopNode(node.nodeId);
      await this.delay(500);
    }

    // Verify cluster cannot operate
    await this.delay(5000);

    const leaderAfterFailure = this.clusterManager.getLeader();
    if (!leaderAfterFailure) {
      this.logger.success(
        "Cluster correctly unable to elect leader without majority",
      );
    } else {
      this.logger.warn("Unexpected leader election without majority");
    }

    // Attempt operations (should fail)
    this.logger.info("Testing operations during catastrophic failure...");

    const stateMachine = new CounterStateMachine("catastrophic-recovery");

    try {
      await this.clusterManager.appendToLeader(
        stateMachine.createIncrementCommand(1, "catastrophic-test"),
      );
      this.logger.warn(
        "Unexpected successful operation during catastrophic failure",
      );
    } catch {
      this.logger.success(
        "Operations correctly failed during catastrophic failure",
      );
    }

    // Begin recovery process
    this.logger.info("\\nBeginning catastrophic recovery process...");

    // Restart nodes one by one to restore majority
    const recoveryOrder = [...nodesToFail];

    for (let i = 0; i < recoveryOrder.length; i++) {
      const node = recoveryOrder[i];

      this.logger.info(
        `Restarting node ${i + 1}/${recoveryOrder.length}: ${node.nodeId}`,
      );
      await this.clusterManager.startNode(node.nodeId);

      await this.delay(4000); // Wait for recovery

      // Check if we've restored majority
      const activeNodes = this.clusterManager
        .getAllNodes()
        .filter((n) => n.node.getState() !== RaftState.CANDIDATE).length;

      this.logger.info(`Active nodes after restart: ${activeNodes}/5`);

      if (activeNodes >= 3) {
        const newLeader = this.clusterManager.getLeader();
        if (newLeader) {
          this.logger.success(
            `Majority restored! New leader: ${newLeader.nodeId}`,
          );
          break;
        }
      }
    }

    // Test operations after recovery
    this.logger.info("\\nTesting operations after catastrophic recovery...");

    for (let i = 0; i < 3; i++) {
      try {
        await this.clusterManager.appendToLeader(
          stateMachine.createIncrementCommand(1, `post-catastrophic-${i}`),
        );
        this.logger.success(`Post-recovery operation ${i} successful`);
      } catch (_error) {
        this.logger.error(
          `Post-recovery operation ${i} failed`,
          undefined,
          _error,
        );
      }
      await this.delay(500);
    }

    // Verify final consistency
    await this.delay(3000);

    const finalConsistency = await this.verifyConsistency();
    if (finalConsistency) {
      this.logger.success("Cluster recovered from catastrophic failure");
    } else {
      this.logger.error(
        "Consistency issues remain after catastrophic recovery",
      );
    }

    await this.displayClusterState();
  }

  private async demonstrateRollingRestartRecovery(): Promise<void> {
    this.logger.step(5, "Rolling Restart Recovery");
    this.logger.info(
      "Testing rolling restart recovery (maintenance scenario)...",
    );

    const allNodes = this.clusterManager.getAllNodes();

    // Perform rolling restart (one node at a time)
    for (let i = 0; i < allNodes.length; i++) {
      const node = allNodes[i];

      this.logger.info(
        `Rolling restart ${i + 1}/${allNodes.length}: ${node.nodeId}`,
      );

      // Stop node
      await this.clusterManager.stopNode(node.nodeId);

      // Wait a bit (simulating maintenance)
      await this.delay(2000);

      // Test cluster operation without this node
      const stateMachine = new CounterStateMachine("rolling-restart");

      try {
        await this.clusterManager.appendToLeader(
          stateMachine.createIncrementCommand(1, `rolling-${i}`),
        );
        this.logger.success(
          `Operations successful during ${node.nodeId} restart`,
        );
      } catch (_error) {
        this.logger.error(
          `Operations failed during ${node.nodeId} restart`,
          undefined,
          _error,
        );
      }

      // Restart node
      await this.clusterManager.startNode(node.nodeId);

      // Wait for recovery
      await this.delay(3000);

      // Verify node rejoined properly
      const recoveredNode = this.clusterManager.getNode(node.nodeId);
      if (recoveredNode) {
        this.logger.success(
          `${node.nodeId} recovered with state: ${recoveredNode.node.getState()}`,
        );
      } else {
        this.logger.error(`${node.nodeId} failed to recover`);
      }
    }

    // Final verification
    await this.delay(3000);

    const finalConsistency = await this.verifyConsistency();
    if (finalConsistency) {
      this.logger.success("Rolling restart completed successfully");
    } else {
      this.logger.error("Consistency issues after rolling restart");
    }

    await this.displayClusterState();
  }

  private async demonstrateDataCorruptionRecovery(): Promise<void> {
    this.logger.step(6, "Data Corruption Recovery");
    this.logger.info("Testing recovery from simulated data corruption...");

    // This is a conceptual demonstration since we can't easily corrupt data
    // In a real scenario, this would involve:
    // 1. Detecting corruption
    // 2. Isolating corrupt node
    // 3. Rebuilding from clean nodes
    // 4. Reintegrating repaired node

    this.logger.info("Simulating data corruption scenario...");

    // Pick a node to simulate corruption
    const followers = this.clusterManager
      .getAllNodes()
      .filter((n) => n.node.getState() === RaftState.FOLLOWER);

    if (followers.length === 0) {
      this.logger.error("No followers available for corruption simulation");
      return;
    }

    const corruptedNode = followers[0];

    this.logger.info(`Simulating corruption on node: ${corruptedNode.nodeId}`);

    // In a real scenario, corruption would be detected through:
    // - Checksum mismatches
    // - Log inconsistencies
    // - State machine divergence

    // Step 1: Isolate corrupted node
    this.logger.info("Step 1: Isolating corrupted node...");
    await this.clusterManager.stopNode(corruptedNode.nodeId);

    // Step 2: Verify cluster continues to operate
    await this.delay(2000);

    const leader = this.clusterManager.getLeader();
    if (leader) {
      this.logger.success(
        "Cluster continues to operate after isolating corrupted node",
      );
    } else {
      this.logger.error("Cluster failed after isolating corrupted node");
    }

    // Step 3: Submit operations to establish clean state
    this.logger.info("Step 3: Establishing clean state...");

    const stateMachine = new CounterStateMachine("corruption-recovery");

    for (let i = 0; i < 5; i++) {
      await this.clusterManager.appendToLeader(
        stateMachine.createIncrementCommand(1, `clean-state-${i}`),
      );
      await this.delay(200);
    }

    // Step 4: Simulate data repair and node reintegration
    this.logger.info("Step 4: Repairing and reintegrating node...");

    // In a real scenario, this would involve:
    // - Wiping corrupted data
    // - Restoring from snapshots
    // - Replaying logs from clean nodes

    await this.clusterManager.startNode(corruptedNode.nodeId);

    // Wait for reintegration
    await this.delay(5000);

    // Step 5: Verify recovery
    const recoveredNode = this.clusterManager.getNode(corruptedNode.nodeId);
    if (recoveredNode) {
      this.logger.success(
        `Corrupted node ${corruptedNode.nodeId} reintegrated with state: ${recoveredNode.node.getState()}`,
      );
    } else {
      this.logger.error(
        `Failed to reintegrate corrupted node ${corruptedNode.nodeId}`,
      );
    }

    // Step 6: Verify data consistency
    await this.delay(2000);

    const consistency = await this.verifyConsistency();
    if (consistency) {
      this.logger.success(
        "Data consistency restored after corruption recovery",
      );
    } else {
      this.logger.error("Consistency issues remain after corruption recovery");
    }

    // Step 7: Test normal operations
    this.logger.info("Step 7: Testing normal operations after recovery...");

    for (let i = 0; i < 3; i++) {
      await this.clusterManager.appendToLeader(
        stateMachine.createIncrementCommand(1, `post-corruption-${i}`),
      );
      await this.delay(300);
    }

    const finalConsistency = await this.verifyConsistency();
    if (finalConsistency) {
      this.logger.success(
        "Normal operations successful after corruption recovery",
      );
    } else {
      this.logger.error(
        "Issues with normal operations after corruption recovery",
      );
    }

    await this.displayClusterState();
  }

  // private async captureClusterState(): Promise<any> {
  //   const nodes = this.clusterManager.getAllNodes();
  //   const metrics = await this.clusterManager.getMetrics();

  //   return {
  //     leader: metrics.leader,
  //     term: metrics.term,
  //     timestamp: Date.now(),
  //     nodes: nodes.map((nodeInfo) => ({
  //       nodeId: nodeInfo.nodeId,
  //       state: nodeInfo.node.getState(),
  //       term: nodeInfo.node.getCurrentTerm(),
  //       commitIndex: nodeInfo.node.getCommitIndex(),
  //       lastApplied: nodeInfo.node.getLastApplied(),
  //       stateMachineState: (
  //         nodeInfo.stateMachine as CounterStateMachine
  //       ).getState(),
  //     })),
  //   };
  // }

  private async verifyConsistency(): Promise<boolean> {
    const nodes = this.clusterManager.getAllNodes();
    const stateMachineStates = nodes.map((nodeInfo) => {
      const sm = nodeInfo.stateMachine as CounterStateMachine;
      return sm.getState();
    });

    const uniqueValues = new Set(stateMachineStates.map((s) => s.value));
    const uniqueVersions = new Set(stateMachineStates.map((s) => s.version));

    const isConsistent = uniqueValues.size === 1 && uniqueVersions.size === 1;

    if (!isConsistent) {
      this.logger.info("\\n🔍 Consistency Check (Issues Found):");
      for (const state of stateMachineStates) {
        console.log(
          `  ${state.nodeId}: Value=${state.value}, Version=${state.version}`,
        );
      }
    }

    return isConsistent;
  }

  private async displayClusterState(): Promise<void> {
    const nodes = this.clusterManager.getAllNodes();
    const metrics = await this.clusterManager.getMetrics();

    console.log(chalk.cyan("\\n  📊 Cluster State:"));
    console.log(`    Leader: ${metrics.leader || "None"}`);
    console.log(`    Term: ${metrics.term}`);
    console.log(`    Active Nodes: ${nodes.length}`);

    console.log(chalk.cyan("  📋 Node Details:"));
    for (const nodeInfo of nodes) {
      const state = nodeInfo.node.getState();
      const term = nodeInfo.node.getCurrentTerm();
      const commitIndex = nodeInfo.node.getCommitIndex();
      const lastApplied = nodeInfo.node.getLastApplied();
      const sm = nodeInfo.stateMachine as CounterStateMachine;
      const smState = sm.getState();

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
        `    ${stateIcon} ${nodeInfo.nodeId}: ${state} | Term: ${term} | Commit: ${commitIndex} | Applied: ${lastApplied} | Value: ${smState.value}`,
      );
    }
    console.log();
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async cleanup(): Promise<void> {
    this.logger.info("Cleaning up recovery scenarios demo...");
    await this.clusterManager.cleanup();
  }
}
