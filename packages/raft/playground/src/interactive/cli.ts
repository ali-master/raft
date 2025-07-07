import chalk from "chalk";
import inquirer from "inquirer";
import { RaftState } from "@usex/raft";
import { ClusterManager } from "../utils/cluster-manager.js";
import { PlaygroundLogger } from "../utils/logger.js";
import { CounterStateMachine } from "../state-machines/counter-state-machine.js";

export class InteractiveCLI {
  private logger = new PlaygroundLogger();
  private clusterManager = new ClusterManager("interactive-cli");
  private isRunning = false;

  async run(): Promise<void> {
    this.logger.section("Interactive Raft CLI");

    console.log(
      chalk.yellow(`
🎮 Welcome to the Interactive Raft CLI!

This interface allows you to manually control a Raft cluster and observe
the consensus algorithm in action. You can:

• Create and manage clusters
• Submit operations and observe replication
• Simulate failures and network partitions
• Monitor cluster state in real-time
• Learn Raft concepts through hands-on experimentation

Type 'help' at any time to see available commands.
`),
    );

    this.isRunning = true;

    try {
      await this.startInteractiveSession();
    } catch (_error) {
      this.logger.error("Interactive CLI failed", undefined, _error);
    } finally {
      await this.cleanup();
    }
  }

  private async startInteractiveSession(): Promise<void> {
    while (this.isRunning) {
      try {
        const answer = await inquirer.prompt({
          type: "input",
          name: "command",
          message: chalk.cyan("raft>"),
        });

        const command = answer.command.trim().toLowerCase();

        if (!command) continue;

        await this.executeCommand(command);
      } catch (_error) {
        if ((_error as Error).name === "ExitPromptError") {
          break;
        }
        this.logger.error("Command execution failed", undefined, _error);
      }
    }
  }

  private async executeCommand(input: string): Promise<void> {
    const parts = input.split(" ");
    const command = parts[0];
    const args = parts.slice(1);

    switch (command) {
      case "help":
      case "h":
        this.showHelp();
        break;

      case "create":
        await this.handleCreateCluster(args);
        break;

      case "status":
      case "st":
        await this.handleStatus();
        break;

      case "nodes":
      case "ls":
        await this.handleListNodes();
        break;

      case "leader":
        await this.handleShowLeader();
        break;

      case "submit":
      case "op":
        await this.handleSubmitOperation(args);
        break;

      case "stop":
        await this.handleStopNode(args);
        break;

      case "start":
        await this.handleStartNode(args);
        break;

      case "partition":
        await this.handleNetworkPartition(args);
        break;

      case "heal":
        await this.handleHealPartition(args);
        break;

      case "add":
        await this.handleAddNode(args);
        break;

      case "remove":
        await this.handleRemoveNode(args);
        break;

      case "watch":
        await this.handleWatch(args);
        break;

      case "benchmark":
      case "bench":
        await this.handleBenchmark(args);
        break;

      case "scenario":
        await this.handleScenario(args);
        break;

      case "clear":
      case "cls":
        console.clear();
        break;

      case "reset":
        await this.handleReset();
        break;

      case "exit":
      case "quit":
      case "q":
        this.isRunning = false;
        console.log(chalk.green("👋 Goodbye!"));
        break;

      default:
        console.log(chalk.red(`Unknown command: ${command}`));
        console.log(chalk.yellow('Type "help" to see available commands.'));
        break;
    }
  }

