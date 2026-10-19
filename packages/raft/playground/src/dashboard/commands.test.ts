import { test, expect, describe } from "bun:test";
import { ObservatoryStateMachine, CommandCenter } from "./commands";
import type { DispatchCommand } from "./commands";
import type { NodeInfo } from "../utils/cluster-manager";
import { EventJournal } from "./journal";
import { DashboardMetrics } from "./metrics";

function fixture() {
  const journal = new EventJournal();
  const commands = new CommandCenter(journal);
  let proposal: DispatchCommand;
  let reject = false;
  const nodes = ["a", "b", "c"].map((nodeId) => {
    const stateMachine = new ObservatoryStateMachine(nodeId);
    const info = {
      nodeId,
      stateMachine,
      node: {
        isRunning: () => true,
        getState: () => (nodeId === "a" ? "leader" : "follower"),
        getCurrentTerm: () => 3,
        getCommitIndex: () => 5,
        getLog: () => ({ getLastIndex: () => 5 }),
        appendLog: async (command: DispatchCommand) => {
          proposal = command;
          if (reject) throw new Error("Commit timed out");
          return true;
        },
      },
    } as unknown as NodeInfo;
    stateMachine.onCommand = (command) => commands.applied(info, command);
    return info;
  });
  return {
    commands,
    nodes,
    journal,
    proposal: () => proposal!,
    failProposal: () => {
      reject = true;
    },
  };
}

describe("committed destination probes", () => {
  test("executes only the destination after apply, with an exact SHA-256 result", async () => {
    const f = fixture();
    await f.commands.dispatch(f.nodes[0]!, ["b"], "sha256", "abc");
    expect(f.commands.snapshot()[0]!.commit).toBe("pending");
    expect(f.commands.snapshot()[0]!.receipts[0]!.status).toBe("waiting");
    for (const node of f.nodes) await node.stateMachine.apply(f.proposal());
    const run = f.commands.snapshot()[0]!;
    expect(run.commit).toBe("confirmed");
    expect(run.receipts).toHaveLength(1);
    expect(run.receipts[0]!.nodeId).toBe("b");
    expect(run.receipts[0]!.output).toEqual({
      bytes: 3,
      sha256:
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    });
    expect(
      f.journal.history
        .filter((event) => event.type === "command_result")
        .map((event) => event.nodeId),
    ).toEqual(["b"]);
    await f.nodes[1]!.stateMachine.apply(f.proposal());
    expect(
      f.journal.history.filter((event) => event.type === "command_result"),
    ).toHaveLength(1);
  });

  test("keeps replicated counter data and snapshots identical across targets", async () => {
    const f = fixture();
    await f.commands.dispatch(f.nodes[0]!, ["b"], "inspect", "");
    for (const info of f.nodes) {
      await info.stateMachine.apply({ type: "increment", value: 7 });
      await info.stateMachine.apply(f.proposal());
      const data = JSON.parse(
        (await info.stateMachine.getSnapshotData()).toString(),
      );
      expect(data.value).toBe(7);
      expect(data.version).toBe(1);
      const restored = new ObservatoryStateMachine(info.nodeId);
      await restored.applySnapshot(Buffer.from(JSON.stringify(data)));
      expect(restored.getValue()).toBe(7);
    }
    expect(f.commands.snapshot()[0]!.receipts[0]!.output?.counter).toBe(7);
  });

  test("does not execute an expired or previous-session probe on late apply", async () => {
    const f = fixture();
    await f.commands.dispatch(f.nodes[0]!, ["b"], "inspect", "");
    const run = f.commands.snapshot()[0]!;
    run.expiresAt = Date.now() - 1;
    await f.nodes[1]!.stateMachine.apply(f.proposal());
    expect(run.commit).toBe("confirmed");
    expect(run.receipts[0]!.status).toBe("expired");
    expect(run.receipts[0]!.output).toBeUndefined();
    const fresh = new CommandCenter(new EventJournal());
    fresh.applied(f.nodes[1]!, f.proposal());
    expect(fresh.snapshot()).toHaveLength(0);
  });

  test("keeps a timed-out proposal uncertain and accepts evidence of later commit", async () => {
    const f = fixture();
    f.failProposal();
    await expect(
      f.commands.dispatch(f.nodes[0]!, ["b"], "inspect", ""),
    ).rejects.toThrow("Commit timed out");
    const run = f.commands.snapshot()[0]!;
    expect(run.commit).toBe("unknown");
    expect(run.receipts[0]!.status).toBe("waiting");
    await f.nodes[1]!.stateMachine.apply(f.proposal());
    expect(run.commit).toBe("confirmed");
    expect(run.receipts[0]!.status).toBe("succeeded");
  });

  test("rejects non-leaders, empty destinations and oversized UTF-8 input", async () => {
    const f = fixture();
    await expect(
      f.commands.dispatch(f.nodes[1]!, ["c"], "inspect", ""),
    ).rejects.toThrow("leader");
    await expect(
      f.commands.dispatch(f.nodes[0]!, [], "inspect", ""),
    ).rejects.toThrow("Invalid");
    await expect(
      f.commands.dispatch(f.nodes[0]!, ["b"], "sha256", "🙂".repeat(129)),
    ).rejects.toThrow("Invalid");
    expect(f.commands.snapshot()).toHaveLength(0);
  });

  test("captures a destination error without failing the replicated state machine", async () => {
    const f = fixture();
    await f.commands.dispatch(f.nodes[0]!, ["b"], "inspect", "");
    f.nodes[1]!.node.getLog = () => {
      throw new Error("Diagnostic unavailable");
    };
    await f.nodes[1]!.stateMachine.apply(f.proposal());
    expect(f.commands.snapshot()[0]!.receipts[0]!.status).toBe("failed");
    expect(f.commands.snapshot()[0]!.receipts[0]!.error).toBe(
      "Diagnostic unavailable",
    );
  });
});

