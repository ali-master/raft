import assert from "node:assert/strict";
import { RaftState } from "@usex/raft";
import { ClusterManager } from "../utils/cluster-manager";
import { PlaygroundLogger } from "../utils/logger";
import { CounterStateMachine } from "../state-machines/counter-state-machine";

export class NetworkPartitionShowcase {
  private logger = new PlaygroundLogger();
  private clusterManager = new ClusterManager("network-partition-showcase");

  async run(): Promise<void> {
    this.logger.section("Network Partition Scenarios");
    try {
      this.logger.step(1, "Isolate the current leader in a minority partition");
      await this.clusterManager.createCluster(5, "counter");
      const oldLeader = this.clusterManager.getLeader()!;
      const others = this.clusterManager
        .getAllNodes()
        .filter((n) => n !== oldLeader);
      const minority = [oldLeader.nodeId, others[0]!.nodeId];
      const majority = others.slice(1).map((n) => n.nodeId);
      await this.clusterManager.simulateNetworkPartition(majority, minority);
      await this.waitForLeader(majority);
      assert(
        this.clusterManager.getAllNodes().every((n) => n.node.isRunning()),
      );

      this.logger.step(2, "Only the majority can commit operations");
      const commands = new CounterStateMachine("partition-test");
      await this.clusterManager.appendToLeader(
        commands.createIncrementCommand(5),
      );
      await assert.rejects(
        oldLeader.node.appendLog(commands.createIncrementCommand(100)),
      );
      assert.equal(
        (oldLeader.stateMachine as CounterStateMachine).getState().value,
        0,
      );
      await this.clusterManager.healNetworkPartition(minority);
      await this.checkConsistency();
      assert.equal(
        (oldLeader.stateMachine as CounterStateMachine).getState().value,
        5,
      );

      this.logger.step(
        3,
        "Three partitions of 3/2/2 cannot form a quorum of 7",
      );
      await this.clusterManager.createCluster(7, "counter");
      const ids = this.clusterManager.getAllNodes().map((n) => n.nodeId);
      const groups = [ids.slice(0, 3), ids.slice(3, 5), ids.slice(5)];
      await this.clusterManager.simulateNetworkPartition(groups[0]!, [
        ...groups[1]!,
        ...groups[2]!,
      ]);
      await this.clusterManager.simulateNetworkPartition(
        groups[1]!,
        groups[2]!,
      );
      await this.delay(500);
      for (const info of this.clusterManager.getAllNodes()) {
        await assert.rejects(
          info.node.appendLog(commands.createIncrementCommand(1)),
        );
        assert.equal(
          (info.stateMachine as CounterStateMachine).getState().value,
          0,
        );
      }

      this.logger.step(4, "Heal the partitions and reconcile uncommitted logs");
      await this.clusterManager.healNetworkPartition(ids);
      await this.clusterManager.appendToLeader(
        commands.createIncrementCommand(1),
      );
      await this.checkConsistency();

      this.logger.step(
        5,
        "Rotate the majority partition while all nodes keep running",
      );
      const majorities = [
        ids.slice(0, 4),
        [ids[0]!, ids[2]!, ids[4]!, ids[6]!],
        ids.slice(1, 5),
      ];
      for (const group of majorities) {
        const isolated = ids.filter((id) => !group.includes(id));
        await this.clusterManager.simulateNetworkPartition(group, isolated);
        await this.waitForLeader(group);
        await this.clusterManager.appendToLeader(
          commands.createIncrementCommand(1),
        );
        await this.clusterManager.healNetworkPartition(isolated);
        await this.checkConsistency();
      }
      this.logger.result(true, "All network partition scenarios passed");
    } finally {
      await this.clusterManager.cleanup();
    }
  }

  private async waitForLeader(ids: string[]): Promise<void> {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const leader = this.clusterManager.getLeader();
      if (
        leader &&
        ids.includes(leader.nodeId) &&
        leader.node.getState() === RaftState.LEADER
      )
        return;
      await this.delay(50);
    }
    throw new Error(`No leader in majority partition: ${ids.join(", ")}`);
  }

  private async checkConsistency(): Promise<void> {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const states = this.clusterManager
        .getAllNodes()
        .map((n) => (n.stateMachine as CounterStateMachine).getState());
      if (
        states.every(
          (s) =>
            s.value === states[0]!.value && s.version === states[0]!.version,
        )
      )
        return;
      await this.delay(50);
    }
    throw new Error("State machines did not converge after healing");
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

if (import.meta.main) {
  new NetworkPartitionShowcase().run().catch(() => {
    process.exitCode = 1;
  });
}