  private showHelp(): void {
    console.log(
      chalk.cyan(`
📚 RAFT INTERACTIVE CLI COMMANDS

🏗️  CLUSTER MANAGEMENT:
  create <size>          - Create a new cluster (default: 3 nodes)
  status                 - Show cluster status and metrics
  nodes, ls             - List all nodes and their states
  leader                - Show current leader information
  reset                 - Reset and cleanup current cluster

⚡ OPERATIONS:
  submit <op> [value]   - Submit operation (inc, dec, set, reset)
  op <op> [value]       - Alias for submit

  Examples:
    submit inc 5        - Increment counter by 5
    submit dec 2        - Decrement counter by 2
    submit set 100      - Set counter to 100
    submit reset        - Reset counter to 0

🔧 NODE CONTROL:
  stop <node>           - Stop a specific node
  start <node>          - Start a stopped node
  add [name]            - Add new node to cluster
  remove <node>         - Remove node from cluster

🌐 NETWORK SIMULATION:
  partition <nodes1> | <nodes2>  - Create network partition
  heal <nodes>                    - Heal network partition

  Example:
    partition node-0,node-1 | node-2,node-3,node-4

📊 MONITORING:
  watch [interval]      - Start real-time cluster monitoring
  benchmark [ops]       - Run performance benchmark
  scenario <name>       - Run predefined scenarios

🎯 SCENARIOS:
  scenario election     - Trigger leader election
  scenario partition    - Simulate network partition
  scenario recovery     - Test node recovery
  scenario stress       - Run stress test

🎮 UTILITY:
  help, h              - Show this help message
  clear, cls           - Clear screen
  exit, quit, q        - Exit interactive mode

💡 TIP: Press Ctrl+C to interrupt long-running commands
`),
    );
  }

  private async handleCreateCluster(args: string[]): Promise<void> {
    const size = parseInt(args[0]) || 3;

    if (size < 1 || size > 10) {
      console.log(chalk.red("Cluster size must be between 1 and 10"));
      return;
    }

    console.log(chalk.blue(`Creating cluster with ${size} nodes...`));

    try {
      await this.clusterManager.cleanup();
      await this.clusterManager.createCluster(size, "counter");

      // Wait for stabilization
      await this.delay(3000);

      const leader = this.clusterManager.getLeader();
      if (leader) {
        console.log(chalk.green(`✅ Cluster created successfully!`));
        console.log(chalk.blue(`Leader: ${leader.nodeId}`));
      } else {
        console.log(
          chalk.yellow("⚠️  Cluster created but no leader elected yet"),
        );
      }
    } catch (_error) {
      console.log(
        chalk.red(`❌ Failed to create cluster: ${(_error as Error).message}`),
      );
    }
  }

  private async handleStatus(): Promise<void> {
    const nodes = this.clusterManager.getAllNodes();

    if (nodes.length === 0) {
      console.log(
        chalk.yellow('No cluster exists. Use "create" to start one.'),
      );
      return;
    }

    const metrics = await this.clusterManager.getMetrics();

    console.log(chalk.cyan("\n📊 CLUSTER STATUS"));
    console.log(chalk.blue("━".repeat(50)));

    console.log(`🏛️  Cluster Size: ${nodes.length} nodes`);
    console.log(`👑 Leader: ${metrics.leader || "None"}`);
    console.log(`📜 Current Term: ${metrics.term}`);
    console.log(`👥 Followers: ${metrics.followers.length}`);
    console.log(`🗳️  Candidates: ${metrics.candidates.length}`);

    const leader = this.clusterManager.getLeader();
    if (leader) {
      console.log(`💾 Commit Index: ${leader.node.getCommitIndex()}`);
      console.log(`🎯 Last Applied: ${leader.node.getLastApplied()}`);
    }

    // State machine status
    const stateMachineStates = nodes.map((nodeInfo) => {
      const sm = nodeInfo.stateMachine as CounterStateMachine;
      return sm.getState();
    });

    const uniqueValues = new Set(stateMachineStates.map((s) => s.value));
    const consistencyStatus =
      uniqueValues.size === 1 ? "✅ Consistent" : "⚠️  Inconsistent";

    console.log(`🔄 State Machine: ${consistencyStatus}`);
    if (stateMachineStates.length > 0) {
      console.log(`🔢 Counter Value: ${stateMachineStates[0].value}`);
      console.log(`📋 Version: ${stateMachineStates[0].version}`);
    }

    console.log(chalk.blue("━".repeat(50)));
  }

