import { useState, useEffect } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  Zap,
  X,
  ShieldCheck,
  Send,
  Scissors,
  RotateCcw,
  Radio,
  Power,
  Orbit,
  LoaderCircle,
  Layers,
  HeartPulse,
  Gauge,
  Database,
  CircleDot,
  ChevronDown,
  ArrowUpRight,
  ArrowDownToLine,
  Activity,
} from "lucide-react";
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
import {
  TooltipTrigger,
  TooltipProvider,
  TooltipContent,
  Tooltip,
} from "./components/ui/tooltip";
import {
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuContent,
  DropdownMenu,
} from "./components/ui/dropdown-menu";

import { useObservatory } from "./use-observatory";
import { Topology } from "./topology";
import { quorumFor, describeEvent } from "./model";
import type { DashboardNode } from "./model";
import { cn } from "./lib/utils";
const format = new Intl.NumberFormat("en-US");

function Hint({ children, text }: { children: ReactNode; text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent sideOffset={8}>{text}</TooltipContent>
    </Tooltip>
  );
}

function Stat({
  label,
  value,
  detail,
}: {
  label: string;
  value: ReactNode;
  detail: ReactNode;
}) {
  return (
    <div className="min-w-0 border-r border-border px-4 py-1 first:pl-0 last:border-0 md:px-7">
      <p className="metric-label">{label}</p>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="mono text-[25px] font-light tracking-tight md:text-[29px]">
          {value}
        </span>
      </div>
      <p className="mt-1.5 truncate text-[10px] text-muted-foreground">
        {detail}
      </p>
    </div>
  );
}

