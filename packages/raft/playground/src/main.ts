#!/usr/bin/env node

import chalk from "chalk";
import { InteractiveOption, InteractiveCommand } from "interactive-commander";
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

const showcaseChoices = [
  "cluster",
  "election",
  "replication",
  "membership",
  "snapshot",
  "failures",
  "performance",
  "monitoring",
  "weighted",
  "partition",
  "transfer",
  "concurrent",
  "recovery",
  "stress",
  "interactive",
  "visualizer",
];

const cli = new InteractiveCommand()
  .name("raft-playground")
  .description("Complete Raft consensus algorithm playground")
  .helpOption("-h, --help", "Show help")
  .version(`v${RaftVersion}`, "-v, --version", "Show version")
  .interactive("-y, --no-interactive", "Disable interactive mode")
  .exitOverride((err) => {
    // Exit with code 0 when help or version is displayed
    if (
      err.code === "commander.helpDisplayed" ||
      err.code === "commander.version" ||
      err.code === "commander.help"
    ) {
      process.exit(0);
    }
    throw err;
  });

// Main showcase command with interactive options
cli
  .command("showcase")
  .description("Run Raft consensus showcases")
  .addOption(
    new InteractiveOption(
      "-s, --showcase <showcase>",
      "Choose which showcase to run",
    )
      .choices(showcaseChoices)
      .makeOptionMandatory(),
  )
  .addOption(
    new InteractiveOption("-r, --repeat", "Repeat showcase after completion")
      .default(false)
      .makeOptionMandatory(false),
  )
  .action(async (options) => {
    const { showcase, repeat } = options;

    console.log(chalk.yellow(`\n🎯 Running ${showcase} showcase...\n`));

    await runShowcase(showcase);

    if (repeat) {
      console.log(chalk.cyan("\n🔄 Repeating showcase...\n"));
      await runShowcase(showcase);
    }

    console.log(chalk.green("\n✅ Showcase completed successfully!"));
  });

async function runShowcase(showcase: string) {
  switch (showcase) {
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
    default:
      console.log(chalk.red(`Unknown showcase: ${showcase}`));
      process.exit(1);
  }
}

// Handle Ctrl+C gracefully
process.on("SIGINT", () => {
  console.log("\n");
  console.log(chalk.green("👋 Thanks for exploring Raft! Goodbye!"));
  console.log("\n");
  process.exit(0);
});

// Default action - run showcase command if no command is provided
if (process.argv.length === 2) {
  // No arguments provided, run showcase command in interactive mode
  process.argv.push("showcase");
}

// Parse command line arguments
void cli.parseAsync(process.argv);
