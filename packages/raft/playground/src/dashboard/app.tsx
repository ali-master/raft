import type { ReactNode } from "react";
import {
  Layers,
  Database,
} from "lucide-react";
import { Button } from "./components/ui/button";
import {
  TooltipTrigger,
  TooltipContent,
  Tooltip,
} from "./components/ui/tooltip";

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

export function Replication({
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
