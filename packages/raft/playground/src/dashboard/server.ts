import { serve, build } from "bun";
import type { Server, BuildArtifact } from "bun";
import tailwind from "bun-plugin-tailwind";
import type { RaftEvent } from "@usex/raft";
import type { NodeInfo, ClusterManager } from "../utils/cluster-manager";
import { CounterStateMachine } from "../state-machines/counter-state-machine";
import { playgroundTelemetry } from "./telemetry";
import type { PlaygroundMessage } from "./telemetry";
import { HISTORY_LIMIT, EventJournal } from "./journal";
import {
  ObservatoryStateMachine,
  CommandCenter,
  COMMAND_PAYLOAD_BYTES,
} from "./commands";
import type { CommandOperation } from "./commands";
import { DashboardMetrics } from "./metrics";

export class PlaygroundDashboard {
  readonly journal = new EventJournal();
  readonly commands = new CommandCenter(this.journal);
  private readonly metrics = new DashboardMetrics();
  readonly sessionId = crypto.randomUUID();
  readonly startedAt = Date.now();
  url = "";
  ready = false;
  busy = false;
  status = "starting";
  private server?: Server<undefined>;
  private assets = new Map<string, BuildArtifact>();
  private timer?: ReturnType<typeof setInterval>;
  private retainedNodes: ReturnType<PlaygroundDashboard["readNodes"]> = [];
  private messages = 0;
  private failed = 0;
  private latency = 0;
  private rate = 0;
  private lastMessages = 0;
  private lastSample = Date.now();
  private ticks = 0;
  private logListener = (event: PlaygroundMessage) => {
    this.journal.publish(event.type, event.nodeId ?? "playground", {
      message: event.message,
    });
  };

  constructor(
    private manager: ClusterManager,
    readonly clusterId: string,
    readonly controls = false,
  ) {}

  async start(
    options: { port?: number; openBrowser?: boolean; keepAlive?: boolean } = {},
  ) {
    const port =
      options.port ?? Number(process.env.RAFT_DASHBOARD_PORT ?? 3210);
    if (!Number.isInteger(port) || port < 0 || port > 65535)
      throw new Error("Invalid RAFT_DASHBOARD_PORT");
    const bundle = await build({
      entrypoints: [new URL("./public/index.html", import.meta.url).pathname],
      target: "browser",
      plugins: [tailwind],
      minify: true,
      define: { "process.env.NODE_ENV": '"production"' },
    });
    if (!bundle.success) throw new Error(bundle.logs.map(String).join("\n"));
    for (const output of bundle.outputs) {
      const name = output.path.split("/").pop()!;
      this.assets.set(name === "index.html" ? "/" : `/${name}`, output);
    }
    const listen = (selectedPort: number) =>
      serve({
        hostname: "127.0.0.1",
        port: selectedPort,
        maxRequestBodySize: 1024,
        idleTimeout: 30,
        fetch: (request: Request) => this.handle(request),
        error: (error: Error) => {
          this.journal.publish("error", "studio", { message: error.message });
          return Response.json(
            { error: "Dashboard request failed" },
            { status: 500 },
          );
        },
      });
    try {
      this.server = listen(port);
    } catch (error) {
      if ((error as { code?: string }).code !== "EADDRINUSE" || port === 0)
        throw error;
      this.server = listen(0);
    }
    this.url = `http://127.0.0.1:${this.server.port}`;
    if (!options.keepAlive) this.server.unref();
    playgroundTelemetry.on("message", this.logListener);
    this.timer = setInterval(() => {
      this.journal.flush();
      if (++this.ticks % 3 === 0)
        this.journal.broadcast("state", this.snapshot());
    }, 100);
    this.timer.unref();
    console.log(`\n  Raft Observatory → ${this.url}\n`);
    if (
      options.openBrowser !== false &&
      process.env.RAFT_DASHBOARD_OPEN !== "0" &&
      !process.env.CI
    ) {
      const command =
        process.platform === "darwin"
          ? "open"
          : process.platform === "win32"
            ? "rundll32"
            : "xdg-open";
      const args =
        process.platform === "win32"
          ? ["url.dll,FileProtocolHandler", this.url]
          : [this.url];
      try {
        Bun.spawn([command, ...args], {
          stdout: "ignore",
          stderr: "ignore",
        }).unref();
      } catch {
        console.log(`  Open ${this.url} in your browser.`);
      }
    }
    return this.url;
  }