describe("measured node telemetry", () => {
  test("attributes successful RPCs, failures, inflight counts and percentiles correctly", () => {
    const metrics = new DashboardMetrics();
    const now = Date.now();
    for (const duration of [2, 4, 8, 20]) {
      metrics.rpc("a", "b", "sent", 0);
      metrics.rpc("a", "b", "received", duration);
    }
    metrics.rpc("a", "c", "blocked", 0);
    metrics.rpc("a", "c", "sent", 0);
    metrics.rpc("a", "c", "failed", 25);
    metrics.rpc("a", "c", "sent", 0);
    metrics.event("b", "heartbeat_received");
    metrics.event("b", "log_applied");
    metrics.event("a", "election_started");
    metrics.sample(
      [
        { id: "a", commitIndex: 8, lastApplied: 8, running: true },
        { id: "b", commitIndex: 7, lastApplied: 6, running: true },
      ],
      now + 1000,
    );
    expect(metrics.get("a")).toMatchObject({
      sent: 7,
      failed: 2,
      inFlight: 1,
      p50: 4,
      p95: 20,
      elections: 1,
      rate: 7,
    });
    expect(metrics.get("b")).toMatchObject({
      received: 4,
      sent: 0,
      heartbeats: 1,
      applied: 1,
      p95: null,
    });
    expect(metrics.history[0]!.nodes.b!.lag).toBe(2);
  });

  test("expires old latency observations and bounds history without inventing samples", () => {
    const metrics = new DashboardMetrics();
    const now = Date.now();
    metrics.rpc("a", "b", "received", 10);
    for (let i = 1; i <= 70; i++)
      metrics.sample(
        [{ id: "a", commitIndex: 1, lastApplied: 1, running: true }],
        now + i * 1001,
      );
    expect(metrics.history).toHaveLength(60);
    expect(metrics.get("a").p95).toBeNull();
    expect(metrics.history.at(-1)!.nodes.a!.rate).toBe(0);
  });
});
