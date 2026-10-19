import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { HISTORY_LIMIT, EventJournal } from "./journal";
import { PlaygroundDashboard } from "./server";
import { ClusterManager } from "../utils/cluster-manager";
import { quorumFor, positions, describeEvent } from "./model";
import type { DashboardNode } from "./model";
import { DashboardMetrics } from "./metrics";

const decoder = new TextDecoder();
async function readFrame(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const { value } = await reader.read();
  return decoder.decode(value);
}

function node(id: string, role = "follower", running = true): DashboardNode {
  return {
    id,
    role: role as DashboardNode["role"],
    running,
    term: 1,
    commitIndex: 2,
    lastApplied: 2,
    lastLogIndex: 2,
    firstLogIndex: 1,
    weight: 1,
    weighted: false,
    peers: ["a", "b", "c"],
    configuration: { newPeers: ["a", "b", "c"] },
    value: 1,
    log: [],
    metrics: new DashboardMetrics().get(id),
    commandCapable: false,
  };
}

describe("SSE event journal", () => {
  test("keeps important transitions visible to late observers", async () => {
    const journal = new EventJournal();
    journal.publish("leader_elected", "a", { term: 1 });
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) journal.publish("rpc", "a");
    const reader = journal.connect(null, {}).getReader();
    await readFrame(reader);
    await readFrame(reader);
    expect(await readFrame(reader)).toContain("leader_elected");
    await reader.cancel();
  });
  test("replays only unseen events and closes disconnected readers", async () => {
    const journal = new EventJournal();
    journal.publish("state_change", "a", { state: "candidate" });
    journal.publish("leader_elected", "a", { term: 1 });
    const reader = journal.connect("1", { term: 1 }).getReader();
    expect(await readFrame(reader)).toContain("retry: 1200");
    expect(await readFrame(reader)).toContain("event: state");
    const frame = await readFrame(reader);
    expect(frame).toContain("id: 2");
    expect(frame).toContain("leader_elected");
    expect(frame).not.toContain("state_change");
    journal.publish("log_applied", "b", { index: 2 });
    journal.flush();
    expect(await readFrame(reader)).toContain("id: 3");
    await reader.cancel();
    expect(() => journal.broadcast("state", {})).not.toThrow();
    journal.close();
  });

  test("reports replay gaps after bounded retention and handles server restarts", async () => {
    const journal = new EventJournal();
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) journal.publish("rpc", "a");
    expect(journal.history).toHaveLength(HISTORY_LIMIT);
    const reader = journal.connect("1", {}).getReader();
    await readFrame(reader);
    await readFrame(reader);
    expect(await readFrame(reader)).toContain('"omitted":4');
    await reader.cancel();
    const restarted = new EventJournal();
    restarted.publish("ready", "new-session");
    const next = restarted.connect("999999", {}).getReader();
    await readFrame(next);
    await readFrame(next);
    expect(await readFrame(next)).toContain('"nodeId":"new-session"');
    await next.cancel();
  });

  test("bounds payloads and redacts sensitive keys without throwing into Raft", () => {
    const journal = new EventJournal();
    expect(
      journal.publish("log", "a", {
        token: "sensitive",
        nested: { password: "secret" },
      }).data,
    ).toEqual({ token: "[redacted]", nested: { password: "[redacted]" } });
    expect(
      journal.publish("log", "a", { content: "a".repeat(8000) }).data.truncated,
    ).toBe(true);
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => journal.publish("log", "a", cycle)).not.toThrow();
  });

  test("disconnects slow observers instead of retaining unbounded queues", async () => {
    const journal = new EventJournal();
    const reader = journal.connect(null, {}).getReader();
    for (let i = 0; i < 400; i++) {
      journal.publish("log", "a", { value: "a".repeat(3900) });
      journal.flush();
    }
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
    }
    expect(bytes).toBeLessThan(1100000);
  });
});

describe("honest cluster presentation", () => {
  test("keeps twenty nodes apart and within the topology viewport", () => {
    const points = [
      ...positions(
        Array.from({ length: 20 }, (_, i) => node(`node-${i}`)),
      ).values(),
    ];
    expect(points).toHaveLength(20);
    const distances = points.flatMap((point, i) =>
      points
        .slice(i + 1)
        .map((other) => Math.hypot(point.x - other.x, point.y - other.y)),
    );
    expect(Math.min(...distances)).toBeGreaterThan(64);
    expect(
      points.every(({ x, y }) => x >= 70 && x <= 730 && y >= 50 && y <= 480),
    ).toBe(true);
  });

  test("does not report quorum for an isolated old leader or stopped members", () => {
    const nodes = [node("a", "leader"), node("b"), node("c")];
    expect(quorumFor(nodes, []).healthy).toBe(true);
    expect(quorumFor(nodes, ["a->b", "a->c"]).healthy).toBe(false);
    nodes[1]!.running = false;
    nodes[2]!.running = false;
    expect(quorumFor(nodes, []).healthy).toBe(false);
  });

  test("honors weighted and joint voting configurations", () => {
    const nodes = [
      node("a", "leader"),
      node("b"),
      node("c", "follower", false),
    ];
    nodes[0]!.weighted = true;
    nodes[2]!.weight = 4;
    expect(quorumFor(nodes, []).healthy).toBe(false);
    nodes[0]!.weighted = false;
    nodes[0]!.configuration.oldPeers = ["c", "d", "a"];
    expect(quorumFor(nodes, []).healthy).toBe(false);
  });

  test("distinguishes an appended log from an applied entry", () => {
    expect(
      describeEvent({
        id: 1,
        time: 0,
        nodeId: "a",
        type: "log_replicated",
        data: { index: 3 },
      }),
    ).toContain("awaiting commit");
    expect(
      describeEvent({
        id: 2,
        time: 0,
        nodeId: "a",
        type: "log_applied",
        data: { index: 3 },
      }),
    ).toContain("committed & applied");
  });
});

