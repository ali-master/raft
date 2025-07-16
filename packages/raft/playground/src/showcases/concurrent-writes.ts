import chalk from "chalk";
import { ClusterManager } from "../utils/cluster-manager";
import { PlaygroundLogger } from "../utils/logger";
import { CounterStateMachine } from "../state-machines/counter-state-machine";

export class ConcurrentWritesShowcase {
  private logger = new PlaygroundLogger();
  private clusterManager = new ClusterManager("concurrent-writes-showcase");

  async run(): Promise<void> {
    this.logger.section("Concurrent Writes and Conflict Resolution");

    try {
      // Setup cluster
      await this.setupCluster();

      // Scenario 1: Basic concurrent writes
      await this.demonstrateBasicConcurrentWrites();

      // Scenario 2: High concurrency stress test
      await this.demonstrateHighConcurrencyWrites();

      // Scenario 3: Concurrent writes with leader changes
      await this.demonstrateConcurrentWritesWithLeaderChanges();

      // Scenario 4: Concurrent writes from different clients
      await this.demonstrateDifferentClientWrites();

      // Scenario 5: Concurrent writes with network issues
      await this.demonstrateConcurrentWritesWithNetworkIssues();

      this.logger.result(
        true,
        "All concurrent writes scenarios completed successfully!",
      );
    } catch (_error) {
      this.logger.error("Concurrent writes showcase failed", undefined, _error);
      this.logger.result(false, "Concurrent writes demonstration failed");
    } finally {
      await this.cleanup();
    }
  }

  private async setupCluster(): Promise<void> {
    this.logger.step(1, "Setting up cluster for concurrent writes");
    await this.clusterManager.createCluster(5, "counter");

    // Wait for stability
    await this.delay(3000);

    const leader = this.clusterManager.getLeader();
    if (leader) {
      this.logger.success(`Cluster ready with leader: ${leader.nodeId}`);
    } else {
      this.logger.error("Failed to establish leader");
    }

    // Initialize with some baseline operations
    const stateMachine = new CounterStateMachine("init");
    await this.clusterManager.appendToLeader(
      stateMachine.createSetCommand(0, "initialization"),
    );

    await this.delay(1000);
    this.logger.info("Cluster initialized and ready for concurrent writes");
  }

  private async demonstrateBasicConcurrentWrites(): Promise<void> {
    this.logger.step(2, "Basic Concurrent Writes");
    this.logger.info("Testing basic concurrent write operations...");

    const numberOfClients = 5;
    const operationsPerClient = 10;

    this.logger.info(
      `Creating ${numberOfClients} concurrent clients with ${operationsPerClient} operations each`,
    );

    const clientPromises = [];

    // Create concurrent clients
    for (let clientId = 0; clientId < numberOfClients; clientId++) {
      const promise = this.runConcurrentClient(clientId, operationsPerClient);
      clientPromises.push(promise);
    }

    // Wait for all clients to complete
    const results = await Promise.allSettled(clientPromises);

    let totalSuccess = 0;
    let totalFailures = 0;

    for (let i = 0; i < results.length; i++) {
      if (results[i].status === "fulfilled") {
        const result = (results[i] as PromiseFulfilledResult<any>).value;
        totalSuccess += result.successful;
        totalFailures += result.failed;

        this.logger.info(
          `Client ${i}: ${result.successful} successful, ${result.failed} failed`,
        );
      } else {
        this.logger.error(
          `Client ${i}: completely failed`,
          undefined,
          (results[i] as PromiseRejectedResult).reason,
        );
        totalFailures += operationsPerClient;
      }
    }

    this.logger.info(`\\nTotal operations: ${totalSuccess + totalFailures}`);
    this.logger.info(`Successful: ${totalSuccess}, Failed: ${totalFailures}`);
    this.logger.info(
      `Success rate: ${((totalSuccess / (totalSuccess + totalFailures)) * 100).toFixed(2)}%`,
    );

    // Verify final consistency
    await this.delay(2000);
    const finalConsistency = await this.verifyConsistency();

    if (finalConsistency) {
      this.logger.success(
        "Cluster maintained consistency during concurrent writes",
      );
    } else {
      this.logger.error("Consistency issues detected after concurrent writes");
    }

    await this.displayClusterState();
  }

