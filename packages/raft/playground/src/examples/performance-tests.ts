import chalk from "chalk";
import { ClusterManager } from "../utils/cluster-manager.js";
import { PlaygroundLogger } from "../utils/logger.js";
import { CounterStateMachine } from "../state-machines/counter-state-machine.js";

export class PerformanceTestsDemo {
  private logger = new PlaygroundLogger();
  private clusterManager = new ClusterManager("performance-demo");

  async run(): Promise<void> {
    this.logger.section("Performance Testing and Benchmarks");

    try {
      // Setup performance cluster
      await this.setupPerformanceCluster();

      // Benchmark 1: Throughput testing
      await this.benchmarkThroughput();

      // Benchmark 2: Latency testing
      await this.benchmarkLatency();

      // Benchmark 3: Concurrent clients
      await this.benchmarkConcurrentClients();

      // Benchmark 4: Large cluster performance
      await this.benchmarkLargeCluster();

      // Benchmark 5: Memory and resource usage
      await this.benchmarkResourceUsage();

      this.logger.result(
        true,
        "All performance benchmarks completed successfully!",
      );
    } catch (_error) {
      this.logger.error("Performance testing failed", undefined, _error);
      this.logger.result(false, "Performance testing failed");
    } finally {
      await this.cleanup();
    }
  }

  private async setupPerformanceCluster(): Promise<void> {
    this.logger.step(1, "Setting up high-performance cluster");
    await this.clusterManager.createCluster(3, "counter");

    // Wait for stability and warm up
    this.logger.info("Warming up cluster...");
    const stateMachine = new CounterStateMachine("warmup");
    for (let i = 0; i < 10; i++) {
      await this.clusterManager.appendToLeader(
        stateMachine.createIncrementCommand(1, "warmup"),
      );
      await this.delay(50);
    }

    this.logger.success("Performance cluster ready");
  }

  private async benchmarkThroughput(): Promise<void> {
    this.logger.step(2, "Throughput Benchmark");
    this.logger.info("Testing maximum operations per second...");

    const operationCounts = [100, 500, 1000, 2000];
    const results: Array<{
      count: number;
      duration: number;
      opsPerSec: number;
    }> = [];

    for (const opCount of operationCounts) {
      this.logger.info(`\nTesting ${opCount} operations...`);

      const stateMachine = new CounterStateMachine("throughput");
      const commands = Array.from({ length: opCount }, (_, i) =>
        stateMachine.createIncrementCommand(1, `throughput-${i}`),
      );

      const startTime = Date.now();

      // Submit all operations
      for (let i = 0; i < commands.length; i++) {
        try {
          await this.clusterManager.appendToLeader(commands[i]);

          // Show progress for large batches
          if (opCount >= 500 && (i + 1) % 100 === 0) {
            this.logger.progress(i + 1, opCount, "Operations submitted");
          }
        } catch (_error) {
          this.logger.error(`Operation ${i} failed`, undefined, _error);
        }
      }

      const endTime = Date.now();
      const duration = endTime - startTime;
      const opsPerSec = Math.round((opCount / duration) * 1000);

      results.push({ count: opCount, duration, opsPerSec });

      this.logger.metric("Operations", opCount.toString());
      this.logger.metric("Duration", duration.toString(), "ms");
      this.logger.metric("Throughput", opsPerSec.toString(), "ops/sec");

      // Wait for replication to complete
      await this.delay(1000);
    }

    // Display throughput summary
    console.log(chalk.cyan("\n📊 Throughput Benchmark Results:"));
    console.log(chalk.blue("Operations | Duration | Throughput"));
    console.log(chalk.blue("-----------|----------|----------"));

    for (const result of results) {
      console.log(
        chalk.white(
          `${result.count.toString().padStart(10)} | ${result.duration.toString().padStart(8)}ms | ${result.opsPerSec.toString().padStart(7)} ops/sec`,
        ),
      );
    }

    const maxThroughput = Math.max(...results.map((r) => r.opsPerSec));
    this.logger.success(`Peak throughput: ${maxThroughput} ops/sec`);
  }