function Replication({
  nodes,
  selected,
  onSelect,
}: {
  nodes: DashboardNode[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const max = Math.max(0, ...nodes.map((node) => node.lastLogIndex));
  const start = Math.max(1, max - 11);
  const indices = Array.from({ length: 12 }, (_, i) => start + i);
  return (
    <section id="replication" className="panel scroll-mt-6 overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-5 md:px-6">
        <div>
          <h2 className="section-heading">A shared memory</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            The same story, replicated across every node.
          </p>
        </div>
        <Layers className="size-4 text-muted-foreground" />
      </div>
      <div className="overflow-x-auto px-5 py-4 md:px-6">
        <div className="min-w-[560px]">
          <div className="mb-2 grid grid-cols-[96px_1fr_50px] items-center gap-3 text-[9px] text-muted-foreground">
            <span className="eyebrow">NODE / LOG</span>
            <div className="grid grid-cols-12 gap-1.5">
              {indices.map((index) => (
                <span key={index} className="mono text-center">
                  {index <= max ? `#${index}` : "·"}
                </span>
              ))}
            </div>
            <span className="text-right">VALUE</span>
          </div>
          {!nodes.length && (
            <p className="py-7 text-xs text-muted-foreground">
              Waiting for the first replicated entry…
            </p>
          )}
          {nodes.map((node) => (
            <div
              key={node.id}
              className={cn(
                "grid grid-cols-[96px_1fr_50px] items-center gap-3 rounded-lg py-1.5",
                !node.running && "opacity-45",
              )}
            >
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  "h-9 justify-start gap-2 px-0 font-mono text-[11px]",
                  selected === node.id && "text-primary",
                )}
                onClick={() => onSelect(node.id)}
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    node.role === "leader" ? "bg-primary" : "bg-follower",
                  )}
                />
                {node.id}
              </Button>
              <div className="grid grid-cols-12 gap-1.5">
                {indices.map((index) => {
                  const entry = node.log.find((item) => item.index === index);
                  const snapshot =
                    index < node.firstLogIndex && index <= node.lastApplied;
                  const stage = snapshot
                    ? "snapshot"
                    : !entry
                      ? "empty"
                      : index <= node.lastApplied
                        ? "applied"
                        : index <= node.commitIndex
                          ? "committed"
                          : "pending";
                  const text = snapshot
                    ? `#${index} compacted into snapshot`
                    : entry
                      ? `#${index} · term ${entry.term} · ${entry.type} · ${stage}`
                      : `#${index} · no entry`;
                  return (
                    <Hint key={index} text={text}>
                      <div
                        tabIndex={0}
                        aria-label={`${node.id} ${text}`}
                        className={cn("log-cell", stage)}
                      >
                        {snapshot ? (
                          <Database className="size-3" />
                        ) : entry ? (
                          `T${entry.term}`
                        ) : (
                          ""
                        )}
                      </div>
                    </Hint>
                  );
                })}
              </div>
              <span className="mono text-right text-[13px]">
                {node.value === null ? "KV" : format.format(node.value)}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-5 border-t border-border px-6 py-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-2">
          <span className="legend-dot bg-follower" />
          Applied
        </span>
        <span className="flex items-center gap-2">
          <span className="legend-dot bg-primary" />
          Committed
        </span>
        <span className="flex items-center gap-2">
          <span className="size-1.5 rounded-full border border-muted-foreground" />
          Pending
        </span>
        <span className="flex items-center gap-2">
          <span className="legend-dot bg-candidate" />
          Snapshot
        </span>
        <span className="ml-auto">Latest 12 positions</span>
      </div>
    </section>
  );
}

function App() {
  const { state, events, packets, connected, reducedMotion } =
    useObservatory();
  const [selected, setSelected] = useState("");
  const [pending, setPending] = useState("");
  const [notice, setNotice] = useState<{
    message: string;
    error: boolean;
  } | null>(null);
  const [navigation, setNavigation] = useState("overview");
  const nodes = state?.nodes ?? [];
  const quorum = quorumFor(nodes, state?.blockedLinks ?? []);
  const active = nodes.filter((node) => node.running);
  const selectedNode =
    nodes.find((node) => node.id === selected) ?? quorum.leader ?? nodes[0];
  const controls = !!state?.controls;
  const disabled = !connected || !state?.ready || !!pending || !!state?.busy;
  const term = Math.max(0, ...nodes.map((node) => node.term));
  const commitIndex =
    quorum.leader?.commitIndex ??
    Math.max(0, ...nodes.map((node) => node.commitIndex));
  const startupError =
    state?.status === "error"
      ? events.find((event) => event.type === "error")
      : undefined;
  const sessionLabel =
    state?.status === "complete"
      ? "Session complete"
      : state?.status === "error"
        ? "Startup failed"
        : connected
          ? "Live session"
          : "Reconnecting";

  useEffect(() => {
    if (!notice || notice.error) return;
    const timeout = setTimeout(setNotice, 4500, null);
    return () => clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    setSelected("");
    setNotice(null);
  }, [state?.sessionId]);

  async function action(name: string, nodeId?: string) {
    setPending(name);
    setNotice(null);
    try {
      const response = await fetch("/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: name, nodeId }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Operation failed");
      const messages: Record<string, string> = {
        write: "Entry committed. Watch it reach every state machine.",
        burst: "10 entries committed to the cluster.",
        "fail-leader":
          "Leader stopped. The remaining nodes will elect a successor.",
        partition: "Network split. Watch the majority and minority diverge.",
        heal: "All nodes reconnected. The cluster has stabilized.",
        snapshot: "Snapshot requested. Inspect the compaction in the log.",
        transfer: "Leadership transferred.",
        stop: "Node stopped.",
        start: "Node started. Catching up with the cluster.",
      };
      setNotice({
        message: messages[name] ?? "Operation completed.",
        error: false,
      });
    } catch (error) {
      setNotice({
        message: error instanceof Error ? error.message : String(error),
        error: true,
      });
    } finally {
      setPending("");
    }
  }

  const select = (id: string) => setSelected(id);
  const onAction = (name: string, nodeId?: string) => {
    void action(name, nodeId);
  };

  return (
    <TooltipProvider delayDuration={300}>
      <a
        href="#overview"
        className="sr-only z-50 focus:not-sr-only focus:absolute focus:bg-primary focus:p-3 focus:text-primary-foreground"
      >
        Skip to cluster
      </a>
      <header className="studio-header">
        <div className="studio-shell flex h-[76px] items-center justify-between gap-4">
          <a
            href="#overview"
            className="flex items-center gap-3"
            aria-label="Raft Observatory home"
          >
            <Orbit className="brand-mark size-8" strokeWidth={1.3} />
            <span className="text-[19px] font-semibold tracking-[-.06em]">
              raft<span className="text-primary">.</span>
            </span>
            <span className="mx-1 hidden h-4 w-px bg-border sm:block" />
            <span className="hidden text-[11px] tracking-[.04em] text-muted-foreground sm:block">
              OBSERVATORY
            </span>
          </a>
          <nav
            aria-label="Dashboard sections"
            className="hidden items-center gap-1 md:flex"
          >
            {[
              ["overview", "Overview", Orbit],
              ["commands", "Commands", Send],
              ["metrics", "Metrics", Gauge],
              ["replication", "Replication", Layers],
              ["activity", "Activity", Activity],
            ]
              .filter(([id]) => id !== "commands" || controls)
              .map(([id, label, Icon]) => {
                const ItemIcon = Icon as typeof Orbit;
                return (
                  <a
                    key={String(id)}
                    href={`#${id}`}
                    onClick={() => setNavigation(String(id))}
                    className={cn("nav-link", navigation === id && "active")}
                    aria-current={navigation === id ? "location" : undefined}
                  >
                    <ItemIcon className="size-3.5" />
                    {String(label)}
                  </a>
                );
              })}
          </nav>
          <div className="flex items-center gap-4">
            <span
              role="status"
              className="flex items-center gap-2 text-[11px] text-muted-foreground"
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  connected && state?.status !== "error"
                    ? "live-dot"
                    : "bg-primary",
                )}
              />
              {sessionLabel}
            </span>
            <Hint text="Download the latest 2,000 events and current cluster state">
              <Button
                variant="outline"
                size="icon-sm"
                className="rounded-full"
                asChild
              >
                <a href="/api/export" download aria-label="Export session">
                  <ArrowDownToLine className="size-3.5" />
                </a>
              </Button>
            </Hint>
          </div>
        </div>
      </header>

      <main id="overview" className="studio-shell pb-8">
        <section className="enter flex flex-wrap items-end justify-between gap-6 pb-8 pt-10">
          <div>
            <p className="eyebrow mb-3 flex items-center gap-2">
              <span className="h-px w-5 bg-primary" />A living view of
              distributed systems
            </p>
            <h1 className="hero-title">
              Consensus, <em>in motion.</em>
            </h1>
            <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
              Every heartbeat. Every vote. One shared truth.
            </p>
          </div>
          {controls ? (
            <div className="flex items-center gap-2 pb-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className="h-10 rounded-full px-4 text-xs"
                    disabled={disabled}
                  >
                    <Zap className="size-3.5" />
                    Experiment
                    <ChevronDown className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64 p-2">
                  <DropdownMenuLabel className="eyebrow px-2 py-2">
                    Introduce a little chaos
                  </DropdownMenuLabel>
                  <DropdownMenuItem onSelect={() => onAction("burst")}>
                    <Layers />
                    Append 10 entries
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onAction("fail-leader")}>
                    <Power />
                    Stop the leader
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onAction("partition")}>
                    <Scissors />
                    Split the network
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => onAction("heal")}>
                    <RotateCcw />
                    Reconnect all nodes
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onAction("snapshot")}>
                    <Database />
                    Create a snapshot
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                className="h-10 rounded-full px-5 text-xs shadow-[0_0_26px_#f2b58d14]"
                disabled={disabled}
                onClick={() => onAction("write")}
              >
                {pending === "write" ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <span className="mr-1 text-lg leading-none">+</span>
                )}
                Append entry
                <ArrowUpRight className="ml-1 size-3.5" />
              </Button>
            </div>
          ) : (
            <Badge
              variant="outline"
              className="gap-2 rounded-full px-3 py-2 font-normal text-muted-foreground"
            >
              <Radio className="size-3" />
              Observing{" "}
              {state?.clusterId.replace(/-showcase$/, "") ?? "playground"}
            </Badge>
          )}
        </section>

        {(notice ||
          startupError ||
          (!connected && state && state.status !== "complete")) && (
          <div
            role="alert"
            className={cn(
              "mb-5 flex items-center justify-between gap-4 rounded-xl border p-4 text-xs",
              notice?.error || startupError
                ? "border-destructive/30 bg-destructive/5 text-destructive"
                : "border-primary/20 bg-primary/5 text-primary",
            )}
          >
            <span>
              {notice?.message ??
                (startupError
                  ? describeEvent(startupError)
                  : "Connection interrupted. Displaying the last known state; reconnecting automatically…")}
            </span>
            {notice && (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setNotice(null)}
                aria-label="Dismiss notification"
              >
                <X />
              </Button>
            )}
          </div>
        )}

        <section
          aria-label="Live cluster metrics"
          className="enter enter-delay mb-7 grid grid-cols-3 gap-y-5 border-y border-border py-6 md:grid-cols-5"
        >
          <Stat
            label="Current term"
            value={nodes.length ? String(term).padStart(2, "0") : "—"}
            detail="Election generation"
          />
          <Stat
            label="Commit index"
            value={nodes.length ? `#${commitIndex}` : "—"}
            detail="Confirmed by a voting majority"
          />
          <Stat
            label="Nodes online"
            value={
              <>
                {String(active.length).padStart(2, "0")}
                <span className="text-base text-muted-foreground">
                  {" "}
                  / {String(nodes.length).padStart(2, "0")}
                </span>
              </>
            }
            detail={
              quorum.total
                ? `${quorum.required} of ${quorum.total} ${nodes[0]?.weighted ? "weight" : "votes"} required`
                : "Establishing quorum"
            }
          />
          <Stat
            label="Message flow"
            value={
              <>
                {format.format(state?.traffic.rate ?? 0)}
                <span className="ml-1 text-xs text-muted-foreground">/s</span>
              </>
            }
            detail="Actual outgoing Raft RPCs"
          />
          <Stat
            label="Round trip"
            value={
              <>
                {state ? state.traffic.latency.toFixed(1) : "—"}
                <span className="ml-1 text-xs text-muted-foreground">ms</span>
              </>
            }
            detail="Latest successful response"
          />
        </section>

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px] xl:gap-6 xl:grid-cols-[minmax(0,1fr)_344px]">
          <div className="min-w-0 space-y-5 xl:space-y-6">
            <section className="panel topology-surface enter enter-delay">
              <div className="relative z-10 flex items-start justify-between gap-3 px-5 pt-5 md:px-6">
                <div>
                  <h2 className="section-heading">The living cluster</h2>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {nodes.length
                      ? `${nodes.length} nodes · select one to look closer`
                      : "Starting a real Raft cluster…"}
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    "gap-1.5 rounded-full border-healthy/20 bg-healthy/5 px-2.5 py-1 font-normal text-[10px]",
                    quorum.healthy
                      ? "text-healthy"
                      : "text-primary border-primary/20 bg-primary/5",
                  )}
                >
                  {quorum.healthy ? (
                    <ShieldCheck className="size-3" />
                  ) : (
                    <CircleDot className="size-3" />
                  )}
                  {!nodes.length
                    ? "Initializing"
                    : !connected
                      ? "Last known state"
                      : quorum.healthy
                        ? "Quorum available"
                        : "Quorum unavailable"}
                </Badge>
              </div>
              <Topology
                nodes={nodes}
                blocked={state?.blockedLinks ?? []}
                packets={packets}
                selected={selectedNode?.id ?? ""}
                onSelect={select}
                reducedMotion={reducedMotion}
                connected={connected}
              />
              <div className="relative z-10 flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4 text-[10px] text-muted-foreground md:px-6">
                <div className="flex flex-wrap gap-4">
                  <span className="flex items-center gap-1.5">
                    <span className="legend-dot bg-primary" />
                    Leader
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="legend-dot bg-follower" />
                    Follower
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="legend-dot bg-candidate" />
                    Candidate
                  </span>
                </div>
                <Hint text="Each particle is a real outgoing RPC. Motion is slowed for readability and capped at 80 concurrent particles; events continue to stream.">
                  <span tabIndex={0} className="flex items-center gap-1.5">
                    <HeartPulse className="size-3" />
                    {reducedMotion
                      ? "Reduced motion"
                      : "Real traffic · slowed motion"}
                  </span>
                </Hint>
              </div>
            </section>

            <Replication
              nodes={nodes}
              selected={selectedNode?.id ?? ""}
              onSelect={select}
            />
          </div>

          <aside className="min-w-0 space-y-5 xl:space-y-6">

          </aside>
        </div>

        <footer className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-border py-5 text-[10px] text-muted-foreground">
          <div className="flex items-center gap-2">
            <Orbit className="size-3.5 text-primary" />
            <span>Many nodes. One decision.</span>
            <span className="mx-2 text-border">/</span>
            <span className="mono">{state?.clusterId ?? "Connecting…"}</span>
          </div>
          <div className="flex items-center gap-4">
            <span>{format.format(state?.traffic.messages ?? 0)} RPCs</span>
            <span>
              {format.format(state?.traffic.failed ?? 0)} failed / blocked
            </span>
            <span className="rounded-full border border-border px-2 py-1">
              Bun + SSE
            </span>
          </div>
        </footer>
        <div role="status" aria-live="polite" className="sr-only">
          {pending
            ? `Running ${pending}`
            : state?.ready
              ? "Cluster ready"
              : state?.status === "error"
                ? "Cluster failed to start"
                : "Waiting for cluster"}
        </div>
      </main>

    </TooltipProvider>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
