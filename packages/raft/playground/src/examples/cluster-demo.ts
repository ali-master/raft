import chalk from "chalk";
import { ClusterManager } from "../utils/cluster-manager";
import { PlaygroundLogger } from "../utils/logger";
import { CounterStateMachine } from "../state-machines/counter-state-machine";

export class ClusterDemo {
  private logger = new PlaygroundLogger();
  private clusterManager = new ClusterManager("cluster-demo");

  async run(): Promise<void> {
    this.logger.section("Basic Raft Cluster Demonstration");

    try {
      // Step 1: Create a 3-node cluster
      this.logger.step(1, "Creating a 3-node Raft cluster");
      await this.clusterManager.createCluster(3, "counter");

      await this.displayClusterStatus();

      // Step 2: Submit some commands
      this.logger.step(2, "Submitting commands to the cluster");
      await this.demonstrateBasicOperations();

      // Step 3: Show state machine synchronization
      this.logger.step(3, "Verifying state machine synchronization");
      await this.verifyStateMachineSync();

      // Step 4: Demonstrate leader failure and recovery
      this.logger.step(4, "Demonstrating leader failure and recovery");
      await this.demonstrateLeaderFailure();

      this.logger.result(
        true,
        "Basic cluster demonstration completed successfully!",
      );
    } catch (_error) {
      this.logger.error("Cluster demo failed", undefined, _error);
      this.logger.result(false, "Cluster demonstration failed");
    } finally {
      await this.cleanup();
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
    console.log(
      `  Candidates: ${chalk.yellow(metrics.candidates.join(", ") || "None")}`,
    );
    console.log(`  Current Term: ${metrics.term}`);
    console.log(`  Commit Index: ${metrics.commitIndex}\n`);
  }

  private async demonstrateBasicOperations(): Promise<void> {
    this.logger.info("Performing counter operations...");

    // Create some commands
    const stateMachine = new CounterStateMachine("demo");
    const commands = [
      stateMachine.createIncrementCommand(5, "client-1"),
      stateMachine.createIncrementCommand(3, "client-2"),
      stateMachine.createDecrementCommand(2, "client-3"),
      stateMachine.createSetCommand(10, "client-4"),
    ];

    // Submit commands to leader
    for (let i = 0; i < commands.length; i++) {
      try {
        await this.clusterManager.appendToLeader(commands[i]);
        this.logger.success(`Command ${i + 1} submitted: ${commands[i]!.type}`);

        // Wait for replication
        await this.delay(500);
      } catch (_error) {
        this.logger.error(
          `Failed to submit command ${i + 1}`,
          undefined,
          _error,
        );
      }
    }

    // Wait for all commands to be applied
    await this.delay(2000);
  }

  private async verifyStateMachineSync(): Promise<void> {
    this.logger.info("Checking state machine synchronization...");

    const nodes = this.clusterManager.getAllNodes();
    const states: Array<{ nodeId: string; value: number; version: number }> =
      [];

    for (const nodeInfo of nodes) {
      const stateMachine = nodeInfo.stateMachine as CounterStateMachine;
      const state = stateMachine.getState();
      states.push(state);

      console.log(
        chalk.blue(
          `  ${state.nodeId}: value=${state.value}, version=${state.version}`,
        ),
      );
    }

    // Check if all nodes have the same state
    const firstState = states[0];
    const allSynced = states.every(
      (state) =>
        state.value === firstState.value &&
        state.version === firstState.version,
    );

    if (allSynced) {
      this.logger.success("All nodes are synchronized!");
    } else {
      this.logger.error("Nodes are not synchronized!");
    }
  }

  private async demonstrateLeaderFailure(): Promise<void> {
    const leader = this.clusterManager.getLeader();
    if (!leader) {
      this.logger.warn("No leader found for failure demonstration");
      return;
    }

    this.logger.info(`Stopping leader ${leader.nodeId} to trigger election...`);
    await this.clusterManager.stopNode(leader.nodeId);

    // Wait for new leader election
    this.logger.info("Waiting for new leader election...");
    await this.delay(3000);

    await this.displayClusterStatus();

    // Submit a command to verify the new leader works
    const newLeader = this.clusterManager.getLeader();
    if (newLeader) {
      this.logger.info("Testing new leader with a command...");
      const stateMachine = new CounterStateMachine("demo");
      const command = stateMachine.createIncrementCommand(1, "recovery-test");

      try {
        await this.clusterManager.appendToLeader(command);
        this.logger.success("New leader is working correctly!");
      } catch (_error) {
        this.logger.error(
          "New leader failed to process command",
          undefined,
          _error,
        );
      }
    }

    // Restart the failed node
    this.logger.info(`Restarting node ${leader.nodeId}...`);
    await this.clusterManager.startNode(leader.nodeId);
    await this.delay(2000);

    this.logger.success("Node recovery completed");
    await this.displayClusterStatus();
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async cleanup(): Promise<void> {
    this.logger.info("Cleaning up cluster demo...");
    await this.clusterManager.cleanup();
  }
}