  private async benchmarkLatency(): Promise<void> {
    this.logger.step(3, "Latency Benchmark");
    this.logger.info("Measuring individual operation latency...");

    const sampleSize = 100;
    const latencies: number[] = [];
    const stateMachine = new CounterStateMachine("latency");

    this.logger.info(
      `Measuring ${sampleSize} individual operation latencies...`,
    );

    for (let i = 0; i < sampleSize; i++) {
      const command = stateMachine.createIncrementCommand(1, `latency-${i}`);

      const startTime = process.hrtime.bigint();

      try {
        await this.clusterManager.appendToLeader(command);
        const endTime = process.hrtime.bigint();
        const latencyNs = Number(endTime - startTime);
        const latencyMs = latencyNs / 1_000_000;

        latencies.push(latencyMs);

        if ((i + 1) % 20 === 0) {
          this.logger.progress(i + 1, sampleSize, "Latency samples");
        }
      } catch (_error) {
        this.logger.error(`Latency test ${i} failed`, undefined, _error);
      }

      // Small delay between operations
      await this.delay(10);
    }

    // Calculate statistics
    latencies.sort((a, b) => a - b);
    const min = latencies[0] || 0;
    const max = latencies[latencies.length - 1] || 0;
    const avg = latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length;
    const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
    const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
    const p99 = latencies[Math.floor(latencies.length * 0.99)] || 0;

    console.log(chalk.cyan("\n📊 Latency Benchmark Results:"));
    this.logger.metric("Samples", sampleSize.toString());
    this.logger.metric("Min latency", min.toFixed(2), "ms");
    this.logger.metric("Max latency", max.toFixed(2), "ms");
    this.logger.metric("Avg latency", avg.toFixed(2), "ms");
    this.logger.metric("P50 latency", p50.toFixed(2), "ms");
    this.logger.metric("P95 latency", p95.toFixed(2), "ms");
    this.logger.metric("P99 latency", p99.toFixed(2), "ms");
  }

  private async benchmarkConcurrentClients(): Promise<void> {
    this.logger.step(4, "Concurrent Clients Benchmark");
    this.logger.info("Testing performance with multiple concurrent clients...");

    const clientCounts = [1, 5, 10, 20];
    const operationsPerClient = 50;

    for (const clientCount of clientCounts) {
      this.logger.info(
        `\nTesting ${clientCount} concurrent clients (${operationsPerClient} ops each)...`,
      );

      const startTime = Date.now();

      // Create concurrent client operations
      const clientPromises = Array.from(
        { length: clientCount },
        async (_, clientId) => {
          const stateMachine = new CounterStateMachine(`client-${clientId}`);
          const clientLatencies: number[] = [];

          for (let opId = 0; opId < operationsPerClient; opId++) {
            try {
              const opStart = process.hrtime.bigint();
              await this.clusterManager.appendToLeader(
                stateMachine.createIncrementCommand(
                  1,
                  `client-${clientId}-op-${opId}`,
                ),
              );
              const opEnd = process.hrtime.bigint();
              clientLatencies.push(Number(opEnd - opStart) / 1_000_000);
            } catch (_error) {
              this.logger.error(
                `Client ${clientId} operation ${opId} failed`,
                undefined,
                _error,
              );
            }
          }

          return {
            clientId,
            latencies: clientLatencies,
            avgLatency:
              clientLatencies.reduce((sum, lat) => sum + lat, 0) /
              clientLatencies.length,
          };
        },
      );

      const clientResults = await Promise.allSettled(clientPromises);
      const endTime = Date.now();

      const totalDuration = endTime - startTime;
      const totalOperations = clientCount * operationsPerClient;
      const totalThroughput = Math.round(
        (totalOperations / totalDuration) * 1000,
      );

      // Calculate aggregate statistics
      const successfulClients = clientResults
        .filter((result) => result.status === "fulfilled")
        .map((result) => (result as PromiseFulfilledResult<any>).value);

      const allLatencies = successfulClients.flatMap(
        (client) => client.latencies,
      );
      const avgLatency =
        allLatencies.reduce((sum, lat) => sum + lat, 0) / allLatencies.length;

      this.logger.metric("Concurrent clients", clientCount.toString());
      this.logger.metric("Total operations", totalOperations.toString());
      this.logger.metric("Total duration", totalDuration.toString(), "ms");
      this.logger.metric(
        "Aggregate throughput",
        totalThroughput.toString(),
        "ops/sec",
      );
      this.logger.metric("Average latency", avgLatency.toFixed(2), "ms");
      this.logger.metric(
        "Successful clients",
        successfulClients.length.toString(),
      );
    }
  }

  private async benchmarkLargeCluster(): Promise<void> {
    this.logger.step(5, "Large Cluster Performance");
    this.logger.info("Testing performance scaling with cluster size...");

    // Test current 3-node cluster first
    await this.measureClusterPerformance(3);

    // Scale up to 5 nodes
    this.logger.info("Scaling cluster to 5 nodes...");
    await this.clusterManager.addNode("perf-node-3", "counter");
    await this.clusterManager.addNode("perf-node-4", "counter");
    await this.delay(3000); // Wait for stabilization

    await this.measureClusterPerformance(5);

    // Scale up to 7 nodes
    this.logger.info("Scaling cluster to 7 nodes...");
    await this.clusterManager.addNode("perf-node-5", "counter");
    await this.clusterManager.addNode("perf-node-6", "counter");
    await this.delay(3000);

    await this.measureClusterPerformance(7);
  }

