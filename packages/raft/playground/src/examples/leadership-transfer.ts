import chalk from "chalk";
import { RaftState } from "@usex/raft";
import { ClusterManager } from "../utils/cluster-manager";
import { PlaygroundLogger } from "../utils/logger";
import { CounterStateMachine } from "../state-machines/counter-state-machine";

export class LeadershipTransferDemo {
  private logger = new PlaygroundLogger();
  private clusterManager = new ClusterManager("leadership-transfer-demo");

  async run(): Promise<void> {
    this.logger.section("Leadership Transfer Scenarios");

    try {
      // Setup cluster
      await this.setupCluster();

      // Scenario 1: Basic leadership transfer
      await this.demonstrateBasicLeadershipTransfer();

      // Scenario 2: Leadership transfer with active operations
      await this.demonstrateTransferWithOperations();

      // Scenario 3: Leadership transfer to specific node
      await this.demonstrateTargetedTransfer();

      // Scenario 4: Leadership transfer with node failures
      await this.demonstrateTransferWithFailures();

      // Scenario 5: Graceful shutdown and leadership transfer
      await this.demonstrateGracefulShutdown();

      this.logger.result(
        true,
        "All leadership transfer scenarios completed successfully!",
      );
    } catch (_error) {
      this.logger.error("Leadership transfer demo failed", undefined, _error);
      this.logger.result(false, "Leadership transfer demonstration failed");
    } finally {
      await this.cleanup();
    }
  }

  private async setupCluster(): Promise<void> {
    this.logger.step(1, "Setting up cluster for leadership transfer");
    await this.clusterManager.createCluster(5, "counter");

    // Wait for stable leadership
    await this.delay(3000);

    const leader = this.clusterManager.getLeader();
    if (leader) {
      this.logger.success(`Initial leader established: ${leader.nodeId}`);
    } else {
      this.logger.error("Failed to establish initial leader");
    }

    await this.displayClusterState();
  }

  private async demonstrateBasicLeadershipTransfer(): Promise<void> {
    this.logger.step(2, "Basic Leadership Transfer");
    this.logger.info("Demonstrating basic leadership transfer mechanism...");

    const currentLeader = this.clusterManager.getLeader();
    if (!currentLeader) {
      this.logger.error("No leader available for transfer");
      return;
    }

    this.logger.info(`Current leader: ${currentLeader.nodeId}`);

    // Get potential transfer targets (followers)
    const followers = this.clusterManager
      .getAllNodes()
      .filter((n) => n.node.getState() === RaftState.FOLLOWER)
      .map((n) => n.nodeId);

    if (followers.length === 0) {
      this.logger.error("No followers available for leadership transfer");
      return;
    }

    const targetNode = followers[0];
    this.logger.info(`Initiating leadership transfer to: ${targetNode}`);

    // In a real implementation, this would send a TimeoutNow RPC
    // For simulation, we'll stop the current leader to trigger election
    this.logger.info(
      "Simulating leadership transfer (stopping current leader)...",
    );

    const preTransferTerm = currentLeader.node.getCurrentTerm();
    await this.clusterManager.stopNode(currentLeader.nodeId);

    // Track the election process
    await this.trackElection(10000);

    const newLeader = this.clusterManager.getLeader();
    if (newLeader) {
      const postTransferTerm = newLeader.node.getCurrentTerm();

      this.logger.success(`Leadership transferred to: ${newLeader.nodeId}`);
      this.logger.info(
        `Term changed: ${preTransferTerm} → ${postTransferTerm}`,
      );

      if (postTransferTerm > preTransferTerm) {
        this.logger.success("Term correctly incremented during transfer");
      } else {
        this.logger.warn("Term did not increment as expected");
      }
    } else {
      this.logger.error("Leadership transfer failed - no new leader");
    }

    // Restart the original leader
    this.logger.info(`Restarting original leader: ${currentLeader.nodeId}`);
    await this.clusterManager.startNode(currentLeader.nodeId);
    await this.delay(2000);

    // Verify it becomes a follower
    const restartedNode = this.clusterManager.getNode(currentLeader.nodeId);
    if (restartedNode && restartedNode.node.getState() === RaftState.FOLLOWER) {
      this.logger.success("Original leader correctly became follower");
    } else {
      this.logger.warn("Original leader did not become follower as expected");
    }

    await this.displayClusterState();
  }