  private async demonstrateHighConcurrencyWrites(): Promise<void> {
    this.logger.step(3, "High Concurrency Stress Test");
    this.logger.info("Testing high concurrency write scenarios...");

    const numberOfClients = 20;
    const operationsPerClient = 5;
    const batchSize = 4; // Process clients in batches to avoid overwhelming

    this.logger.info(
      `Running ${numberOfClients} clients in batches of ${batchSize}`,
    );

    const totalOperations = numberOfClients * operationsPerClient;
    let completedOperations = 0;
    let successfulOperations = 0;

    // Process clients in batches
    for (let batch = 0; batch < numberOfClients; batch += batchSize) {
      const batchEnd = Math.min(batch + batchSize, numberOfClients);
      const batchPromises = [];

      this.logger.info(
        `Processing batch ${Math.floor(batch / batchSize) + 1}: clients ${batch} to ${batchEnd - 1}`,
      );

      for (let clientId = batch; clientId < batchEnd; clientId++) {
        const promise = this.runConcurrentClient(clientId, operationsPerClient);
        batchPromises.push(promise);
      }

      const batchResults = await Promise.allSettled(batchPromises);

      for (const result of batchResults) {
        if (result.status === "fulfilled") {
          completedOperations += result.value.successful + result.value.failed;
          successfulOperations += result.value.successful;
        } else {
          completedOperations += operationsPerClient;
        }
      }

      // Small delay between batches
      await this.delay(500);
    }

    this.logger.info(`\\nHigh concurrency results:`);
    this.logger.info(`Total operations: ${totalOperations}`);
    this.logger.info(`Completed: ${completedOperations}`);
    this.logger.info(`Successful: ${successfulOperations}`);
    this.logger.info(
      `Success rate: ${((successfulOperations / totalOperations) * 100).toFixed(2)}%`,
    );

    // Verify consistency after high concurrency
    await this.delay(3000);
    const consistency = await this.verifyConsistency();

    if (consistency) {
      this.logger.success(
        "Cluster maintained consistency under high concurrency",
      );
    } else {
      this.logger.error(
        "Consistency issues detected after high concurrency test",
      );
    }
  }

  private async demonstrateConcurrentWritesWithLeaderChanges(): Promise<void> {
    this.logger.step(4, "Concurrent Writes with Leader Changes");
    this.logger.info("Testing concurrent writes during leadership changes...");

    const numberOfClients = 8;
    const operationsPerClient = 8;

    // Start concurrent clients
    const clientPromises = [];

    for (let clientId = 0; clientId < numberOfClients; clientId++) {
      const promise = this.runConcurrentClientWithRetry(
        clientId,
        operationsPerClient,
      );
      clientPromises.push(promise);
    }

    // Wait a bit for operations to start
    await this.delay(1000);

    // Simulate leadership changes during operations
    this.logger.info(
      "Simulating leadership changes during concurrent operations...",
    );

    const leadershipChangePromise = this.simulateLeadershipChanges();

    // Wait for both operations and leadership changes to complete
    const [clientResults] = await Promise.allSettled([
      Promise.allSettled(clientPromises),
      leadershipChangePromise,
    ]);

    // Process client results
    let totalSuccess = 0;
    let totalFailures = 0;

    if (clientResults.status === "fulfilled") {
      for (let i = 0; i < clientResults.value.length; i++) {
        const result = clientResults.value[i];
        if (result.status === "fulfilled") {
          totalSuccess += result.value.successful;
          totalFailures += result.value.failed;
        } else {
          totalFailures += operationsPerClient;
        }
      }
    }

    this.logger.info(`\\nConcurrent writes with leadership changes:`);
    this.logger.info(`Successful operations: ${totalSuccess}`);
    this.logger.info(`Failed operations: ${totalFailures}`);
    this.logger.info(
      `Success rate: ${((totalSuccess / (totalSuccess + totalFailures)) * 100).toFixed(2)}%`,
    );

    // Verify final consistency
    await this.delay(3000);
    const finalConsistency = await this.verifyConsistency();

    if (finalConsistency) {
      this.logger.success("Consistency maintained despite leadership changes");
    } else {
      this.logger.error("Consistency issues after leadership changes");
    }
  }

