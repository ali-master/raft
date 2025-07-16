import chalk from "chalk";
import { ClusterManager } from "../utils/cluster-manager";
import { PlaygroundLogger } from "../utils/logger";
import { CounterStateMachine } from "../state-machines/counter-state-machine";

export class MembershipChangesShowcase {
  private logger = new PlaygroundLogger();
  private clusterManager = new ClusterManager("membership-showcase");

  async run(): Promise<void> {
    this.logger.section("Cluster Membership Changes");

    try {
      // Setup initial cluster
      await this.setupInitialCluster();

      // Scenario 1: Adding new nodes
      await this.demonstrateNodeAddition();

      // Scenario 2: Removing nodes
      await this.demonstrateNodeRemoval();

      // Scenario 3: Rolling replacement
      await this.demonstrateRollingReplacement();

      // Scenario 4: Bulk membership changes
      await this.demonstrateBulkChanges();

      this.logger.result(
        true,
        "All membership change scenarios completed successfully!",
      );
    } catch (_error) {
      this.logger.error(
        "Membership changes showcase failed",
        undefined,
        _error,
      );
      this.logger.result(false, "Membership changes demonstration failed");
    } finally {
      await this.cleanup();
    }
  }

  private async setupInitialCluster(): Promise<void> {
    this.logger.step(1, "Setting up initial 3-node cluster");
    await this.clusterManager.createCluster(3, "counter");

    await this.displayClusterTopology();
    await this.submitInitialData();
  }

  private async submitInitialData(): Promise<void> {
    this.logger.info("Submitting initial data to establish baseline...");

    const stateMachine = new CounterStateMachine("showcase");
    const commands = [
      stateMachine.createSetCommand(0, "baseline-init"),
      stateMachine.createIncrementCommand(10, "baseline-1"),
      stateMachine.createIncrementCommand(5, "baseline-2"),
    ];

    for (const command of commands) {
      await this.clusterManager.appendToLeader(command);
      await this.delay(500);
    }

    this.logger.success("Baseline data established");
    await this.verifyDataConsistency();
  }

  private async demonstrateNodeAddition(): Promise<void> {
    this.logger.step(2, "Adding New Nodes to Cluster");

    const originalMetrics = await this.clusterManager.getMetrics();
    this.logger.info(`Original cluster size: ${originalMetrics.totalNodes}`);

    // Add first new node
    this.logger.info("Adding node-3 to the cluster...");
    const newNode1 = await this.clusterManager.addNode("node-3", "counter");

    await this.delay(3000); // Wait for discovery and synchronization
    await this.displayClusterTopology();

    // Verify new node caught up
    await this.verifyNewNodeCatchUp(newNode1.nodeId);

    // Test cluster functionality with new member
    this.logger.info("Testing cluster functionality after adding node...");
    const stateMachine = new CounterStateMachine("showcase");
    await this.clusterManager.appendToLeader(
      stateMachine.createIncrementCommand(7, "after-add-1"),
    );

    await this.delay(2000);
    await this.verifyDataConsistency();

    // Add second new node
    this.logger.info("Adding node-4 to the cluster...");
    const newNode2 = await this.clusterManager.addNode("node-4", "counter");

    await this.delay(3000);

    const finalMetrics = await this.clusterManager.getMetrics();
    if (finalMetrics.totalNodes === originalMetrics.totalNodes + 2) {
      this.logger.success(
        `Successfully expanded cluster from ${originalMetrics.totalNodes} to ${finalMetrics.totalNodes} nodes`,
      );
    } else {
      this.logger.warn("Cluster size not as expected after additions");
    }

    await this.verifyNewNodeCatchUp(newNode2.nodeId);
  }

