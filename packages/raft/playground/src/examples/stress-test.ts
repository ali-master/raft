import chalk from "chalk";
import { RaftState } from "@usex/raft";
import { ClusterManager } from "../utils/cluster-manager.js";
import { PlaygroundLogger } from "../utils/logger.js";
import { CounterStateMachine } from "../state-machines/counter-state-machine.js";

export class StressTestDemo {
  private logger = new PlaygroundLogger();
  private clusterManager = new ClusterManager("stress-test-demo");
  private isStressing = false;
  private stressResults: any = {};

  async run(): Promise<void> {
    this.logger.section("Stress Testing Scenarios");

    try {
      // Setup stress test cluster
      await this.setupStressCluster();

      // Test 1: High throughput stress
      await this.runHighThroughputStress();

      // Test 2: Concurrent connections stress
      await this.runConcurrentConnectionsStress();

      // Test 3: Memory pressure stress
      await this.runMemoryPressureStress();

      // Test 4: Failure chaos stress
      await this.runFailureChaosStress();

      // Test 5: Long duration endurance test
      await this.runEnduranceStress();

      // Generate final stress test report
      await this.generateStressReport();

      this.logger.result(
        true,
        "All stress test scenarios completed successfully!",
      );
    } catch (_error) {
      this.logger.error("Stress test demo failed", undefined, _error);
      this.logger.result(false, "Stress testing failed");
    } finally {
      this.isStressing = false;
      await this.cleanup();
    }
  }

  private async setupStressCluster(): Promise<void> {
    this.logger.step(1, "Setting up stress test cluster");

    // Use larger cluster for stress testing
    await this.clusterManager.createCluster(7, "counter");

    // Wait for stability
    await this.delay(3000);

    const leader = this.clusterManager.getLeader();
    if (leader) {
      this.logger.success(
        `Stress test cluster ready with leader: ${leader.nodeId}`,
      );
    } else {
      this.logger.error("Failed to set up stress test cluster");
    }

    // Initialize stress results tracking
    this.stressResults = {
      throughput: {},
      concurrency: {},
      memory: {},
      chaos: {},
      endurance: {},
      startTime: Date.now(),
    };
  }

  private async runHighThroughputStress(): Promise<void> {
    this.logger.step(2, "High Throughput Stress Test");
    this.logger.info("Testing maximum sustainable throughput...");

    const testDuration = 30000; // 30 seconds
    const batchSizes = [10, 50, 100, 200];

    for (const batchSize of batchSizes) {
      this.logger.info(`\\nTesting batch size: ${batchSize}`);

      const startTime = Date.now();
      const endTime = startTime + testDuration;
      let operationCount = 0;
      let successCount = 0;
      let errorCount = 0;

      this.isStressing = true;

      while (Date.now() < endTime && this.isStressing) {
        const batchPromises = [];

        // Create batch of operations
        for (let i = 0; i < batchSize; i++) {
          const stateMachine = new CounterStateMachine(`stress-${batchSize}`);
          const operation = this.clusterManager
            .appendToLeader(
              stateMachine.createIncrementCommand(
                1,
                `stress-${operationCount + i}`,
              ),
            )
            .then(() => {
              successCount++;
            })
            .catch(() => {
              errorCount++;
            });

          batchPromises.push(operation);
        }

        // Wait for batch completion
        await Promise.allSettled(batchPromises);
        operationCount += batchSize;

        // Brief pause between batches
        await this.delay(10);

        // Progress update
        if (operationCount % (batchSize * 10) === 0) {
          const elapsed = Date.now() - startTime;
          const throughput = Math.round((successCount / elapsed) * 1000);
          this.logger.progress(elapsed, testDuration, `${throughput} ops/sec`);
        }
      }

      const totalDuration = Date.now() - startTime;
      const throughput = Math.round((successCount / totalDuration) * 1000);
      const errorRate = ((errorCount / operationCount) * 100).toFixed(2);

      this.logger.info(`Batch ${batchSize} results:`);
      this.logger.metric("Operations", operationCount.toString());
      this.logger.metric("Successful", successCount.toString());
      this.logger.metric("Errors", errorCount.toString());
      this.logger.metric("Error rate", errorRate, "%");
      this.logger.metric("Throughput", throughput.toString(), "ops/sec");

      // Store results
      this.stressResults.throughput[`batch_${batchSize}`] = {
        operations: operationCount,
        successful: successCount,
        errors: errorCount,
        errorRate: parseFloat(errorRate),
        throughput,
        duration: totalDuration,
      };

      // Brief recovery period
      await this.delay(2000);
    }

    // Find optimal batch size
    const bestBatch = Object.entries(this.stressResults.throughput).reduce(
      (best, [_key, result]: [string, any]) => {
        return result.throughput > best.throughput ? result : best;
      },
      { throughput: 0 },
    );

    this.logger.success(`Optimal throughput: ${bestBatch.throughput} ops/sec`);
  }

