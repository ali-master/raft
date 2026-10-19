import { it, expect, describe, afterEach } from "vitest";
import { rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RaftState, RaftNode, RaftCommandType } from "../../src";
import { calculateChecksum } from "../../src/utils";
import { getGlobalRedisContext } from "../shared/test-setup";
import type { StateMachine, RaftEvent, RaftConfiguration } from "../../src";
import { createTestConfig } from "../shared/test-utils";

class Counter implements StateMachine<number> {
  value = 0;
  async apply(value: number) {
    await new Promise((resolve) => setTimeout(resolve, 1));
    this.value += value;
  }
  async getSnapshotData() {
    return Buffer.from(String(this.value));
  }
  async applySnapshot(data: Buffer) {
    this.value = Number(data.toString());
  }
}

async function until(check: () => boolean, timeout = 12000) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Condition did not converge");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("playground regression paths", () => {
  const nodes: RaftNode<number>[] = [];
  const directories: string[] = [];
  afterEach(async () => {
    await Promise.all(nodes.splice(0).map((node) => node.stop()));
    await Promise.all(
      directories
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function cluster(
    size: number,
    snapshotThreshold = 10000,
    weights?: number[],
  ) {
    const dir = await mkdtemp(join(tmpdir(), "raft-regression-"));
    directories.push(dir);
    const clusterId = dir.split("/").pop()!;
    const peers = Array.from({ length: size }, (_, i) => `${clusterId}-${i}`);
    const configs: RaftConfiguration[] = peers.map((nodeId) =>
      createTestConfig({
        nodeId,
        clusterId,
        peers,
        snapshotThreshold,
        voting: {
          enableWeighting: !!weights,
          defaultWeight: 1,
          weightMetrics: [],
          ...(weights
            ? {
                weights: Object.fromEntries(
                  peers.map((peer, i) => [peer, weights[i]!]),
                ),
              }
            : {}),
        },
        network: {
          requestTimeout: 800,
          maxRetries: 1,
          retryDelay: 10,
          circuitBreakerThreshold: 5,
          circuitBreakerTimeout: 300,
        },
        peerDiscovery: {
          registrationInterval: 100,
          healthCheckInterval: 100,
          peerTimeout: 5000,
        },
        persistence: {
          enableSnapshots: true,
          snapshotInterval: 60000,
          dataDir: join(dir, nodeId),
          walEnabled: true,
          walSizeLimit: 10485760,
        },
      }),
    );
    const counters = configs.map(() => new Counter());
    const members = configs.map(
      (config, i) => new RaftNode(config, counters[i]!),
    );
    nodes.push(...members);
    await Promise.all(members.map((node) => node.start()));
    await until(
      () =>
        members.filter((node) => node.getState() === RaftState.LEADER)
          .length === 1,
    );
    return { members, counters, configs };
  }

  it("commits a single-node write and replays snapshot plus committed suffix", async () => {
    const { members, counters, configs } = await cluster(1);
    const node = members[0]!;
    const observed: RaftEvent[] = [];
    node.on("raftEvent", (event: RaftEvent) => observed.push(event));
    await node.appendLog(4);
    expect(counters[0]!.value).toBe(4);
    const appended = observed.find((event) => event.type === "log_replicated")!;
    const applied = observed.find(
      (event) =>
        event.type === "log_applied" &&
        event.data.index === appended.data.index,
    )!;
    expect(observed.indexOf(applied)).toBeGreaterThan(
      observed.indexOf(appended),
    );
    expect(applied.nodeId).toBe(node.getNodeId());
    expect(applied.timestamp).toBeInstanceOf(Date);
    await node.createSnapshot();
    expect(
      observed.some(
        (event) =>
          event.type === "snapshot_created" &&
          event.data.lastIncludedIndex === node.getLastApplied(),
      ),
    ).toBe(true);
    await node.appendLog(7);
    await node.stop();
    expect(observed.some((event) => event.type === "node_stopped")).toBe(true);
    const restored = new Counter();
    const replacement = new RaftNode(configs[0]!, restored);
    nodes.push(replacement);
    await replacement.start();
    expect(restored.value).toBe(11);
    await replacement.stop();
    await replacement.start();
    expect(restored.value).toBe(11);
  }, 20000);

  it("applies concurrent commands exactly once and transfers leadership", async () => {
    const { members, counters } = await cluster(3);
    const leader = members.find(
      (node) => node.getState() === RaftState.LEADER,
    )!;
    await Promise.all(Array.from({ length: 40 }, () => leader.appendLog(1)));
    await until(() => counters.every((counter) => counter.value === 40));
    const target = members.find((node) => node !== leader)!;
    await leader.transferLeadership(target.getNodeId());
    await until(
      () =>
        target.getState() === RaftState.LEADER &&
        leader.getState() === RaftState.FOLLOWER,
    );
    await target.appendLog(2);
    await until(() => counters.every((counter) => counter.value === 42));
    expect(members.map((node) => node.getLeaderId())).toEqual(
      members.map(() => target.getNodeId()),
    );
  }, 30000);

  it("does not move commitIndex backward on an older replicated prefix", async () => {
    const { members, counters } = await cluster(1);
    const node = members[0]!;
    await node.appendLog(1);
    await node.appendLog(2);
    const committed = node.getCommitIndex();
    const response = await node.handleAppendEntries({
      term: node.getCurrentTerm() + 1,
      leaderId: "replacement-leader",
      prevLogIndex: 1,
      prevLogTerm: node.getLog().getEntry(1)!.term,
      entries: [],
      leaderCommit: committed + 1,
    });
    expect(response.success).toBe(true);
    expect(node.getCommitIndex()).toBe(committed);
    expect(node.getLastApplied()).toBe(committed);
    expect(counters[0]!.value).toBe(3);
  });

  it("restores an offline follower through a snapshot and refuses minority commits", async () => {
    const { members, counters, configs } = await cluster(3, 5);
    const leader = members.find(
      (node) => node.getState() === RaftState.LEADER,
    )!;
    const follower = members.find((node) => node !== leader)!;
    await follower.stop();
    for (let i = 0; i < 12; i++) await leader.appendLog(1);
    await follower.start();
    await until(() => counters.every((counter) => counter.value === 12));
    await follower.stop();
    const followerIndex = members.indexOf(follower);
    const restored = new Counter();
    const replacement = new RaftNode(configs[followerIndex]!, restored);
    nodes.push(replacement);
    members[followerIndex] = replacement;
    counters[followerIndex] = restored;
    await replacement.start();
    expect(restored.value).toBe(12);
    await Promise.all(
      members.filter((node) => node !== leader).map((node) => node.stop()),
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    await expect(leader.appendLog(100)).rejects.toThrow();
    expect(counters[members.indexOf(leader)]!.value).toBe(12);
    expect(leader.getPeers()).toHaveLength(3);
    const uncommitted = leader.getLog().getLastIndex();
    await leader.createSnapshot();
    expect(leader.getLog().getEntry(uncommitted)?.commandPayload).toBe(100);
  }, 30000);

  it("uses the configured weighted quorum even when members disappear", async () => {
    const { members, counters } = await cluster(5, 10000, [3, 3, 1, 1, 1]);
    await Promise.all(members.slice(2).map((node) => node.stop()));
    await until(() =>
      members.slice(0, 2).some((node) => node.getState() === RaftState.LEADER),
    );
    const leader = members
      .slice(0, 2)
      .find((node) => node.getState() === RaftState.LEADER)!;
    await leader.appendLog(5);
    await until(() =>
      counters.slice(0, 2).every((counter) => counter.value === 5),
    );
    await Promise.all(members.slice(2).map((node) => node.start()));
    await until(() => counters.every((counter) => counter.value === 5));
    await Promise.all(members.slice(0, 2).map((node) => node.stop()));
    await new Promise((resolve) => setTimeout(resolve, 2500));
    expect(
      members.slice(2).some((node) => node.getState() === RaftState.LEADER),
    ).toBe(false);
  }, 30000);

  it("isolates persisted state for identical node IDs with different prefixes", async () => {
    const root = await mkdtemp(join(tmpdir(), "raft-isolation-"));
    directories.push(root);
    const configs = ["first", "second"].map((name) => {
      const base = createTestConfig({
        nodeId: "shared-node",
        clusterId: name,
        peers: ["shared-node"],
      });
      return {
        ...base,
        redis: { ...base.redis, keyPrefix: `${root}:${name}:` },
        persistence: {
          ...base.persistence,
          walEnabled: false,
          dataDir: join(root, name),
        },
      };
    });
    for (const [index, config] of configs.entries()) {
      const counter = new Counter();
      const node = new RaftNode(config, counter);
      nodes.push(node);
      await node.start();
      await until(() => node.getState() === RaftState.LEADER);
      expect(counter.value).toBe(0);
      await node.appendLog(index + 3);
      await node.stop();
    }
    for (const [index, config] of configs.entries()) {
      const counter = new Counter();
      const node = new RaftNode(config, counter);
      nodes.push(node);
      await node.start();
      expect(counter.value).toBe(index + 3);
    }
  }, 20000);

  it("recovers legacy unprefixed Redis state and logs with an explicit empty prefix", async () => {
    const dir = await mkdtemp(join(tmpdir(), "raft-legacy-"));
    directories.push(dir);
    const nodeId = dir.split("/").pop()!;
    const config = createTestConfig({
      nodeId,
      clusterId: nodeId,
      peers: [nodeId],
    });
    config.redis.keyPrefix = "";
    config.persistence = {
      ...config.persistence,
      dataDir: dir,
      walEnabled: false,
    };
    const { redis } = getGlobalRedisContext();
    await redis.set(
      `${nodeId}:state`,
      JSON.stringify({
        currentTerm: 7,
        votedFor: null,
        commitIndex: 1,
        lastApplied: 1,
        activeConfiguration: { newPeers: [nodeId] },
      }),
    );
    await redis.set(
      `${nodeId}:log:1`,
      JSON.stringify({
        term: 7,
        index: 1,
        commandType: RaftCommandType.APPLICATION,
        commandPayload: 9,
        timestamp: new Date(),
        checksum: calculateChecksum(9),
      }),
    );
    const counter = new Counter();
    const node = new RaftNode(config, counter);
    nodes.push(node);
    await node.start();
    expect(node.getCurrentTerm()).toBe(7);
    expect(counter.value).toBe(9);
    await node.forceElection();
    await node.appendLog(4);
    expect(counter.value).toBe(13);
    expect(JSON.parse((await redis.get(`${nodeId}:state`))!).commitIndex).toBe(
      node.getCommitIndex(),
    );
    expect(await redis.exists(`${nodeId}:log:${node.getCommitIndex()}`)).toBe(
      1,
    );
  });

  it("adds and removes voting members through joint consensus", async () => {
    const { members, counters, configs } = await cluster(3);
    const leader = members.find(
      (node) => node.getState() === RaftState.LEADER,
    )!;
    const config = {
      ...configs[0]!,
      nodeId: `${configs[0]!.clusterId}-new`,
      persistence: {
        ...configs[0]!.persistence,
        dataDir: join(configs[0]!.persistence.dataDir, "new"),
      },
    };
    config.peers = [...leader.getPeers(), config.nodeId];
    const state = new Counter();
    const added = new RaftNode(config, state);
    nodes.push(added);
    await added.start();
    await new Promise((resolve) => setTimeout(resolve, 300));
    await leader.changeClusterConfiguration(config.peers);
    await leader.appendLog(3);
    await until(() => state.value === 3);
    const removed = members.find((node) => node !== leader)!;
    await leader.changeClusterConfiguration(
      config.peers.filter((peer) => peer !== removed.getNodeId()),
    );
    await removed.stop();
    await leader.appendLog(7);
    await until(
      () =>
        state.value === 10 && counters[members.indexOf(leader)]!.value === 10,
    );
    expect(leader.getActiveConfiguration().oldPeers).toBeUndefined();
    expect(leader.getPeers()).not.toContain(removed.getNodeId());
  }, 30000);
});