  private async demonstrateNodeRemoval(): Promise<void> {
    this.logger.step(3, "Removing Nodes from Cluster");

    const currentMetrics = await this.clusterManager.getMetrics();
    this.logger.info(`Current cluster size: ${currentMetrics.totalNodes}`);

    if (currentMetrics.totalNodes < 4) {
      this.logger.warn("Not enough nodes for removal demonstration");
      return;
    }

    // Test removing a follower first
    const followers = this.clusterManager.getFollowers();
    if (followers.length > 0) {
      const nodeToRemove = followers[0];
      this.logger.info(`Removing follower ${nodeToRemove.nodeId}...`);

      // Submit data before removal
      const stateMachine = new CounterStateMachine("showcase");
      await this.clusterManager.appendToLeader(
        stateMachine.createIncrementCommand(3, "before-removal"),
      );

      await this.clusterManager.removeNode(nodeToRemove.nodeId);
      await this.delay(2000);

      // Verify cluster still functions
      this.logger.info("Testing cluster functionality after node removal...");
      await this.clusterManager.appendToLeader(
        stateMachine.createIncrementCommand(5, "after-removal"),
      );

      await this.delay(2000);
      await this.verifyDataConsistency();

      const newMetrics = await this.clusterManager.getMetrics();
      this.logger.success(
        `Cluster size reduced to ${newMetrics.totalNodes} nodes`,
      );
    }

    await this.displayClusterTopology();
  }

  private async demonstrateRollingReplacement(): Promise<void> {
    this.logger.step(4, "Rolling Node Replacement");
    this.logger.info("Demonstrating safe node replacement strategy...");

    const currentNodes = this.clusterManager.getAllNodes();
    if (currentNodes.length < 3) {
      this.logger.warn("Not enough nodes for rolling replacement");
      return;
    }

    // Pick a node to replace (not the leader)
    const followers = this.clusterManager.getFollowers();
    if (followers.length === 0) {
      this.logger.warn("No followers available for replacement");
      return;
    }

    const nodeToReplace = followers[0];
    const replacementNodeId = `${nodeToReplace.nodeId}-replacement`;

    this.logger.info(
      `Replacing ${nodeToReplace.nodeId} with ${replacementNodeId}...`,
    );

    // Step 1: Add replacement node
    this.logger.info("Step 1: Adding replacement node...");
    await this.clusterManager.addNode(replacementNodeId, "counter");
    await this.delay(3000);

    // Step 2: Verify replacement node is caught up
    await this.verifyNewNodeCatchUp(replacementNodeId);

    // Step 3: Remove old node
    this.logger.info("Step 2: Removing old node...");
    await this.clusterManager.removeNode(nodeToReplace.nodeId);
    await this.delay(2000);

    // Step 4: Verify cluster health
    this.logger.info("Step 3: Verifying cluster health after replacement...");
    const stateMachine = new CounterStateMachine("showcase");
    await this.clusterManager.appendToLeader(
      stateMachine.createIncrementCommand(8, "rolling-replacement-test"),
    );

    await this.delay(2000);
    await this.verifyDataConsistency();

    this.logger.success(
      `Successfully replaced ${nodeToReplace.nodeId} with ${replacementNodeId}`,
    );
  }

  private async demonstrateBulkChanges(): Promise<void> {
    this.logger.step(5, "Bulk Membership Changes");
    this.logger.info("Demonstrating safe bulk cluster reconfiguration...");

    const currentMetrics = await this.clusterManager.getMetrics();
    this.logger.info(`Starting with ${currentMetrics.totalNodes} nodes`);

    // Scenario: Scale cluster down to 3 nodes, then back up to 5
    const targetSize = 3;
    const finalSize = 5;

    // Scale down phase
    this.logger.info(`Phase 1: Scaling down to ${targetSize} nodes...`);
    const currentNodes = this.clusterManager.getAllNodes();

    while (currentNodes.length > targetSize) {
      const followers = this.clusterManager.getFollowers();
      if (followers.length > 0) {
        const nodeToRemove = followers[0];
        this.logger.info(`Removing ${nodeToRemove.nodeId}...`);
        await this.clusterManager.removeNode(nodeToRemove.nodeId);
        await this.delay(2000);

        // Update current nodes list
        currentNodes.splice(
          currentNodes.findIndex((n) => n.nodeId === nodeToRemove.nodeId),
          1,
        );
      } else {
        break;
      }
    }

    // Verify cluster health at minimum size
    this.logger.info("Verifying cluster health at reduced size...");
    const stateMachine = new CounterStateMachine("showcase");
    await this.clusterManager.appendToLeader(
      stateMachine.createIncrementCommand(12, "bulk-scale-down-test"),
    );
    await this.delay(2000);

    // Scale up phase
    this.logger.info(`Phase 2: Scaling up to ${finalSize} nodes...`);
    const currentSize = this.clusterManager.getAllNodes().length;

    for (let i = currentSize; i < finalSize; i++) {
      const newNodeId = `bulk-node-${i}`;
      this.logger.info(`Adding ${newNodeId}...`);
      await this.clusterManager.addNode(newNodeId, "counter");
      await this.delay(2000);
    }

    // Final verification
    await this.delay(3000);
    const finalMetrics = await this.clusterManager.getMetrics();

    this.logger.info("Final bulk changes verification...");
    await this.clusterManager.appendToLeader(
      stateMachine.createIncrementCommand(15, "bulk-final-test"),
    );
    await this.delay(2000);
    await this.verifyDataConsistency();

    this.logger.success(
      `Bulk reconfiguration completed. Final cluster size: ${finalMetrics.totalNodes}`,
    );
    await this.displayClusterTopology();
  }