  private async runConcurrentConnectionsStress(): Promise<void> {
    this.logger.step(3, "Concurrent Connections Stress Test");
    this.logger.info("Testing with many concurrent clients...");

    const clientCounts = [10, 25, 50, 100];
    const operationsPerClient = 20;

    for (const clientCount of clientCounts) {
      this.logger.info(`\\nTesting ${clientCount} concurrent clients...`);

      const startTime = Date.now();
      const clientPromises = [];

      // Create concurrent clients
      for (let clientId = 0; clientId < clientCount; clientId++) {
        const promise = this.runStressClient(clientId, operationsPerClient);
        clientPromises.push(promise);
      }

      // Wait for all clients to complete
      const results = await Promise.allSettled(clientPromises);
      const endTime = Date.now();

      // Aggregate results
      let totalOps = 0;
      let successfulOps = 0;
      let failedOps = 0;

      for (const result of results) {
        if (result.status === "fulfilled") {
          totalOps += result.value.total;
          successfulOps += result.value.successful;
          failedOps += result.value.failed;
        } else {
          totalOps += operationsPerClient;
          failedOps += operationsPerClient;
        }
      }

      const duration = endTime - startTime;
      const throughput = Math.round((successfulOps / duration) * 1000);
      const successRate = ((successfulOps / totalOps) * 100).toFixed(2);

      this.logger.info(`${clientCount} clients results:`);
      this.logger.metric("Total operations", totalOps.toString());
      this.logger.metric("Successful", successfulOps.toString());
      this.logger.metric("Failed", failedOps.toString());
      this.logger.metric("Success rate", successRate, "%");
      this.logger.metric("Throughput", throughput.toString(), "ops/sec");
      this.logger.metric("Duration", duration.toString(), "ms");

      // Store results
      this.stressResults.concurrency[`clients_${clientCount}`] = {
        clients: clientCount,
        totalOps,
        successfulOps,
        failedOps,
        successRate: parseFloat(successRate),
        throughput,
        duration,
      };

      // Brief recovery
      await this.delay(1000);
    }
  }

  private async runMemoryPressureStress(): Promise<void> {
    this.logger.step(4, "Memory Pressure Stress Test");
    this.logger.info("Testing memory usage under load...");

    const initialMemory = process.memoryUsage();
    this.logger.info("Initial memory usage:");
    this.displayMemoryUsage(initialMemory);

    // Create large number of operations to build up log
    const operationCounts = [1000, 2000, 5000, 10000];

    for (const opCount of operationCounts) {
      this.logger.info(`\\nMemory test with ${opCount} operations...`);

      const startTime = Date.now();
      const startMemory = process.memoryUsage();

      const stateMachine = new CounterStateMachine("memory-stress");

      // Submit operations rapidly
      for (let i = 0; i < opCount; i++) {
        try {
          await this.clusterManager.appendToLeader(
            stateMachine.createIncrementCommand(1, `memory-${opCount}-${i}`),
          );

          // Progress update
          if ((i + 1) % Math.max(1, Math.floor(opCount / 10)) === 0) {
            this.logger.progress(i + 1, opCount, "Memory operations");
          }
        } catch {
          // Continue on errors during stress test
        }
      }

      const endTime = Date.now();
      const endMemory = process.memoryUsage();

      const duration = endTime - startTime;
      const memoryIncrease = endMemory.heapUsed - startMemory.heapUsed;
      const avgMemoryPerOp = memoryIncrease / opCount;

      this.logger.info(`${opCount} operations memory results:`);
      this.logger.metric("Duration", duration.toString(), "ms");
      this.logger.metric(
        "Memory increase",
        `${(memoryIncrease / 1024 / 1024).toFixed(2)} MB`,
      );
      this.logger.metric(
        "Memory per operation",
        `${(avgMemoryPerOp / 1024).toFixed(2)} KB`,
      );

      console.log(chalk.yellow("\\nMemory after operations:"));
      this.displayMemoryUsage(endMemory);

      // Store results
      this.stressResults.memory[`ops_${opCount}`] = {
        operations: opCount,
        duration,
        memoryIncrease,
        avgMemoryPerOp,
        finalHeapUsed: endMemory.heapUsed,
      };

      // Force garbage collection if available
      if (global.gc) {
        console.log(chalk.blue("\\nForcing garbage collection..."));
        global.gc();
        const postGCMemory = process.memoryUsage();
        this.displayMemoryUsage(postGCMemory);
      }

      await this.delay(2000);
    }
  }

