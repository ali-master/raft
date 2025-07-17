import { vi, it, expect, describe, beforeEach, afterEach } from "vitest";
import type { RaftNode } from "../src/core/raft-node";
import { RaftEngine } from "../src/raft-engine";
import { MockStateMachine } from "./shared/mocks/state-machine.mock";
import type { RaftConfiguration } from "../src/types";
import { RaftState, LogLevel } from "../src/constants";
import { createTempDataDir, cleanupDataDir } from "./shared/utils/temp-dir";
import type { RaftNetwork } from "../src/network/raft-network";
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
  electionTimeout: [150, 300], // Keep election timeouts relatively short for tests
  heartbeatInterval: 50,
  logging: { level: LogLevel.ERROR },
  persistence: {
    enableSnapshots: false,
    snapshotInterval: 1000,
    dataDir: "/tmp/test",
    walEnabled: false,
    walSizeLimit: 1024 * 1024,
  },
  network: {
    requestTimeout: 200,
    maxRetries: 3,
    retryDelay: 50,
    circuitBreakerThreshold: 5,
    circuitBreakerTimeout: 5000,
  }, // Faster network timeout for tests
};

async function createTestNode(
  nodeId: string,
  port: number,
  peerPorts: number[] = [],
): Promise<TestNode> {
  const dataDir = await createTempDataDir();
  ALL_DATA_DIRS.push(dataDir);

  const peers = peerPorts.map((p) => `localhost:${p}`);

  const config = createTestConfig(nodeId, {
    ...baseConfig,
    clusterId: "prevote-test-cluster",
    httpHost: "localhost",
    httpPort: port,
    snapshotThreshold: 10000, // High to prevent snapshots
    persistence: { ...baseConfig.persistence, dataDir },
    peers,
  });

  const stateMachine = new MockStateMachine();
  const engine = new RaftEngine();
  // Provide the stateMachine directly to createNode
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
  // Vitest's clearAllMocks might be better if spies are on prototypes/classes
  vi.clearAllMocks();
  // If vi.restoreAllMocks() is preferred:
  // vi.restoreAllMocks();

  for (const dir of ALL_DATA_DIRS) {
    await cleanupDataDir(dir);
  }
  ALL_DATA_DIRS.length = 0;
  Object.keys(NODES).forEach((key) => delete NODES[key]);
}

async function waitForLeader(
  nodesToQuery: RaftNode[],
  timeoutMs = 5000,
  expectedLeaderId?: string,
): Promise<RaftNode | null> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    for (const node of nodesToQuery) {
      if (node.getState() === RaftState.LEADER) {
        if (expectedLeaderId && node.getNodeId() !== expectedLeaderId) continue;
        return node;
      }
    }
    await delay(100);
  }
  console.warn(
    `Timeout waiting for leader. Expected: ${expectedLeaderId || "any"}`,
  );
  return null;
}

// Helper to manually trigger election logic for a node (bypassing actual timer)
async function _triggerElection(node: RaftNode) {
  // @ts-ignore: Access private method for testing
  await (node as any).startElection();
}

