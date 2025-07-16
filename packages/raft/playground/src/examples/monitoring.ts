import { RaftState } from "@usex/raft";
import chalk from "chalk";
import { ClusterManager } from "../utils/cluster-manager";
import { PlaygroundLogger } from "../utils/logger";
import { CounterStateMachine } from "../state-machines/counter-state-machine";

export class MonitoringDemo {
  private logger = new PlaygroundLogger();
  private clusterManager = new ClusterManager("monitoring-demo");
  private monitoringInterval?: NodeJS.Timeout;

  async run(): Promise<void> {
    this.logger.section("Monitoring and Metrics Collection");

    try {
      // Setup monitoring cluster
      await this.setupMonitoringCluster();

      // Start real-time monitoring
      await this.startRealTimeMonitoring();

      // Generate workload while monitoring
      await this.generateMonitoringWorkload();

      // Collect and display comprehensive metrics
      await this.collectComprehensiveMetrics();

      // Test monitoring during failure scenarios
      await this.monitorFailureScenarios();

      this.logger.result(
        true,
        "Monitoring and metrics demonstration completed successfully!",
      );
    } catch (_error) {
      this.logger.error("Monitoring demo failed", undefined, _error);
      this.logger.result(false, "Monitoring demonstration failed");
    } finally {
      await this.cleanup();
    }
  }

  private async setupMonitoringCluster(): Promise<void> {
    this.logger.step(1, "Setting up monitored cluster");
    await this.clusterManager.createCluster(5, "counter");

    this.logger.info("Cluster ready for monitoring");
    this.logger.success("Monitoring cluster established");
  }

  private async startRealTimeMonitoring(): Promise<void> {
    this.logger.step(2, "Starting real-time monitoring");

    let monitoringRound = 0;

    this.monitoringInterval = setInterval(async () => {
      try {
        monitoringRound++;
        const metrics = await this.clusterManager.getMetrics();
        const timestamp = new Date().toISOString();

        // Clear previous monitoring output and display current metrics
        if (monitoringRound > 1) {
          process.stdout.write("\x1b[2J\x1b[H"); // Clear screen
        }

        console.log(
          chalk.cyan(
            `\n📊 Real-time Metrics (Round ${monitoringRound}) - ${timestamp}`,
          ),
        );
        console.log(chalk.blue("━".repeat(80)));

        // Cluster state metrics
        console.log(chalk.green(`🏛️  Cluster State:`));
        console.log(`   Leader: ${metrics.leader || "None"}`);
        console.log(`   Term: ${metrics.term}`);
        console.log(`   Followers: ${metrics.followers.length}`);
        console.log(`   Candidates: ${metrics.candidates.length}`);

        // Node-specific metrics
        console.log(chalk.green(`\n🖥️  Node Details:`));
        const nodes = this.clusterManager.getAllNodes();

        for (const nodeInfo of nodes) {
          const state = nodeInfo.node.getState();
          const term = nodeInfo.node.getCurrentTerm();
          const commitIndex = nodeInfo.node.getCommitIndex();
          const lastApplied = nodeInfo.node.getLastApplied();

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
            `   ${stateIcon} ${nodeInfo.nodeId}: ${state} | Term: ${term} | Commit: ${commitIndex} | Applied: ${lastApplied}`,
          );
        }

        // State machine metrics
        const stateMachineStates = nodes.map((nodeInfo) => {
          const sm = nodeInfo.stateMachine as CounterStateMachine;
          return sm.getState();
        });

        console.log(chalk.green(`\n🔢 State Machine Status:`));
        for (const state of stateMachineStates) {
          console.log(
            `   ${state.nodeId}: Value=${state.value}, Version=${state.version}`,
          );
        }

        // Consistency check
        const allConsistent = stateMachineStates.every(
          (state) =>
            state.value === stateMachineStates[0].value &&
            state.version === stateMachineStates[0].version,
        );

        console.log(
          chalk.green(
            `\n✅ Consistency: ${allConsistent ? "All nodes consistent" : "Inconsistency detected!"}`,
          ),
        );

        console.log(chalk.blue("━".repeat(80)));
      } catch (_error) {
        this.logger.error("Monitoring error", undefined, _error);
      }
    }, 2000); // Update every 2 seconds