  private async runFailureChaosStress(): Promise<void> {
    this.logger.step(5, "Failure Chaos Stress Test");
    this.logger.info("Testing resilience under chaotic failure conditions...");

    const testDuration = 45000; // 45 seconds of chaos
    const startTime = Date.now();
    const endTime = startTime + testDuration;

    let operationCount = 0;
    let successCount = 0;
    let errorCount = 0;
    let failureEvents = 0;

    this.isStressing = true;

    // Start background operations
    const operationsPromise = this.runBackgroundOperations(
      endTime,
      (success, error) => {
        operationCount += success + error;
        successCount += success;
        errorCount += error;
      },
    );

    // Start chaos monkey
    const chaosPromise = this.runChaosMonkey(endTime, () => {
      failureEvents++;
    });

    // Wait for both to complete
    await Promise.all([operationsPromise, chaosPromise]);

    this.isStressing = false;

    const totalDuration = Date.now() - startTime;
    const averageThroughput = Math.round((successCount / totalDuration) * 1000);
    const resilienceRatio = successCount / failureEvents;

    this.logger.info("\\nChaos stress test results:");
    this.logger.metric(
      "Duration",
      `${(totalDuration / 1000).toFixed(1)} seconds`,
    );
    this.logger.metric("Total operations", operationCount.toString());
    this.logger.metric("Successful", successCount.toString());
    this.logger.metric("Failed", errorCount.toString());
    this.logger.metric("Failure events", failureEvents.toString());
    this.logger.metric(
      "Average throughput",
      averageThroughput.toString(),
      "ops/sec",
    );
    this.logger.metric(
      "Resilience ratio",
      resilienceRatio.toFixed(2),
      "ops/failure",
    );

    // Store results
    this.stressResults.chaos = {
      duration: totalDuration,
      operations: operationCount,
      successful: successCount,
      failed: errorCount,
      failureEvents,
      averageThroughput,
      resilienceRatio,
    };

    // Wait for cluster to stabilize
    await this.delay(5000);

    const finalConsistency = await this.verifyConsistency();
    if (finalConsistency) {
      this.logger.success("Cluster maintained consistency through chaos");
    } else {
      this.logger.error("Consistency issues after chaos stress");
    }
  }

  private async runEnduranceStress(): Promise<void> {
    this.logger.step(6, "Endurance Stress Test");
    this.logger.info("Running long-duration endurance test...");

    const testDuration = 60000; // 1 minute endurance
    const startTime = Date.now();
    const endTime = startTime + testDuration;

    let totalOperations = 0;
    let successfulOperations = 0;
    let errorOperations = 0;

    const checkpointInterval = 10000; // 10 seconds
    let lastCheckpoint = startTime;

    this.isStressing = true;

    this.logger.info(
      `Running endurance test for ${testDuration / 1000} seconds...`,
    );

    while (Date.now() < endTime && this.isStressing) {
      try {
        const stateMachine = new CounterStateMachine("endurance");
        await this.clusterManager.appendToLeader(
          stateMachine.createIncrementCommand(
            1,
            `endurance-${totalOperations}`,
          ),
        );
        successfulOperations++;
      } catch {
        errorOperations++;
      }

      totalOperations++;

      // Checkpoint reporting
      const now = Date.now();
      if (now - lastCheckpoint >= checkpointInterval) {
        const elapsed = now - startTime;
        // const _progress = (elapsed / testDuration) * 100;
        const currentThroughput = Math.round(
          (successfulOperations / elapsed) * 1000,
        );

        this.logger.progress(
          elapsed,
          testDuration,
          `${currentThroughput} ops/sec`,
        );
        lastCheckpoint = now;
      }

      // Small delay to prevent overwhelming
      await this.delay(10);
    }

    this.isStressing = false;

    const actualDuration = Date.now() - startTime;
    const averageThroughput = Math.round(
      (successfulOperations / actualDuration) * 1000,
    );
    const errorRate = ((errorOperations / totalOperations) * 100).toFixed(2);

    this.logger.info("\\nEndurance test results:");
    this.logger.metric(
      "Duration",
      `${(actualDuration / 1000).toFixed(1)} seconds`,
    );
    this.logger.metric("Total operations", totalOperations.toString());
    this.logger.metric("Successful", successfulOperations.toString());
    this.logger.metric("Errors", errorOperations.toString());
    this.logger.metric("Error rate", errorRate, "%");
    this.logger.metric(
      "Average throughput",
      averageThroughput.toString(),
      "ops/sec",
    );

    // Store results
    this.stressResults.endurance = {
      duration: actualDuration,
      totalOperations,
      successfulOperations,
      errorOperations,
      errorRate: parseFloat(errorRate),
      averageThroughput,
    };

    // Final consistency check
    await this.delay(3000);

    const finalConsistency = await this.verifyConsistency();
    if (finalConsistency) {
      this.logger.success(
        "Cluster maintained consistency through endurance test",
      );
    } else {
      this.logger.error("Consistency issues after endurance test");
    }
  }

