import { RaftState } from "@usex/raft";
import chalk from "chalk";
import blessed from "blessed";
import { ClusterManager } from "../utils/cluster-manager";
import { PlaygroundLogger } from "../utils/logger";
import { CounterStateMachine } from "../state-machines/counter-state-machine";

export class ClusterVisualizer {
  private logger = new PlaygroundLogger();
  private clusterManager = new ClusterManager("visualizer-demo");
  private screen?: blessed.Widgets.Screen;
  private isRunning = false;
  private updateInterval?: NodeJS.Timeout;

  async run(): Promise<void> {
    this.logger.section("Real-time Cluster Visualizer");

    console.log(
      chalk.yellow(`
🎬 Starting Real-time Raft Cluster Visualizer

This interactive dashboard provides a live view of your Raft cluster:

• Real-time node states and transitions
• Live metrics and performance data
• Interactive controls for cluster operations
• Visual representation of consensus process
• Network topology and partition visualization

Press 'q' to quit the visualizer at any time.
`),
    );

    try {
      // Setup cluster first
      await this.setupVisualizationCluster();

      // Start the visual interface
      await this.startVisualInterface();
    } catch (_error) {
      this.logger.error("Cluster visualizer failed", undefined, _error);
    } finally {
      await this.cleanup();
    }
  }

  private async setupVisualizationCluster(): Promise<void> {
    console.log(chalk.blue("Setting up cluster for visualization..."));

    await this.clusterManager.createCluster(5, "counter");

    // Wait for stability
    await this.delay(3000);

    const leader = this.clusterManager.getLeader();
    if (leader) {
      console.log(
        chalk.green(
          `Cluster ready for visualization with leader: ${leader.nodeId}`,
        ),
      );
    } else {
      console.log(chalk.yellow("Cluster created but no leader yet"));
    }

    // Add some initial data
    const stateMachine = new CounterStateMachine("viz-init");
    for (let i = 0; i < 5; i++) {
      try {
        await this.clusterManager.appendToLeader(
          stateMachine.createIncrementCommand(1, `init-${i}`),
        );
      } catch {
        // Continue if operations fail
      }
    }

    await this.delay(1000);
    console.log(chalk.blue("Starting visualizer..."));
  }