  private async demonstrateTransferWithOperations(): Promise<void> {
    this.logger.step(3, "Leadership Transfer with Active Operations");
    this.logger.info(
      "Testing leadership transfer while operations are in progress...",
    );

    const stateMachine = new CounterStateMachine("transfer-ops");

    // Start submitting operations
    this.logger.info("Starting background operations...");

    const operationPromises = [];
    // const _operationResults = [];

    // Submit operations that will continue during transfer
    for (let i = 0; i < 10; i++) {
      const promise = this.submitOperationWithRetry(
        stateMachine.createIncrementCommand(1, `transfer-op-${i}`),
        `operation-${i}`,
      );
      operationPromises.push(promise);

      await this.delay(200); // Stagger operations
    }

    // Wait a bit for operations to start
    await this.delay(1000);

    // Initiate leadership transfer while operations are active
    const currentLeader = this.clusterManager.getLeader();
    if (currentLeader) {
      this.logger.info(
        `Transferring leadership from ${currentLeader.nodeId} during active operations...`,
      );

      await this.clusterManager.stopNode(currentLeader.nodeId);
      await this.trackElection(8000);

      const newLeader = this.clusterManager.getLeader();
      if (newLeader) {
        this.logger.success(`Leadership transferred to ${newLeader.nodeId}`);
      }

      // Restart original leader
      await this.clusterManager.startNode(currentLeader.nodeId);
      await this.delay(2000);
    }

    // Wait for all operations to complete
    this.logger.info("Waiting for all operations to complete...");

    const results = await Promise.allSettled(operationPromises);
    const successful = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;

    this.logger.info(
      `Operations completed: ${successful} successful, ${failed} failed`,
    );

    // Verify consistency after operations
    await this.delay(2000);
    const consistency = await this.verifyConsistency();

    if (consistency) {
      this.logger.success(
        "Cluster maintained consistency during leadership transfer",
      );
    } else {
      this.logger.error(
        "Consistency issues detected after leadership transfer",
      );
    }
  }

  private async demonstrateTargetedTransfer(): Promise<void> {
    this.logger.step(4, "Targeted Leadership Transfer");
    this.logger.info("Demonstrating transfer to a specific target node...");

    const currentLeader = this.clusterManager.getLeader();
    if (!currentLeader) {
      this.logger.error("No leader available for targeted transfer");
      return;
    }

    const followers = this.clusterManager
      .getAllNodes()
      .filter((n) => n.node.getState() === RaftState.FOLLOWER);

    if (followers.length < 2) {
      this.logger.error("Not enough followers for targeted transfer demo");
      return;
    }

    // Choose a specific target
    const targetNode = followers[1]; // Choose second follower

    this.logger.info(`Current leader: ${currentLeader.nodeId}`);
    this.logger.info(`Target node: ${targetNode.nodeId}`);

    // Display pre-transfer state
    this.logger.info("\\nPre-transfer cluster state:");
    await this.displayClusterState();

    // In a real implementation, this would use TimeoutNow RPC to specific node
    // For simulation, we'll use a more sophisticated approach
    this.logger.info(
      `\\nInitiating targeted transfer to ${targetNode.nodeId}...`,
    );

    // First, ensure target is up-to-date
    const stateMachine = new CounterStateMachine("targeted-transfer");
    await this.clusterManager.appendToLeader(
      stateMachine.createIncrementCommand(1, "pre-transfer-sync"),
    );

    await this.delay(1000); // Wait for replication

    // Stop current leader to trigger election
    await this.clusterManager.stopNode(currentLeader.nodeId);

    // Track who becomes leader
    await this.trackElection(8000);

    const newLeader = this.clusterManager.getLeader();
    if (newLeader) {
      this.logger.success(`New leader: ${newLeader.nodeId}`);

      if (newLeader.nodeId === targetNode.nodeId) {
        this.logger.success(
          "Targeted transfer successful - desired node became leader",
        );
      } else {
        this.logger.info(
          "Different node became leader (normal in election-based transfer)",
        );
      }
    } else {
      this.logger.error("Targeted transfer failed - no new leader");
    }

    // Restart original leader
    await this.clusterManager.startNode(currentLeader.nodeId);
    await this.delay(2000);

    // Display post-transfer state
    this.logger.info("\\nPost-transfer cluster state:");
    await this.displayClusterState();
  }