describe("Pre-Vote Protocol", () => {
  beforeEach(async () => {
    await cleanupAllNodes(); // Ensure clean state before each test
  });

  afterEach(async () => {
    await cleanupAllNodes();
  });

  it("Test Case 1: Pre-Vote Prevents Disruption from Partitioned Node", async () => {
    // 1. Setup: 3-node cluster, node3 is partitioned
    const n1 = await createTestNode("node1", 9021, [9022, 9023]);
    const n2 = await createTestNode("node2", 9022, [9021, 9023]);
    const n3 = await createTestNode("node3", 9023, [9021, 9022]);

    await n1.node.start();
    await n2.node.start();
    // Do not start n3 with full connectivity initially for partition simulation

    const initialLeader = await waitForLeader([n1.node, n2.node], 5000);
    expect(initialLeader).not.toBeNull();
    const initialTerm = initialLeader!.getCurrentTerm();
    console.log(
      `Initial leader ${initialLeader!.getNodeId()} at term ${initialTerm}`,
    );

    // Simulate partition for node3
    // @ts-ignore : Access private network member
    const n3Network = n3.node.network as RaftNetwork;
    const _sendPreVoteSpyN3 = vi
      .spyOn(n3Network, "sendPreVoteRequest")
      .mockImplementation(async (peerId, _request) => {
        console.log(
          `Simulated partition: n3 trying to send PreVote to ${peerId} - blocked.`,
        );
        throw new Error("Simulated network partition: cannot reach peer");
      });
    // @ts-ignore
    const _sendVoteSpyN3 = vi
      .spyOn(n3Network, "sendVoteRequest")
      .mockImplementation(async (peerId, _request) => {
        console.log(
          `Simulated partition: n3 trying to send VoteRequest to ${peerId} - blocked.`,
        );
        throw new Error("Simulated network partition: cannot reach peer");
      });

    // Start n3 *after* its network is "partitioned" for outgoing requests
    await n3.node.start();
    await delay(n3.config.electionTimeout[1] * 2); // Wait for n3's election timer to likely expire

    // 2. Action: Trigger election on node3 (or wait for its timer)
    // Since n3 cannot communicate, its pre-vote should fail.
    // We can try to force it if direct timer manipulation is hard.
    // For now, waiting for its natural timeout is the primary mechanism.
    // If we directly call startElection, it bypasses the timer logic which is part of what pre-vote protects.
    // Let's rely on n3's election timer expiring due to lack of heartbeats (which it won't get due to partition)

    console.log("Waiting for partitioned node3 to attempt election...");

    // 3. Assertions
    // n3 should have attempted pre-vote due to election timeout
    // We expect sendPreVoteSpyN3 to have been called, but all calls failed.
    // It's hard to assert it was called if it always throws without returning a promise that resolves.
    // A better spy might be on the caller within startElection if needed.
    // For now, we check the outcome: term and state.

    expect(n3.node.getCurrentTerm()).toBe(initialTerm); // Term should NOT have incremented
    expect(n3.node.getState()).toBe(RaftState.FOLLOWER); // Should remain follower or return to it

    // node1 and node2 should be undisturbed
    expect(initialLeader!.getState()).toBe(RaftState.LEADER); // Original leader still leader
    expect(initialLeader!.getCurrentTerm()).toBe(initialTerm);

    const otherHealthyNode =
      initialLeader!.getNodeId() === "node1" ? n2.node : n1.node;
    expect(otherHealthyNode.getState()).toBe(RaftState.FOLLOWER);
    expect(otherHealthyNode.getCurrentTerm()).toBe(initialTerm);

    console.log("Test Case 1 assertions passed.");
  }, 15000);

  it("Test Case 2: Pre-Vote Allows Election When Majority is Reachable", async () => {
    // 1. Setup: 3-node cluster
    const n1 = await createTestNode("node1", 9031, [9032, 9033]);
    const n2 = await createTestNode("node2", 9032, [9031, 9033]);
    const n3 = await createTestNode("node3", 9033, [9031, 9032]);

    await n1.node.start();
    await n2.node.start();
    await n3.node.start();

    const originalLeader = await waitForLeader(
      [n1.node, n2.node, n3.node],
      5000,
    );
    expect(originalLeader).not.toBeNull();
    const originalTerm = originalLeader!.getCurrentTerm();
    console.log(
      `Original leader ${originalLeader!.getNodeId()} at term ${originalTerm}`,
    );

    // 2. Action: Stop the leader
    await originalLeader!.stop();
    console.log(`Stopped leader ${originalLeader!.getNodeId()}.`);

    // Wait for election timers on n2 or n3 to expire
    // One of them should successfully complete pre-vote and then a real election.
    await delay(baseConfig.electionTimeout![1] * 3); // Wait for enough time for new election cycle

    // 3. Assertions
    const remainingNodes = [n1.node, n2.node, n3.node].filter(
      (n) => n.getNodeId() !== originalLeader!.getNodeId(),
    );
    const newLeader = await waitForLeader(remainingNodes, 5000);
    expect(newLeader).not.toBeNull();

    console.log(`New leader elected: ${newLeader!.getNodeId()}`);
    expect(newLeader!.getCurrentTerm()).toBeGreaterThan(originalTerm); // Term should have incremented
    expect(newLeader!.getState()).toBe(RaftState.LEADER);

    // The other remaining node should be a follower in the new term
    const newFollower = remainingNodes.find(
      (n) => n.getNodeId() !== newLeader!.getNodeId(),
    );
    expect(newFollower).toBeDefined();
    expect(newFollower!.getState()).toBe(RaftState.FOLLOWER);
    expect(newFollower!.getCurrentTerm()).toEqual(newLeader!.getCurrentTerm());

    console.log("Test Case 2 assertions passed.");
  }, 20000);
});
