import { useState } from "react";
import {
  Send,
  ScanLine,
  Radio,
  LoaderCircle,
  Fingerprint,
  ChevronDown,
  ArrowUpRight,
} from "lucide-react";
import { Button } from "./components/ui/button";
import { Textarea } from "./components/ui/textarea";
import {
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuRadioItem,
  DropdownMenuRadioGroup,
  DropdownMenuLabel,
  DropdownMenuContent,
  DropdownMenu,
} from "./components/ui/dropdown-menu";

import { TabsTrigger, TabsList, Tabs } from "./components/ui/tabs";
import type { CommandOperation } from "./commands";
import type { DashboardState } from "./server";
import { cn } from "./lib/utils";

export function CommandCenterPanel({
  state,
  disabled,
  target,
  onTarget,
}: {
  state: DashboardState | null;
  disabled: boolean;
  target: string;
  onTarget: (target: string) => void;
}) {
  const [operation, setOperation] = useState<CommandOperation>("inspect");
  const [payload, setPayload] = useState("Many nodes. One decision.");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const nodes = state?.nodes ?? [];
  const leader = nodes
    .filter((node) => node.running && node.role === "leader")
    .sort((a, b) => b.term - a.term)[0];
  const members = new Set([
    ...(leader?.configuration.newPeers ?? []),
    ...(leader?.configuration.oldPeers ?? []),
  ]);
  const eligible = nodes.filter(
    (node) => members.has(node.id) && node.commandCapable,
  );
  const destinations = eligible.filter(
    (node) =>
      target === "all" ||
      (target === "followers" ? node.id !== leader?.id : target === node.id),
  );
  const bytes = new TextEncoder().encode(payload).byteLength;
  const destinationLabel =
    target === "all"
      ? "Every node"
      : target === "followers"
        ? "All other nodes"
        : target;

  async function dispatch() {
    setSending(true);
    setError("");
    try {
      const response = await fetch("/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "dispatch",
          target,
          operation,
          payload: operation === "sha256" ? payload : "",
        }),
      });
      const result = (await response.json()) as {
        commandId?: string;
        error?: string;
      };
      if (!response.ok)
        throw new Error(result.error ?? "Command could not be submitted");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSending(false);
    }
  }

  return (
    <section
      id="commands"
      className="panel command-panel scroll-mt-6 overflow-hidden"
      aria-label="Leader command center"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-5 md:px-6">
        <div>
          <p className="eyebrow mb-2 text-primary">LEADER → DESTINATION</p>
          <h2 className="section-heading">One instruction. A live response.</h2>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Send a task. Follow its journey through consensus.
          </p>
        </div>
        <span className="flex items-center gap-2 rounded-full border border-border bg-background/50 px-3 py-1.5 font-mono text-[10px] text-primary">
          <Radio className="size-3" /> {leader?.id ?? "Awaiting leader"}
        </span>
      </div>

      <div className="grid xl:grid-cols-[280px_minmax(0,1fr)]">
        <form
          className="space-y-5 border-b border-border p-5 md:p-6 xl:border-r xl:border-b-0"
          onSubmit={(event) => {
            event.preventDefault();
            void dispatch();
          }}
        >
          <div>
            <label
              className="metric-label mb-2.5 block"
              id="command-target-label"
            >
              01 / Destination
            </label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="h-11 w-full justify-between text-xs"
                  aria-labelledby="command-target-label"
                  disabled={sending}
                >
                  <span className="flex items-center gap-2">
                    <Radio className="size-3.5 text-primary" />
                    {destinationLabel}
                  </span>
                  <ChevronDown className="size-3.5 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-h-80 w-64 overflow-y-auto"
              >
                <DropdownMenuLabel className="text-xs">
                  Choose who executes
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup value={target} onValueChange={onTarget}>
                  <DropdownMenuRadioItem value="followers">
                    All other nodes
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="all">
                    Every node, including leader
                  </DropdownMenuRadioItem>
                  <DropdownMenuSeparator />
                  {eligible.map((node) => (
                    <DropdownMenuRadioItem
                      key={node.id}
                      value={node.id}
                      className="font-mono text-xs"
                    >
                      {node.id}
                      <span
                        className={cn(
                          "ml-auto text-[10px]",
                          node.running
                            ? "text-muted-foreground"
                            : "text-destructive",
                        )}
                      >
                        {node.running ? node.role : "offline"}
                      </span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <p className="mt-2 text-[10px] text-muted-foreground">
              {destinations.length} destination
              {destinations.length === 1 ? "" : "s"} ·{" "}
              {destinations.filter((node) => !node.running).length} offline
            </p>
          </div>
          <div>
            <p className="metric-label mb-2.5">02 / Task</p>
            <Tabs
              value={operation}
              onValueChange={(value) => setOperation(value as CommandOperation)}
            >
              <TabsList className="w-full h-10 bg-background">
                <TabsTrigger value="inspect" className="text-[11px]">
                  <ScanLine className="size-3.5" />
                  Node report
                </TabsTrigger>
                <TabsTrigger value="sha256" className="text-[11px]">
                  <Fingerprint className="size-3.5" />
                  SHA-256
                </TabsTrigger>
              </TabsList>
            </Tabs>
            {operation === "sha256" ? (
              <div className="mt-3">
                <label htmlFor="command-payload" className="sr-only">
                  Text to hash
                </label>
                <Textarea
                  id="command-payload"
                  value={payload}
                  onChange={(event) => setPayload(event.target.value)}
                  maxLength={512}
                  aria-invalid={bytes > 512}
                  aria-describedby="payload-size"
                  className="min-h-24 resize-y font-mono text-[11px] leading-relaxed"
                />
                <p
                  id="payload-size"
                  className={cn(
                    "mt-1.5 text-right font-mono text-[9px]",
                    bytes > 512 ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {bytes} / 512 UTF-8 bytes
                </p>
              </div>
            ) : (
              <p className="mt-3 min-h-16 text-[11px] leading-relaxed text-muted-foreground">
                Ask each destination to report its role, term, committed log and
                counter value at execution time.
              </p>
            )}
          </div>
          <Button
            type="submit"
            className="h-11 w-full rounded-xl text-xs"
            disabled={
              disabled ||
              sending ||
              !leader ||
              !destinations.length ||
              (operation === "sha256" && bytes > 512)
            }
          >
            {sending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Send className="size-3.5" />
            )}
            {sending ? "Proposing command…" : "Dispatch from leader"}
            <ArrowUpRight className="ml-auto size-3.5" />
          </Button>
          {error && (
            <p
              role="alert"
              className="break-words text-[11px] leading-relaxed text-destructive"
            >
              {error}
            </p>
          )}
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Read-only tasks. Executed after commit.
            <br />
            Offline destinations wait up to 15 seconds.
          </p>
        </form>

      </div>
      <div className="border-t border-border px-5 py-3 text-[10px] leading-relaxed text-muted-foreground md:px-6">
        The command is replicated to every member; only the chosen destinations
        execute. Results are local session telemetry, retained for the latest 40
        commands.
      </div>

    </section>
  );
}
