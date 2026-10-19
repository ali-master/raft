import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { ClusterManager } from "../utils/cluster-manager";
import { DEFAULT_PLAYGROUND_CONFIG } from "../utils/config";
import type { PlaygroundDashboard } from "./server";
import type { DispatchCommand } from "./commands";
import { ObservatoryStateMachine } from "./commands";

const container = `raft-command-test-${process.pid}`;
const clusterId = `commands-${crypto.randomUUID()}`;
let manager: ClusterManager;
let dashboard: PlaygroundDashboard;
const previousPort = process.env.RAFT_DASHBOARD_PORT;
const previousOpen = process.env.RAFT_DASHBOARD_OPEN;

function docker(...args: string[]) {
  const result = Bun.spawnSync(["docker", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}

async function eventually(predicate: () => boolean, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline)
      throw new Error("Timed out waiting for real cluster state");
    await Bun.sleep(40);
  }
}

async function post(input: unknown) {
  return fetch(`${dashboard.url}/api/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

async function dispatch(target: string, operation = "inspect", payload = "") {
  const response = await post({
    action: "dispatch",
    target,
    operation,
    payload,
  });
  const body = (await response.json()) as { commandId: string; error?: string };
  if (!response.ok) throw new Error(body.error);
  return () =>
    dashboard.snapshot().commands.find((run) => run.id === body.commandId)!;
}

beforeAll(async () => {
  docker(
    "run",
    "--detach",
    "--rm",
    "--name",
    container,
    "-p",
    "127.0.0.1::6379",
    "redis:8-alpine",
    "redis-server",
    "--save",
    "",
    "--appendonly",
    "no",
  );
  const redisPort = Number(
    docker("port", container, "6379/tcp").split(":").at(-1),
  );
  process.env.RAFT_DASHBOARD_PORT = "0";
  process.env.RAFT_DASHBOARD_OPEN = "0";
  manager = new ClusterManager(clusterId, {
    ...DEFAULT_PLAYGROUND_CONFIG,
    cluster: {
      ...DEFAULT_PLAYGROUND_CONFIG.cluster,
      redisHost: "127.0.0.1",
      redisPort,
    },
  });
  dashboard = (await manager.enableDashboard(true))!;
  await manager.createCluster(3);
  await manager.appendToLeader({ type: "increment", value: 7 });
  dashboard.ready = true;
}, 30000);

afterAll(async () => {
  try {
    if (manager) await manager.cleanup();
  } finally {
    if (dashboard) await dashboard.close();
    Bun.spawnSync(["docker", "rm", "-f", container], {
      stdout: "ignore",
      stderr: "ignore",
    });
    if (previousPort === undefined) delete process.env.RAFT_DASHBOARD_PORT;
    else process.env.RAFT_DASHBOARD_PORT = previousPort;
    if (previousOpen === undefined) delete process.env.RAFT_DASHBOARD_OPEN;
    else process.env.RAFT_DASHBOARD_OPEN = previousOpen;
  }
}, 15000);

describe("leader commands over real Redis Raft replication", () => {
  test("runs SHA-256 on one destination, emits SSE and preserves counter convergence", async () => {
    const target = manager
      .getAllNodes()
      .find((info) => info.nodeId !== manager.getLeader()!.nodeId)!;
    const stream = await fetch(`${dashboard.url}/api/events`);
    const reader = stream.body!.getReader();
    try {
      const run = await dispatch(target.nodeId, "sha256", "abc");
      await eventually(() => run().receipts[0]!.status === "succeeded");
      expect(run().commit).toBe("confirmed");
      expect(run().receipts.map((receipt) => receipt.nodeId)).toEqual([
        target.nodeId,
      ]);
      expect(run().receipts[0]!.output?.sha256).toBe(
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      );
      let frames = "";
      const deadline = Date.now() + 5000;
      while (!frames.includes("command_result") && Date.now() < deadline) {
        const chunk = await reader.read();
        if (chunk.done) break;
        frames += new TextDecoder().decode(chunk.value);
      }
      expect(frames).toContain("command_result");
      await eventually(() =>
        manager
          .getAllNodes()
          .every(
            (info) =>
              info.node.getLastApplied() ===
              manager.getLeader()!.node.getCommitIndex(),
          ),
      );
      expect(dashboard.snapshot().nodes.map((node) => node.value)).toEqual([
        7, 7, 7,
      ]);
    } finally {
      await reader.cancel();
    }
  }, 15000);

  test("broadcasts to followers or all members with exact per-destination reports", async () => {
    const leaderId = manager.getLeader()!.nodeId;
    const others = await dispatch("followers");
    await eventually(() =>
      others().receipts.every((receipt) => receipt.status === "succeeded"),
    );
    expect(others().targets).toHaveLength(2);
    expect(others().targets).not.toContain(leaderId);
    const all = await dispatch("all");
    await eventually(() =>
      all().receipts.every((receipt) => receipt.status === "succeeded"),
    );
    expect(all().receipts).toHaveLength(3);
    for (const receipt of all().receipts) {
      expect(receipt.output?.node).toBe(receipt.nodeId);
      expect(receipt.output?.counter).toBe(7);
    }
  }, 15000);

  test("waits for a stopped destination and executes when it catches up before expiry", async () => {
    const target = manager
      .getAllNodes()
      .find((info) => info.nodeId !== manager.getLeader()!.nodeId)!;
    await manager.stopNode(target.nodeId);
    try {
      const run = await dispatch(target.nodeId);
      expect(run().commit).toBe("confirmed");
      expect(run().receipts[0]!.status).toBe("waiting");
      expect(run().receipts[0]!.output).toBeUndefined();
      await manager.startNode(target.nodeId);
      await eventually(() => run().receipts[0]!.status === "succeeded");
      expect(run().receipts[0]!.output?.node).toBe(target.nodeId);
    } finally {
      if (!target.node.isRunning()) await manager.startNode(target.nodeId);
    }
  }, 20000);

  test("does not execute on a partitioned target and expires it without a fake success", async () => {
    const target = manager
      .getAllNodes()
      .find((info) => info.nodeId !== manager.getLeader()!.nodeId)!;
    const others = manager
      .getAllNodes()
      .filter((info) => info !== target)
      .map((info) => info.nodeId);
    await manager.simulateNetworkPartition([target.nodeId], others);
    try {
      const run = await dispatch(target.nodeId);
      expect(run().receipts[0]!.status).toBe("waiting");
      await eventually(() => run().receipts[0]!.status === "expired", 17000);
      expect(run().receipts[0]!.output).toBeUndefined();
      await manager.healNetworkPartition(
        manager.getAllNodes().map((info) => info.nodeId),
      );
      await eventually(
        () =>
          target.node.getLastApplied() ===
          manager.getLeader()!.node.getCommitIndex(),
      );
      expect(run().receipts[0]!.status).toBe("expired");
    } finally {
      await manager.healNetworkPartition(
        manager.getAllNodes().map((info) => info.nodeId),
      );
    }
  }, 30000);

  test("uses the newly elected leader after transfer", async () => {
    const original = manager.getLeader()!;
    const next = manager.getAllNodes().find((info) => info !== original)!;
    await original.node.transferLeadership(next.nodeId);
    await eventually(() => manager.getLeader()?.nodeId === next.nodeId);
    const run = await dispatch("followers");
    await eventually(() =>
      run().receipts.every((receipt) => receipt.status === "succeeded"),
    );
    expect(run().leaderId).toBe(next.nodeId);
    expect(run().targets).not.toContain(next.nodeId);
    expect(run().targets).toContain(original.nodeId);
  }, 15000);

  test("does not execute a proposal without a quorum, then tracks its later commitment", async () => {
    const followers = manager
      .getAllNodes()
      .filter((info) => info !== manager.getLeader());
    await Promise.all(followers.map((info) => manager.stopNode(info.nodeId)));
    try {
      const response = await post({
        action: "dispatch",
        target: "all",
        operation: "inspect",
        payload: "",
      });
      expect(response.status).toBe(409);
      const run = dashboard.snapshot().commands[0]!;
      expect(run.commit).toBe("unknown");
      expect(
        run.receipts.every((receipt) => receipt.output === undefined),
      ).toBe(true);
      await Promise.all(
        followers.map((info) => manager.startNode(info.nodeId)),
      );
      await manager.waitForStability();
      await eventually(
        () => dashboard.snapshot().commands[0]!.commit === "confirmed",
      );
      expect(dashboard.snapshot().nodes.map((node) => node.value)).toEqual([
        7, 7, 7,
      ]);
    } finally {
      await Promise.all(
        followers
          .filter((info) => !info.node.isRunning())
          .map((info) => manager.startNode(info.nodeId)),
      );
    }
  }, 25000);

  test("rejects malformed, unsupported and oversized commands at the HTTP boundary", async () => {
    for (const bad of [
      { target: "missing", operation: "inspect", payload: "" },
      { target: "all", operation: "shell", payload: "whoami" },
      { target: "all", operation: "sha256", payload: "🙂".repeat(130) },
      { target: "all", operation: "inspect", payload: {} },
    ])
      expect((await post({ action: "dispatch", ...bad })).status).toBe(400);
    const follower = manager
      .getAllNodes()
      .find((info) => info !== manager.getLeader())!;
    await expect(
      follower.node.appendLog({
        type: "observatory.dispatch",
      } as DispatchCommand),
    ).rejects.toThrow();
    expect(follower.stateMachine).toBeInstanceOf(ObservatoryStateMachine);
  });

  test("exports real measured per-node counters, bounded charts and process metrics", async () => {
    await eventually(() => dashboard.snapshot().metricsHistory.length > 1);
    const state = dashboard.snapshot();
    expect(state.nodes.some((node) => node.metrics.sent > 0)).toBe(true);
    expect(state.nodes.some((node) => node.metrics.received > 0)).toBe(true);
    expect(state.nodes.some((node) => node.metrics.failed > 0)).toBe(true);
    expect(state.nodes.some((node) => node.metrics.applied > 0)).toBe(true);
    expect(state.metricsHistory.at(-1)!.rss).toBeGreaterThan(0);
    const exported = (await fetch(`${dashboard.url}/api/export`).then(
      (response) => response.json(),
    )) as { state: typeof state };
    expect(exported.state.commands.length).toBeGreaterThan(0);
    expect(exported.state.metricsHistory.length).toBeLessThanOrEqual(60);
  });
});