  private async runStressClient(
    clientId: number,
    operationCount: number,
  ): Promise<{ total: number; successful: number; failed: number }> {
    const stateMachine = new CounterStateMachine(`stress-client-${clientId}`);
    let successful = 0;
    let failed = 0;

    for (let i = 0; i < operationCount; i++) {
      try {
        await this.clusterManager.appendToLeader(
          stateMachine.createIncrementCommand(1, `client-${clientId}-op-${i}`),
        );
        successful++;
      } catch {
        failed++;
      }

      // Random small delay
      await this.delay(Math.random() * 50);
    }

    return {
      total: operationCount,
      successful,
      failed,
    };
  }

  private async runBackgroundOperations(
    endTime: number,
    callback: (success: number, error: number) => void,
  ): Promise<void> {
    let operationId = 0;

    while (Date.now() < endTime && this.isStressing) {
      let success = 0;
      let error = 0;

      try {
        const stateMachine = new CounterStateMachine("chaos-ops");
        await this.clusterManager.appendToLeader(
          stateMachine.createIncrementCommand(1, `chaos-${operationId++}`),
        );
        success = 1;
      } catch {
        error = 1;
      }

      callback(success, error);
      await this.delay(100);
    }
  }

  private async runChaosMonkey(
    endTime: number,
    callback: () => void,
  ): Promise<void> {
    const allNodes = this.clusterManager.getAllNodes().map((n) => n.nodeId);

    while (Date.now() < endTime && this.isStressing) {
      // Wait random time between failures
      await this.delay(Math.random() * 5000 + 2000); // 2-7 seconds

      if (!this.isStressing) break;

      // Randomly fail a node
      const availableNodes = allNodes.filter((id) => {
        const node = this.clusterManager.getNode(id);
        return node && node.node.getState() !== RaftState.CANDIDATE;
      });

      if (availableNodes.length > 3) {
        // Keep majority available
        const targetNode =
          availableNodes[Math.floor(Math.random() * availableNodes.length)];

        this.logger.warn(`Chaos: Failing node ${targetNode}`);
        await this.clusterManager.stopNode(targetNode);
        callback();

        // Wait a bit, then restart
        await this.delay(Math.random() * 3000 + 1000); // 1-4 seconds

        if (this.isStressing) {
          this.logger.info(`Chaos: Restarting node ${targetNode}`);
          await this.clusterManager.startNode(targetNode);
        }
      }
    }
  }

