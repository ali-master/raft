import { useState } from "react";
import {
  TriangleAlert,
  Terminal,
  Send,
  ScanLine,
  Radio,
  LoaderCircle,
  Fingerprint,
  Clock3,
  ChevronDown,
  Check,
  ArrowUpRight,
  ArrowRight,
} from "lucide-react";
import { Button } from "./components/ui/button";
import { Badge } from "./components/ui/badge";
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
import {
  DialogTitle,
  DialogHeader,
  DialogDescription,
  DialogContent,
  Dialog,
} from "./components/ui/dialog";
import { TabsTrigger, TabsList, Tabs } from "./components/ui/tabs";
import { ScrollArea } from "./components/ui/scroll-area";
import type { CommandRun, CommandOperation } from "./commands";
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
  const [activeId, setActiveId] = useState("");
  const [detail, setDetail] = useState<{
    runId: string;
    nodeId: string;
  } | null>(null);
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
  const runs = state?.commands ?? [];
  const run = runs.find((item) => item.id === activeId) ?? runs[0];
  const receipt = runs
    .find((item) => item.id === detail?.runId)
    ?.receipts.find((item) => item.nodeId === detail?.nodeId);
  const completed =
    run?.receipts.filter((item) => item.status === "succeeded").length ?? 0;
  const waiting =
    run?.receipts.filter((item) => item.status === "waiting").length ?? 0;
  const bytes = new TextEncoder().encode(payload).byteLength;
  const destinationLabel =
    target === "all"
      ? "Every node"
      : target === "followers"
        ? "All other nodes"
        : target;
  const runLabel = (item: CommandRun) =>
    `${item.operation === "inspect" ? "Node report" : "SHA-256"} · ${new Date(item.createdAt).toLocaleTimeString("en-GB")}`;

  async function dispatch() {
    setSending(true);
    setError("");
    setActiveId("");
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
      setActiveId(result.commandId ?? "");
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

        <div className="min-w-0 p-5 md:p-6">
          <div className="mb-5 flex items-center justify-between gap-2">
            <p className="metric-label">Execution trace</p>
            {runs.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[10px] text-muted-foreground"
                    aria-label="Command history"
                  >
                    {run ? runLabel(run) : "History"}
                    <ChevronDown className="size-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="max-h-64 overflow-y-auto"
                >
                  <DropdownMenuRadioGroup
                    value={run?.id ?? ""}
                    onValueChange={setActiveId}
                  >
                    {runs.map((item) => (
                      <DropdownMenuRadioItem
                        key={item.id}
                        value={item.id}
                        className="text-xs"
                      >
                        {runLabel(item)}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          {!run ? (
            <div className="command-empty flex min-h-64 flex-col items-center justify-center text-center">
              <div className="command-orbit mb-6 flex size-20 items-center justify-center rounded-full border border-primary/20">
                <Send strokeWidth={1} className="size-7 text-primary" />
              </div>
              <p className="text-sm">A task starts with one leader.</p>
              <p className="mt-2 max-w-60 text-[11px] leading-relaxed text-muted-foreground">
                Choose a destination. Send your first instruction. See exactly
                who responds.
              </p>
            </div>
          ) : (
            <>
              <div className="mb-5 flex items-center gap-3 rounded-xl border border-border bg-background/60 p-3.5">
                <div className="shrink-0">
                  <p className="mono text-xs text-primary">{run.leaderId}</p>
                  <p className="mt-1 text-[9px] text-muted-foreground">
                    TERM {run.term}
                  </p>
                </div>
                <div
                  className={cn(
                    "command-rail flex-1",
                    waiting > 0 && "in-transit",
                  )}
                  aria-hidden="true"
                />
                <ArrowRight className="size-3.5 shrink-0 text-primary" />
                <div className="text-right">
                  <p className="mono text-xl font-light">
                    {completed}
                    <span className="text-sm text-muted-foreground">
                      {" "}
                      / {run.targets.length}
                    </span>
                  </p>
                  <p className="mt-0.5 text-[9px] text-muted-foreground">
                    EXECUTED
                  </p>
                </div>
              </div>
              <div className="mb-4 flex flex-wrap gap-2 text-[9px]">
                <Badge
                  variant="outline"
                  className="gap-1.5 border-border text-[9px] font-normal"
                >
                  <Check className="size-3 text-healthy" />
                  Proposed
                </Badge>
                <Badge
                  variant="outline"
                  className={cn(
                    "gap-1.5 border-border text-[9px] font-normal",
                    run.commit === "confirmed"
                      ? "text-healthy"
                      : "text-primary",
                  )}
                >
                  {run.commit === "confirmed" ? (
                    <Check className="size-3" />
                  ) : (
                    <Clock3 className="size-3" />
                  )}
                  {run.commit === "confirmed"
                    ? "Committed"
                    : run.commit === "unknown"
                      ? "Commit unknown"
                      : "Awaiting quorum"}
                </Badge>
                <span className="ml-auto self-center text-muted-foreground">
                  {waiting ? `${waiting} awaiting execution` : "Trace complete"}
                </span>
              </div>
              <ScrollArea
                className="h-48 pr-3"
                aria-label="Command destination results"
              >
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-2">
                  {run.receipts.map((item) => (
                    <Button
                      key={`${run.id}-${item.nodeId}-${item.status}`}
                      variant="outline"
                      className={cn(
                        "receipt-tile h-auto min-w-0 justify-start gap-2.5 rounded-xl p-3 text-left",
                        item.status === "succeeded" &&
                          "receipt-done border-healthy/20 bg-healthy/5",
                        (item.status === "expired" ||
                          item.status === "failed") &&
                          "border-destructive/20 bg-destructive/5",
                      )}
                      onClick={() =>
                        setDetail({ runId: run.id, nodeId: item.nodeId })
                      }
                      aria-label={`${item.nodeId}: ${item.status}. View result`}
                    >
                      {item.status === "succeeded" ? (
                        <Check className="size-3.5 text-healthy" />
                      ) : item.status === "waiting" ? (
                        <LoaderCircle className="size-3.5 animate-spin text-primary" />
                      ) : (
                        <TriangleAlert className="size-3.5 text-destructive" />
                      )}
                      <span className="min-w-0">
                        <span className="mono block text-[11px]">
                          {item.nodeId}
                        </span>
                        <span className="mt-1 block truncate text-[9px] font-normal text-muted-foreground">
                          {item.status === "succeeded"
                            ? `${item.deliveryMs} ms · received`
                            : item.status === "waiting"
                              ? "Waiting for commit & apply"
                              : item.status === "expired"
                                ? "Deadline reached"
                                : "Execution failed"}
                        </span>
                      </span>
                    </Button>
                  ))}
                </div>
              </ScrollArea>
              <p className="mt-3 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <Terminal className="size-3" />
                Select a destination to inspect its actual result.
              </p>
              {run.error && (
                <p className="mt-2 text-[10px] leading-relaxed text-primary">
                  Proposal returned an error. Receipts show any execution
                  actually observed.
                </p>
              )}
            </>
          )}
        </div>
      </div>
      <div className="border-t border-border px-5 py-3 text-[10px] leading-relaxed text-muted-foreground md:px-6">
        The command is replicated to every member; only the chosen destinations
        execute. Results are local session telemetry, retained for the latest 40
        commands.
      </div>
      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Terminal className="size-4 text-primary" />
              {detail?.nodeId} / execution result
            </DialogTitle>
            <DialogDescription>
              Measured at the destination after its state machine received the
              committed instruction.
            </DialogDescription>
          </DialogHeader>
          {receipt && (
            <>
              <div className="flex flex-wrap gap-3 text-[11px]">
                <Badge variant="outline">{receipt.status}</Badge>
                <span className="text-muted-foreground">
                  Delivery:{" "}
                  <span className="mono text-foreground">
                    {receipt.deliveryMs ?? "—"} ms
                  </span>
                </span>
                <span className="text-muted-foreground">
                  Execution:{" "}
                  <span className="mono text-foreground">
                    {receipt.executionMs ?? "—"} ms
                  </span>
                </span>
              </div>
              <pre className="overflow-x-auto rounded-xl border border-border bg-background p-4 font-mono text-[11px] leading-6 text-follower">
                {JSON.stringify(
                  receipt.output ?? {
                    status: receipt.status,
                    detail:
                      receipt.error ??
                      "Waiting for this destination to apply the command.",
                  },
                  null,
                  2,
                )}
              </pre>
              <p className="break-all font-mono text-[9px] text-muted-foreground">
                COMMAND {detail?.runId}
              </p>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
