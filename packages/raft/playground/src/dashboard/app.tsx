import { useState, useEffect } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  X,
  ShieldCheck,
  Send,
  Orbit,
  Layers,
  HeartPulse,
  Gauge,
  Database,
  CircleDot,
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
  const [pending, ] = useState("");
  const [notice, setNotice] = useState<{
    message: string;
    error: boolean;
  } | null>(null);
  const [navigation, setNavigation] = useState("overview");
  const nodes = state?.nodes ?? [];
  const quorum = quorumFor(nodes, state?.blockedLinks ?? []);
  const selectedNode =
    nodes.find((node) => node.id === selected) ?? quorum.leader ?? nodes[0];
  const controls = !!state?.controls;
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

  const select = (id: string) => setSelected(id);

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