describe("native Bun dashboard HTTP boundary", () => {
  const manager = new ClusterManager("dashboard-http-test");
  const dashboard = new PlaygroundDashboard(
    manager,
    "dashboard-http-test",
    true,
  );
  let url: string;
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${url}/api/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  beforeAll(async () => {
    url = await dashboard.start({ port: 0, openBrowser: false });
    dashboard.ready = true;
  });
  afterAll(async () => {
    await dashboard.close();
  });

  test("bundles real React, Tailwind and shadcn assets with Bun", async () => {
    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
    const html = await response.text();
    expect(html).toContain("Raft Observatory");
    const script = html.match(/src="([^"]+\.js)"/)!;
    const js = await fetch(new URL(script[1]!, url)).then((result) =>
      result.text(),
    );
    expect(js).toContain("Consensus,");
    expect(js).not.toContain("node:http");
  });

  test("rejects cross-origin actions, DNS rebinding, and invalid input", async () => {
    expect(
      (await post({ action: "write" }, { Origin: "https://example.com" }))
        .status,
    ).toBe(403);
    expect(
      (await fetch(`${url}/api/state`, { headers: { Host: "example.com" } }))
        .status,
    ).toBe(403);
    expect((await post({ action: "execute-shell" })).status).toBe(400);
    expect((await post({ action: "start", nodeId: "unknown" })).status).toBe(
      400,
    );
    expect(
      (await post({ action: "write", padding: "x".repeat(2000) })).status,
    ).toBe(413);
  });

  test("serializes controls and returns failed commands as errors", async () => {
    const original = manager.appendToLeader.bind(manager);
    let release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    manager.appendToLeader = async () => {
      started();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    };
    const first = post({ action: "write" });
    await entered;
    expect((await post({ action: "write" })).status).toBe(409);
    release();
    expect((await first).status).toBe(200);
    manager.appendToLeader = original;
    expect((await post({ action: "write" })).status).toBe(409);
    expect(dashboard.busy).toBe(false);
  });

  test("streams proper SSE headers and releases the connection on abort", async () => {
    const controller = new AbortController();
    const response = await fetch(`${url}/api/events`, {
      signal: controller.signal,
    });
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body!.getReader();
    expect(await readFrame(reader)).toContain("event: state");
    controller.abort();
    await reader.cancel().catch(() => {});
  });
});

test("an observation-only showcase delivers its final SSE state before exiting", async () => {
  const serverPath = new URL("./server.ts", import.meta.url).pathname;
  const managerPath = new URL("../utils/cluster-manager.ts", import.meta.url)
    .pathname;
  const child = Bun.spawn(
    [
      process.execPath,
      "--eval",
      `
    import { PlaygroundDashboard } from ${JSON.stringify(serverPath)};
    import { ClusterManager } from ${JSON.stringify(managerPath)};
    const dashboard = new PlaygroundDashboard(new ClusterManager("final-frame-test"), "final-frame-test");
    await dashboard.start({ port: 0, openBrowser: false, keepAlive: true });
    for await (const _ of Bun.stdin.stream()) {
      await dashboard.complete();
      process.exit(0);
    }
  `,
    ],
    { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
  );
  try {
    const output = child.stdout.getReader();
    let startup = "";
    while (!startup.includes("http://127.0.0.1:")) {
      const chunk = await output.read();
      if (chunk.done) throw new Error("Dashboard exited before listening");
      startup += decoder.decode(chunk.value);
    }
    const url = startup.match(/http:\/\/127\.0\.0\.1:\d+/)![0];
    expect((await fetch(`${url}/api/action`, { method: "POST" })).status).toBe(
      403,
    );
    const response = await fetch(`${url}/api/events`);
    const reader = response.body!.getReader();
    let stream = await readFrame(reader);
    child.stdin.write("finish\n");
    child.stdin.end();
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        stream += decoder.decode(chunk.value);
      }
    } catch {
      // process.exit closes the HTTP socket after the final frame.
    }
    expect(await child.exited).toBe(0);
    expect(stream).toContain('"status":"complete"');
    expect(stream).toContain("session_complete");
  } finally {
    if (child.exitCode === null) child.kill();
  }
}, 15000);