  private async demonstrateDifferentClientWrites(): Promise<void> {
    this.logger.step(5, "Different Client Write Patterns");
    this.logger.info(
      "Testing different client write patterns and operations...",
    );

    // Create clients with different operation patterns
    const clientPatterns = [
      { name: "Incrementer", operations: "increment", count: 10 },
      { name: "Decrementer", operations: "decrement", count: 5 },
      { name: "Setter", operations: "set", count: 3 },
      { name: "Mixed", operations: "mixed", count: 8 },
    ];

    const clientPromises = [];

    for (let i = 0; i < clientPatterns.length; i++) {
      const pattern = clientPatterns[i];
      const promise = this.runPatternClient(i, pattern);
      clientPromises.push(promise);
    }

    // Wait for all pattern clients to complete
    const results = await Promise.allSettled(clientPromises);

    this.logger.info("\\nClient pattern results:");
    let totalOps = 0;
    let successfulOps = 0;

    for (let i = 0; i < results.length; i++) {
      const pattern = clientPatterns[i];

      if (results[i].status === "fulfilled") {
        const result = (results[i] as PromiseFulfilledResult<any>).value;
        totalOps += result.successful + result.failed;
        successfulOps += result.successful;

        this.logger.info(
          `${pattern.name}: ${result.successful}/${result.successful + result.failed} operations successful`,
        );
      } else {
        totalOps += pattern.count;
        this.logger.error(
          `${pattern.name}: completely failed`,
          undefined,
          (results[i] as PromiseRejectedResult).reason,
        );
      }
    }

    this.logger.info(
      `\\nOverall: ${successfulOps}/${totalOps} operations successful`,
    );

    // Verify consistency
    await this.delay(2000);
    const consistency = await this.verifyConsistency();

    if (consistency) {
      this.logger.success(
        "Consistency maintained across different client patterns",
      );
    } else {
      this.logger.error("Consistency issues with different client patterns");
    }

    await this.displayFinalState();
  }

  private async demonstrateConcurrentWritesWithNetworkIssues(): Promise<void> {
    this.logger.step(6, "Concurrent Writes with Network Issues");
    this.logger.info(
      "Testing concurrent writes with network partitions and healing...",
    );

    const numberOfClients = 6;
    const operationsPerClient = 6;

    // Start concurrent clients
    const clientPromises = [];

    for (let clientId = 0; clientId < numberOfClients; clientId++) {
      const promise = this.runResilientClient(clientId, operationsPerClient);
      clientPromises.push(promise);
    }

    // Wait for operations to start
    await this.delay(1000);

    // Simulate network issues
    this.logger.info("Simulating network partition during operations...");

    const allNodes = this.clusterManager.getAllNodes().map((n) => n.nodeId);
    const majorityPartition = allNodes.slice(0, 3);
    const minorityPartition = allNodes.slice(3);

    await this.clusterManager.simulateNetworkPartition(
      majorityPartition,
      minorityPartition,
    );

    // Wait during partition
    await this.delay(3000);

    // Heal partition
    this.logger.info("Healing network partition...");
    await this.clusterManager.healNetworkPartition(minorityPartition);

    // Wait for clients to complete
    const results = await Promise.allSettled(clientPromises);

    // Process results
    let totalSuccess = 0;
    let totalFailures = 0;

    for (let i = 0; i < results.length; i++) {
      if (results[i].status === "fulfilled") {
        const result = (results[i] as PromiseFulfilledResult<any>).value;
        totalSuccess += result.successful;
        totalFailures += result.failed;
      } else {
        totalFailures += operationsPerClient;
      }
    }

    this.logger.info(`\\nConcurrent writes with network issues:`);
    this.logger.info(`Successful operations: ${totalSuccess}`);
    this.logger.info(`Failed operations: ${totalFailures}`);
    this.logger.info(
      `Success rate: ${((totalSuccess / (totalSuccess + totalFailures)) * 100).toFixed(2)}%`,
    );

    // Final consistency check
    await this.delay(3000);
    const finalConsistency = await this.verifyConsistency();

    if (finalConsistency) {
      this.logger.success("Consistency maintained despite network issues");
    } else {
      this.logger.error("Consistency issues remain after network healing");
    }
  }

