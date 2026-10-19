import {
  Radio,
  Layers,
  Gauge,
  Cpu,
  ChevronDown,
  ArrowDownUp,
  Activity,
} from "lucide-react";
import { Button } from "./components/ui/button";
import {
  DropdownMenuTrigger,
  DropdownMenuRadioItem,
  DropdownMenuRadioGroup,
  DropdownMenuContent,
  DropdownMenu,
} from "./components/ui/dropdown-menu";
import type { DashboardState } from "./server";
import { cn } from "./lib/utils";

function Sparkline({
  values,
  label,
  color = "var(--primary)",
  compact = false,
}: {
  values: (number | null)[];
  label: string;
  color?: string;
  compact?: boolean;
}) {
  const present = values.filter((value): value is number => value !== null);
  if (present.length < 2)
    return (
      <div className="flex h-16 items-end pb-2 text-[10px] text-muted-foreground">
        Waiting for measured samples…
      </div>
    );
  const high = Math.max(1, ...present);
  let connected = false;
  const path = values
    .map((value, index) => {
      if (value === null) {
        connected = false;
        return "";
      }
      const point = `${connected ? "L" : "M"}${((index / Math.max(1, values.length - 1)) * 300).toFixed(1)},${(57 - (value / high) * 48).toFixed(1)}`;
      connected = true;
      return point;
    })
    .join(" ");
  return (
    <svg
      viewBox="0 0 300 64"
      preserveAspectRatio="none"
      className={cn("mt-2 w-full overflow-visible", compact ? "h-7" : "h-16")}
      role="img"
      aria-label={label}
    >
      <path
        d="M0 15H300 M0 36H300 M0 57H300"
        stroke="var(--border)"
        strokeDasharray="2 5"
      />
      <path
        d={path}
        stroke={color}
        strokeWidth="1.5"
        fill="none"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function NodeMetricsPanel({
  state,
  selected,
  onSelect,
  connected,
}: {
  state: DashboardState | null;
  selected: string;
  onSelect: (id: string) => void;
  connected: boolean;
}) {
  const nodes = state?.nodes ?? [];
  const node = nodes.find((item) => item.id === selected) ?? nodes[0];
  const metrics = node?.metrics;
  const history = state?.metricsHistory ?? [];
  const host = history.at(-1);
  const commit = Math.max(
    0,
    ...nodes.filter((item) => item.running).map((item) => item.commitIndex),
  );
  const lag = node ? Math.max(0, commit - node.lastApplied) : 0;
  const p95 = metrics?.p95;
  const mb = (bytes: number | undefined) =>
    bytes === undefined ? "—" : (bytes / 1024 ** 2).toFixed(1);
  const charts = [
    {
      label: "Outbound RPCs",
      value: metrics ? String(metrics.rate) : "—",
      unit: "/ sec",
      detail: "Measured attempts, including blocked links",
      icon: ArrowDownUp,
      values: history.map(
        (sample) => sample.nodes[node?.id ?? ""]?.rate ?? null,
      ),
      color: "var(--primary)",
    },
    {
      label: "Response latency · p95",
      value: p95 === undefined || p95 === null ? "—" : p95.toFixed(1),
      unit: "ms",
      detail: "Successful outgoing RPC round trips",
      icon: Gauge,
      values: history.map(
        (sample) => sample.nodes[node?.id ?? ""]?.p95 ?? null,
      ),
      color: "var(--follower)",
    },
    {
      label: "Replication lag",
      value: node ? String(lag) : "—",
      unit: "entries",
      detail: "Highest live commit minus this node’s applied",
      icon: Layers,
      values: history.map(
        (sample) => sample.nodes[node?.id ?? ""]?.lag ?? null,
      ),
      color: "var(--candidate)",
    },
  ];
  return (
    <section
      id="metrics"
      className="panel mt-6 scroll-mt-6 overflow-hidden"
      aria-label="Per-node metrics"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-5 py-5 md:px-6">
        <div>
          <p className="eyebrow mb-2 text-primary">SIGNAL, IN DETAIL</p>
          <h2 className="section-heading">Every node has a pulse.</h2>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Measured traffic, latency and progress. One second at a time.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span
              className={cn(
                "size-1.5 rounded-full",
                connected ? "live-dot" : "bg-primary",
              )}
            />
            {state?.status === "complete"
              ? "Final samples"
              : connected
                ? "Last 60 samples"
                : "Last known samples"}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="h-9 min-w-32 justify-between font-mono text-xs"
                aria-label="Metrics node"
              >
                <Radio className="size-3 text-primary" />
                {node?.id ?? "Select node"}
                <ChevronDown className="size-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="max-h-72 overflow-y-auto"
            >
              <DropdownMenuRadioGroup
                value={node?.id ?? ""}
                onValueChange={onSelect}
              >
                {nodes.map((item) => (
                  <DropdownMenuRadioItem
                    key={item.id}
                    value={item.id}
                    className="font-mono text-xs"
                  >
                    {item.id}
                    <span className="ml-3 text-[10px] text-muted-foreground">
                      {item.running ? item.role : "offline"}
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="grid divide-y divide-border md:grid-cols-3 md:divide-x md:divide-y-0">
        {charts.map((chart) => (
          <div key={chart.label} className="min-w-0 p-5 md:p-6">
            <div className="flex items-center justify-between">
              <h3 className="metric-label">{chart.label}</h3>
              <chart.icon className="size-3.5 text-muted-foreground" />
            </div>
            <p className="mono mt-4 text-3xl font-light tracking-tight">
              {chart.value}
              <span className="ml-2 text-[11px] text-muted-foreground">
                {chart.unit}
              </span>
            </p>
            <Sparkline
              values={chart.values}
              color={chart.color}
              label={`${node?.id ?? "Node"}: ${chart.label} over the latest minute`}
            />
            <p className="mt-3 text-[10px] text-muted-foreground">
              {chart.detail}
            </p>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto border-t border-border">
        <table className="w-full min-w-[720px] border-collapse text-left text-[11px]">
          <caption className="sr-only">
            Per-node counters since this observer attached. Select a node to see
            its charts.
          </caption>
          <thead className="bg-background/40 text-[9px] uppercase tracking-wider text-muted-foreground">
            <tr>
              {[
                "Node / role",
                "Sent",
                "Acknowledged inbound",
                "Failed / blocked",
                "In flight",
                "p50 / p95 (ms)",
                "Applied events",
              ].map((label) => (
                <th
                  key={label}
                  className="whitespace-nowrap px-5 py-3 font-normal"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {nodes.map((item) => (
              <tr
                key={item.id}
                className={cn(
                  "border-t border-border transition-colors hover:bg-accent/30",
                  node?.id === item.id && "bg-primary/5",
                  !item.running && "opacity-50",
                )}
              >
                <td className="px-5 py-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-2 px-0 font-mono text-[11px]"
                    onClick={() => onSelect(item.id)}
                    aria-pressed={item.id === node?.id}
                  >
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        !item.running
                          ? "bg-muted-foreground"
                          : item.role === "leader"
                            ? "bg-primary"
                            : "bg-follower",
                      )}
                    />
                    {item.id}
                    <span className="ml-1 text-[9px] font-normal text-muted-foreground">
                      {item.running ? item.role : "offline"}
                    </span>
                  </Button>
                </td>
                <td className="mono px-5">
                  {item.metrics.sent.toLocaleString()}
                </td>
                <td className="mono px-5">
                  {item.metrics.received.toLocaleString()}
                </td>
                <td
                  className={cn(
                    "mono px-5",
                    item.metrics.failed > 0 && "text-destructive",
                  )}
                >
                  {item.metrics.failed.toLocaleString()}
                </td>
                <td className="mono px-5">{item.metrics.inFlight}</td>
                <td className="mono px-5">
                  {item.metrics.p50?.toFixed(1) ?? "—"}
                  <span className="text-muted-foreground"> / </span>
                  {item.metrics.p95?.toFixed(1) ?? "—"}
                </td>
                <td className="mono px-5">
                  {item.metrics.applied.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid border-t border-border bg-background/30 lg:grid-cols-[1fr_2fr]">
        <div className="p-5 md:px-6">
          <div className="flex items-center gap-2 text-xs">
            <Cpu className="size-4 text-primary" />
            Shared Bun process
          </div>
          <p className="mt-2 max-w-sm text-[10px] leading-relaxed text-muted-foreground">
            All playground nodes run in one process. CPU and memory below belong
            to that process, not to individual nodes.
          </p>
        </div>
        <div className="grid grid-cols-3 divide-x divide-border border-t border-border lg:border-t-0 lg:border-l">
          {[
            {
              label: "CPU / one core",
              value: host?.cpu.toFixed(1) ?? "—",
              unit: "%",
              values: history.map((sample) => sample.cpu),
            },
            {
              label: "Resident memory",
              value: mb(host?.rss),
              unit: "MB",
              values: history.map((sample) => sample.rss),
            },
            {
              label: "Heap used",
              value: mb(host?.heap),
              unit: "MB",
              values: history.map((sample) => sample.heap),
            },
          ].map((metric) => (
            <div key={metric.label} className="min-w-0 px-4 py-4">
              <p className="text-[9px] text-muted-foreground">{metric.label}</p>
              <p className="mono mt-2 text-lg font-light">
                {metric.value}
                <span className="ml-1 text-[9px] text-muted-foreground">
                  {metric.unit}
                </span>
              </p>
              <div className="h-9 overflow-hidden">
                <Sparkline
                  values={metric.values}
                  label={`${metric.label} over time`}
                  color="var(--healthy)"
                  compact
                />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3 text-[9px] leading-relaxed text-muted-foreground md:px-6">
        <span className="flex items-center gap-1.5">
          <Activity className="size-3" />
          Counters since observation began · charts scale independently
        </span>
        <span>
          Latency: latest 1,000 successful RPCs within 60 seconds · — means no
          samples
        </span>
      </div>
    </section>
  );
}