    this.logger.success("Real-time monitoring started");
    await this.delay(5000); // Let it run for 5 seconds initially
  }

  private async generateMonitoringWorkload(): Promise<void> {
    this.logger.step(3, "Generating workload for monitoring");

    const stateMachine = new CounterStateMachine("monitoring-workload");
    const operations = [
      { type: "increment", count: 20 },
      { type: "decrement", count: 10 },
      { type: "set", count: 5 },
      { type: "reset", count: 2 },
    ];

    for (const op of operations) {
      this.logger.info(`Generating ${op.count} ${op.type} operations...`);

      for (let i = 0; i < op.count; i++) {
        try {
          let command;
          switch (op.type) {
            case "increment":
              command = stateMachine.createIncrementCommand(
                Math.floor(Math.random() * 5) + 1,
              );
              break;
            case "decrement":
              command = stateMachine.createDecrementCommand(
                Math.floor(Math.random() * 3) + 1,
              );
              break;
            case "set":
              command = stateMachine.createSetCommand(
                Math.floor(Math.random() * 100),
              );
              break;
            case "reset":
              command = stateMachine.createResetCommand();
              break;
          }

          if (command) {
            await this.clusterManager.appendToLeader(command);
            await this.delay(100); // Small delay between operations
          }
        } catch (_error) {
          this.logger.error(`Operation ${op.type} failed`, undefined, _error);
        }
      }
    }

    this.logger.success("Workload generation completed");
  }

  private async collectComprehensiveMetrics(): Promise<void> {
    this.logger.step(4, "Collecting comprehensive metrics");

    // Stop real-time monitoring for detailed analysis
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    console.log(chalk.cyan("\n📈 Comprehensive Metrics Report"));
    console.log(chalk.blue("═".repeat(60)));

    const metrics = await this.clusterManager.getMetrics();
    const nodes = this.clusterManager.getAllNodes();

    // Cluster-wide metrics
    console.log(chalk.green("\n🏛️  Cluster-wide Metrics:"));
    console.log(`   Total Nodes: ${nodes.length}`);
    console.log(
      `   Active Nodes: ${nodes.filter((n) => n.node.getState() !== RaftState.CANDIDATE).length}`,
    );
    console.log(`   Current Term: ${metrics.term}`);
    console.log(`   Leader Node: ${metrics.leader || "None"}`);
    console.log(`   Quorum Size: ${Math.floor(nodes.length / 2) + 1}`);

    // Performance metrics
    console.log(chalk.green("\n⚡ Performance Metrics:"));
    const leader = this.clusterManager.getLeader();
    if (leader) {
      const commitIndex = leader.node.getCommitIndex();
      const lastApplied = leader.node.getLastApplied();

      console.log(`   Total Committed Entries: ${commitIndex}`);
      console.log(`   Total Applied Entries: ${lastApplied}`);
      console.log(`   Pending Application: ${commitIndex - lastApplied}`);

      // Calculate approximate throughput
      // const _uptime = Date.now() - (Date.now() - 60000); // Assume 1 minute uptime for demo
      const throughput = commitIndex > 0 ? (commitIndex / 60).toFixed(2) : "0";
      console.log(`   Estimated Throughput: ${throughput} ops/sec`);
    }

    // Node health metrics
    console.log(chalk.green("\n🏥 Node Health Metrics:"));
    for (const nodeInfo of nodes) {
      const state = nodeInfo.node.getState();
      const term = nodeInfo.node.getCurrentTerm();
      const commitIndex = nodeInfo.node.getCommitIndex();
      const lastApplied = nodeInfo.node.getLastApplied();

      let healthStatus = "Healthy";
      if (state === RaftState.CANDIDATE) {
        healthStatus = "Election in Progress";
      } else if (commitIndex - lastApplied > 10) {
        healthStatus = "Lagging Application";
      }

      console.log(`   ${nodeInfo.nodeId}:`);
      console.log(`     State: ${state}`);
      console.log(`     Term: ${term}`);
      console.log(`     Commit Index: ${commitIndex}`);
      console.log(`     Last Applied: ${lastApplied}`);
      console.log(`     Health: ${healthStatus}`);
    }

    // State machine consistency metrics
    console.log(chalk.green("\n🔄 State Machine Consistency:"));
    const stateMachineStates = nodes.map((nodeInfo) => {
      const sm = nodeInfo.stateMachine as CounterStateMachine;
      return sm.getState();
    });

    const uniqueValues = new Set(stateMachineStates.map((s) => s.value));
    const uniqueVersions = new Set(stateMachineStates.map((s) => s.version));

    console.log(
      `   Unique Values: ${uniqueValues.size} (${Array.from(uniqueValues).join(", ")})`,
    );
    console.log(
      `   Unique Versions: ${uniqueVersions.size} (${Array.from(uniqueVersions).join(", ")})`,
    );
    console.log(
      `   Consistency Status: ${uniqueValues.size === 1 && uniqueVersions.size === 1 ? "Consistent" : "Inconsistent"}`,
    );

    // Memory and resource metrics
    console.log(chalk.green("\n💾 Resource Usage:"));
    const memUsage = process.memoryUsage();
    console.log(
      `   Heap Used: ${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
    );
    console.log(
      `   Heap Total: ${(memUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`,
    );
    console.log(`   RSS: ${(memUsage.rss / 1024 / 1024).toFixed(2)} MB`);
    console.log(
      `   External: ${(memUsage.external / 1024 / 1024).toFixed(2)} MB`,
    );

    console.log(chalk.blue("═".repeat(60)));
  }

  private async monitorFailureScenarios(): Promise<void> {
    this.logger.step(5, "Monitoring during failure scenarios");

    // Start monitoring again
    this.logger.info("Starting failure monitoring...");

    const leader = this.clusterManager.getLeader();
    if (!leader) {
      this.logger.error("No leader available for failure monitoring");
      return;
    }

    console.log(chalk.yellow("\n🚨 Failure Monitoring Dashboard"));
    console.log(chalk.blue("━".repeat(50)));

    // Monitor before failure
    console.log(chalk.green("Before failure:"));
    await this.displayCurrentMetrics();

    // Simulate leader failure
    this.logger.warn(`Simulating failure of leader ${leader.nodeId}...`);
    await this.clusterManager.stopNode(leader.nodeId);

    // Monitor during election
    console.log(chalk.yellow("\nDuring re-election:"));
    let electionComplete = false;
    let attempts = 0;
    const maxAttempts = 10;

    while (!electionComplete && attempts < maxAttempts) {
      attempts++;
      await this.delay(1000);

      const currentMetrics = await this.clusterManager.getMetrics();
      console.log(
        `  Attempt ${attempts}: Leader=${currentMetrics.leader || "None"}, Term=${currentMetrics.term}, Candidates=${currentMetrics.candidates.length}`,
      );

      if (currentMetrics.leader) {
        electionComplete = true;
        console.log(
          chalk.green(`  ✅ New leader elected: ${currentMetrics.leader}`),
        );
      }
    }

    // Monitor after recovery
    console.log(chalk.green("\nAfter recovery:"));
    await this.displayCurrentMetrics();

    // Restart failed node and monitor
    this.logger.info(`Restarting failed node ${leader.nodeId}...`);
    await this.clusterManager.startNode(leader.nodeId);
    await this.delay(2000);

    console.log(chalk.green("\nAfter node restart:"));
    await this.displayCurrentMetrics();

    console.log(chalk.blue("━".repeat(50)));
    this.logger.success("Failure monitoring completed");
  }

  private async displayCurrentMetrics(): Promise<void> {
    const metrics = await this.clusterManager.getMetrics();
    const nodes = this.clusterManager.getAllNodes();

    console.log(`  Leader: ${metrics.leader || "None"}`);
    console.log(`  Term: ${metrics.term}`);
    console.log(
      `  Active Nodes: ${nodes.filter((n) => n.node.getState() !== RaftState.CANDIDATE).length}/${nodes.length}`,
    );
    console.log(`  Candidates: ${metrics.candidates.length}`);

    // Check consistency
    const stateMachineStates = nodes.map((nodeInfo) => {
      const sm = nodeInfo.stateMachine as CounterStateMachine;
      return sm.getState();
    });

    const uniqueValues = new Set(stateMachineStates.map((s) => s.value));
    console.log(
      `  State Consistency: ${uniqueValues.size === 1 ? "Consistent" : "Inconsistent"}`,
    );
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async cleanup(): Promise<void> {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    this.logger.info("Cleaning up monitoring demo...");
    await this.clusterManager.cleanup();
  }
}
