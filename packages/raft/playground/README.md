<div align="center">
  <img src="../../../assets/logo.svg" alt="Raft Quorum mark" width="88" height="88" />
  <h1>Raft · Observatory</h1>
  <p>See consensus happen.</p>
  <p><a href="../../../README.md">Workspace</a> · <a href="../README.md">Core engine</a> · <a href="../../../docs/dashboard-command-validation.md">Command validation</a></p>
</div>

The `@usex/raft-playground` workspace contains executable examples for `@usex/raft`, with a live web observatory, an interactive CLI, and a terminal visualizer. The scenarios exercise elections, replication, membership, snapshots, failures, recovery, and load. They are demonstrations and regression checks, not an exhaustive proof of consensus safety. See the [spec audit](../../../docs/raft-spec-audit.md) for remaining correctness failures.

## Run

From the repository root, with Bun 1.4.3 and a reachable Redis instance:

```bash
bun install --frozen-lockfile
bun run build
cd packages/raft/playground

# Defaults: REDIS_HOST=localhost, REDIS_PORT=6379
export REDIS_HOST=127.0.0.1
export REDIS_PORT=6379

bun run start # Opens the Raft Observatory with the configured NODE_COUNT
# Or choose a scenario without a prompt:
bun run start --no-interactive showcase --showcase cluster
```

Build after changing `packages/raft/src`: the playground imports the compiled workspace package.

Each example uses its own Redis namespace and `/tmp/raft-playground/<cluster-id>` directory. Startup and cleanup remove that example's data. Use a disposable Redis instance for experiments; do not run two copies of the same example on the same machine simultaneously (their snapshot paths would overlap).

## Raft Observatory

`bun run start` (or `bun run dashboard`) starts the dashboard and opens your browser at `http://127.0.0.1:3210`. If the port is occupied, Bun selects a free port and prints the actual URL. Redis must already be reachable; startup failures are displayed in the UI. Stop with `Ctrl+C` to clean up this dashboard's dedicated cluster namespace.

The dashboard starts with five nodes. To change the cluster size, edit `NODE_COUNT` at the top of `src/dashboard/main.ts` and restart the dashboard. Use a positive integer.

The server uses **Bun.serve**, Web Streams, and SSE. **Bun.build** bundles React 19, Tailwind CSS 4, and locally owned shadcn/ui components in memory at startup. There is no separate frontend build or Node.js server. UI sources, components, tests, and server are in `src/dashboard/`; shadcn aliases are in `components.json`.

- Live topology: real RPC particles, elections, roles, stopped nodes, and blocked network links. Packet motion is slowed for readability and limited to 80 concurrent particles; this does not limit event delivery.
- Replication matrix: pending, committed, applied, and snapshotted log positions. `LOG_REPLICATED` means appended, while `LOG_APPLIED` follows state-machine application.
- Node inspector: term, commit/applied positions, counter state, voting weight, and start/stop/leadership controls.
- Command center: send a node report or SHA-256 task to one node, all other nodes, or every member. Inspect individual results, delivery/execution timings, and the latest 40 command traces over SSE. The node inspector has a shortcut to target that node.
- Metrics: per-node RPC attempts, acknowledged inbound requests, failed/blocked requests, in-flight requests, applied events, p50/p95 response latency, and replication lag. Charts retain 60 one-second samples. CPU (percentage of one core), resident memory, and heap belong to the shared Bun process, not individual nodes.
- Experiments: append a command, send ten concurrent writes, stop the leader, partition the network, heal/restart nodes, or create a snapshot.
- Event feed: category filters, pause/resume (the cluster keeps running), full event payloads, and JSON export.
- Responsive layout, keyboard controls, shadcn focus management, and reduced-motion support.

Every standalone scenario also starts an **observation-only** dashboard automatically when its first node is created. The terminal scenario remains in control of its cluster. The dashboard keeps its final state when the scenario finishes. In a long-running session, reconnecting clients replay events using `Last-Event-ID`; gaps beyond retention are reported in the feed. The initial connection receives the last 100 highlights and latest 100 events. The raw journal/export retains the latest 2,000 events, and payloads are redacted and capped at 4 KB. This is a live observatory, not a durable event archive.

```bash
# Choose a port or suppress opening the browser (server still runs)
RAFT_DASHBOARD_PORT=3211 RAFT_DASHBOARD_OPEN=0 bun run start

# Run examples headlessly; CI/test environments also disable automatic observation
RAFT_DASHBOARD=0 bun run all-examples

# Original terminal scenario picker
bun run cli

# Native Bun tests for SSE, replay, backpressure, quorum display, and HTTP controls
bun run test:dashboard

# Real three-node command delivery, partitions, restart, leader transfer,
# quorum loss, SSE and metrics. Starts and removes its own Docker Redis.
bun run test:commands
```

