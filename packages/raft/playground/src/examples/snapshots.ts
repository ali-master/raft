import chalk from "chalk";
import { ClusterManager } from "../utils/cluster-manager.js";
import { PlaygroundLogger } from "../utils/logger.js";
import { CounterStateMachine } from "../state-machines/counter-state-machine.js";

export class SnapshotDemo {
  private logger = new PlaygroundLogger();
  private clusterManager = new ClusterManager("snapshot-demo");

  async run(): Promise<void> {
    this.logger.section("Snapshot and Log Compaction");

    try {
      // Setup cluster
      await this.setupCluster();

      // Scenario 1: Fill log to trigger snapshot
      await this.demonstrateSnapshotTrigger();

      // Scenario 2: Manual snapshot creation
      await this.demonstrateManualSnapshot();

      // Scenario 3: Snapshot installation on new nodes
      await this.demonstrateSnapshotInstallation();

      // Scenario 4: Recovery from snapshot
      await this.demonstrateSnapshotRecovery();

      this.logger.result(
        true,
        "All snapshot scenarios completed successfully!",
      );
    } catch (_error) {
      this.logger.error("Snapshot demo failed", undefined, _error);
      this.logger.result(false, "Snapshot demonstration failed");
    } finally {
      await this.cleanup();
    }
  }

  private async setupCluster(): Promise<void> {
    this.logger.step(1, "Setting up cluster with snapshot configuration");

    // Create cluster with lower snapshot threshold for demo
    await this.clusterManager.createCluster(3, "counter");

    await this.displayClusterStatus();
  }

  private async demonstrateSnapshotTrigger(): Promise<void> {
    this.logger.step(2, "Triggering Automatic Snapshot Creation");
    this.logger.info(
      "Submitting many operations to fill the log and trigger snapshot...",
    );

    const stateMachine = new CounterStateMachine("demo");
    const operationCount = 120; // Should exceed snapshot threshold

    this.logger.info(`Submitting ${operationCount} operations...`);

    // Submit many operations rapidly
    for (let i = 0; i < operationCount; i++) {
      try {
        const command =
          i % 3 === 0
            ? stateMachine.createIncrementCommand(1, `batch-${i}`)
            : i % 3 === 1
              ? stateMachine.createDecrementCommand(1, `batch-${i}`)
              : stateMachine.createIncrementCommand(2, `batch-${i}`);

        await this.clusterManager.appendToLeader(command);

        // Show progress every 20 operations
        if ((i + 1) % 20 === 0) {
          this.logger.progress(i + 1, operationCount, "Operations submitted");
        }

        // Small delay to avoid overwhelming
        if (i % 10 === 0) {
          await this.delay(50);
        }
      } catch (_error) {
        this.logger.error(`Failed to submit operation ${i}`, undefined, _error);
      }
    }

    this.logger.success("Batch operations completed");

    // Wait for potential snapshot creation
    this.logger.info("Waiting for potential snapshot creation...");
    await this.delay(5000);

    await this.checkSnapshotStatus();
  }

  private async demonstrateManualSnapshot(): Promise<void> {
    this.logger.step(3, "Manual Snapshot Creation");

    const leader = this.clusterManager.getLeader();
    if (!leader) {
      this.logger.error("No leader available for manual snapshot");
      return;
    }

    this.logger.info(
      `Triggering manual snapshot on leader ${leader.nodeId}...`,
    );

    try {
      // Get current state before snapshot
      const beforeCommitIndex = leader.node.getCommitIndex();
      const stateMachine = leader.stateMachine as CounterStateMachine;
      const beforeState = stateMachine.getState();

      this.logger.info(
        `State before snapshot: value=${beforeState.value}, commit=${beforeCommitIndex}`,
      );

      // Trigger snapshot creation (if method exists)
      if ("createSnapshot" in leader.node) {
        await (leader.node as any).createSnapshot();
        this.logger.success("Manual snapshot creation triggered");
      } else {
        this.logger.info(
          "Manual snapshot method not available, using state machine snapshot",
        );

        // Create snapshot through state machine
        const snapshotData = await stateMachine.getSnapshotData();
        this.logger.success(
          `State machine snapshot created (${snapshotData.length} bytes)`,
        );
      }

      await this.delay(2000);
      await this.checkSnapshotStatus();
    } catch (_error) {
      this.logger.error("Manual snapshot creation failed", undefined, _error);
    }
  }