  private async generateStressReport(): Promise<void> {
    this.logger.step(7, "Stress Test Report");

    const totalDuration = Date.now() - this.stressResults.startTime;

    console.log(chalk.cyan("\\n📊 COMPREHENSIVE STRESS TEST REPORT"));
    console.log(chalk.blue("═".repeat(60)));

    console.log(chalk.green("\\n🚀 Throughput Performance:"));
    if (this.stressResults.throughput) {
      const throughputResults = Object.values(
        this.stressResults.throughput,
      ) as any[];
      const maxThroughput = Math.max(
        ...throughputResults.map((r: any) => r.throughput),
      );
      const avgErrorRate = (
        throughputResults.reduce(
          (sum: number, r: any) => sum + r.errorRate,
          0,
        ) / throughputResults.length
      ).toFixed(2);

      console.log(`  Peak Throughput: ${maxThroughput} ops/sec`);
      console.log(`  Average Error Rate: ${avgErrorRate}%`);
    }

    console.log(chalk.green("\\n👥 Concurrency Performance:"));
    if (this.stressResults.concurrency) {
      const concurrencyResults = Object.values(
        this.stressResults.concurrency,
      ) as any[];
      const maxClients = Math.max(
        ...concurrencyResults.map((r: any) => r.clients),
      );
      const avgSuccessRate = (
        concurrencyResults.reduce(
          (sum: number, r: any) => sum + r.successRate,
          0,
        ) / concurrencyResults.length
      ).toFixed(2);

      console.log(`  Max Concurrent Clients: ${maxClients}`);
      console.log(`  Average Success Rate: ${avgSuccessRate}%`);
    }

    console.log(chalk.green("\\n💾 Memory Performance:"));
    if (this.stressResults.memory) {
      const memoryResults = Object.values(this.stressResults.memory) as any[];
      const maxOps = Math.max(...memoryResults.map((r: any) => r.operations));
      const avgMemoryPerOp = (
        memoryResults.reduce(
          (sum: number, r: any) => sum + r.avgMemoryPerOp,
          0,
        ) /
        memoryResults.length /
        1024
      ).toFixed(2);

      console.log(`  Max Operations Tested: ${maxOps}`);
      console.log(`  Average Memory/Operation: ${avgMemoryPerOp} KB`);
    }

    console.log(chalk.green("\\n💥 Chaos Resilience:"));
    if (this.stressResults.chaos) {
      const chaos = this.stressResults.chaos;
      console.log(
        `  Operations during chaos: ${chaos.successful}/${chaos.operations}`,
      );
      console.log(`  Failure events survived: ${chaos.failureEvents}`);
      console.log(
        `  Resilience ratio: ${chaos.resilienceRatio.toFixed(2)} ops/failure`,
      );
    }

    console.log(chalk.green("\\n⏱️ Endurance Results:"));
    if (this.stressResults.endurance) {
      const endurance = this.stressResults.endurance;
      console.log(
        `  Test duration: ${(endurance.duration / 1000).toFixed(1)} seconds`,
      );
      console.log(
        `  Sustained throughput: ${endurance.averageThroughput} ops/sec`,
      );
      console.log(`  Error rate: ${endurance.errorRate}%`);
    }

    console.log(chalk.green("\\n📈 Overall Summary:"));
    console.log(
      `  Total test duration: ${(totalDuration / 1000 / 60).toFixed(1)} minutes`,
    );

    // Overall assessment
    const overallScore = this.calculateOverallScore();
    console.log(`  Overall performance score: ${overallScore}/100`);

    let assessment = "";
    if (overallScore >= 90) assessment = "Excellent";
    else if (overallScore >= 80) assessment = "Good";
    else if (overallScore >= 70) assessment = "Fair";
    else assessment = "Needs Improvement";

    console.log(`  Assessment: ${assessment}`);

    console.log(chalk.blue("═".repeat(60)));
  }

  private calculateOverallScore(): number {
    let score = 0;
    let factors = 0;

    // Throughput score (30 points max)
    if (this.stressResults.throughput) {
      const throughputResults = Object.values(
        this.stressResults.throughput,
      ) as any[];
      const maxThroughput = Math.max(
        ...throughputResults.map((r: any) => r.throughput),
      );
      score += Math.min(30, maxThroughput / 10); // 300+ ops/sec = 30 points
      factors++;
    }

    // Concurrency score (25 points max)
    if (this.stressResults.concurrency) {
      const concurrencyResults = Object.values(
        this.stressResults.concurrency,
      ) as any[];
      const avgSuccessRate =
        concurrencyResults.reduce(
          (sum: number, r: any) => sum + r.successRate,
          0,
        ) / concurrencyResults.length;
      score += (avgSuccessRate / 100) * 25;
      factors++;
    }

    // Chaos resilience score (25 points max)
    if (this.stressResults.chaos) {
      const chaos = this.stressResults.chaos;
      const resilienceScore = Math.min(
        25,
        (chaos.successful / chaos.operations) * 25,
      );
      score += resilienceScore;
      factors++;
    }

    // Endurance score (20 points max)
    if (this.stressResults.endurance) {
      const endurance = this.stressResults.endurance;
      const enduranceScore = Math.min(
        20,
        ((100 - endurance.errorRate) / 100) * 20,
      );
      score += enduranceScore;
      factors++;
    }

    return factors > 0 ? Math.round((score / factors) * (100 / 100)) : 0;
  }

  private displayMemoryUsage(memUsage: NodeJS.MemoryUsage): void {
    const formatBytes = (bytes: number) =>
      `${(bytes / 1024 / 1024).toFixed(2)} MB`;

    console.log(chalk.blue(`    RSS: ${formatBytes(memUsage.rss)}`));
    console.log(
      chalk.blue(`    Heap Total: ${formatBytes(memUsage.heapTotal)}`),
    );
    console.log(chalk.blue(`    Heap Used: ${formatBytes(memUsage.heapUsed)}`));
    console.log(chalk.blue(`    External: ${formatBytes(memUsage.external)}`));
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

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async cleanup(): Promise<void> {
    this.isStressing = false;
    this.logger.info("Cleaning up stress test demo...");
    await this.clusterManager.cleanup();
  }
}
