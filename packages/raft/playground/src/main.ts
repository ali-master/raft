#!/usr/bin/env node

import chalk from "chalk";
import { Command } from "commander";
import inquirer from "inquirer";
import { ClusterShowcase } from "./showcases/cluster-showcase";
import { LeaderElectionShowcase } from "./showcases/leader-election";
import { LogReplicationShowcase } from "./showcases/log-replication";
import { MembershipChangesShowcase } from "./showcases/membership-changes";
import { SnapshotShowcase } from "./showcases/snapshots";
import { FailuresScenariosShowcase } from "./showcases/failure-scenarios";
import { PerformanceTestsShowcase } from "./showcases/performance-tests";
import { MonitoringShowcase } from "./showcases/monitoring";
import { WeightedVotingShowcase } from "./showcases/weighted-voting";
import { NetworkPartitionShowcase } from "./showcases/network-partition";
import { LeadershipTransferShowcase } from "./showcases/leadership-transfer";
import { ConcurrentWritesShowcase } from "./showcases/concurrent-writes";
import { RecoveryShowcase } from "./showcases/recovery-scenarios";
import { StressTestShowcase } from "./showcases/stress-test";
import { InteractiveCLI } from "./interactive/cli";
import { ClusterVisualizer } from "./visualization/cluster-visualizer";
import { version as RaftVersion } from "../../package.json";

const program = new Command("Raft");

console.log(
  chalk.cyan.bold(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║                🚀 RAFT CONSENSUS PLAYGROUND 🚀            ║
║                                                           ║
║           Complete 100% Coverage of Raft Use Cases        ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
`),
);

program
  .name("raft-playground")
  .description("Complete Raft consensus algorithm playground")
  .version(RaftVersion);

async function showMainMenu() {
  console.log(chalk.yellow("\n🎯 Welcome to the Raft Consensus Playground!\n"));

  const choices = [
    { name: "Basic Cluster Showcase", value: "cluster" },
    { name: "Leader Election", value: "election" },
    { name: "Log Replication", value: "replication" },
    { name: "Membership Changes", value: "membership" },
    { name: "Snapshots & Compaction", value: "snapshot" },
    { name: "Failure Scenarios", value: "failures" },
    { name: "Performance Testing", value: "performance" },
    { name: "Monitoring & Metrics", value: "monitoring" },
    { name: "️Weighted Voting", value: "weighted" },
    { name: "Network Partitions", value: "partition" },
    { name: "Leadership Transfer", value: "transfer" },
    { name: "Concurrent Writes", value: "concurrent" },
    { name: "Recovery Scenarios", value: "recovery" },
    { name: "Stress Testing", value: "stress" },
    { name: "Interactive CLI", value: "interactive" },
    { name: "Real-time Visualizer", value: "visualizer" },
    { name: "Random Demo", value: "random" },
    { name: "Exit", value: "exit" },
  ];

  const answer = await inquirer.prompt([
    {
      type: "list",
      name: "demo",
      message: "Choose a Raft demonstration:",
      choices,
      pageSize: 20,
      loop: true,
    },
  ]);

  console.log();

  switch (answer.demo) {
    case "cluster":
      await new ClusterShowcase().run();
      break;
    case "election":
      await new LeaderElectionShowcase().run();
      break;
    case "replication":
      await new LogReplicationShowcase().run();
      break;
    case "membership":
      await new MembershipChangesShowcase().run();
      break;
    case "snapshot":
      await new SnapshotShowcase().run();
      break;
    case "failures":
      await new FailuresScenariosShowcase().run();
      break;
    case "performance":
      await new PerformanceTestsShowcase().run();
      break;
    case "monitoring":
      await new MonitoringShowcase().run();
      break;
    case "weighted":
      await new WeightedVotingShowcase().run();
      break;
    case "partition":
      await new NetworkPartitionShowcase().run();
      break;
    case "transfer":
      await new LeadershipTransferShowcase().run();
      break;
    case "concurrent":
      await new ConcurrentWritesShowcase().run();
      break;
    case "recovery":
      await new RecoveryShowcase().run();
      break;
    case "stress":
      await new StressTestShowcase().run();
      break;
    case "interactive":
      await new InteractiveCLI().run();
      break;
    case "visualizer":
      await new ClusterVisualizer().run();
      break;
    case "random": {
      const randomChoice =
        choices[Math.floor(Math.random() * (choices.length - 2))]!;
      console.log(chalk.magenta(`🎲 Randomly selected: ${randomChoice.name}`));

      await showMainMenu();
      break;
    }
    case "exit":
      console.log(chalk.green("👋 Thanks for exploring Raft! Goodbye!"));
      process.exit(0);
  }

  // Ask if they want to continue
  const continueAnswer = await inquirer.prompt([
    {
      type: "confirm",
      name: "continue",
      message: "Would you like to try another demo?",
      default: true,
    },
  ]);

  if (continueAnswer.continue) {
    await showMainMenu();
  } else {
    console.log(chalk.green("👋 Thanks for exploring Raft! Goodbye!"));
    process.exit(0);
  }
}

process.on("uncaughtException", (error) => {
  if (error instanceof Error && error.name === "ExitPromptError") {
    console.log("\n");
    console.log(chalk.green("👋 Thanks for exploring Raft! Goodbye!"));
    console.log("\n");
    process.exit(0);
  }
});

// CLI commands
program
  .command("menu")
  .description("Show interactive menu")
  .action(showMainMenu);

program
  .command("cluster")
  .description("Basic cluster demonstration")
  .action(() => new ClusterShowcase().run());

program
  .command("election")
  .description("Leader election scenarios")
  .action(() => new LeaderElectionShowcase().run());

program
  .command("replication")
  .description("Log replication examples")
  .action(() => new LogReplicationShowcase().run());

program
  .command("membership")
  .description("Cluster membership changes")
  .action(() => new MembershipChangesShowcase().run());

program
  .command("snapshot")
  .description("Snapshot and compaction demo")
  .action(() => new SnapshotShowcase().run());

program
  .command("failures")
  .description("Failure scenarios and recovery")
  .action(() => new FailuresScenariosShowcase().run());

program
  .command("performance")
  .description("Performance testing and benchmarks")
  .action(() => new PerformanceTestsShowcase().run());

program
  .command("monitoring")
  .description("Monitoring and metrics collection")
  .action(() => new MonitoringShowcase().run());

program
  .command("weighted")
  .description("Weighted voting demonstration")
  .action(() => new WeightedVotingShowcase().run());

program
  .command("partition")
  .description("Network partition scenarios")
  .action(() => new NetworkPartitionShowcase().run());

program
  .command("transfer")
  .description("Leadership transfer scenarios")
  .action(() => new LeadershipTransferShowcase().run());

program
  .command("concurrent")
  .description("Concurrent writes and conflicts")
  .action(() => new ConcurrentWritesShowcase().run());

program
  .command("recovery")
  .description("Recovery and disaster scenarios")
  .action(() => new RecoveryShowcase().run());

program
  .command("stress")
  .description("Stress testing scenarios")
  .action(() => new StressTestShowcase().run());

program
  .command("interactive")
  .description("Interactive CLI interface")
  .action(() => new InteractiveCLI().run());

program
  .command("visualizer")
  .description("Real-time cluster visualizer")
  .action(() => new ClusterVisualizer().run());

// Default action
if (process.argv.length === 2) {
  void showMainMenu();
} else {
  program.parse();
}