  private async runConcurrentClient(
    clientId: number,
    operationCount: number,
  ): Promise<{ successful: number; failed: number }> {
    const stateMachine = new CounterStateMachine(`client-${clientId}`);
    let successful = 0;
    let failed = 0;

    for (let i = 0; i < operationCount; i++) {
      try {
        const command = stateMachine.createIncrementCommand(
          1,
          `client-${clientId}-op-${i}`,
        );
        await this.clusterManager.appendToLeader(command);
        successful++;
      } catch {
        failed++;
      }

      // Small random delay between operations
      await this.delay(Math.random() * 100);
    }

    return { successful, failed };
  }

  private async runConcurrentClientWithRetry(
    clientId: number,
    operationCount: number,
  ): Promise<{ successful: number; failed: number }> {
    const stateMachine = new CounterStateMachine(`retry-client-${clientId}`);
    let successful = 0;
    let failed = 0;

    for (let i = 0; i < operationCount; i++) {
      const maxRetries = 3;
      let retries = 0;
      let operationSucceeded = false;

      while (retries < maxRetries && !operationSucceeded) {
        try {
          const command = stateMachine.createIncrementCommand(
            1,
            `retry-client-${clientId}-op-${i}`,
          );
          await this.clusterManager.appendToLeader(command);
          successful++;
          operationSucceeded = true;
        } catch {
          retries++;
          if (retries >= maxRetries) {
            failed++;
          } else {
            // Wait before retry
            await this.delay(500);
          }
        }
      }

      // Small delay between operations
      await this.delay(50);
    }

    return { successful, failed };
  }

  private async runPatternClient(
    clientId: number,
    pattern: any,
  ): Promise<{ successful: number; failed: number }> {
    const stateMachine = new CounterStateMachine(`pattern-client-${clientId}`);
    let successful = 0;
    let failed = 0;

    for (let i = 0; i < pattern.count; i++) {
      try {
        let command;

        switch (pattern.operations) {
          case "increment":
            command = stateMachine.createIncrementCommand(
              Math.floor(Math.random() * 5) + 1,
              `${pattern.name}-${i}`,
            );
            break;
          case "decrement":
            command = stateMachine.createDecrementCommand(
              Math.floor(Math.random() * 3) + 1,
              `${pattern.name}-${i}`,
            );
            break;
          case "set":
            command = stateMachine.createSetCommand(
              Math.floor(Math.random() * 100),
              `${pattern.name}-${i}`,
            );
            break;
          case "mixed": {
            const operation = Math.floor(Math.random() * 3);
            if (operation === 0) {
              command = stateMachine.createIncrementCommand(
                Math.floor(Math.random() * 3) + 1,
                `${pattern.name}-${i}`,
              );
            } else if (operation === 1) {
              command = stateMachine.createDecrementCommand(
                Math.floor(Math.random() * 2) + 1,
                `${pattern.name}-${i}`,
              );
            } else {
              command = stateMachine.createSetCommand(
                Math.floor(Math.random() * 50),
                `${pattern.name}-${i}`,
              );
            }
            break;
          }
        }

        if (command) {
          await this.clusterManager.appendToLeader(command);
          successful++;
        }
      } catch {
        failed++;
      }

      // Random delay between operations
      await this.delay(Math.random() * 200);
    }

    return { successful, failed };
  }