The HTTP listener binds to loopback only. Control requests enforce local Host/Origin, body limits, an action allowlist, and one operation at a time. Example dashboards reject control requests. The existing Raft library now forwards structured events through `node.on("raftEvent", handler)`; existing `stateChange` and `leaderElected` listeners retain their behavior.

### Command semantics

Core Raft exposes `appendLog`, not a generic remote-work RPC. The playground adds an `ObservatoryStateMachine` for interactive counter clusters. The leader proposes an `observatory.dispatch` application entry containing a command ID and a fixed list of destination IDs. Every member replicates the same entry; after commit, only the selected destinations execute the read-only probe. The counter's replicated value/version and snapshot format are unchanged. Node reports reflect the destination's local state at execution, not a linearizable cluster read.

The two allowed operations are `inspect` and `sha256` (at most 512 UTF-8 bytes). A proposal error is shown as an unknown commit outcome until actual apply is observed. Destinations have a 15-second deadline from proposal; late arrivals are expired and do not execute. Selecting a stopped node deliberately lets you observe catch-up or expiry. Targets are resolved against the leader's active voting configuration when submitted.

Receipts are in-process observer telemetry. They are not replicated replies or a persistent distributed task queue. Session history, deduplication and pending probes are bounded to the latest 40 commands and are cleared on dashboard restart. Snapshot catch-up does not replay past probes. External side effects, arbitrary code execution, automatic retries and exactly-once execution across crashes are not provided. These controls do not resolve the core persistence/concurrency findings in [the Raft spec audit](../../../docs/raft-spec-audit.md).

Metric counters start when observation attaches. Inbound counts include only RPCs for which the sender observed a response; a request with a lost response is not counted as acknowledged inbound. Latency percentiles use the latest 1,000 successful outgoing requests within 60 seconds; no samples display as `—`. A follower with no outgoing RPCs should therefore show no response-latency value. Replication lag is the highest running-node commit index minus the selected node's last-applied index. Disconnected browsers retain their last known samples.

## Scenarios

| Command                       | Exercises                                                                                |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| `bun run cluster`             | Cluster startup, election, and committed counter writes                                  |
| `bun run election`            | Elections, leader failure, and node recovery                                             |
| `bun run replication`         | Replicated commands and state convergence                                                |
| `bun run membership`          | Adding/removing members and changing quorum                                              |
| `bun run snapshot`            | Log compaction and snapshot recovery                                                     |
| `bun run failures`            | Node failures, loss of quorum, and recovery                                              |
| `bun run performance`         | Throughput and latency at different concurrency levels                                   |
| `bun run monitoring`          | Cluster state and metrics                                                                |
| `bun run weighted-voting`     | Static weighted quorums, partitions, and restart                                         |
| `bun run network-partition`   | Actual RPC isolation, rejected minority writes, and convergence after healing            |
| `bun run leadership-transfer` | Catching up a target and confirming leadership handover                                  |
| `bun run concurrent-writes`   | Concurrent writers and state-machine consistency                                         |
| `bun run recovery`            | Single/multiple node recovery, lost quorum, rolling restart, and fresh-instance recovery |
| `bun run stress-test`         | Throughput, memory pressure, chaos, and endurance                                        |

`bun run all-examples` runs all 14 scenarios sequentially and stops on a failed scenario. Allow several minutes for the full run, particularly the stress test. A failed result exits nonzero.

Weighted voting uses the same positive `voting.weights` map on every member. Runtime CPU/memory measurements are not used to independently change quorum weights. Weight changes during a running cluster are not supported by this example.

## Interactive tools

```bash
bun run interactive
bun run visualizer
```

The CLI supports cluster creation, commands, status, stop/start, membership changes, partition/heal, and cleanup. In the visualizer:

| Key            | Action                                         |
| -------------- | ---------------------------------------------- |
| `s`            | Submit a counter operation                     |
| `f`            | Stop a running node while retaining a majority |
| `r`            | Restart a stopped node                         |
| `p`            | Split the network into two groups              |
| `h`            | Heal the network partition                     |
| `q` / `Ctrl+C` | Stop nodes, clean up, and exit                 |

The terminal visualizer shows running-node count, Raft state, commit/applied positions, counter values, and an operation log. Scroll the node panel to inspect additional nodes.

## Validation

```bash
# From the repository root; Docker is required for Redis test containers.
bun run --cwd packages/raft test run
bun run test:types
bun run lint
```

See [the playground validation report](../../../docs/raft-playground-validation.md) for observed results, repaired bugs, and persistence compatibility notes. These scenarios do not test Byzantine fault tolerance, physical disk corruption, or multi-datacenter deployments.

See the [command center validation report](../../../docs/dashboard-command-validation.md) for destination execution, metrics, quorum-loss behavior, and browser checks. The shared visual identity and downloadable files are in [Brand assets](../../../assets/BRAND_ASSETS.md).

## License

[MIT](../../../LICENCE) · [Ali Torki](https://github.com/ali-master)
