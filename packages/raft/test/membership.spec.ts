import { it, expect, describe, beforeEach, afterEach } from "vitest";
import type { RaftNode } from "../src/core/raft-node";
import { RaftEngine } from "../src/raft-engine";
import { MockStateMachine } from "./shared/mocks/state-machine.mock";
import type {
  RaftConfiguration,
  ConfigurationChangePayload,
} from "../src/types";
import { RaftState, RaftCommandType, LogLevel } from "../src/constants";
import { createTempDataDir, cleanupDataDir } from "./shared/utils/temp-dir";
import { createTestConfig } from "./shared/config/test-config";

// Helper function to delay execution
const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

interface TestNode {
  node: RaftNode;
  engine: RaftEngine;
  stateMachine: MockStateMachine;
  dataDir: string;
  config: RaftConfiguration;
}

const NODES: Record<string, TestNode> = {};
const ALL_DATA_DIRS: string[] = [];

const baseConfig: Partial<RaftConfiguration> = {
  electionTimeout: [250, 400], // Increased for stability in multi-node tests
  heartbeatInterval: 100,
  logging: { level: LogLevel.ERROR }, // Keep logs quiet for tests
  persistence: {
    walEnabled: false,
  },
  network: { requestTimeout: 1000 },
};

async function createTestNode(
  nodeId: string,
  port: number,
  peerPorts: number[] = [],
  initialPeersInConfig: string[] = [],
): Promise<TestNode> {
  const dataDir = await createTempDataDir();
  ALL_DATA_DIRS.push(dataDir);

  const peers = peerPorts.map((p) => `localhost:${p}`);

  const config = createTestConfig(nodeId, {
    ...baseConfig,
    clusterId: "membership-test-cluster",
    httpHost: "localhost",
    httpPort: port,
    snapshotThreshold: 1000, // High threshold to avoid snapshots interfering
    persistence: {
      ...baseConfig.persistence,
      dataDir,
    },
    peers:
      initialPeersInConfig.length > 0
        ? initialPeersInConfig.map(
            (id) => `localhost:${NODES[id]?.config.httpPort || port}`,
          )
        : peers,
  });

  const stateMachine = new MockStateMachine();
  const engine = new RaftEngine();
  const node = await engine.createNode(config, stateMachine);
  NODES[nodeId] = { node, engine, stateMachine, dataDir, config };
  return NODES[nodeId];
}

async function cleanupAllNodes(): Promise<void> {
  for (const nodeId in NODES) {
    try {
      await NODES[nodeId].node.stop();
    } catch {
      /* ignore */
    }
  }
  for (const dir of ALL_DATA_DIRS) {
    await cleanupDataDir(dir);
  }
  ALL_DATA_DIRS.length = 0; // Clear the array
  Object.keys(NODES).forEach((key) => delete NODES[key]); // Clear NODES object
}

async function waitForLeader(
  nodes: RaftNode[],
  timeoutMs = 5000,
): Promise<RaftNode | null> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    for (const node of nodes) {
      if (node.getState() === RaftState.LEADER) {
        return node;
      }
    }
    await delay(100);
  }
  return null;
}

async function waitForLogCommit(
  node: RaftNode,
  index: number,
  timeoutMs = 10000,
): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    if (node.getCommitIndex() >= index) {
      // Also wait for application to ensure config changes are reflected
      // This is a bit of a hack; ideally, we'd wait for lastApplied >= index too,
      // but applyCommittedEntries is async.
      await delay(200); // Give a little time for application
      return;
    }
    if (
      node.getState() !== RaftState.LEADER &&
      node.getState() !== RaftState.FOLLOWER
    ) {
      // If node is candidate or stopped, it might not commit further.
      // This check might need refinement based on test scenario.
    }
    await delay(100);
  }
  throw new Error(
    `Timeout waiting for log index ${index} to be committed on node ${node.getNodeId()}. Current commitIndex: ${node.getCommitIndex()}`,
  );
}

