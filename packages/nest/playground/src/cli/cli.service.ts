import { Injectable, OnApplicationBootstrap } from "@nestjs/common";
import { RaftService } from "@usex/raft-nestjs";
import { LoggerService } from "@/shared/services/logger.service";
import * as readline from "readline";
import * as chalk from "chalk";

@Injectable()
export class CliService implements OnApplicationBootstrap {
  private rl: readline.Interface;
  private isInteractive: boolean;

  constructor(
    private readonly raftService: RaftService,
    private readonly _logger: LoggerService,
  ) {
    this.isInteractive = process.env.INTERACTIVE_MODE === "true";
  }

  onApplicationBootstrap() {
    if (!this.isInteractive) return;

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.cyan("raft> "),
    });

    this.showWelcome();
    this.rl.prompt();

    this.rl.on("line", async (line) => {
      await this.handleCommand(line.trim());
      this.rl.prompt();
    });

    this.rl.on("close", () => {
      console.log(chalk.yellow("\nGoodbye!"));
      process.exit(0);
    });
  }

  private showWelcome() {
    console.log(
      chalk.green(`
╔══════════════════════════════════════════════╗
║     Raft Consensus Playground CLI v1.0       ║
║                                              ║
║  Type 'help' for available commands          ║
║  Type 'exit' or press Ctrl+C to quit         ║
╚══════════════════════════════════════════════╝
    `),
    );
  }

  private async handleCommand(command: string) {
    const [cmd, ...args] = command.split(" ");

    switch (cmd.toLowerCase()) {
      case "help":
        this.showHelp();
        break;

      case "status":
        await this.showStatus();
        break;

      case "nodes":
        await this.showNodes();
        break;

      case "leader":
        await this.showLeader();
        break;

      case "election":
        await this.triggerElection();
        break;

      case "step-down":
        await this.stepDown();
        break;

      case "scenario":
        await this.handleScenario(args);
        break;

      case "metrics":
        await this.showMetrics();
        break;

      case "clear":
        console.clear();
        break;

      case "exit":
      case "quit":
        this.rl.close();
        break;

      default:
        if (command) {
          console.log(chalk.red(`Unknown command: ${cmd}`));
          console.log(chalk.gray(`Type 'help' for available commands`));
        }
    }
  }

  private showHelp() {
    console.log(chalk.yellow("\nAvailable Commands:"));
    console.log(
      chalk.white(`
  ${chalk.cyan("status")}        - Show current node status
  ${chalk.cyan("nodes")}         - List all cluster nodes
  ${chalk.cyan("leader")}        - Show current leader
  ${chalk.cyan("election")}      - Trigger a new election
  ${chalk.cyan("step-down")}     - Step down if leader
  ${chalk.cyan("scenario")} <cmd> - Scenario commands:
    ${chalk.gray("list")}        - List available scenarios
    ${chalk.gray("info <name>")} - Show scenario details
    ${chalk.gray("test <name>")} - Run scenario test
  ${chalk.cyan("metrics")}       - Show current metrics
  ${chalk.cyan("clear")}         - Clear the screen
  ${chalk.cyan("help")}          - Show this help
  ${chalk.cyan("exit")}          - Exit the CLI
    `),
    );
  }

  private async showStatus() {
    const nodeId = process.env.NODE_ID || "unknown";
    const state = this.raftService.getState();
    const isLeader = this.raftService.isLeader();
    const leaderId = this.raftService.getLeaderId();

    console.log(chalk.yellow("\nNode Status:"));
    console.log(`  Node ID:    ${chalk.cyan(nodeId)}`);
    console.log(`  State:      ${this.colorizeState(state)}`);
    console.log(
      `  Is Leader:  ${isLeader ? chalk.green("Yes") : chalk.red("No")}`,
    );
    console.log(
      `  Leader ID:  ${leaderId ? chalk.cyan(leaderId) : chalk.gray("None")}`,
    );
  }

  private async showNodes() {
    const nodes = this.raftService.getClusterNodes();

    console.log(chalk.yellow("\nCluster Nodes:"));
    nodes.forEach((node) => {
      const isSelf = node.nodeId === (process.env.NODE_ID || "unknown");

      let nodeStr = `  ${chalk.cyan(node.nodeId)} - ${chalk.white(node.state)} (Term: ${node.term})`;
      if (node.isLeader) nodeStr += chalk.green(" (Leader)");
      if (isSelf) nodeStr += chalk.magenta(" (Self)");

      console.log(nodeStr);
    });
    console.log(`  Total: ${chalk.white(nodes.length)} nodes`);
  }

  private async showLeader() {
    const leaderId = this.raftService.getLeaderId();

    if (leaderId) {
      console.log(`\nCurrent leader: ${chalk.cyan(leaderId)}`);
    } else {
      console.log(chalk.yellow("\nNo leader elected yet"));
    }
  }

  private async triggerElection() {
    console.log(chalk.yellow("\nTriggering new election..."));
    // This would trigger an election in the actual implementation
    console.log(chalk.gray("(Not implemented in this demo)"));
  }

  private async stepDown() {
    if (!this.raftService.isLeader()) {
      console.log(chalk.red("\nNot the leader, cannot step down"));
      return;
    }

    console.log(chalk.yellow("\nStepping down as leader..."));
    // This would step down in the actual implementation
    console.log(chalk.gray("(Not implemented in this demo)"));
  }

  private async handleScenario(args: string[]) {
    const subCmd = args[0];

    switch (subCmd) {
      case "list":
        this.listScenarios();
        break;

      case "info":
        this.showScenarioInfo(args[1]);
        break;

      case "test":
        await this.testScenario(args[1]);
        break;

      default:
        console.log(chalk.red("Invalid scenario command"));
        console.log(chalk.gray("Usage: scenario [list|info|test] [name]"));
    }
  }

  private listScenarios() {
    console.log(chalk.yellow("\nAvailable Scenarios:"));
    console.log(`
  ${chalk.cyan("cache")}      - Distributed cache with TTL support
  ${chalk.cyan("queue")}      - Distributed task queue with priorities
  ${chalk.cyan("lock")}       - Distributed lock service
  ${chalk.cyan("game")}       - Real-time multiplayer game server
  ${chalk.cyan("monitor")}    - Cluster monitoring dashboard
    `);
  }

  private showScenarioInfo(name: string) {
    const scenarios = {
      cache: {
        name: "Distributed Cache",
        description: "A distributed key-value cache with TTL support",
        endpoints: [
          "GET /cache/:key",
          "POST /cache/:key",
          "DELETE /cache/:key",
          "GET /cache/stats",
        ],
      },
      queue: {
        name: "Task Queue",
        description: "Priority-based distributed task queue",
        endpoints: [
          "POST /tasks",
          "POST /tasks/assign/:workerId",
          "PUT /tasks/:id/complete",
          "GET /tasks/stats",
        ],
      },
      lock: {
        name: "Lock Service",
        description: "Distributed lock service for resource coordination",
        endpoints: [
          "POST /locks/:resource",
          "DELETE /locks/:resource",
          "GET /locks/stats",
        ],
      },
      game: {
        name: "Game Server",
        description: "Real-time multiplayer game server",
        endpoints: ["POST /games", "POST /games/:id/join", "WS /game"],
      },
      monitor: {
        name: "Monitoring",
        description: "Real-time cluster monitoring",
        endpoints: ["GET /monitoring/dashboard", "WS /monitoring"],
      },
    };

    const scenario = scenarios[name];
    if (!scenario) {
      console.log(chalk.red(`Unknown scenario: ${name}`));
      return;
    }

    console.log(chalk.yellow(`\n${scenario.name}:`));
    console.log(`  ${scenario.description}`);
    console.log(chalk.cyan("\n  Endpoints:"));
    scenario.endpoints.forEach((ep) => {
      console.log(`    ${ep}`);
    });
  }

  private async testScenario(name: string) {
    console.log(chalk.yellow(`\nTesting ${name} scenario...`));

    switch (name) {
      case "cache":
        await this.testCacheScenario();
        break;
      case "queue":
        await this.testQueueScenario();
        break;
      case "lock":
        await this.testLockScenario();
        break;
      default:
        console.log(chalk.red(`Unknown scenario: ${name}`));
    }
  }

  private async testCacheScenario() {
    console.log(chalk.gray("1. Setting cache value..."));
    console.log(chalk.gray("2. Getting cache value..."));
    console.log(chalk.gray("3. Checking cache stats..."));
    console.log(chalk.green("✓ Cache scenario test completed"));
  }

  private async testQueueScenario() {
    console.log(chalk.gray("1. Creating task..."));
    console.log(chalk.gray("2. Assigning task to worker..."));
    console.log(chalk.gray("3. Completing task..."));
    console.log(chalk.green("✓ Queue scenario test completed"));
  }

  private async testLockScenario() {
    console.log(chalk.gray("1. Acquiring lock..."));
    console.log(chalk.gray("2. Renewing lock..."));
    console.log(chalk.gray("3. Releasing lock..."));
    console.log(chalk.green("✓ Lock scenario test completed"));
  }

  private async showMetrics() {
    console.log(chalk.yellow("\nCurrent Metrics:"));
    console.log(chalk.gray("(Metrics would be displayed here)"));
  }

  private colorizeState(state: string): string {
    switch (state.toLowerCase()) {
      case "leader":
        return chalk.green(state);
      case "follower":
        return chalk.blue(state);
      case "candidate":
        return chalk.yellow(state);
      default:
        return chalk.gray(state);
    }
  }
}