  private async handleListNodes(): Promise<void> {
    const nodes = this.clusterManager.getAllNodes();

    if (nodes.length === 0) {
      console.log(
        chalk.yellow('No cluster exists. Use "create" to start one.'),
      );
      return;
    }

    console.log(chalk.cyan("\n📋 CLUSTER NODES"));
    console.log(chalk.blue("━".repeat(60)));

    for (const nodeInfo of nodes) {
      const state = nodeInfo.node.getState();
      const term = nodeInfo.node.getCurrentTerm();
      const commitIndex = nodeInfo.node.getCommitIndex();
      const lastApplied = nodeInfo.node.getLastApplied();
      const sm = nodeInfo.stateMachine as CounterStateMachine;
      const smState = sm.getState();

      let stateIcon = "";
      let stateColor = chalk.white;

      switch (state) {
        case RaftState.LEADER:
          stateIcon = "👑";
          stateColor = chalk.green;
          break;
        case RaftState.FOLLOWER:
          stateIcon = "👤";
          stateColor = chalk.blue;
          break;
        case RaftState.CANDIDATE:
          stateIcon = "🗳️";
          stateColor = chalk.yellow;
          break;
      }

      console.log(
        `${stateIcon} ${stateColor(nodeInfo.nodeId.padEnd(12))} | ${state.padEnd(9)} | Term: ${term.toString().padStart(3)} | Commit: ${commitIndex.toString().padStart(3)} | Applied: ${lastApplied.toString().padStart(3)} | Value: ${smState.value}`,
      );
    }

    console.log(chalk.blue("━".repeat(60)));
  }

  private async handleShowLeader(): Promise<void> {
    const leader = this.clusterManager.getLeader();

    if (!leader) {
      console.log(chalk.yellow("No leader currently elected"));
      return;
    }

    const term = leader.node.getCurrentTerm();
    const commitIndex = leader.node.getCommitIndex();
    const lastApplied = leader.node.getLastApplied();
    const sm = leader.stateMachine as CounterStateMachine;
    const smState = sm.getState();

    console.log(chalk.cyan("\n👑 CURRENT LEADER"));
    console.log(chalk.blue("━".repeat(30)));
    console.log(`🆔 Node ID: ${leader.nodeId}`);
    console.log(`📜 Term: ${term}`);
    console.log(`💾 Commit Index: ${commitIndex}`);
    console.log(`🎯 Last Applied: ${lastApplied}`);
    console.log(`🔢 Counter Value: ${smState.value}`);
    console.log(`📋 Counter Version: ${smState.version}`);
    console.log(chalk.blue("━".repeat(30)));
  }

  private async handleSubmitOperation(args: string[]): Promise<void> {
    const leader = this.clusterManager.getLeader();

    if (!leader) {
      console.log(chalk.red("❌ No leader available to submit operations"));
      return;
    }

    const operation = args[0];
    const value = parseInt(args[1]);

    if (!operation) {
      console.log(chalk.yellow("Usage: submit <operation> [value]"));
      console.log(chalk.blue("Operations: inc, dec, set, reset"));
      return;
    }

    const stateMachine = new CounterStateMachine("interactive");
    let command;

    try {
      switch (operation) {
        case "inc":
        case "increment":
          command = stateMachine.createIncrementCommand(
            value || 1,
            "interactive-cli",
          );
          break;
        case "dec":
        case "decrement":
          command = stateMachine.createDecrementCommand(
            value || 1,
            "interactive-cli",
          );
          break;
        case "set":
          if (isNaN(value)) {
            console.log(chalk.red("❌ Set operation requires a value"));
            return;
          }
          command = stateMachine.createSetCommand(value, "interactive-cli");
          break;
        case "reset":
          command = stateMachine.createResetCommand("interactive-cli");
          break;
        default:
          console.log(chalk.red(`❌ Unknown operation: ${operation}`));
          return;
      }

      console.log(chalk.blue(`Submitting ${operation} operation...`));

      const startTime = Date.now();
      await this.clusterManager.appendToLeader(command);
      const duration = Date.now() - startTime;

      console.log(chalk.green(`✅ Operation completed in ${duration}ms`));

      // Show updated state
      await this.delay(500);
      const updatedSm = leader.stateMachine as CounterStateMachine;
      const updatedState = updatedSm.getState();
      console.log(chalk.blue(`🔢 New counter value: ${updatedState.value}`));
    } catch (_error) {
      console.log(
        chalk.red(`❌ Operation failed: ${(_error as Error).message}`),
      );
    }
  }

