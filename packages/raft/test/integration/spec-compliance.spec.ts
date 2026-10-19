import { vi, it, expect, describe, afterEach } from "vitest";
import { rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RaftNode, RaftCommandType } from "../../src";
import type { StateMachine, RaftConfiguration, LogEntry } from "../../src";
import { WALRecovery, WALEngine } from "../../src/persistence";
import { calculateChecksum } from "../../src/utils";
import { createTestConfig } from "../shared/test-utils";
import { getGlobalRedisContext } from "../shared/test-setup";

class State implements StateMachine<number> {
  values: number[] = [];
  async apply(value: number) {
    this.values.push(value);
  }
  async getSnapshotData() {
    return Buffer.from(JSON.stringify(this.values));
  }
  async applySnapshot(data: Buffer) {
    this.values = JSON.parse(data.toString());
  }
}

function entry(index: number, term: number, value: number): LogEntry<number> {
  return {
    index,
    term,
    commandType: RaftCommandType.APPLICATION,
    commandPayload: value,
    timestamp: new Date(),
    checksum: calculateChecksum(value),
  };
}

describe("Raft specification and durable state", () => {
  const nodes: RaftNode<number>[] = [];
  const directories: string[] = [];
  const wals: WALEngine[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(nodes.splice(0).map((node) => node.stop()));
    await Promise.all(wals.splice(0).map((wal) => wal.close()));
    await Promise.all(
      directories
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function createNode(config?: RaftConfiguration) {
    if (!config) {
      const dir = await mkdtemp(join(tmpdir(), "raft-spec-"));
      directories.push(dir);
      const nodeId = dir.split("/").pop()!;
      config = createTestConfig({
        nodeId,
        clusterId: nodeId,
        peers: [nodeId],
        electionTimeout: [10000, 20000],
      });
      config.redis = { ...config.redis, keyPrefix: `${nodeId}:`, ttl: 1 };
      config.persistence = {
        ...config.persistence,
        dataDir: dir,
        snapshotInterval: 60000,
      };
    }
    const state = new State();
    const node = new RaftNode<number>(config, state);
    nodes.push(node);
    await node.start();
    return { node, state, config };
  }

  it("does not expire persistent term, vote or log entries", async () => {
    const { node, config } = await createNode();
    await node.forceElection();
    await node.appendLog(4);
    const { redis } = getGlobalRedisContext();
    const prefix = `${config.redis.keyPrefix}${config.nodeId}`;
    expect(await redis.ttl(`${prefix}:state`)).toBe(-1);
    expect(await redis.ttl(`${prefix}:log:${node.getCommitIndex()}`)).toBe(-1);
  });

  it("recovers term, vote and committed data from WAL when Redis state is lost", async () => {
    const { node, config } = await createNode();
    await node.forceElection();
    await node.appendLog(4);
    const vote = {
      term: 7,
      candidateId: "candidate-a",
      lastLogIndex: node.getLog().getLastIndex(),
      lastLogTerm: node.getLog().getLastTerm(),
    };
    expect((await node.handleVoteRequest(vote)).voteGranted).toBe(true);
    await node.stop();
    const { redis } = getGlobalRedisContext();
    const keys = await redis.keys(
      `${config.redis.keyPrefix}${config.nodeId}:*`,
    );
    if (keys.length) await redis.del(...keys);
    const restored = await createNode(config);
    expect(restored.node.getCurrentTerm()).toBe(7);
    expect(restored.state.values).toEqual([4]);
    expect(
      (
        await restored.node.handleVoteRequest({
          ...vote,
          candidateId: "candidate-b",
        })
      ).voteGranted,
    ).toBe(false);
  });

  it("rejects corrupt persisted state instead of starting a new term history", async () => {
    const { node, config } = await createNode();
    await node.stop();
    await getGlobalRedisContext().redis.set(
      `${config.redis.keyPrefix}${config.nodeId}:state`,
      "invalid-json",
    );
    const replacement = new RaftNode(config, new State());
    nodes.push(replacement);
    await expect(replacement.start()).rejects.toThrow();
  });

  it("reports snapshot persistence or state-machine failures to its caller", async () => {
    const { node, state } = await createNode();
    await node.forceElection();
    await node.appendLog(1);
    vi.spyOn(state, "getSnapshotData").mockRejectedValue(
      new Error("snapshot unavailable"),
    );
    await expect(node.createSnapshot()).rejects.toThrow("snapshot unavailable");
  });

  it("rejects an old AppendEntries resumed after a newer term has committed", async () => {
    const { node, state } = await createNode();
    const discovery = (node as any).peerDiscovery;
    const update = discovery.updatePeerState.bind(discovery);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let waiting = false;
    vi.spyOn(discovery, "updatePeerState").mockImplementationOnce(
      async (...args: unknown[]) => {
        await update(...args);
        waiting = true;
        await gate;
      },
    );
    const stale = node.handleAppendEntries({
      term: 2,
      leaderId: "old",
      prevLogIndex: 0,
      prevLogTerm: 0,
      entries: [entry(1, 2, 2)],
      leaderCommit: 1,
    });
    try {
      await vi.waitFor(() => expect(waiting).toBe(true));
      await node.handleAppendEntries({
        term: 3,
        leaderId: "new",
        prevLogIndex: 0,
        prevLogTerm: 0,
        entries: [entry(1, 3, 3)],
        leaderCommit: 1,
      });
    } finally {
      release();
    }
    expect((await stale).success).toBe(false);
    expect(node.getLog().getEntry(1)?.commandPayload).toBe(3);
    expect(state.values).toEqual([3]);
  });

  it("serializes concurrent membership changes before appending joint configurations", async () => {
    const { node } = await createNode();
    await node.forceElection();
    const results = await Promise.allSettled([
      node.changeClusterConfiguration([node.getNodeId()]),
      node.changeClusterConfiguration([node.getNodeId()]),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    const configurations = node
      .getLog()
      .getEntries(1)
      .filter((log) => log.commandType === RaftCommandType.CHANGE_CONFIG);
    expect(
      configurations.filter(
        (log) => (log.commandPayload as { oldPeers?: string[] }).oldPeers,
      ),
    ).toHaveLength(1);
  });

  it("does not resurrect a conflicting suffix from WAL after installing a snapshot", async () => {
    const { node, config } = await createNode();
    await node.handleAppendEntries({
      term: 1,
      leaderId: "old",
      prevLogIndex: 0,
      prevLogTerm: 0,
      entries: [entry(1, 1, 1), entry(2, 1, 2)],
      leaderCommit: 0,
    });
    await node.handleInstallSnapshot({
      term: 2,
      leaderId: "new",
      lastIncludedIndex: 1,
      lastIncludedTerm: 2,
      offset: 0,
      data: Buffer.from("[5]"),
      done: true,
    });
    expect(node.getLog().getLastIndex()).toBe(1);
    await node.stop();
    const restored = await createNode(config);
    expect(restored.node.getLog().getLastIndex()).toBe(1);
    expect(restored.state.values).toEqual([5]);
  });

  it("uses the latest received membership configuration before its commit", async () => {
    const { node } = await createNode();
    const payload = {
      oldPeers: [node.getNodeId()],
      newPeers: [node.getNodeId(), "joining-peer"],
    };
    await node.handleAppendEntries({
      term: 2,
      leaderId: node.getNodeId(),
      prevLogIndex: 0,
      prevLogTerm: 0,
      entries: [
        {
          ...entry(1, 2, 0),
          commandType: RaftCommandType.CHANGE_CONFIG,
          commandPayload: payload,
          checksum: calculateChecksum(payload),
        },
      ],
      leaderCommit: 0,
    });
    expect(node.getActiveConfiguration()).toEqual(payload);
  });

  it("preserves unsnapshotted logs and hard state across WAL compaction and restart", async () => {
    const { node, config } = await createNode();
    await node.stop();
    const dataDir = join(config.persistence.dataDir, "compaction");
    const options = {
      dataDir,
      maxSegmentSize: 300,
      maxWalSize: 600,
      syncInterval: 0,
      compressionEnabled: false,
      checksumEnabled: true,
    };
    const writer = new WALEngine(options, node.getLogger());
    wals.push(writer);
    await writer.initialize();
    await writer.appendMetadata({
      term: 9,
      votedFor: "candidate",
      commitIndex: 12,
    });
    for (let i = 1; i <= 12; i++) await writer.appendLogEntry(entry(i, 9, i));
    await writer.compact();
    await writer.close();
    const reader = new WALEngine(options, node.getLogger());
    wals.push(reader);
    await reader.initialize();
    const state = await new WALRecovery(reader, node.getLogger()).recover();
    expect(state.term).toBe(9);
    expect(state.votedFor).toBe("candidate");
    expect(state.logs.map((log) => log.index)).toEqual(
      Array.from({ length: 12 }, (_, i) => i + 1),
    );
  });
});