  private async demonstrateSnapshotInstallation(): Promise<void> {
    this.logger.step(4, "Snapshot Installation on New Node");
    this.logger.info(
      "Adding a new node to demonstrate snapshot installation...",
    );

    // Get current cluster state
    const leader = this.clusterManager.getLeader();
    if (!leader) {
      this.logger.error("No leader available for snapshot installation demo");
      return;
    }

    const leaderStateMachine = leader.stateMachine as CounterStateMachine;
    const leaderState = leaderStateMachine.getState();
    const leaderCommitIndex = leader.node.getCommitIndex();

    this.logger.info(
      `Current cluster state: value=${leaderState.value}, commit=${leaderCommitIndex}`,
    );

    // Add new node
    const newNodeId = "snapshot-test-node";
    this.logger.info(`Adding new node ${newNodeId}...`);

    const newNode = await this.clusterManager.addNode(newNodeId, "counter");

    // Wait for the new node to catch up
    this.logger.info(
      "Waiting for new node to receive snapshot and catch up...",
    );
    await this.delay(5000);

    // Verify new node state
    const newNodeStateMachine = newNode.stateMachine as CounterStateMachine;
    const newNodeState = newNodeStateMachine.getState();
    const newNodeCommitIndex = newNode.node.getCommitIndex();

    this.logger.info(
      `New node state: value=${newNodeState.value}, commit=${newNodeCommitIndex}`,
    );

    // Check if states match
    if (
      newNodeState.value === leaderState.value &&
      newNodeCommitIndex >= leaderCommitIndex - 10
    ) {
      // Allow small difference
      this.logger.success(
        "New node successfully caught up via snapshot/log replication",
      );
    } else {
      this.logger.warn("New node may not be fully synchronized");
    }

    // Test that new node can participate in consensus
    this.logger.info("Testing new node participation in consensus...");
    const stateMachine = new CounterStateMachine("demo");
    await this.clusterManager.appendToLeader(
      stateMachine.createIncrementCommand(100, "new-node-test"),
    );

    await this.delay(2000);

    // Verify all nodes have the new operation
    await this.verifyAllNodesConsistent();
  }

  private async demonstrateSnapshotRecovery(): Promise<void> {
    this.logger.step(5, "Recovery from Snapshot");
    this.logger.info("Demonstrating node recovery using snapshots...");

    const followers = this.clusterManager.getFollowers();
    if (followers.length === 0) {
      this.logger.warn("No followers available for recovery demonstration");
      return;
    }

    const nodeToRestart = followers[0];
    this.logger.info(
      `Restarting node ${nodeToRestart.nodeId} to simulate recovery...`,
    );

    // Get state before restart
    const beforeStateMachine =
      nodeToRestart.stateMachine as CounterStateMachine;
    const beforeState = beforeStateMachine.getState();

    this.logger.info(
      `State before restart: value=${beforeState.value}, version=${beforeState.version}`,
    );

    // Restart the node
    await this.clusterManager.restartNode(nodeToRestart.nodeId);

    // Submit some operations while node is recovering
    this.logger.info("Submitting operations during node recovery...");
    const stateMachine = new CounterStateMachine("demo");
    const recoveryCommands = [
      stateMachine.createIncrementCommand(50, "recovery-1"),
      stateMachine.createDecrementCommand(20, "recovery-2"),
      stateMachine.createIncrementCommand(30, "recovery-3"),
    ];

    for (const command of recoveryCommands) {
      try {
        await this.clusterManager.appendToLeader(command);
        await this.delay(500);
      } catch (error) {
        this.logger.error(
          "Failed to submit recovery command",
          undefined,
          error,
        );
      }
    }

    // Wait for node to fully recover
    this.logger.info("Waiting for node recovery to complete...");
    await this.delay(5000);

    // Verify recovered node state
    const recoveredNode = this.clusterManager.getNode(nodeToRestart.nodeId);
    if (recoveredNode) {
      const afterStateMachine =
        recoveredNode.stateMachine as CounterStateMachine;
      const afterState = afterStateMachine.getState();

      this.logger.info(
        `State after recovery: value=${afterState.value}, version=${afterState.version}`,
      );

      if (afterState.version > beforeState.version) {
        this.logger.success(
          "Node successfully recovered and caught up with missed operations",
        );
      } else {
        this.logger.warn("Node recovery may not be complete");
      }
    }

    await this.verifyAllNodesConsistent();
  }

  private async checkSnapshotStatus(): Promise<void> {
    this.logger.info("\n📸 Snapshot Status Check:");

    const nodes = this.clusterManager.getAllNodes();

    for (const nodeInfo of nodes) {
      const commitIndex = nodeInfo.node.getCommitIndex();
      const lastApplied = nodeInfo.node.getLastApplied();

      // Try to get snapshot info if available
      let snapshotInfo = "N/A";
      try {
        if ("getSnapshotMetadata" in nodeInfo.node) {
          const metadata = (nodeInfo.node as any).getSnapshotMetadata();
          snapshotInfo = metadata
            ? `Index: ${metadata.lastIncludedIndex}`
            : "None";
        }
      } catch {
        // Method may not exist
      }

      console.log(
        chalk.blue(
          `  ${nodeInfo.nodeId}: commit=${commitIndex}, applied=${lastApplied}, snapshot=${snapshotInfo}`,
        ),
      );
    }
    console.log();
  }

  private async verifyAllNodesConsistent(): Promise<void> {
    this.logger.info("Verifying consistency across all nodes...");

    const nodes = this.clusterManager.getAllNodes();
    const states = nodes.map((nodeInfo) => {
      const stateMachine = nodeInfo.stateMachine as CounterStateMachine;
      const stateData = stateMachine.getState();
      return {
        ...stateData,
        nodeId: nodeInfo.nodeId,
      };
    });

    if (states.length === 0) return;

    const firstState = states[0];
    const allConsistent = states.every(
      (state) =>
        state.value === firstState.value &&
        state.version === firstState.version,
    );

    if (allConsistent) {
      this.logger.success(
        `All ${states.length} nodes are consistent (value=${firstState.value}, version=${firstState.version})`,
      );
    } else {
      this.logger.error("Node consistency check failed!");
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
    this.logger.info("Cleaning up snapshot demo...");
    await this.clusterManager.cleanup();
  }
}
