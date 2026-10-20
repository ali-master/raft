<div align="center">
  <img src="../../../assets/logo.svg" alt="Raft Quorum mark" width="88" height="88" />
  <h1>Raft · Observatory</h1>
  <p>See consensus happen.</p>
  <p><a href="../../../README.md">Workspace</a> · <a href="../README.md">Core engine</a> · <a href="../../../docs/dashboard-command-validation.md">Command validation</a></p>
</div>

The `@usex/raft-playground` workspace contains executable examples for `@usex/raft`, with a live web observatory, an interactive CLI, and a terminal visualizer. The scenarios exercise elections, replication, membership, snapshots, failures, recovery, and load. They are demonstrations and regression checks, not an exhaustive proof of consensus safety. See the [spec audit](../../../docs/raft-spec-audit.md) for remaining correctness failures.

## Contents

- [Run](#run)
- [First experiment](#first-experiment)
- [Raft Observatory](#raft-observatory)
- [HTTP API](#http-api)
- [SSE subscription](#sse-subscription)
- [Scenarios](#scenarios)
- [Interactive tools](#interactive-tools)
- [Troubleshooting and validation](#troubleshooting-and-validation)

## Run

Use Bun >= 1.4.3. Start a dedicated Redis instance, then install and build from the repository root:

```bash
docker run --rm --name raft-observatory-redis -p 127.0.0.1:6389:6379 redis:7-alpine
```

In another terminal:

```bash
bun install --frozen-lockfile
bun run --cwd packages/raft build
cd packages/raft/playground

export REDIS_HOST=127.0.0.1
export REDIS_PORT=6389

bun run start
```

Build after changing `packages/raft/src`: the playground imports the compiled workspace package.

Each example uses its own Redis namespace and `/tmp/raft-playground/<cluster-id>` directory. Startup and cleanup remove that example's data. Use a disposable Redis instance for experiments; do not run two copies of the same example on the same machine simultaneously (their snapshot paths would overlap).

## First experiment

1. Open the printed Observatory URL and wait for the five nodes and a leader to appear.
2. Submit one counter write. Wait until the nodes' applied indices catch up and each counter has increased by one.
3. In the command center, choose `inspect`, select all nodes, and dispatch. Open the individual receipts to compare each node's local report.
4. Stop the leader. A remaining majority should elect a replacement; inspect the term and role changes in the event feed.
5. Heal the cluster to restart stopped nodes and remove partitions. Confirm the counters converge again.
6. Export the session before stopping with `Ctrl+C`; history is kept only in memory.

Use the HTTP examples below to perform the same experiment without browser controls.

## Raft Observatory

`bun run start` (or `bun run dashboard`) starts the dashboard and opens your browser at `http://127.0.0.1:3210`. If the port is occupied, Bun selects a free port and prints the actual URL. Redis must already be reachable; startup failures are displayed in the UI. Stop with `Ctrl+C` to clean up this dashboard's dedicated cluster namespace.

The dashboard starts with five nodes. Its single cluster-size setting is `const NODE_COUNT = 5` in `src/dashboard/main.ts`; change that value to a positive integer and restart. There is currently no node-count environment variable.

The server uses **Bun.serve**, Web Streams, and SSE. **Bun.build** bundles React 19, Tailwind CSS 4, and shadcn/ui components in memory at startup. No separate frontend build or Node.js server is needed.

| Setting                      | Default                       | Use                                                             |
| ---------------------------- | ----------------------------- | --------------------------------------------------------------- |
| `REDIS_HOST`, `REDIS_PORT`   | `localhost`, `6379`           | Redis connection; exported shell values apply to every scenario |
| `REDIS_PASSWORD`, `REDIS_DB` | Unset, `0`                    | Optional authentication and logical database                    |
| `RAFT_DASHBOARD_PORT`        | `3210`                        | Integer port; `0` asks Bun to select one                        |
| `RAFT_DASHBOARD_OPEN`        | Browser opens                 | Set to `0` to suppress browser launch                           |
| `RAFT_DASHBOARD`             | Automatic observation enabled | Set to `0` for headless terminal scenarios                      |
| `CI`                         | Unset                         | Suppresses browser launch and automatic scenario observation    |

`RAFT_DASHBOARD=0` controls automatic observation of scenarios; use a scenario command rather than the explicit `dashboard` command for a headless run.

- Live topology: real RPC particles, elections, roles, stopped nodes, and blocked network links. Packet motion is slowed for readability and limited to 80 concurrent particles; this does not limit event delivery.
- Replication matrix: pending, committed, applied, and snapshotted log positions. `LOG_REPLICATED` means appended, while `LOG_APPLIED` follows state-machine application.
- Node inspector: term, commit/applied positions, counter state, voting weight, and start/stop/leadership controls.
- Command center: send a node report or SHA-256 task to one node, all other nodes, or every member. Inspect individual results, delivery/execution timings, and the latest 40 command traces over SSE. The node inspector has a shortcut to target that node.
- Metrics: per-node RPC attempts, acknowledged inbound requests, failed/blocked requests, in-flight requests, applied events, p50/p95 response latency, and replication lag. Charts retain 60 one-second samples. CPU (percentage of one core), resident memory, and heap belong to the shared Bun process, not individual nodes.
- Experiments: append a command, send ten concurrent writes, stop the leader, partition the network, heal/restart nodes, or create a snapshot.
- Event feed: category filters, pause/resume (the cluster keeps running), full event payloads, and JSON export.
- Responsive layout, keyboard controls, shadcn focus management, and reduced-motion support.

Every standalone scenario also starts an **observation-only** dashboard automatically when its first node is created. The terminal scenario remains in control of its cluster. The dashboard keeps its final state when the scenario finishes. In a long-running session, reconnecting clients replay events using `Last-Event-ID`; gaps beyond retention are reported in the feed. The initial connection receives the last 100 highlights and latest 100 events. The raw journal/export retains the latest 2,000 events. Sensitive payload fields are redacted, and serialized payloads exceeding 4,096 characters are replaced with a truncated summary. This is a live observatory, not a durable event archive.

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

## HTTP API

Use the origin printed at startup. All endpoints are local-only; cross-origin callers are rejected. This is an in-memory development API, with no stable external versioning contract.

| Request            | Response                                               |
| ------------------ | ------------------------------------------------------ |
| `GET /api/state`   | Current dashboard state as JSON                        |
| `GET /api/events`  | Named SSE events, described below                      |
| `GET /api/export`  | `{ state, events }` download named `raft-session.json` |
| `POST /api/action` | Execute one control action; JSON body required         |

```bash
export OBSERVATORY=http://127.0.0.1:3210
curl -sS "$OBSERVATORY/api/state"
curl -sS "$OBSERVATORY/api/export" -o raft-session.json

# Increment the replicated counter by one.
curl -sS "$OBSERVATORY/api/action" \
  -H 'Content-Type: application/json' -d '{"action":"write"}'

# Execute a read-only SHA-256 probe on all current members.
curl -sS "$OBSERVATORY/api/action" \
  -H 'Content-Type: application/json' \
  -d '{"action":"dispatch","operation":"sha256","target":"all","payload":"hello"}'
```

Ordinary actions return `{ "ok": true }`. Dispatch returns `{ "ok": true, "commandId": "..." }`; inspect the matching command's receipts in subsequent state updates to establish which destinations executed it.

### Action bodies

| `action`         | Additional fields                | Effect                                                                                                             |
| ---------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `write`          | None                             | Propose one `increment` by 1                                                                                       |
| `burst`          | None                             | Submit ten concurrent increments                                                                                   |
| `fail-leader`    | None                             | Stop the current leader                                                                                            |
| `partition`      | None                             | Separate a minority containing the current leader from the other running nodes                                     |
| `heal`           | None                             | Restart stopped nodes and remove blocked links                                                                     |
| `snapshot`       | None                             | Ask the current leader to create a snapshot; verify its event/result because core snapshot errors can be swallowed |
| `transfer`       | `nodeId`                         | Transfer leadership to an existing running node                                                                    |
| `stop` / `start` | `nodeId`                         | Stop or restart an existing node                                                                                   |
| `dispatch`       | `operation`, `target`, `payload` | Propose a destination-specific read-only task                                                                      |

Read actual IDs from `state.nodes[].id` before passing `nodeId` or a specific `target`. For dispatch:

- `operation` is `inspect` or `sha256`.
- `target` is `all`, `followers`, or one node ID. Here `followers` means all other members of the leader's active voting configuration, including stopped members.
- `payload` is always required; use `""` for `inspect`. Its maximum size is 512 UTF-8 bytes.
- A stopped destination may catch up before its 15-second deadline, or receive an `expired` receipt without execution.

The server limits request bodies to 1 KiB. It accepts one control operation at a time.

| Status | Meaning                                                                     |
| ------ | --------------------------------------------------------------------------- |
| 200    | Action completed or command dispatch was accepted                           |
| 400    | Invalid JSON, action, node, task, destination, or payload                   |
| 403    | Nonlocal Host/Origin, or an observation-only scenario                       |
| 409    | Startup incomplete, an operation is busy, or execution failed; read `error` |
| 413    | Request exceeds Bun's body limit                                            |
| 415    | Missing/incorrect JSON content type                                         |

### State and receipt fields

| Field                                 | Meaning                                                                                         |
| ------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `sessionId`, `clusterId`              | Dashboard session and observed cluster                                                          |
| `startedAt`, `time`                   | Unix timestamps in milliseconds                                                                 |
| `status`, `ready`, `busy`, `controls` | Display status, readiness, operation lock, and permission to use controls                       |
| `nodes`                               | Node snapshots, including stopped nodes; final snapshots are retained when a scenario ends      |
| `blockedLinks`                        | Current simulated network isolation                                                             |
| `commands`                            | Recent dispatch traces and per-destination receipts                                             |
| `metricsHistory`                      | Up to 60 samples containing `time`, per-node `rate`/`p95`/`lag`, and process `cpu`/`rss`/`heap` |
| `traffic`                             | Aggregate message/failed counts, rate and latency                                               |
| `totalEvents`, `historyLimit`         | Monotonic session event sequence and retained journal capacity                                  |

Each node includes `id`, `role`, `running`, `term`, `commitIndex`, `lastApplied`, `firstLogIndex`, `lastLogIndex`, `peers`, voting `weight`/`weighted`, active `configuration`, `metrics`, `commandCapable`, counter `value`, and recent `log` positions. A non-counter state machine has `value: null`. Log previews contain index, term, and command type; they are not a full dump of application commands.

A receipt contains `nodeId` and `status`: `waiting`, `succeeded`, `failed`, or `expired`. Once available, `finishedAt` is epoch milliseconds, `deliveryMs` and `executionMs` are durations, `output` holds the probe result, and `error` describes failure. Successful delivery is distinct from successful execution.

## SSE subscription

Run this in the browser console **on the Observatory page**, or in a same-origin browser application:

```javascript
const stream = new EventSource("/api/events");

stream.addEventListener("state", (event) => {
  const state = JSON.parse(event.data);
  console.table(
    state.nodes.map(({ id, role, commitIndex, lastApplied, value }) => ({
      id,
      role,
      commitIndex,
      lastApplied,
      value,
    })),
  );
});

stream.addEventListener("events", (event) => {
  const { events, omitted } = JSON.parse(event.data);
  if (omitted > 0)
    console.warn(`${omitted} older events are no longer retained`);
  for (const item of events) {
    console.log(item.id, item.type, item.nodeId, item.data);
  }
});

stream.onerror = () => console.warn("Disconnected; EventSource will reconnect");
// When finished:
// stream.close();
```

The connection immediately emits `state`. State updates are broadcast about every 300 ms, while event batches are flushed about every 100 ms. Metrics history samples once per second. These are display intervals, not consensus timing guarantees.

The named `events` message contains `{ events: [...], omitted: number }`. Each item is `{ id, time, type, nodeId, data }`, with integer session ID and epoch-millisecond time. `data` depends on event type; do not assume every event is an RPC or has the same payload.

Native `EventSource` automatically sends the last received event ID on reconnection. A valid `Last-Event-ID` resumes journal replay; retention gaps are reflected in `omitted`. IDs reset with a new dashboard session, so use `sessionId` to recognize restarts. The stream advertises a 1,200 ms reconnect delay.

For a terminal subscriber:

```bash
curl -N "$OBSERVATORY/api/events"
# Resume from a previously received event ID in the same session:
curl -N -H 'Last-Event-ID: 120' "$OBSERVATORY/api/events"
```

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

## Troubleshooting and validation

| Symptom                           | Check                                                                                   |
| --------------------------------- | --------------------------------------------------------------------------------------- |
| No nodes or a startup error       | Redis host/port, Redis reachability, and the terminal error                             |
| Browser opens a different port    | The requested port was occupied; use the printed URL                                    |
| Controls return 403               | Standalone scenarios are observation-only; run `bun run dashboard` for controls         |
| Action returns 409                | Wait for readiness/busy state, then inspect `error`; a leader/quorum may be unavailable |
| Counters differ after a partition | Heal the cluster and wait for log application before comparing values                   |
| No latency for a follower         | It may have no successful outgoing RPCs in the measurement window                       |
| An old event is missing           | History is bounded; export before stopping or overflowing retention                     |
| Source changes do not appear      | Rebuild `packages/raft`, then restart the playground                                    |

```bash
# From this playground:
bun run test:dashboard
bun run test:types
bun run lint

# From the repository root; Docker is required for Redis test containers.
bun run --cwd packages/raft test run
```

See [the playground validation report](../../../docs/raft-playground-validation.md) for observed results, repaired bugs, and persistence compatibility notes. These scenarios do not test Byzantine fault tolerance, physical disk corruption, or multi-datacenter deployments.

See the [command center validation report](../../../docs/dashboard-command-validation.md) for destination execution, metrics, quorum-loss behavior, and browser checks. The shared visual identity and downloadable files are in [Brand assets](../../../assets/BRAND_ASSETS.md).

## License

[MIT](../../../LICENCE) · [Ali Torki](https://github.com/ali-master)