  private async measureClusterPerformance(nodeCount: number): Promise<void> {
    this.logger.info(`\nMeasuring performance with ${nodeCount} nodes...`);

    const operationCount = 200;
    const stateMachine = new CounterStateMachine(`cluster-${nodeCount}`);

    const startTime = Date.now();

    for (let i = 0; i < operationCount; i++) {
      try {
        await this.clusterManager.appendToLeader(
          stateMachine.createIncrementCommand(1, `cluster-test-${i}`),
        );
      } catch (_error) {
        this.logger.error(`Cluster operation ${i} failed`, undefined, _error);
      }
    }

    const endTime = Date.now();
    const duration = endTime - startTime;
    const throughput = Math.round((operationCount / duration) * 1000);

    // Wait for replication and measure consistency
    await this.delay(2000);

    const nodes = this.clusterManager.getAllNodes();
    const states = nodes.map((nodeInfo) => {
      const sm = nodeInfo.stateMachine as CounterStateMachine;
      return sm.getState();
    });

    const allConsistent = states.every(
      (state) =>
        state.value === states[0].value && state.version === states[0].version,
    );

    this.logger.metric(
      `${nodeCount}-node throughput`,
      throughput.toString(),
      "ops/sec",
    );
    this.logger.metric(`${nodeCount}-node duration`, duration.toString(), "ms");
    this.logger.result(allConsistent, `${nodeCount}-node consistency check`);
  }

  private async benchmarkResourceUsage(): Promise<void> {
    this.logger.step(6, "Resource Usage Analysis");
    this.logger.info("Analyzing memory and resource usage patterns...");

    // Simulate memory usage tracking
    const initialMemory = process.memoryUsage();
    this.logger.info("Initial memory usage:");
    this.displayMemoryUsage(initialMemory);

    // Submit operations and track memory
    this.logger.info("\nSubmitting operations and tracking resource usage...");
    const stateMachine = new CounterStateMachine("resource");

    const checkpoints = [0, 250, 500, 1000];

    for (const checkpoint of checkpoints) {
      if (checkpoint > 0) {
        // Submit operations up to checkpoint
        const opsToSubmit =
          checkpoint - (checkpoints[checkpoints.indexOf(checkpoint) - 1] || 0);

        for (let i = 0; i < opsToSubmit; i++) {
          await this.clusterManager.appendToLeader(
            stateMachine.createIncrementCommand(
              1,
              `resource-${checkpoint}-${i}`,
            ),
          );
        }

        await this.delay(1000); // Wait for processing
      }

      const currentMemory = process.memoryUsage();
      console.log(chalk.yellow(`\nAfter ${checkpoint} operations:`));
      this.displayMemoryUsage(currentMemory);

      if (checkpoint > 0) {
        const memoryIncrease = currentMemory.heapUsed - initialMemory.heapUsed;
        this.logger.metric(
          "Memory increase",
          `${(memoryIncrease / 1024 / 1024).toFixed(2)} MB`,
        );
      }
    }

    // Force garbage collection if available
    if (global.gc) {
      this.logger.info("\nForcing garbage collection...");
      global.gc();
      const postGCMemory = process.memoryUsage();
      console.log(chalk.green("After garbage collection:"));
      this.displayMemoryUsage(postGCMemory);
    }

    // Display cluster metrics if available
    const leader = this.clusterManager.getLeader();
    if (leader) {
      const metrics = leader.node.getMetrics();
      if (metrics) {
        console.log(chalk.cyan("\n📊 Raft Metrics:"));
        console.log(
          chalk.blue(`Current Term: ${leader.node.getCurrentTerm()}`),
        );
        console.log(
          chalk.blue(`Commit Index: ${leader.node.getCommitIndex()}`),
        );
        console.log(
          chalk.blue(`Last Applied: ${leader.node.getLastApplied()}`),
        );
      }
    }
  }

  private displayMemoryUsage(memUsage: NodeJS.MemoryUsage): void {
    const formatBytes = (bytes: number) =>
      `${(bytes / 1024 / 1024).toFixed(2)} MB`;

    console.log(chalk.blue(`  RSS: ${formatBytes(memUsage.rss)}`));
    console.log(chalk.blue(`  Heap Total: ${formatBytes(memUsage.heapTotal)}`));
    console.log(chalk.blue(`  Heap Used: ${formatBytes(memUsage.heapUsed)}`));
    console.log(chalk.blue(`  External: ${formatBytes(memUsage.external)}`));
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async cleanup(): Promise<void> {
    this.logger.info("Cleaning up performance tests...");
    await this.clusterManager.cleanup();
  }
}