  private async runResilientClient(
    clientId: number,
    operationCount: number,
  ): Promise<{ successful: number; failed: number }> {
    const stateMachine = new CounterStateMachine(
      `resilient-client-${clientId}`,
    );
    let successful = 0;
    let failed = 0;

    for (let i = 0; i < operationCount; i++) {
      const maxRetries = 5;
      let retries = 0;
      let operationSucceeded = false;

      while (retries < maxRetries && !operationSucceeded) {
        try {
          const command = stateMachine.createIncrementCommand(
            1,
            `resilient-client-${clientId}-op-${i}`,
          );
          await this.clusterManager.appendToLeader(command);
          successful++;
          operationSucceeded = true;
        } catch {
          retries++;
          if (retries >= maxRetries) {
            failed++;
          } else {
            // Exponential backoff
            await this.delay(2 ** retries * 500);
          }
        }
      }

      // Small delay between operations
      await this.delay(100);
    }

    return { successful, failed };
  }

  private async simulateLeadershipChanges(): Promise<void> {
    // Simulate 2 leadership changes during operations
    await this.delay(2000);

    const leader1 = this.clusterManager.getLeader();
    if (leader1) {
      this.logger.info(`Stopping leader: ${leader1.nodeId}`);
      await this.clusterManager.stopNode(leader1.nodeId);

      await this.delay(3000);

      const leader2 = this.clusterManager.getLeader();
      if (leader2) {
        this.logger.info(`New leader: ${leader2.nodeId}`);

        // Restart the first leader
        await this.clusterManager.startNode(leader1.nodeId);

        await this.delay(2000);

        // Stop the second leader
        this.logger.info(`Stopping second leader: ${leader2.nodeId}`);
        await this.clusterManager.stopNode(leader2.nodeId);

        await this.delay(3000);

        // Restart the second leader
        await this.clusterManager.startNode(leader2.nodeId);
      }
    }
  }

  private async verifyConsistency(): Promise<boolean> {
    const nodes = this.clusterManager.getAllNodes();
    const stateMachineStates = nodes.map((nodeInfo) => {
      const sm = nodeInfo.stateMachine as CounterStateMachine;
      return sm.getState();
    });

    const uniqueValues = new Set(stateMachineStates.map((s) => s.value));
    const uniqueVersions = new Set(stateMachineStates.map((s) => s.version));

    const isConsistent = uniqueValues.size === 1 && uniqueVersions.size === 1;

    this.logger.info("\\n🔍 Consistency Check:");
    for (const state of stateMachineStates) {
      console.log(
        `  ${state.nodeId}: Value=${state.value}, Version=${state.version}`,
      );
    }

    return isConsistent;
  }

  private async displayClusterState(): Promise<void> {
    const nodes = this.clusterManager.getAllNodes();
    const metrics = await this.clusterManager.getMetrics();

    console.log(chalk.cyan("\\n  📊 Cluster State:"));
    console.log(`    Leader: ${metrics.leader || "None"}`);
    console.log(`    Term: ${metrics.term}`);
    console.log(`    Active Nodes: ${nodes.length}`);

    const leader = this.clusterManager.getLeader();
    if (leader) {
      console.log(`    Commit Index: ${leader.node.getCommitIndex()}`);
      console.log(`    Last Applied: ${leader.node.getLastApplied()}`);
    }
  }

  private async displayFinalState(): Promise<void> {
    const nodes = this.clusterManager.getAllNodes();

    console.log(chalk.cyan("\\n  📋 Final State Machine Values:"));
    for (const nodeInfo of nodes) {
      const sm = nodeInfo.stateMachine as CounterStateMachine;
      const state = sm.getState();
      console.log(
        `    ${nodeInfo.nodeId}: Value=${state.value}, Version=${state.version}`,
      );
    }
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async cleanup(): Promise<void> {
    this.logger.info("Cleaning up concurrent writes showcase...");
    await this.clusterManager.cleanup();
  }
}