  observe(info: NodeInfo) {
    this.status = "running";
    if (info.stateMachine instanceof ObservatoryStateMachine)
      info.stateMachine.onCommand = (command) =>
        this.commands.applied(info, command);
    info.node.on("raftEvent", (event: RaftEvent) => {
      this.metrics.event(event.nodeId, event.type);
      this.journal.publish(event.type, event.nodeId, event.data);
    });
    this.journal.publish("node_added", info.nodeId, {
      weight: info.weight ?? info.config.voting.defaultWeight,
    });
  }

  rpc(
    nodeId: string,
    target: string,
    type: unknown,
    payload: object,
    phase: string,
    duration = 0,
    error = "",
  ) {
    const request = payload as { entries?: unknown[]; term?: number };
    this.metrics.rpc(nodeId, target, phase, duration);
    const kind =
      type === "append_entries" && request.entries?.length === 0
        ? "heartbeat"
        : String(type);
    if (phase === "sent" || phase === "blocked") this.messages++;
    if (phase === "failed" || phase === "blocked") this.failed++;
    if (phase === "received") this.latency = duration;
    this.journal.publish("rpc", nodeId, {
      target,
      kind,
      phase,
      term: request.term,
      entries: request.entries?.length ?? 0,
      duration: Math.round(duration * 100) / 100,
      ...(error ? { error } : {}),
    });
  }

  private readNodes() {
    return this.manager
      .getAllNodes()
      .map(({ nodeId, node, stateMachine, weight, config }) => {
        const log = node.getLog();
        const last = log.getLastIndex();
        return {
          id: nodeId,
          role: node.getState(),
          running: node.isRunning(),
          term: node.getCurrentTerm(),
          commitIndex: node.getCommitIndex(),
          lastApplied: node.getLastApplied(),
          lastLogIndex: last,
          firstLogIndex: log.getFirstIndex(),
          weight:
            weight ??
            config.voting.weights?.[nodeId] ??
            config.voting.defaultWeight,
          weighted: config.voting.enableWeighting,
          peers: node.getPeers(),
          configuration: node.getActiveConfiguration(),
          metrics: this.metrics.get(nodeId),
          commandCapable: stateMachine instanceof ObservatoryStateMachine,
          value:
            stateMachine instanceof CounterStateMachine
              ? stateMachine.getValue()
              : null,
          log: log
            .getEntries(Math.max(log.getFirstIndex(), last - 15))
            .map((entry) => ({
              index: entry.index,
              term: entry.term,
              type: entry.commandType,
            })),
        };
      });
  }

  snapshot() {
    const now = Date.now();
    if (now - this.lastSample >= 1000) {
      this.rate = Math.round(
        ((this.messages - this.lastMessages) * 1000) / (now - this.lastSample),
      );
      this.lastSample = now;
      this.lastMessages = this.messages;
    }
    const current = this.readNodes();
    this.metrics.sample(current, now);
    for (const node of current) node.metrics = this.metrics.get(node.id);
    if (current.length) this.retainedNodes = current;
    return {
      sessionId: this.sessionId,
      clusterId: this.clusterId,
      startedAt: this.startedAt,
      time: now,
      status: this.status,
      controls: this.controls,
      ready: this.ready,
      busy: this.busy,
      nodes: current.length ? current : this.retainedNodes,
      blockedLinks: this.manager.getBlockedLinks(),
      commands: this.commands.snapshot(),
      metricsHistory: this.metrics.history,
      traffic: {
        messages: this.messages,
        failed: this.failed,
        rate: this.rate,
        latency: this.latency,
      },
      totalEvents: this.journal.sequence,
      historyLimit: HISTORY_LIMIT,
    };
  }

