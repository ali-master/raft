import chalk from "chalk";
import { ClusterManager } from "../utils/cluster-manager";
import { PlaygroundLogger } from "../utils/logger";
import { CounterStateMachine } from "../state-machines/counter-state-machine";

export class LogReplicationShowcase {
  private logger = new PlaygroundLogger();
  private clusterManager = new ClusterManager("replication-showcase");

  async run(): Promise<void> {
    this.logger.section("Log Replication Demonstration");

    try {
      // Setup cluster
      await this.setupCluster();

      // Scenario 1: Basic log replication
      await this.demonstrateBasicReplication();

      // Scenario 2: Concurrent operations
      await this.demonstrateConcurrentReplication();

      // Scenario 3: Replication with node failure
      await this.demonstrateReplicationWithFailure();

      // Scenario 4: Log consistency verification
      await this.demonstrateLogConsistency();

      this.logger.result(
        true,
        "All log replication scenarios completed successfully!",
      );
    } catch (_error) {
      this.logger.error("Log replication showcase failed", undefined, _error);
      this.logger.result(false, "Log replication demonstration failed");
    } finally {
      await this.cleanup();
    }
  }

  private async setupCluster(): Promise<void> {
    this.logger.step(1, "Setting up 5-node cluster for replication showcase");
    await this.clusterManager.createCluster(5, "counter");

    await this.displayClusterStatus();
  }

  private async demonstrateBasicReplication(): Promise<void> {
    this.logger.step(2, "Basic Log Replication");
    this.logger.info(
      "Submitting sequential commands and tracking replication...",
    );

    const stateMachine = new CounterStateMachine("showcase");
    const commands = [
      stateMachine.createSetCommand(0, "init"),
      stateMachine.createIncrementCommand(5, "client-1"),
      stateMachine.createIncrementCommand(3, "client-2"),
      stateMachine.createDecrementCommand(2, "client-3"),
      stateMachine.createIncrementCommand(7, "client-4"),
      stateMachine.createSetCommand(100, "client-5"),
    ];

    for (let i = 0; i < commands.length; i++) {
      const command = commands[i];
      this.logger.info(
        `Submitting command ${i + 1}/${commands.length}: ${command.type} (${command.value || "N/A"})`,
      );

      try {
        await this.clusterManager.appendToLeader(command);

        // Track replication progress
        await this.trackReplicationProgress(i + 1);

        // Show current state across all nodes
        await this.displayStateMachineStates();

        await this.delay(1000);
      } catch (_error) {
        this.logger.error(
          `Failed to submit command ${i + 1}`,
          undefined,
          _error,
        );
      }
    }

    this.logger.success("Basic replication sequence completed");
  }

  private async demonstrateConcurrentReplication(): Promise<void> {
    this.logger.step(3, "Concurrent Operations and Serialization");
    this.logger.info("Submitting multiple concurrent commands...");

    const stateMachine = new CounterStateMachine("showcase");
    const concurrentCommands = [
      stateMachine.createIncrementCommand(10, "concurrent-1"),
      stateMachine.createIncrementCommand(20, "concurrent-2"),
      stateMachine.createIncrementCommand(30, "concurrent-3"),
      stateMachine.createDecrementCommand(5, "concurrent-4"),
      stateMachine.createIncrementCommand(15, "concurrent-5"),
    ];

    // Submit all commands rapidly
    const submitPromises = concurrentCommands.map(async (command, index) => {
      try {
        await this.clusterManager.appendToLeader(command);
        this.logger.info(
          `Concurrent command ${index + 1} submitted: ${command.type}`,
        );
      } catch (_error) {
        this.logger.error(
          `Concurrent command ${index + 1} failed`,
          undefined,
          _error,
        );
      }
    });

    await Promise.allSettled(submitPromises);

    // Wait for all operations to be applied
    this.logger.info("Waiting for all concurrent operations to be applied...");
    await this.delay(3000);

    // Verify consistency after concurrent operations
    await this.verifyNodeConsistency();
  }

  private async demonstrateReplicationWithFailure(): Promise<void> {
    this.logger.step(4, "Replication with Node Failure");

    const leader = this.clusterManager.getLeader();
    const followers = this.clusterManager.getFollowers();

    if (!leader || followers.length < 2) {
      this.logger.warn("Insufficient nodes for failure demonstration");
      return;
    }

    // Stop two followers to test minority availability
    const failedNodes = followers.slice(0, 2);
    this.logger.info(
      `Stopping nodes: ${failedNodes.map((n) => n.nodeId).join(", ")}`,
    );

    for (const node of failedNodes) {
      await this.clusterManager.stopNode(node.nodeId);
    }

    // Submit commands with reduced cluster
    this.logger.info("Submitting commands with reduced cluster size...");
    const stateMachine = new CounterStateMachine("showcase");
    const commands = [
      stateMachine.createIncrementCommand(25, "failure-test-1"),
      stateMachine.createIncrementCommand(15, "failure-test-2"),
    ];

    for (const command of commands) {
      try {
        await this.clusterManager.appendToLeader(command);
        this.logger.success(
          `Command applied despite node failures: ${command.type}`,
        );
        await this.delay(1000);
      } catch (_error) {
        this.logger.error(
          "Command failed with reduced cluster",
          undefined,
          _error,
        );
      }
    }

    // Restart failed nodes and verify catch-up
    this.logger.info("Restarting failed nodes and verifying log catch-up...");
    for (const node of failedNodes) {
      await this.clusterManager.startNode(node.nodeId);
      this.logger.info(`Restarted ${node.nodeId}`);
      await this.delay(1000);
    }

    // Wait for catch-up and verify consistency
    this.logger.info("Waiting for nodes to catch up...");
    await this.delay(3000);
    await this.verifyNodeConsistency();
  }