  private async handleStopNode(args: string[]): Promise<void> {
    const nodeId = args[0];

    if (!nodeId) {
      console.log(chalk.yellow("Usage: stop <node-id>"));
      return;
    }

    const node = this.clusterManager.getNode(nodeId);
    if (!node) {
      console.log(chalk.red(`❌ Node ${nodeId} not found`));
      return;
    }

    try {
      console.log(chalk.blue(`Stopping node ${nodeId}...`));
      await this.clusterManager.stopNode(nodeId);
      console.log(chalk.green(`✅ Node ${nodeId} stopped`));

      // Check if we stopped the leader
      await this.delay(1000);
      const newLeader = this.clusterManager.getLeader();
      if (newLeader && newLeader.nodeId !== nodeId) {
        console.log(chalk.blue(`👑 New leader: ${newLeader.nodeId}`));
      } else if (!newLeader) {
        console.log(chalk.yellow("⚠️  No leader currently elected"));
      }
    } catch (_error) {
      console.log(
        chalk.red(`❌ Failed to stop node: ${(_error as Error).message}`),
      );
    }
  }

  private async handleStartNode(args: string[]): Promise<void> {
    const nodeId = args[0];

    if (!nodeId) {
      console.log(chalk.yellow("Usage: start <node-id>"));
      return;
    }

    try {
      console.log(chalk.blue(`Starting node ${nodeId}...`));
      await this.clusterManager.startNode(nodeId);
      console.log(chalk.green(`✅ Node ${nodeId} started`));

      // Wait a bit and show its state
      await this.delay(2000);
      const node = this.clusterManager.getNode(nodeId);
      if (node) {
        console.log(chalk.blue(`📊 Node state: ${node.node.getState()}`));
      }
    } catch (_error) {
      console.log(
        chalk.red(`❌ Failed to start node: ${(_error as Error).message}`),
      );
    }
  }

  private async handleNetworkPartition(args: string[]): Promise<void> {
    const partitionSpec = args.join(" ");

    if (!partitionSpec.includes("|")) {
      console.log(chalk.yellow("Usage: partition <nodes1> | <nodes2>"));
      console.log(
        chalk.blue("Example: partition node-0,node-1 | node-2,node-3"),
      );
      return;
    }

    const [part1Str, part2Str] = partitionSpec.split("|").map((s) => s.trim());
    const partition1 = part1Str.split(",").map((s) => s.trim());
    const partition2 = part2Str.split(",").map((s) => s.trim());

    try {
      console.log(chalk.blue("Creating network partition..."));
      console.log(chalk.blue(`Partition 1: ${partition1.join(", ")}`));
      console.log(chalk.blue(`Partition 2: ${partition2.join(", ")}`));

      await this.clusterManager.simulateNetworkPartition(
        partition1,
        partition2,
      );
      console.log(chalk.green("✅ Network partition created"));

      // Check which partition has leader
      await this.delay(2000);
      const leader = this.clusterManager.getLeader();
      if (leader) {
        const leaderPartition = partition1.includes(leader.nodeId) ? 1 : 2;
        console.log(
          chalk.blue(
            `👑 Leader in partition ${leaderPartition}: ${leader.nodeId}`,
          ),
        );
      }
    } catch (_error) {
      console.log(
        chalk.red(
          `❌ Failed to create partition: ${(_error as Error).message}`,
        ),
      );
    }
  }

  private async handleHealPartition(args: string[]): Promise<void> {
    const nodesStr = args.join(" ");
    const nodes = nodesStr
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s);