  private async startVisualInterface(): Promise<void> {
    // Create blessed screen
    this.screen = blessed.screen({
      smartCSR: true,
      title: "Raft Cluster Visualizer",
    });

    // Create main container
    const container = blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: "100%",
      height: "100%",
      border: {
        type: "line",
      },
      style: {
        border: {
          fg: "cyan",
        },
      },
    });

    // Title
    // const _title = blessed.text({
    //   parent: container,
    //   top: 0,
    //   left: "center",
    //   width: "shrink",
    //   height: 1,
    //   content: "🏛️  RAFT CLUSTER VISUALIZER 🏛️",
    //   style: {
    //     fg: "cyan",
    //     bold: true,
    //   },
    // });

    // Cluster overview box
    const overviewBox = blessed.box({
      parent: container,
      label: " Cluster Overview ",
      top: 2,
      left: 0,
      width: "50%",
      height: 8,
      border: {
        type: "line",
      },
      style: {
        border: {
          fg: "green",
        },
      },
    });

    // Node details box
    const nodesBox = blessed.box({
      parent: container,
      label: " Node Details ",
      top: 2,
      left: "50%",
      width: "50%",
      height: 15,
      border: {
        type: "line",
      },
      style: {
        border: {
          fg: "blue",
        },
      },
      scrollable: true,
      alwaysScroll: true,
    });

    // Metrics box
    const metricsBox = blessed.box({
      parent: container,
      label: " Performance Metrics ",
      top: 10,
      left: 0,
      width: "50%",
      height: 7,
      border: {
        type: "line",
      },
      style: {
        border: {
          fg: "yellow",
        },
      },
    });

    // Operations log
    const operationsBox = blessed.box({
      parent: container,
      label: " Recent Operations ",
      top: 17,
      left: 0,
      width: "100%",
      height: 8,
      border: {
        type: "line",
      },
      style: {
        border: {
          fg: "magenta",
        },
      },
      scrollable: true,
      alwaysScroll: true,
    });

    // Controls box
    // const controlsBox = blessed.box({
    //   parent: container,
    //   label: " Controls ",
    //   top: 25,
    //   left: 0,
    //   width: "100%",
    //   height: 5,
    //   border: {
    //     type: "line",
    //   },
    //   style: {
    //     border: {
    //       fg: "white",
    //     },
    //   },
    // });

    // Controls text
    // const _controlsText = blessed.text({
    //   parent: container, // was controlsBox
    //   top: 0,
    //   left: 1,
    //   width: "100%-2",
    //   height: 3,
    //   content:
    //     "Controls: [s] Submit Operation | [f] Fail Random Node | [r] Restart Failed Node | [p] Network Partition | [h] Heal Partition | [q] Quit",
    //   style: {
    //     fg: "white",
    //   },
    // });

    // Status bar
    const statusBar = blessed.text({
      parent: container,
      bottom: 0,
      left: 0,
      width: "100%",
      height: 1,
      content: "Status: Running | Press [q] to quit",
      style: {
        fg: "white",
        bg: "blue",
      },
    });

    // Handle key events
    this.screen.key(["q", "C-c"], () => {
      this.isRunning = false;
      this.screen?.destroy();
      process.exit(0);
    });

    // Operation submission
    this.screen.key("s", async () => {
      try {
        const stateMachine = new CounterStateMachine("viz-user");
        await this.clusterManager.appendToLeader(
          stateMachine.createIncrementCommand(
            Math.floor(Math.random() * 5) + 1,
            "user-action",
          ),
        );
        this.appendToOperationsLog(
          operationsBox,
          "User submitted increment operation",
        );
      } catch (_error) {
        this.appendToOperationsLog(
          operationsBox,
          `Operation failed: ${(_error as Error).message}`,
        );
      }
    });

    // Fail random node
    this.screen.key("f", async () => {
      try {
        const nodes = this.clusterManager.getAllNodes();
        const activeNodes = nodes.filter(
          (n) => n.node.getState() !== RaftState.CANDIDATE,
        );

        if (activeNodes.length > 2) {
          // Keep majority
          const randomNode =
            activeNodes[Math.floor(Math.random() * activeNodes.length)];
          await this.clusterManager.stopNode(randomNode.nodeId);
          this.appendToOperationsLog(
            operationsBox,
            `Failed node: ${randomNode.nodeId}`,
          );
        } else {
          this.appendToOperationsLog(
            operationsBox,
            "Cannot fail more nodes (would lose quorum)",
          );
        }
      } catch (_error) {
        this.appendToOperationsLog(
          operationsBox,
          `Node failure failed: ${(_error as Error).message}`,
        );
      }
    });

    // Restart random failed node
    this.screen.key("r", async () => {
      try {
        // In a real implementation, we'd track failed nodes
        // For demo, we'll try to restart a random node ID
        const allPossibleNodes = [
          "node-0",
          "node-1",
          "node-2",
          "node-3",
          "node-4",
        ];
        const activeNodes = this.clusterManager
          .getAllNodes()
          .map((n) => n.nodeId);
        const failedNodes = allPossibleNodes.filter(
          (id) => !activeNodes.includes(id),
        );

        if (failedNodes.length > 0) {
          const nodeToRestart =
            failedNodes[Math.floor(Math.random() * failedNodes.length)];
          await this.clusterManager.startNode(nodeToRestart);
          this.appendToOperationsLog(
            operationsBox,
            `Restarted node: ${nodeToRestart}`,
          );
        } else {
          this.appendToOperationsLog(
            operationsBox,
            "No failed nodes to restart",
          );
        }
      } catch (_error) {
        this.appendToOperationsLog(
          operationsBox,
          `Node restart failed: ${(_error as Error).message}`,
        );
      }
    });

    // Network partition
    this.screen.key("p", async () => {
      try {
        const nodes = this.clusterManager.getAllNodes().map((n) => n.nodeId);
        if (nodes.length >= 3) {
          const mid = Math.floor(nodes.length / 2);
          const partition1 = nodes.slice(0, mid + 1);
          const partition2 = nodes.slice(mid + 1);

          await this.clusterManager.simulateNetworkPartition(
            partition1,
            partition2,
          );
          this.appendToOperationsLog(
            operationsBox,
            `Network partition: [${partition1.join(",")}] | [${partition2.join(",")}]`,
          );
        }
      } catch (_error) {
        this.appendToOperationsLog(
          operationsBox,
          `Partition failed: ${(_error as Error).message}`,
        );
      }
    });

    // Heal partition
    this.screen.key("h", async () => {
      try {
        const nodes = this.clusterManager.getAllNodes().map((n) => n.nodeId);
        // Heal by reconnecting all nodes (simplified)
        await this.clusterManager.healNetworkPartition(nodes);
        this.appendToOperationsLog(operationsBox, "Network partition healed");
      } catch (_error) {
        this.appendToOperationsLog(
          operationsBox,
          `Heal failed: ${(_error as Error).message}`,
        );
      }
    });

    // Start data updates
    this.isRunning = true;
    let updateCount = 0;
    let operationCount = 0;

    this.updateInterval = setInterval(async () => {
      if (!this.isRunning) return;

      try {
        updateCount++;

        // Update cluster overview
        const metrics = await this.clusterManager.getMetrics();
        const nodes = this.clusterManager.getAllNodes();

        const overviewContent = [
          `Cluster Size: ${nodes.length} nodes`,
          `Leader: ${metrics.leader || "None"}`,
          `Current Term: ${metrics.term}`,
          `Followers: ${metrics.followers.length}`,
          `Candidates: ${metrics.candidates.length}`,
          `Last Update: ${new Date().toLocaleTimeString()}`,
        ];

        overviewBox.setContent(overviewContent.join("\\n"));

        // Update node details
        let nodeContent = "";
        for (const nodeInfo of nodes) {
          const state = nodeInfo.node.getState();
          const term = nodeInfo.node.getCurrentTerm();
          const commitIndex = nodeInfo.node.getCommitIndex();
          const lastApplied = nodeInfo.node.getLastApplied();
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

          nodeContent += `${stateIcon} ${nodeInfo.nodeId}\\n`;
          nodeContent += `  State: ${state}\\n`;
          nodeContent += `  Term: ${term}\\n`;
          nodeContent += `  Commit: ${commitIndex}\\n`;
          nodeContent += `  Applied: ${lastApplied}\\n`;
          nodeContent += `  Counter: ${smState.value}\\n`;
          nodeContent += `\\n`;
        }

        nodesBox.setContent(nodeContent);

        // Update metrics
        const stateMachineStates = nodes.map((nodeInfo) => {
          const sm = nodeInfo.stateMachine as CounterStateMachine;
          return sm.getState();
        });

        const uniqueValues = new Set(stateMachineStates.map((s) => s.value));
        const consistencyStatus =
          uniqueValues.size === 1 ? "Consistent" : "Inconsistent";
        const counterValue =
          stateMachineStates.length > 0 ? stateMachineStates[0].value : 0;

        const metricsContent = [
          `Consistency: ${consistencyStatus}`,
          `Counter Value: ${counterValue}`,
          `Updates: ${updateCount}`,
          `Memory: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`,
        ];

        metricsBox.setContent(metricsContent.join("\\n"));

        // Occasionally submit automatic operations
        if (updateCount % 10 === 0) {
          try {
            const stateMachine = new CounterStateMachine("auto-viz");
            const operations = ["increment", "decrement"];
            const op =
              operations[Math.floor(Math.random() * operations.length)];

            if (op === "increment") {
              await this.clusterManager.appendToLeader(
                stateMachine.createIncrementCommand(
                  1,
                  `auto-${operationCount++}`,
                ),
              );
            } else {
              await this.clusterManager.appendToLeader(
                stateMachine.createDecrementCommand(
                  1,
                  `auto-${operationCount++}`,
                ),
              );
            }

            this.appendToOperationsLog(
              operationsBox,
              `Auto-${op} operation completed`,
            );
          } catch {
            // Continue on error
          }
        }

        // Refresh screen
        this.screen?.render();
      } catch (_error) {
        // Handle errors gracefully
        statusBar.setContent(
          `Status: Error - ${(_error as Error).message} | Press [q] to quit`,
        );
        this.screen?.render();
      }
    }, 1000); // Update every second

    // Initial render
    this.screen.render();

    // Keep the interface running
    await new Promise((resolve) => {
      this.screen?.on("destroy", resolve);
    });
  }

  private appendToOperationsLog(
    box: blessed.Widgets.BoxElement,
    message: string,
  ): void {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = `[${timestamp}] ${message}`;

    const currentContent = box.getContent();
    const lines = currentContent.split("\\n").filter((line) => line.trim());

    // Keep only last 10 lines
    if (lines.length >= 10) {
      lines.shift();
    }

    lines.push(logEntry);
    box.setContent(lines.join("\\n"));

    // Scroll to bottom
    box.setScrollPerc(100);
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async cleanup(): Promise<void> {
    this.isRunning = false;

    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }

    if (this.screen) {
      this.screen.destroy();
    }

    console.log(chalk.blue("Cleaning up visualizer..."));
    await this.clusterManager.cleanup();
    console.log(chalk.green("Visualizer cleanup complete"));
  }
}
