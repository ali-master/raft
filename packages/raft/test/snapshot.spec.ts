import { vi, it, expect, describe, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { RaftEngine } from "../src/raft-engine";
import { MockStateMachine } from "./shared/mocks/state-machine.mock";
import type { RaftConfiguration } from "../src/types";
import { RaftState, LogLevel } from "../src/constants";
import { createTempDataDir, cleanupDataDir } from "./shared/utils/temp-dir";
import type { RaftNetwork } from "../src/network/raft-network";
import { createTestConfig } from "./shared/config/test-config";

// Helper function to delay execution
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Snapshot Functionality", () => {
  let dataDir: string;
  let leaderDataDir: string;
  let followerDataDir: string;

  const baseConfig: Partial<RaftConfiguration> = {
    electionTimeout: [150, 300],
    heartbeatInterval: 50,
    logging: { level: LogLevel.ERROR }, // Keep logs quiet for tests
    persistence: {
      walEnabled: false, // For simplicity in these tests, focus on snapshot files
    },
  };

  beforeEach(async () => {
    // Default dataDir for single node tests
    dataDir = await createTempDataDir();
  });

  afterEach(async () => {
    await cleanupDataDir(dataDir);
    if (leaderDataDir) await cleanupDataDir(leaderDataDir);
    if (followerDataDir) await cleanupDataDir(followerDataDir);
    leaderDataDir = "";
    followerDataDir = "";
    vi.restoreAllMocks(); // Clears spies and mocks
  });

  it("Test Case 1: Snapshot Creation and Loading (Single Node)", async () => {
    const snapshotThreshold = 5;
    const totalEntries = 10;
    const snapshotDataContent = "snapshot_for_case_1";

    const config = createTestConfig("single-node", {
      ...baseConfig,
      clusterId: "test-cluster-1",
      httpHost: "localhost",
      httpPort: 8001,
      snapshotThreshold,
      persistence: {
        ...baseConfig.persistence,
        dataDir,
      },
    });

    const mockStateMachine1 = new MockStateMachine();
    mockStateMachine1.setSnapshotDataToReturn(Buffer.from(snapshotDataContent));

    const engine1 = new RaftEngine();
    const node1 = await engine1.createNode(config, mockStateMachine1);

    // Action & Assertions - Part 1: Create snapshot
    await node1.start();
    // For single node, it should become leader quickly
    await delay(config.electionTimeout[1] + 50);
    expect(node1.getState()).toBe(RaftState.LEADER);

    const getSnapshotDataSpy = vi.spyOn(mockStateMachine1, "getSnapshotData");

    for (let i = 0; i < totalEntries; i++) {
      await node1.appendLog({ command: `entry-${i}` });
      if (i === snapshotThreshold - 1) {
        // Snapshot should be triggered after this entry
        await delay(100); // Give time for snapshot creation
        expect(getSnapshotDataSpy).toHaveBeenCalled();

        const files = await fs.readdir(dataDir);
        const snapshotFile = files.find((f) =>
          f.match(/^snapshot-\d+-\d+\.snap$/),
        );
        expect(snapshotFile).toBeDefined();

        //@ts-ignore access private member for test
        const meta = node1.latestSnapshotMeta;
        expect(meta).not.toBeNull();
        expect(meta?.filePath).toEqual(path.join(dataDir, snapshotFile!));
        expect(meta?.lastIncludedIndex).toEqual(snapshotThreshold - 1);

        // Log's first index is lastIncludedIndex + 1
        expect(node1.getLog().getFirstIndex()).toEqual(snapshotThreshold);
      }
    }

    await node1.stop();

    // Action & Assertions - Part 2: Load snapshot
    const mockStateMachine2 = new MockStateMachine();
    const engine2 = new RaftEngine();
    const node2 = await engine2.createNode(config, mockStateMachine2);

    const applySnapshotSpy = vi.spyOn(mockStateMachine2, "applySnapshot");

    await node2.start();
    await delay(config.electionTimeout[1] + 50); // Allow time to load snapshot and potentially become leader

    expect(applySnapshotSpy).toHaveBeenCalledOnce();
    expect(mockStateMachine2.snapshotApplied).toBe(true);
    expect(mockStateMachine2.appliedSnapshotData?.toString()).toEqual(
      snapshotDataContent,
    );

    //@ts-ignore
    const loadedMeta = node2.latestSnapshotMeta;
    expect(loadedMeta).not.toBeNull();
    expect(loadedMeta?.lastIncludedIndex).toEqual(snapshotThreshold - 1);

    expect(node2.getCommitIndex()).toEqual(snapshotThreshold - 1);
    expect(node2.getLastApplied()).toEqual(snapshotThreshold - 1);
    expect(node2.getLog().getFirstIndex()).toEqual(snapshotThreshold); // lastIncludedIndex + 1

    await node2.stop();
  });

  it("Test Case 2: Leader Sends Snapshot to Follower", async () => {
    leaderDataDir = await createTempDataDir();
    followerDataDir = await createTempDataDir();
    const snapshotThreshold = 3;
    const leaderPort = 8002;
    const followerPort = 8003;

    const leaderConfig: RaftConfiguration = {
      ...baseConfig,
      nodeId: "leader",
      clusterId: "test-cluster-2",
      httpHost: "localhost",
      httpPort: leaderPort,
      snapshotThreshold,
      persistence: { ...baseConfig.persistence, dataDir: leaderDataDir },
      network: { ...(baseConfig.network || {}), requestTimeout: 500 }, // Faster timeout for test
    } as RaftConfiguration;

    const followerConfig: RaftConfiguration = {
      ...baseConfig,
      nodeId: "follower",
      clusterId: "test-cluster-2",
      httpHost: "localhost",
      httpPort: followerPort,
      snapshotThreshold: 100, // Follower doesn't create snapshot in this test
      persistence: { ...baseConfig.persistence, dataDir: followerDataDir },
      peers: [`localhost:${leaderPort}`],
      network: { ...(baseConfig.network || {}), requestTimeout: 500 },
    } as RaftConfiguration;

    const leaderSM = new MockStateMachine();
    leaderSM.setSnapshotDataToReturn(Buffer.from("leader_snapshot_data"));
    const followerSM = new MockStateMachine();

    const engine = new RaftEngine();
    const leaderNode = await engine.createNode(leaderConfig, leaderSM);
    const followerNode = await engine.createNode(followerConfig, followerSM);

    // Spy on network call
    // We need to spy on the RaftNetwork instance of the leader
    //@ts-ignore access private member for test
    const leaderNetwork = leaderNode.network as RaftNetwork;
    const sendInstallSnapshotSpy = vi.spyOn(
      leaderNetwork,
      "sendInstallSnapshot",
    );
    const followerApplySnapshotSpy = vi.spyOn(followerSM, "applySnapshot");

    await leaderNode.start();
    await followerNode.start();

    // Wait for leader election
    await delay(leaderConfig.electionTimeout[1] + 100);
    expect(leaderNode.getState()).toBe(RaftState.LEADER);

    // Leader appends entries to trigger snapshot
    for (let i = 0; i < snapshotThreshold + 2; i++) {
      await leaderNode.appendLog({ command: `leader-entry-${i}` });
    }
    await delay(200); // Time for snapshot creation on leader

    //@ts-ignore
    expect(leaderNode.latestSnapshotMeta).not.toBeNull();
    const leaderSnapshotIndex =
      leaderNode.latestSnapshotMeta!.lastIncludedIndex;

    // Trigger replication - a heartbeat or another append should do.
    // Sending another entry will ensure replication attempt.
    await leaderNode.appendLog({ command: "trigger-replication" });
    await delay(
      leaderConfig.heartbeatInterval * 3 +
        leaderConfig.network!.requestTimeout * 2,
    ); // Wait for heartbeats and potential snapshot transfer

    expect(sendInstallSnapshotSpy).toHaveBeenCalledWith(
      followerConfig.nodeId,
      expect.anything(),
    );

    const requestSent = sendInstallSnapshotSpy.mock.calls[0][1];
    expect(requestSent.lastIncludedIndex).toEqual(leaderSnapshotIndex);

    expect(followerApplySnapshotSpy).toHaveBeenCalledOnce();
    expect(followerSM.snapshotApplied).toBe(true);
    expect(followerSM.appliedSnapshotData?.toString()).toEqual(
      "leader_snapshot_data",
    );

    const followerFiles = await fs.readdir(followerDataDir);
    const followerSnapshotFile = followerFiles.find((f) =>
      f.match(/^snapshot-\d+-\d+\.snap$/),
    );
    expect(followerSnapshotFile).toBeDefined();

    //@ts-ignore
    const followerMeta = followerNode.latestSnapshotMeta;
    expect(followerMeta).not.toBeNull();
    expect(followerMeta?.lastIncludedIndex).toEqual(leaderSnapshotIndex);

    expect(followerNode.getCommitIndex()).toEqual(leaderSnapshotIndex);
    expect(followerNode.getLastApplied()).toEqual(leaderSnapshotIndex);
    expect(followerNode.getLog().getFirstIndex()).toEqual(
      leaderSnapshotIndex + 1,
    );

    await leaderNode.stop();
    await followerNode.stop();
  });
});