    if (nodes.length === 0) {
      console.log(chalk.yellow("Usage: heal <nodes>"));
      console.log(chalk.blue("Example: heal node-2,node-3"));
      return;
    }

    try {
      console.log(
        chalk.blue(`Healing partition for nodes: ${nodes.join(", ")}`),
      );
      await this.clusterManager.healNetworkPartition(nodes);
      console.log(chalk.green("✅ Network partition healed"));
    } catch (_error) {
      console.log(
        chalk.red(`❌ Failed to heal partition: ${(_error as Error).message}`),
      );
    }
  }

  private async handleAddNode(args: string[]): Promise<void> {
    const nodeId = args[0] || `node-${Date.now()}`;

    try {
      console.log(chalk.blue(`Adding node ${nodeId} to cluster...`));
      await this.clusterManager.addNode(nodeId, "counter");
      console.log(chalk.green(`✅ Node ${nodeId} added to cluster`));
    } catch (_error) {
      console.log(
        chalk.red(`❌ Failed to add node: ${(_error as Error).message}`),
      );
    }
  }

  private async handleRemoveNode(args: string[]): Promise<void> {
    const nodeId = args[0];

    if (!nodeId) {
      console.log(chalk.yellow("Usage: remove <node-id>"));
      return;
    }

    try {
      console.log(chalk.blue(`Removing node ${nodeId} from cluster...`));
      await this.clusterManager.removeNode(nodeId);
      console.log(chalk.green(`✅ Node ${nodeId} removed from cluster`));
    } catch (_error) {
      console.log(
        chalk.red(`❌ Failed to remove node: ${(_error as Error).message}`),
      );
    }
  }

  private async handleWatch(args: string[]): Promise<void> {
    const interval = parseInt(args[0]) || 2000;

    console.log(
      chalk.blue(`Starting real-time monitoring (${interval}ms interval)`),
    );
    console.log(chalk.yellow("Press Ctrl+C to stop watching"));

    let watchCount = 0;

    const watchInterval = setInterval(async () => {
      try {
        watchCount++;

        // Clear screen and show header
        process.stdout.write("\\x1b[2J\\x1b[H");
        console.log(
          chalk.cyan(`📊 REAL-TIME CLUSTER MONITOR (Update #${watchCount})`),
        );
        console.log(chalk.blue("━".repeat(70)));
        console.log(chalk.yellow("Press Ctrl+C to stop watching\\n"));

        const nodes = this.clusterManager.getAllNodes();
        if (nodes.length === 0) {
          console.log(chalk.yellow("No cluster to monitor"));
          return;
        }

        const metrics = await this.clusterManager.getMetrics();

        // Cluster overview
        console.log(chalk.green("🏛️  CLUSTER OVERVIEW:"));
        console.log(`   Leader: ${metrics.leader || "None"}`);
        console.log(`   Term: ${metrics.term}`);
        console.log(
          `   Nodes: ${nodes.length} (${metrics.followers.length} followers, ${metrics.candidates.length} candidates)`,
        );

        // Node details
        console.log(chalk.green("\\n📋 NODE DETAILS:"));
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
            `   ${stateIcon} ${nodeInfo.nodeId}: ${state} | Term: ${term} | Commit: ${commitIndex} | Value: ${smState.value}`,
          );
        }

        // Consistency check
        const stateMachineStates = nodes.map((nodeInfo) => {
          const sm = nodeInfo.stateMachine as CounterStateMachine;
          return sm.getState();
        });

        const uniqueValues = new Set(stateMachineStates.map((s) => s.value));
        const consistencyIcon = uniqueValues.size === 1 ? "✅" : "⚠️";

        console.log(chalk.green("\\n🔄 CONSISTENCY:"));
        console.log(
          `   ${consistencyIcon} ${uniqueValues.size === 1 ? "All nodes consistent" : "Inconsistency detected"}`,
        );

        console.log(chalk.blue("\\n━".repeat(70)));
        console.log(
          chalk.gray(`Last updated: ${new Date().toLocaleTimeString()}`),
        );
      } catch (_error) {
        console.log(chalk.red(`Monitor error: ${(_error as Error).message}`));
      }
    }, interval);

    // Handle Ctrl+C
    const originalHandler = process.listeners("SIGINT");

    const stopWatching = () => {
      clearInterval(watchInterval);
      console.log(chalk.green("\\n✅ Monitoring stopped"));

      // Restore original handlers
      process.removeAllListeners("SIGINT");
      originalHandler.forEach((handler) => process.on("SIGINT", handler));
    };

    process.once("SIGINT", stopWatching);

    // Also allow stopping with any key press (simplified)
    setTimeout(() => {
      console.log(
        chalk.gray(
          "\\nWatching... (monitoring will continue until you press Ctrl+C)",
        ),
      );
    }, interval);
  }

  private async handleBenchmark(args: string[]): Promise<void> {
    const operations = parseInt(args[0]) || 100;

    const leader = this.clusterManager.getLeader();
    if (!leader) {
      console.log(chalk.red("❌ No leader available for benchmark"));
      return;
    }

    console.log(
      chalk.blue(`Running benchmark with ${operations} operations...`),
    );

    const stateMachine = new CounterStateMachine("benchmark");
    const startTime = Date.now();
    let successful = 0;
    let failed = 0;

    for (let i = 0; i < operations; i++) {
      try {
        await this.clusterManager.appendToLeader(
          stateMachine.createIncrementCommand(1, `bench-${i}`),
        );
        successful++;
      } catch {
        failed++;
      }

      // Progress update
      if ((i + 1) % Math.max(1, Math.floor(operations / 10)) === 0) {
        const progress = (((i + 1) / operations) * 100).toFixed(1);
        process.stdout.write(
          `\\r${chalk.blue(`Progress: ${progress}% (${i + 1}/${operations})`)}`,
        );
      }
    }

    const endTime = Date.now();
    const duration = endTime - startTime;
    const throughput = Math.round((successful / duration) * 1000);

    console.log(chalk.cyan("\\n\\n📈 BENCHMARK RESULTS"));
    console.log(chalk.blue("━".repeat(30)));
    console.log(`⚡ Operations: ${operations}`);
    console.log(`✅ Successful: ${successful}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`⏱️  Duration: ${duration}ms`);
    console.log(`🚀 Throughput: ${throughput} ops/sec`);
    console.log(
      `📊 Success Rate: ${((successful / operations) * 100).toFixed(2)}%`,
    );
    console.log(chalk.blue("━".repeat(30)));
  }

  private async handleScenario(args: string[]): Promise<void> {
    const scenario = args[0];

    if (!scenario) {
      console.log(
        chalk.yellow(
          "Available scenarios: election, partition, recovery, stress",
        ),
      );
      return;
    }

    console.log(chalk.blue(`Running scenario: ${scenario}`));

    try {
      switch (scenario) {
        case "election":
          await this.runElectionScenario();
          break;
        case "partition":
          await this.runPartitionScenario();
          break;
        case "recovery":
          await this.runRecoveryScenario();
          break;
        case "stress":
          await this.runStressScenario();
          break;
        default:
          console.log(chalk.red(`Unknown scenario: ${scenario}`));
          return;
      }

      console.log(chalk.green(`✅ Scenario '${scenario}' completed`));
    } catch (_error) {
      console.log(
        chalk.red(
          `❌ Scenario '${scenario}' failed: ${(_error as Error).message}`,
        ),
      );
    }
  }

  private async runElectionScenario(): Promise<void> {
    console.log(chalk.blue("Triggering leader election..."));

    const leader = this.clusterManager.getLeader();
    if (!leader) {
      console.log(chalk.yellow("No leader to trigger election"));
      return;
    }

    console.log(chalk.blue(`Stopping current leader: ${leader.nodeId}`));
    await this.clusterManager.stopNode(leader.nodeId);

    console.log(chalk.blue("Waiting for new leader election..."));
    await this.delay(5000);

    const newLeader = this.clusterManager.getLeader();
    if (newLeader) {
      console.log(chalk.green(`New leader elected: ${newLeader.nodeId}`));
    } else {
      console.log(chalk.yellow("No new leader elected yet"));
    }

    console.log(chalk.blue(`Restarting original leader: ${leader.nodeId}`));
    await this.clusterManager.startNode(leader.nodeId);
  }

  private async runPartitionScenario(): Promise<void> {
    console.log(chalk.blue("Creating network partition..."));

    const nodes = this.clusterManager.getAllNodes().map((n) => n.nodeId);
    if (nodes.length < 3) {
      console.log(chalk.red("Need at least 3 nodes for partition scenario"));
      return;
    }

    const mid = Math.floor(nodes.length / 2);
    const partition1 = nodes.slice(0, mid + 1);
    const partition2 = nodes.slice(mid + 1);

    console.log(chalk.blue(`Partition 1: ${partition1.join(", ")}`));
    console.log(chalk.blue(`Partition 2: ${partition2.join(", ")}`));

    await this.clusterManager.simulateNetworkPartition(partition1, partition2);

    console.log(chalk.blue("Waiting during partition..."));
    await this.delay(5000);

    console.log(chalk.blue("Healing partition..."));
    await this.clusterManager.healNetworkPartition(partition2);

    await this.delay(3000);
    console.log(chalk.green("Partition scenario complete"));
  }

  private async runRecoveryScenario(): Promise<void> {
    console.log(chalk.blue("Testing node recovery..."));

    const nodes = this.clusterManager.getAllNodes();
    if (nodes.length === 0) {
      console.log(chalk.red("No nodes to test recovery"));
      return;
    }

    const testNode = nodes[Math.floor(Math.random() * nodes.length)];

    console.log(chalk.blue(`Stopping node: ${testNode.nodeId}`));
    await this.clusterManager.stopNode(testNode.nodeId);

    console.log(chalk.blue("Submitting operations while node is down..."));
    const stateMachine = new CounterStateMachine("recovery-test");

    for (let i = 0; i < 3; i++) {
      try {
        await this.clusterManager.appendToLeader(
          stateMachine.createIncrementCommand(1, `recovery-${i}`),
        );
        console.log(chalk.green(`Operation ${i + 1} successful`));
      } catch {
        console.log(
          chalk.yellow(`Operation ${i + 1} failed (expected if no leader)`),
        );
      }
      await this.delay(500);
    }

    console.log(chalk.blue(`Restarting node: ${testNode.nodeId}`));
    await this.clusterManager.startNode(testNode.nodeId);

    await this.delay(3000);
    console.log(chalk.green("Recovery scenario complete"));
  }

  private async runStressScenario(): Promise<void> {
    console.log(chalk.blue("Running mini stress test..."));

    const operations = 50;
    const stateMachine = new CounterStateMachine("stress-test");

    const startTime = Date.now();
    let successful = 0;

    for (let i = 0; i < operations; i++) {
      try {
        await this.clusterManager.appendToLeader(
          stateMachine.createIncrementCommand(1, `stress-${i}`),
        );
        successful++;
      } catch {
        // Continue on error
      }

      if ((i + 1) % 10 === 0) {
        process.stdout.write(
          `\\r${chalk.blue(`Progress: ${i + 1}/${operations}`)}`,
        );
      }
    }

    const duration = Date.now() - startTime;
    const throughput = Math.round((successful / duration) * 1000);

    console.log(
      chalk.green(
        `\\n✅ Stress test complete: ${successful}/${operations} successful, ${throughput} ops/sec`,
      ),
    );
  }

  private async handleReset(): Promise<void> {
    console.log(chalk.blue("Resetting cluster..."));

    try {
      await this.clusterManager.cleanup();
      console.log(chalk.green("✅ Cluster reset complete"));
    } catch (_error) {
      console.log(chalk.red(`❌ Reset failed: ${(_error as Error).message}`));
    }
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async cleanup(): Promise<void> {
    this.isRunning = false;
    await this.clusterManager.cleanup();
  }
}