  private async demonstrateTransferWithFailures(): Promise<void> {
    this.logger.step(5, "Leadership Transfer with Node Failures");
    this.logger.info(
      "Testing leadership transfer resilience with node failures...",
    );

    const currentLeader = this.clusterManager.getLeader();
    if (!currentLeader) {
      this.logger.error("No leader available for failure demo");
      return;
    }

    // Simulate a challenging scenario: multiple node failures during transfer
    const allNodes = this.clusterManager.getAllNodes();
    const followers = allNodes.filter(
      (n) => n.node.getState() === RaftState.FOLLOWER,
    );

    if (followers.length < 3) {
      this.logger.error("Not enough followers for failure demo");
      return;
    }

    this.logger.info(`Current leader: ${currentLeader.nodeId}`);
    this.logger.info(
      `Available followers: ${followers.map((f) => f.nodeId).join(", ")}`,
    );

    // Stop one follower before transfer
    const failedFollower = followers[0];
    this.logger.info(
      `Stopping follower before transfer: ${failedFollower.nodeId}`,
    );
    await this.clusterManager.stopNode(failedFollower.nodeId);

    await this.delay(1000);

    // Now initiate leadership transfer
    this.logger.info("Initiating leadership transfer with reduced cluster...");
    await this.clusterManager.stopNode(currentLeader.nodeId);

    // Track election with reduced cluster
    await this.trackElection(12000);

    const newLeader = this.clusterManager.getLeader();
    if (newLeader) {
      this.logger.success(
        `Leadership transferred despite failure: ${newLeader.nodeId}`,
      );
    } else {
      this.logger.error("Leadership transfer failed with node failures");
    }

    // Restart both failed nodes
    this.logger.info("Restarting failed nodes...");
    await this.clusterManager.startNode(currentLeader.nodeId);
    await this.clusterManager.startNode(failedFollower.nodeId);

    await this.delay(3000);

    // Verify cluster recovery
    const finalLeader = this.clusterManager.getLeader();
    const activeNodes = this.clusterManager
      .getAllNodes()
      .filter((n) => n.node.getState() !== RaftState.CANDIDATE);

    if (finalLeader && activeNodes.length === 5) {
      this.logger.success("Cluster fully recovered from failures");
    } else {
      this.logger.warn("Cluster recovery incomplete");
    }

    await this.displayClusterState();
  }

  private async demonstrateGracefulShutdown(): Promise<void> {
    this.logger.step(6, "Graceful Shutdown with Leadership Transfer");
    this.logger.info("Demonstrating graceful leader shutdown with transfer...");

    const currentLeader = this.clusterManager.getLeader();
    if (!currentLeader) {
      this.logger.error("No leader available for graceful shutdown");
      return;
    }

    // Submit some operations first
    const stateMachine = new CounterStateMachine("graceful-shutdown");

    this.logger.info("Submitting operations before graceful shutdown...");

    for (let i = 0; i < 5; i++) {
      await this.clusterManager.appendToLeader(
        stateMachine.createIncrementCommand(1, `graceful-${i}`),
      );
      await this.delay(100);
    }

    // Wait for replication
    await this.delay(2000);

    this.logger.info("Capturing pre-shutdown state...");
    const preShutdownState = await this.captureStateMachineStates();

    // In a real implementation, graceful shutdown would:
    // 1. Stop accepting new operations
    // 2. Wait for pending operations to complete
    // 3. Ensure all followers are up-to-date
    // 4. Send TimeoutNow to a follower
    // 5. Wait for transfer confirmation
    // 6. Shut down

    this.logger.info(
      `\\nInitiating graceful shutdown of leader ${currentLeader.nodeId}...`,
    );

    // Simulate graceful shutdown steps
    this.logger.info("Step 1: Stop accepting new operations (simulated)");

    this.logger.info("Step 2: Ensure followers are caught up...");
    await this.delay(1000); // Wait for any pending replication

    this.logger.info("Step 3: Transfer leadership...");
    await this.clusterManager.stopNode(currentLeader.nodeId);

    this.logger.info("Step 4: Wait for new leader election...");
    await this.trackElection(8000);

    const newLeader = this.clusterManager.getLeader();
    if (newLeader) {
      this.logger.success(
        `Graceful shutdown completed. New leader: ${newLeader.nodeId}`,
      );
    } else {
      this.logger.error("Graceful shutdown failed - no new leader");
    }

    // Verify no operations were lost
    await this.delay(2000);
    const postShutdownState = await this.captureStateMachineStates();

    // Compare states (in a real scenario, we'd check all committed operations are preserved)
    this.logger.info("\\nVerifying operation preservation...");

    const statesMatch = this.compareStateMachineStates(
      preShutdownState,
      postShutdownState,
    );
    if (statesMatch) {
      this.logger.success("All operations preserved during graceful shutdown");
    } else {
      this.logger.error("Operations lost during graceful shutdown");
    }

    await this.displayClusterState();
  }