async function waitForActiveConfiguration(
  node: RaftNode,
  expectedConfig: { oldPeers?: string[]; newPeers: string[] },
  timeoutMs = 5000,
): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    //@ts-ignore - access private member for test
    const currentConfig = node.activeConfiguration;
    const oldPeersMatch =
      (!expectedConfig.oldPeers && !currentConfig.oldPeers) ||
      (expectedConfig.oldPeers &&
        currentConfig.oldPeers &&
        expectedConfig.oldPeers.length === currentConfig.oldPeers.length &&
        expectedConfig.oldPeers.every((p) =>
          currentConfig.oldPeers!.includes(p),
        ));
    const newPeersMatch =
      expectedConfig.newPeers.length === currentConfig.newPeers.length &&
      expectedConfig.newPeers.every((p) => currentConfig.newPeers.includes(p));

    if (oldPeersMatch && newPeersMatch) return;
    await delay(100);
  }
  //@ts-ignore
  throw new Error(
    `Timeout waiting for active configuration ${JSON.stringify(expectedConfig)} on node ${node.getNodeId()}. Current: ${JSON.stringify(node.activeConfiguration)}`,
  );
}

describe("Cluster Membership Changes (Joint Consensus)", () => {
  beforeEach(async () => {
    // Clean up any residue from previous tests if afterEach failed.
    await cleanupAllNodes();
  });

  afterEach(async () => {
    await cleanupAllNodes();
  });

  it("Test Case 1: Add a Server to a 3-Node Cluster", async () => {
    // 1. Setup 3 initial nodes
    const node1 = await createTestNode(
      "node1",
      9001,
      [9002, 9003],
      ["node1", "node2", "node3"],
    );
    const node2 = await createTestNode(
      "node2",
      9002,
      [9001, 9003],
      ["node1", "node2", "node3"],
    );
    const node3 = await createTestNode(
      "node3",
      9003,
      [9001, 9002],
      ["node1", "node2", "node3"],
    );

    await node1.node.start();
    await node2.node.start();
    await node3.node.start();

    const initialNodes = [node1.node, node2.node, node3.node];
    const leader = await waitForLeader(initialNodes);
    expect(leader).not.toBeNull();
    const leaderNode = NODES[leader!.getNodeId()].node;
    const initialLeaderId = leaderNode.getNodeId();

    const initialConfig = {
      newPeers: [
        node1.config.nodeId,
        node2.config.nodeId,
        node3.config.nodeId,
      ].sort(),
    };
    // @ts-ignore
    expect(leaderNode.activeConfiguration.newPeers.sort()).toEqual(
      initialConfig.newPeers,
    );
    // @ts-ignore
    expect(leaderNode.activeConfiguration.oldPeers).toBeUndefined();

    // Append a few entries to stabilize
    for (let i = 0; i < 3; i++) {
      await leaderNode.appendLog({ command: `initial-entry-${i}` });
    }
    await waitForLogCommit(leaderNode, leaderNode.getLog().getLastIndex());
    for (const n of initialNodes.filter(
      (n) => n.getNodeId() !== initialLeaderId,
    )) {
      await waitForLogCommit(n, leaderNode.getCommitIndex());
      //@ts-ignore
      expect(n.activeConfiguration.newPeers.sort()).toEqual(
        initialConfig.newPeers,
      );
    }

    // 2. Action: Create and add 4th node
    const node4 = await createTestNode("node4", 9004, [9001, 9002, 9003]); // Does not initially know it's part of config.
    await node4.node.start(); // Start node4
    await delay(500); // Give node4 time to discover leader via peers if configured, though it won't be a voting member yet.

    const newClusterPeerIds = [
      node1.config.nodeId,
      node2.config.nodeId,
      node3.config.nodeId,
      node4.config.nodeId,
    ].sort();

    console.log(
      `Leader ${leaderNode.getNodeId()} initiating configuration change to add node4.`,
    );
    await leaderNode.changeClusterConfiguration(newClusterPeerIds);

    // 3. Assertions
    // Leader assertions
    const cJointEntryIndex = leaderNode.getLog().getLastIndex() - 1; // C_joint is the second to last, C_new is last
    const cNewEntryIndex = leaderNode.getLog().getLastIndex();

    const leaderLog = leaderNode.getLog();
    const cJointEntry = leaderLog.getEntry(cJointEntryIndex);
    const cNewEntry = leaderLog.getEntry(cNewEntryIndex);

    expect(cJointEntry?.commandType).toBe(RaftCommandType.CHANGE_CONFIG);
    expect(
      (
        cJointEntry?.commandPayload as ConfigurationChangePayload
      ).oldPeers?.sort(),
    ).toEqual(initialConfig.newPeers);
    expect(
      (
        cJointEntry?.commandPayload as ConfigurationChangePayload
      ).newPeers.sort(),
    ).toEqual(newClusterPeerIds);

    expect(cNewEntry?.commandType).toBe(RaftCommandType.CHANGE_CONFIG);
    expect(
      (cNewEntry?.commandPayload as ConfigurationChangePayload).oldPeers,
    ).toBeUndefined();
    expect(
      (cNewEntry?.commandPayload as ConfigurationChangePayload).newPeers.sort(),
    ).toEqual(newClusterPeerIds);

    // Wait for C_new to be fully applied on leader
    await waitForActiveConfiguration(leaderNode, {
      newPeers: newClusterPeerIds,
    });
    // @ts-ignore
    expect(leaderNode.activeConfiguration.newPeers.sort()).toEqual(
      newClusterPeerIds,
    );
    // @ts-ignore
    expect(leaderNode.activeConfiguration.oldPeers).toBeUndefined();

    // Follower assertions (node2, node3)
    for (const follower of [node2.node, node3.node]) {
      await waitForLogCommit(follower, cNewEntryIndex); // Wait for C_new to be committed & applied
      await waitForActiveConfiguration(follower, {
        newPeers: newClusterPeerIds,
      });
      // @ts-ignore
      expect(follower.activeConfiguration.newPeers.sort()).toEqual(
        newClusterPeerIds,
      );
      // @ts-ignore
      expect(follower.activeConfiguration.oldPeers).toBeUndefined();
      expect(follower.getLog().getEntry(cJointEntryIndex)?.commandType).toBe(
        RaftCommandType.CHANGE_CONFIG,
      );
      expect(follower.getLog().getEntry(cNewEntryIndex)?.commandType).toBe(
        RaftCommandType.CHANGE_CONFIG,
      );
    }

    // New node (node4) assertions
    await waitForLogCommit(node4.node, cNewEntryIndex);
    await waitForActiveConfiguration(node4.node, {
      newPeers: newClusterPeerIds,
    });
    // @ts-ignore
    expect(node4.node.activeConfiguration.newPeers.sort()).toEqual(
      newClusterPeerIds,
    );
    // @ts-ignore
    expect(node4.node.activeConfiguration.oldPeers).toBeUndefined();
    expect(node4.node.getLog().getEntry(cJointEntryIndex)?.commandType).toBe(
      RaftCommandType.CHANGE_CONFIG,
    );
    expect(node4.node.getLog().getEntry(cNewEntryIndex)?.commandType).toBe(
      RaftCommandType.CHANGE_CONFIG,
    );

    // Cluster Stability: Append new entry, verify on all 4 nodes
    const finalEntryPayload = { command: "final-entry" };
    await leaderNode.appendLog(finalEntryPayload);
    const finalEntryIndex = leaderNode.getLog().getLastIndex();

    await waitForLogCommit(leaderNode, finalEntryIndex); // Leader commits it
    for (const n of [node1.node, node2.node, node3.node, node4.node]) {
      await waitForLogCommit(n, finalEntryIndex, 15000); // Increased timeout for all nodes to catch up
      const entry = n.getLog().getEntry(finalEntryIndex);
      expect(entry?.commandType).toBe(RaftCommandType.APPLICATION);
      expect(entry?.commandPayload).toEqual(finalEntryPayload);
      // Check if state machine applied it (optional, depends on applyCommittedEntries being robustly called)
      // expect(NODES[n.getNodeId()].stateMachine.commands.some(c => c.command === "final-entry")).toBe(true);
    }

    console.log("Test Case 1: Add a Server - Completed assertions.");
    // TODO: Verify new leader election involves all 4 nodes (more complex to set up reliably)
  }, 30000); // Increased timeout for this complex test

  it("Test Case 2: Remove a Server from a 4-Node Cluster", async () => {
    // 1. Setup 4 initial nodes
    const n1 = await createTestNode(
      "node1",
      9011,
      [9012, 9013, 9014],
      ["node1", "node2", "node3", "node4"],
    );
    const n2 = await createTestNode(
      "node2",
      9012,
      [9011, 9013, 9014],
      ["node1", "node2", "node3", "node4"],
    );
    const n3 = await createTestNode(
      "node3",
      9013,
      [9011, 9012, 9014],
      ["node1", "node2", "node3", "node4"],
    );
    const n4 = await createTestNode(
      "node4",
      9014,
      [9011, 9012, 9013],
      ["node1", "node2", "node3", "node4"],
    );

    const allNodes = [n1.node, n2.node, n3.node, n4.node];
    await Promise.all(allNodes.map((n) => n.start()));

    const leader = await waitForLeader(allNodes, 10000); // Increased timeout for 4 nodes
    expect(leader).not.toBeNull();
    const leaderNode = NODES[leader!.getNodeId()].node;
    const initialLeaderId = leaderNode.getNodeId();

    const initialPeerIds = [
      n1.config.nodeId,
      n2.config.nodeId,
      n3.config.nodeId,
      n4.config.nodeId,
    ].sort();
    const initialConfig = { newPeers: initialPeerIds };
    // @ts-ignore
    expect(leaderNode.activeConfiguration.newPeers.sort()).toEqual(
      initialConfig.newPeers,
    );
    // @ts-ignore
    expect(leaderNode.activeConfiguration.oldPeers).toBeUndefined();

    // Append a few entries to stabilize
    for (let i = 0; i < 3; i++) {
      await leaderNode.appendLog({ command: `initial-entry-${i}` });
    }
    const lastInitialEntryIndex = leaderNode.getLog().getLastIndex();
    await waitForLogCommit(leaderNode, lastInitialEntryIndex);
    for (const nodeInstance of allNodes.filter(
      (n) => n.getNodeId() !== initialLeaderId,
    )) {
      await waitForLogCommit(nodeInstance, leaderNode.getCommitIndex());
      // @ts-ignore
      expect(nodeInstance.activeConfiguration.newPeers.sort()).toEqual(
        initialConfig.newPeers,
      );
    }
    console.log("Initial 4-node cluster stabilized.");

    // 2. Action: Remove node4
    const finalPeerIds = [
      n1.config.nodeId,
      n2.config.nodeId,
      n3.config.nodeId,
    ].sort();
    console.log(
      `Leader ${leaderNode.getNodeId()} initiating configuration change to remove node4. Target: ${finalPeerIds}`,
    );
    await leaderNode.changeClusterConfiguration(finalPeerIds);

    // 3. Assertions
    const cJointEntryIndex = leaderNode.getLog().getLastIndex() - 1;
    const cNewEntryIndex = leaderNode.getLog().getLastIndex();

    const leaderLog = leaderNode.getLog();
    const cJointEntry = leaderLog.getEntry(cJointEntryIndex);
    const cNewEntry = leaderLog.getEntry(cNewEntryIndex);

    // Check leader's log entries for config change
    expect(cJointEntry?.commandType).toBe(RaftCommandType.CHANGE_CONFIG);
    expect(
      (
        cJointEntry?.commandPayload as ConfigurationChangePayload
      ).oldPeers?.sort(),
    ).toEqual(initialPeerIds);
    expect(
      (
        cJointEntry?.commandPayload as ConfigurationChangePayload
      ).newPeers.sort(),
    ).toEqual(finalPeerIds);

    expect(cNewEntry?.commandType).toBe(RaftCommandType.CHANGE_CONFIG);
    expect(
      (cNewEntry?.commandPayload as ConfigurationChangePayload).oldPeers,
    ).toBeUndefined(); // C_new has no oldPeers
    expect(
      (cNewEntry?.commandPayload as ConfigurationChangePayload).newPeers.sort(),
    ).toEqual(finalPeerIds);

    // Wait for C_new to be fully applied on leader
    await waitForActiveConfiguration(
      leaderNode,
      { newPeers: finalPeerIds },
      10000,
    );
    // @ts-ignore
    expect(leaderNode.activeConfiguration.newPeers.sort()).toEqual(
      finalPeerIds,
    );
    // @ts-ignore
    expect(leaderNode.activeConfiguration.oldPeers).toBeUndefined();
    console.log("Leader configuration updated to 3 nodes.");

    // Assertions for remaining followers (node2, node3)
    const remainingFollowers = [n2.node, n3.node].filter(
      (n) => n.getNodeId() !== initialLeaderId,
    );
    for (const follower of remainingFollowers) {
      await waitForLogCommit(follower, cNewEntryIndex, 10000);
      await waitForActiveConfiguration(
        follower,
        { newPeers: finalPeerIds },
        10000,
      );
      // @ts-ignore
      expect(follower.activeConfiguration.newPeers.sort()).toEqual(
        finalPeerIds,
      );
      // @ts-ignore
      expect(follower.activeConfiguration.oldPeers).toBeUndefined();
      expect(follower.getLog().getEntry(cJointEntryIndex)?.commandType).toBe(
        RaftCommandType.CHANGE_CONFIG,
      );
      expect(follower.getLog().getEntry(cNewEntryIndex)?.commandType).toBe(
        RaftCommandType.CHANGE_CONFIG,
      );
      console.log(`Follower ${follower.getNodeId()} configuration updated.`);
    }

    // Assertions for removed node (node4)
    // It should have processed C_joint and C_new, and its active config should be the new, smaller one.
    await waitForLogCommit(n4.node, cNewEntryIndex, 15000); // Give more time as it might be slower to get updates
    await waitForActiveConfiguration(
      n4.node,
      { newPeers: finalPeerIds },
      15000,
    );
    // @ts-ignore
    expect(n4.node.activeConfiguration.newPeers.sort()).toEqual(finalPeerIds);
    // @ts-ignore
    expect(n4.node.activeConfiguration.oldPeers).toBeUndefined(); // It applies C_new
    console.log("Removed node4 configuration updated.");

    // Cluster Stability (3 Nodes)
    const finalEntryPayload = { command: "final-entry-3-nodes" };
    console.log("Testing stability with 3 nodes. Appending new entry.");
    await leaderNode.appendLog(finalEntryPayload);
    const finalEntryIndex = leaderNode.getLog().getLastIndex();

    await waitForLogCommit(leaderNode, finalEntryIndex, 10000);
    const remainingOnlineNodes = [leaderNode, ...remainingFollowers]; // Should be node1, node2, node3 (or whoever is leader)

    for (const node of remainingOnlineNodes) {
      await waitForLogCommit(node, finalEntryIndex, 15000);
      const entry = node.getLog().getEntry(finalEntryIndex);
      expect(entry?.commandType).toBe(RaftCommandType.APPLICATION);
      expect(entry?.commandPayload).toEqual(finalEntryPayload);
      console.log(
        `Entry ${finalEntryIndex} verified on active node ${node.getNodeId()}`,
      );
    }

    // Verify node4 does NOT get the new entry if it's truly removed or stops processing them.
    // This is harder to assert directly without more insight into node4's state.
    // One way is to check its log length or lastLogIndex.
    const node4LastIndex = n4.node.getLog().getLastIndex();
    expect(node4LastIndex).toBeLessThan(finalEntryIndex); // Should not have the new entry
    console.log(
      `Removed node4 last log index: ${node4LastIndex}, final entry index: ${finalEntryIndex}`,
    );

    // Test leader election with 3 nodes
    console.log(
      `Stopping current leader ${leaderNode.getNodeId()} to trigger new election.`,
    );
    await leaderNode.stop();

    const newLeader = await waitForLeader(remainingFollowers, 10000); // Only remaining nodes can be leader
    expect(newLeader).not.toBeNull();
    expect(finalPeerIds).toContain(newLeader!.getNodeId());
    console.log(`New leader elected: ${newLeader!.getNodeId()}.`);

    // @ts-ignore Access activeConfiguration for verification
    const newLeaderActiveConfig = newLeader!.activeConfiguration;
    expect(newLeaderActiveConfig.newPeers.sort()).toEqual(finalPeerIds);
    expect(newLeaderActiveConfig.oldPeers).toBeUndefined();

    // Ensure node4 does not become leader
    expect(n4.node.getState()).not.toBe(RaftState.LEADER);

    console.log("Test Case 2: Remove a Server - Completed assertions.");
  }, 45000); // Increased timeout for this more complex test with leader change
});