  private async demonstrateLogConsistency(): Promise<void> {
    this.logger.step(5, "Log Consistency Verification");
    this.logger.info("Performing final consistency check across all nodes...");

    const nodes = this.clusterManager.getAllNodes();
    const logStates: Array<{
      nodeId: string;
      commitIndex: number;
      term: number;
      value: number;
      version: number;
    }> = [];

    for (const nodeInfo of nodes) {
      const commitIndex = nodeInfo.node.getCommitIndex();
      const term = nodeInfo.node.getCurrentTerm();
      const stateMachine = nodeInfo.stateMachine as CounterStateMachine;
      const state = stateMachine.getState();

      logStates.push({
        nodeId: nodeInfo.nodeId,
        commitIndex,
        term,
        value: state.value,
        version: state.version,
      });
    }

    // Display log states
    this.logger.info("\n📊 Final Log States:");
    for (const state of logStates) {
      console.log(
        chalk.blue(
          `  ${state.nodeId}: commit=${state.commitIndex}, term=${state.term}, ` +
            `value=${state.value}, version=${state.version}`,
        ),
      );
    }

    // Verify consistency
    const firstState = logStates[0];
    const allConsistent = logStates.every(
      (state) =>
        state.commitIndex === firstState.commitIndex &&
        state.value === firstState.value &&
        state.version === firstState.version,
    );

    if (allConsistent) {
      this.logger.success("✅ All nodes have consistent logs and state!");
    } else {
      this.logger.error("❌ Log consistency violation detected!");

      // Show differences
      logStates.forEach((state) => {
        if (
          state.commitIndex !== firstState.commitIndex ||
          state.value !== firstState.value ||
          state.version !== firstState.version
        ) {
          this.logger.warn(`Inconsistent node: ${state.nodeId}`);
        }
      });
    }
  }

  private async trackReplicationProgress(commandNumber: number): Promise<void> {
    const startTime = Date.now();
    const timeout = 5000; // 5 seconds

    this.logger.info(`Tracking replication of command ${commandNumber}...`);

    while (Date.now() - startTime < timeout) {
      const leader = this.clusterManager.getLeader();
      if (!leader) {
        await this.delay(100);
        continue;
      }

      const commitIndex = leader.node.getCommitIndex();
      if (commitIndex >= commandNumber) {
        const elapsed = Date.now() - startTime;
        this.logger.success(
          `Command ${commandNumber} replicated and committed in ${elapsed}ms`,
        );
        return;
      }

      await this.delay(50);
    }

    this.logger.warn(`Command ${commandNumber} replication timeout`);
  }

  private async displayStateMachineStates(): Promise<void> {
    const nodes = this.clusterManager.getAllNodes();
    const states = nodes.map((nodeInfo) => {
      const stateMachine = nodeInfo.stateMachine as CounterStateMachine;
      const stateData = stateMachine.getState();
      return {
        ...stateData,
        nodeId: nodeInfo.nodeId,
      };
    });

    // Show state summary
    if (states.length > 0) {
      const firstState = states[0];
      const allSame = states.every(
        (s) => s.value === firstState.value && s.version === firstState.version,
      );

      if (allSame) {
        console.log(
          chalk.green(
            `  All nodes: value=${firstState.value}, version=${firstState.version}`,
          ),
        );
      } else {
        console.log(chalk.yellow("  Node states:"));
        states.forEach((state) => {
          console.log(
            chalk.blue(
              `    ${state.nodeId}: value=${state.value}, version=${state.version}`,
            ),
          );
        });
      }
    }
  }

  private async verifyNodeConsistency(): Promise<void> {
    const nodes = this.clusterManager.getAllNodes();
    const states = nodes.map((nodeInfo) => {
      const stateMachine = nodeInfo.stateMachine as CounterStateMachine;
      return stateMachine.getState();
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
      states.forEach((state, index) => {
        const nodeInfo = nodes[index];
        this.logger.warn(
          `${nodeInfo.nodeId}: value=${state.value}, version=${state.version}`,
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
    this.logger.info("Cleaning up log replication showcase...");
    await this.clusterManager.cleanup();
  }
}