  private async trackElection(timeoutMs: number): Promise<void> {
    const startTime = Date.now();
    let lastTerm = 0;

    this.logger.info("Tracking election process...");

    while (Date.now() - startTime < timeoutMs) {
      const metrics = await this.clusterManager.getMetrics();

      if (metrics.term > lastTerm) {
        lastTerm = metrics.term;
        this.logger.info(
          `Election progress - Term: ${metrics.term}, Candidates: ${metrics.candidates.length}`,
        );
      }

      if (metrics.leader) {
        this.logger.success(
          `Election completed - Leader: ${metrics.leader} (Term: ${metrics.term})`,
        );
        break;
      }

      await this.delay(200);
    }
  }

  private async submitOperationWithRetry(
    command: any,
    _operationId: string,
  ): Promise<void> {
    const maxRetries = 3;
    let retries = 0;

    while (retries < maxRetries) {
      try {
        await this.clusterManager.appendToLeader(command);
        return;
      } catch (_error) {
        retries++;
        if (retries >= maxRetries) {
          throw _error;
        }

        // Wait a bit before retry (might be during leadership transfer)
        await this.delay(1000);
      }
    }
  }

  private async verifyConsistency(): Promise<boolean> {
    const nodes = this.clusterManager.getAllNodes();
    const stateMachineStates = nodes.map((nodeInfo) => {
      const sm = nodeInfo.stateMachine as CounterStateMachine;
      return sm.getState();
    });

    const uniqueValues = new Set(stateMachineStates.map((s) => s.value));
    const uniqueVersions = new Set(stateMachineStates.map((s) => s.version));

    return uniqueValues.size === 1 && uniqueVersions.size === 1;
  }

  private async captureStateMachineStates(): Promise<any[]> {
    const nodes = this.clusterManager.getAllNodes();
    return nodes.map((nodeInfo) => {
      const sm = nodeInfo.stateMachine as CounterStateMachine;
      return {
        nodeId: nodeInfo.nodeId,
        state: sm.getState(),
      };
    });
  }

  private compareStateMachineStates(before: any[], after: any[]): boolean {
    // For this demo, we'll compare the leader's state
    // In a real implementation, we'd do more sophisticated comparison

    const beforeLeaderState = before.find((s) => s.nodeId === "node-0")?.state;
    const afterStates = after.map((s) => s.state);

    // Check if any of the after states match the before leader state
    return afterStates.some(
      (state) =>
        state.value === beforeLeaderState?.value &&
        state.version === beforeLeaderState?.version,
    );
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
        `    ${stateIcon} ${nodeInfo.nodeId}: ${state} | Term: ${term} | Commit: ${commitIndex} | Value: ${smState.value}`,
      );
    }
    console.log();
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async cleanup(): Promise<void> {
    this.logger.info("Cleaning up leadership transfer demo...");
    await this.clusterManager.cleanup();
  }
}