  async complete() {
    this.ready = false;
    this.status = "complete";
    this.journal.publish("session_complete", "playground", {
      message: "Scenario complete. Final state retained.",
    });
    this.journal.flush();
    this.journal.broadcast("state", this.snapshot());
    this.journal.close();
    // Let Bun flush queued SSE bytes before a showcase calls process.exit().
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  async close() {
    clearInterval(this.timer);
    playgroundTelemetry.off("message", this.logListener);
    this.journal.close();
    await this.server?.stop(true);
  }

  private async handle(request: Request): Promise<Response> {
    const allowedHosts = [
      this.url.slice(7),
      this.url.slice(7).replace("127.0.0.1", "localhost"),
    ];
    const json = (status: number, data: unknown) =>
      Response.json(data, {
        status,
        headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    if (!allowedHosts.includes(request.headers.get("host") ?? ""))
      return json(403, { error: "Local requests only" });
    const origin = request.headers.get("origin");
    if (origin && !allowedHosts.some((host) => origin === `http://${host}`))
      return json(403, { error: "Origin not allowed" });
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && path === "/api/events") {
      this.server!.timeout(request, 0);
      return new Response(
        this.journal.connect(
          request.headers.get("last-event-id"),
          this.snapshot(),
        ),
        {
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
          },
        },
      );
    }
    if (request.method === "GET" && path === "/api/state")
      return json(200, this.snapshot());
    if (request.method === "GET" && path === "/api/export")
      return Response.json(
        { state: this.snapshot(), events: this.journal.history },
        {
          headers: {
            "Content-Disposition": 'attachment; filename="raft-session.json"',
            "Cache-Control": "no-store",
          },
        },
      );
    if (request.method === "POST" && path === "/api/action") {
      if (!this.controls)
        return json(403, { error: "This scenario is observation only" });
      if (!this.ready || this.busy)
        return json(409, { error: "Wait for the current operation to finish" });
      if (!request.headers.get("content-type")?.startsWith("application/json"))
        return json(415, { error: "Expected JSON" });
      let input: unknown;
      try {
        input = await request.json();
      } catch {
        return json(400, { error: "Invalid JSON" });
      }
      if (!input || typeof input !== "object")
        return json(400, { error: "Invalid action" });
      const { action, nodeId, operation, target, payload } = input as {
        action?: unknown;
        nodeId?: unknown;
        operation?: unknown;
        target?: unknown;
        payload?: unknown;
      };
      const actions = [
        "write",
        "burst",
        "fail-leader",
        "partition",
        "heal",
        "snapshot",
        "transfer",
        "stop",
        "start",
        "dispatch",
      ];
      if (
        typeof action !== "string" ||
        !actions.includes(action) ||
        (nodeId !== undefined && typeof nodeId !== "string")
      ) {
        return json(400, { error: "Unknown action or invalid node ID" });
      }
      if (
        ["stop", "start", "transfer"].includes(action) &&
        (typeof nodeId !== "string" || !this.manager.getNode(nodeId))
      ) {
        return json(400, { error: "Select an existing node" });
      }
      if (action === "dispatch") {
        if (
          (operation !== "inspect" && operation !== "sha256") ||
          typeof target !== "string" ||
          (!["all", "followers"].includes(target) &&
            !this.manager.getNode(target)) ||
          typeof payload !== "string" ||
          Buffer.byteLength(payload, "utf8") > COMMAND_PAYLOAD_BYTES
        )
          return json(400, {
            error:
              "Choose a destination and a supported task. Payload limit: 512 UTF-8 bytes.",
          });
      }
      if (this.busy)
        return json(409, { error: "Another operation is already running" });
      this.busy = true;
      this.journal.publish("action", "studio", {
        message: `Running ${action}`,
        action,
        nodeId,
      });
      try {
        if (action === "dispatch") {
          const leader = this.manager.getLeader();
          if (!leader) throw new Error("No running leader");
          const peers = leader.node.getActiveConfiguration();
          const members = new Set([
            ...peers.newPeers,
            ...(peers.oldPeers ?? []),
          ]);
          const targets = this.manager
            .getAllNodes()
            .filter(
              (info) =>
                members.has(info.nodeId) &&
                (target === "all" ||
                  (target === "followers" && info.nodeId !== leader.nodeId) ||
                  target === info.nodeId),
            );
          if (
            !targets.length ||
            targets.some(
              (info) => !(info.stateMachine instanceof ObservatoryStateMachine),
            )
          )
            throw new Error(
              "No command-capable destination in the current voting configuration",
            );
          const commandId = await this.commands.dispatch(
            leader,
            targets.map((info) => info.nodeId),
            operation as CommandOperation,
            payload as string,
          );
          return json(200, { ok: true, commandId });
        }
        await this.execute(action, nodeId as string | undefined);
        this.journal.publish("action_complete", "studio", {
          message: `${action} completed`,
          action,
        });
        return json(200, { ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.journal.publish("error", "studio", { message, action });
        return json(409, { error: message });
      } finally {
        this.busy = false;
      }
    }
    const asset = this.assets.get(path);
    if (request.method === "GET" && asset)
      return new Response(asset, {
        headers: {
          "Content-Type": asset.type,
          "Cache-Control": "no-cache",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy":
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        },
      });
    return json(404, { error: "Not found" });
  }

  private async execute(action: string, nodeId?: string) {
    const leader = this.manager.getLeader();
    switch (action) {
      case "write":
        await this.manager.appendToLeader({ type: "increment", value: 1 });
        break;
      case "burst":
        await Promise.all(
          Array.from({ length: 10 }, () =>
            this.manager.appendToLeader({ type: "increment", value: 1 }),
          ),
        );
        break;
      case "fail-leader":
        if (!leader) throw new Error("No running leader");
        await this.manager.stopNode(leader.nodeId);
        break;
      case "partition": {
        if (this.manager.getBlockedLinks().length)
          throw new Error("Heal the current partition first");
        const nodes = this.manager
          .getAllNodes()
          .filter((info) => info.node.isRunning())
          .map((info) => info.nodeId);
        const minority = [
          leader?.nodeId,
          ...nodes.filter((id) => id !== leader?.nodeId),
        ]
          .filter((id): id is string => !!id)
          .slice(0, Math.floor(nodes.length / 2));
        if (!minority.length)
          throw new Error("At least two running nodes are needed");
        await this.manager.simulateNetworkPartition(
          minority,
          nodes.filter((id) => !minority.includes(id)),
        );
        break;
      }
      case "heal":
        await Promise.all(
          this.manager
            .getAllNodes()
            .filter((info) => !info.node.isRunning())
            .map((info) => this.manager.startNode(info.nodeId)),
        );
        await this.manager.healNetworkPartition(
          this.manager.getAllNodes().map((info) => info.nodeId),
        );
        break;
      case "snapshot":
        if (!leader) throw new Error("No running leader");
        await leader.node.createSnapshot();
        break;
      case "transfer":
        if (!leader) throw new Error("No running leader");
        if (!this.manager.getNode(nodeId!)?.node.isRunning())
          throw new Error("The target node is stopped");
        await leader.node.transferLeadership(nodeId!);
        break;
      case "stop":
        await this.manager.stopNode(nodeId!);
        break;
      case "start":
        await this.manager.startNode(nodeId!);
        break;
    }
  }
}

export type DashboardState = ReturnType<PlaygroundDashboard["snapshot"]>;