  private async verifyNewNodeCatchUp(nodeId: string): Promise<void> {
    this.logger.info(`Verifying ${nodeId} has caught up with cluster state...`);

    const newNode = this.clusterManager.getNode(nodeId);
    if (!newNode) {
      this.logger.error(`Node ${nodeId} not found`);
      return;
    }

    // Wait a bit for catch-up
    await this.delay(2000);

    const leader = this.clusterManager.getLeader();
    if (!leader) {
      this.logger.warn("No leader available for catch-up verification");
      return;
    }

    const leaderCommitIndex = leader.node.getCommitIndex();
    const newNodeCommitIndex = newNode.node.getCommitIndex();

    if (newNodeCommitIndex >= leaderCommitIndex) {
      this.logger.success(
        `${nodeId} successfully caught up (commit index: ${newNodeCommitIndex})`,
      );
    } else {
      this.logger.warn(
        `${nodeId} may not be fully caught up (${newNodeCommitIndex} vs ${leaderCommitIndex})`,
      );
    }

    // Verify state machine consistency
    const leaderStateMachine = leader.stateMachine as CounterStateMachine;
    const newNodeStateMachine = newNode.stateMachine as CounterStateMachine;

    const leaderState = leaderStateMachine.getState();
    const newNodeState = newNodeStateMachine.getState();

    if (
      leaderState.value === newNodeState.value &&
      leaderState.version === newNodeState.version
    ) {
      this.logger.success(`${nodeId} state machine is synchronized`);
    } else {
      this.logger.warn(
        `${nodeId} state machine not synchronized (${newNodeState.value}/${newNodeState.version} vs ${leaderState.value}/${leaderState.version})`,
      );
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
        `All ${states.length} nodes are consistent (value=${firstState.value})`,
      );
    } else {
      this.logger.error("Data consistency check failed!");
      states.forEach((state) => {
        this.logger.warn(
          `${state.nodeId}: value=${state.value}, version=${state.version}`,
        );
      });
    }
  }

  private async displayClusterTopology(): Promise<void> {
    const metrics = await this.clusterManager.getMetrics();
    const nodes = this.clusterManager.getAllNodes();

    console.log(chalk.cyan("\n🌐 Cluster Topology:"));
    console.log(`  Total Nodes: ${metrics.totalNodes}`);
    console.log(`  Leader: ${chalk.green(metrics.leader || "None")}`);
    console.log(
      `  Followers: ${chalk.blue(metrics.followers.join(", ") || "None")}`,
    );
    console.log(`  Term: ${metrics.term}`);

    console.log("\n📍 Node Details:");
    nodes.forEach((nodeInfo) => {
      const state = nodeInfo.node.getState();
      const commitIndex = nodeInfo.node.getCommitIndex();
      const icon =
        state === "leader" ? "👑" : state === "candidate" ? "🗳️" : "👤";
      console.log(
        `  ${icon} ${nodeInfo.nodeId} (${state}) - Commit: ${commitIndex}`,
      );
    });
    console.log();
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async cleanup(): Promise<void> {
    this.logger.info("Cleaning up membership changes showcase...");
    await this.clusterManager.cleanup();
  }
}
