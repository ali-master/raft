<div align="center">
  <img src="../../assets/logo.svg" alt="Raft Quorum mark" width="88" height="88" />
  <h1>@usex/raft</h1>
  <p>Leader election, replicated commands, and application state machines in TypeScript.</p>
  <p><a href="../../README.md">Workspace</a> · <a href="./playground/README.md">Observatory</a> · <a href="../nest/README.md">NestJS integration</a></p>
</div>

Use this package when your application needs several nodes to agree on an ordered sequence of commands. The leader appends commands; each member applies committed commands to its own state machine. Redis provides transport, discovery, and log/state storage. Local files provide WAL and snapshot storage.

**Development status:** normal-path examples work, but persistence, concurrent membership changes, and snapshot recovery have known correctness failures. Use disposable data while evaluating this version. It is not yet verified for authoritative production data. The limitations relevant to each API are described below; the [audit](../../docs/raft-spec-audit.md) contains the regression results.

## Contents

- [Install](#install)
- [Run a replicated counter](#run-a-replicated-counter)
- [Application state and snapshots](#application-state-and-snapshots)
- [Engine API](#engine-api)
- [Node API](#node-api)
- [Configuration reference](#configuration-reference)
- [Events](#events)
- [Metrics and logging](#metrics-and-logging)
- [Weighted voting and adaptive consensus](#weighted-voting-and-adaptive-consensus)
- [Errors and troubleshooting](#errors-and-troubleshooting)

## Install

```bash
bun add @usex/raft ioredis opossum prom-client
```

Use Bun >= 1.4.3. ESM and CommonJS consumers on Node.js >= 22.22.3 are also supported by the package exports. The examples below run with Bun.

For a checkout of this repository, build the package before running an example; workspace imports resolve its compiled output:

```bash
bun install --frozen-lockfile
bun run --cwd packages/raft build
```

Start a dedicated development Redis in a separate terminal:

```bash
docker run --rm --name raft-redis -p 127.0.0.1:6389:6379 redis:7-alpine
```

## Run a replicated counter

Save the following as `counter.ts` in your application. It creates three local nodes, waits for a leader, commits one increment, checks that every state machine applied it, and shuts down. A fresh data directory prints `[1, 1, 1]`.

```typescript
import { RaftEngine, RaftState, type StateMachine } from "@usex/raft";

class Counter implements StateMachine {
  value = 0;

  async apply(command: unknown): Promise<void> {
    if (
      typeof command !== "object" ||
      command === null ||
      !("type" in command) ||
      command.type !== "increment" ||
      !("amount" in command) ||
      typeof command.amount !== "number" ||
      !Number.isSafeInteger(command.amount) ||
      !Number.isSafeInteger(this.value + command.amount)
    )
      throw new Error("Invalid counter command");
    this.value += command.amount;
  }

  async getSnapshotData(): Promise<Buffer> {
    return Buffer.from(JSON.stringify({ value: this.value }));
  }

  async applySnapshot(data: Buffer): Promise<void> {
    const snapshot = JSON.parse(data.toString());
    if (!Number.isSafeInteger(snapshot.value))
      throw new Error("Invalid snapshot");
    this.value = snapshot.value;
  }
}

async function waitFor(
  check: () => boolean,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error("Cluster did not become ready");
    await Bun.sleep(50);
  }
}

const engine = new RaftEngine();
const clusterId = process.env.CLUSTER_ID ?? "readme-counter";
const ids = ["node-1", "node-2", "node-3"];
const counters = ids.map(() => new Counter());

try {
  const nodes = await Promise.all(
    ids.map((id, index) => {
      const config = RaftEngine.createDefaultConfiguration(id, clusterId);
      config.peers = ids;
      config.httpPort = 4101 + index;
      config.redis = {
        ...config.redis,
        host: process.env.REDIS_HOST ?? "127.0.0.1",
        port: Number(process.env.REDIS_PORT ?? 6389),
        keyPrefix: `raft:${clusterId}:`,
      };
      config.voting = { ...config.voting, enableWeighting: false };
      config.persistence = {
        ...config.persistence,
        dataDir: `./data/${clusterId}/${id}`,
      };
      return engine.createNode(config, counters[index]);
    }),
  );

  await Promise.all(ids.map((id) => engine.startNode(id)));
  await waitFor(
    () =>
      nodes.filter((node) => node.getState() === RaftState.LEADER).length === 1,
  );
  const leader = nodes.find((node) => node.getState() === RaftState.LEADER)!;
  const leaderIndex = nodes.indexOf(leader);
  const expected = counters[leaderIndex]!.value + 1;

  await leader.appendLog({ type: "increment", amount: 1 });
  await waitFor(() => counters.every((counter) => counter.value === expected));
  console.log(
    "Replicated values:",
    counters.map((counter) => counter.value),
  );
} finally {
  await engine.stopAllNodes();
}
```

```bash
REDIS_PORT=6389 bun counter.ts
```

Each node needs a unique `nodeId` and writable `persistence.dataDir`. Members share the same `clusterId`, Redis connection, voting map, and Raft key prefix. **`peers` is the complete initial voting membership, including the local node itself.** Omitting self prevents that node from starting elections. For separate processes, create one node in each process and configure the same complete membership. Redis discovery can find peers, but do not treat discovery alone as an atomic cluster membership change.

A `RaftNode` does not start an HTTP listener. `httpHost`/`httpPort` describe its advertised endpoint; the default transport uses Redis. The HTTP KV server and the Observatory start their own listeners.

## Application state and snapshots

The public contract is:

```typescript
import type { StateMachine } from "@usex/raft";

type SetCommand = { type: "set"; key: string; value: string };

// Contract illustration; the Counter above is a complete implementation.
type ApplicationState = StateMachine<SetCommand>;
// apply(command: SetCommand): Promise<void>
// getSnapshotData(): Promise<Buffer>
// applySnapshot(data: Buffer): Promise<void>
```

`new RaftNode<TCommand>(config, stateMachine)` preserves your command type. `engine.createNode(config, stateMachine?)` is the lifecycle-managed convenience API. Omitting its state machine installs a no-op implementation: proposals can commit without changing application data.

- **`apply`** receives the application payload, not a `LogEntry` wrapper. Keep it deterministic: put timestamps, IDs, and intended values in the proposed command instead of generating them independently on each replica. Validate input before proposing; an exception during apply can prevent later application progress.
- **`getSnapshotData`** serializes the complete application state into bytes. Include your own format version when the application schema evolves.
- **`applySnapshot`** replaces local application state with the supplied snapshot. Validate the entire payload before replacing existing state. Restore JSON dates/maps explicitly when your state uses them.
- An application must implement its own command IDs/deduplication if retrying a write could repeat a side effect. The library does not provide a persistent distributed job queue or exactly-once external execution.
- Reads from your state machine are local reads. There is no public read-index/quorum-barrier API establishing linearizable reads.

`await node.createSnapshot()` requests a snapshot. Snapshot errors can currently be logged and swallowed, so a resolved call is not sufficient proof that a usable snapshot exists. Snapshot/WAL recovery has additional known defects; test your application's restore path before relying on it.

## Engine API

`new RaftEngine()` creates a manager for nodes in the current process. `RaftConsensusLibrary` is an alias for the same class.

| Method                                                     | Returns                 | Behavior                                                                                                             |
| ---------------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `RaftEngine.createDefaultConfiguration(nodeId, clusterId)` | `RaftConfiguration`     | New configuration with the defaults below.                                                                           |
| `createNode(config, stateMachine?)`                        | `Promise<RaftNode>`     | Registers an unstarted node. Duplicate IDs throw `RaftConfigurationException`.                                       |
| `startNode(nodeId)`                                        | `Promise<void>`         | Starts an existing node. Missing ID throws.                                                                          |
| `stopNode(nodeId)`                                         | `Promise<void>`         | Stops a node but keeps it registered, allowing restart. Missing ID throws.                                           |
| `removeNode(nodeId)`                                       | `void`                  | Removes the local registry entry only. Stop it first; this neither stops the process nor changes cluster membership. |
| `getNode(nodeId)`                                          | `RaftNode \| undefined` | Looks up a local managed node.                                                                                       |
| `getAllNodes()`                                            | `Map<string, RaftNode>` | Copy of the local registry; not a remote-cluster inventory.                                                          |
| `stopAllNodes()`                                           | `Promise<void>`         | Stops managed nodes and clears the registry.                                                                         |

For a long-running service, call `stopAllNodes()` from its shutdown hook. Stopping nodes preserves their Redis/WAL/snapshot data; it is not a reset operation.

## Node API

### Proposals and lifecycle

| Method                                  | Returns            | Requirements and result                                                                                                      |
| --------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `start()` / `stop()`                    | `Promise<void>`    | Starts/stops this node's transport, timers and persistence lifecycle.                                                        |
| `isRunning()`                           | `boolean`          | Whether the node is running. A stopped node can still report its last Raft role.                                             |
| `appendLog(command)`                    | `Promise<boolean>` | Running leader only; resolves `true` after waiting for commitment. Rejects during leadership transfer or failed replication. |
| `forceElection()`                       | `Promise<void>`    | Requests an election; does not guarantee leadership.                                                                         |
| `changeClusterConfiguration(memberIds)` | `Promise<void>`    | Leader proposes joint and final configurations; current leader is automatically included. Serialize calls.                   |
| `transferLeadership(targetPeerId)`      | `Promise<void>`    | Running leader catches up another voting member and waits for confirmed handover.                                            |
| `createSnapshot()`                      | `Promise<void>`    | Requests snapshot/compaction; observe the snapshot limitation above.                                                         |

`appendLog` is the write API; there is no `node.propose()`. A successful call does not mean every follower has already applied the entry. Wait for your state-machine result or applied positions when an operation needs that assurance. If a request times out, its outcome can be uncertain: it may still commit later. Do not blindly retry non-idempotent commands.

To add a node, start that node with a compatible configuration, then call `leader.changeClusterConfiguration([...leader.getPeers(), "node-4"])`. To remove a member, pass the desired remaining member IDs. Transfer leadership first if you want to remove the current leader. Concurrent configuration changes and interrupted joint transitions have unresolved safety defects.

### Inspection

| Method                                  | Returns / meaning                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `getNodeId()`                           | `string`                                                                                               |
| `getState()`                            | `RaftState`: `"follower"`, `"candidate"`, or `"leader"`                                                |
| `getLeaderId()`                         | `string \| null`; last known leader                                                                    |
| `getCurrentTerm()`                      | Current term number                                                                                    |
| `getCommitIndex()` / `getLastApplied()` | Committed / application-applied log positions                                                          |
| `getPeers()`                            | Voting member IDs, including self; union of old/new members during a joint configuration               |
| `getActiveConfiguration()`              | `{ oldPeers?: string[]; newPeers: string[] }`                                                          |
| `getPeerInfo(nodeId)`                   | `PeerInfo \| undefined`: identity, endpoint, role, term, last-seen `Date`, weight, system metrics      |
| `getConfiguration()`                    | Configuration object; treat it as read-only. Mutating it is not a supported reconfiguration procedure. |
| `getMetrics()`                          | `RaftMetrics \| undefined`; may be absent before collection                                            |
| `getPrometheusMetrics()`                | `Promise<string>`; Prometheus exposition, empty if disabled                                            |
| `getMetricsCollector()`                 | `RaftMetricsCollector`                                                                                 |
| `getLogger()`                           | `RaftLogger`                                                                                           |
| `getLog()`                              | Internal log handle; do not mutate it to bypass commitment or application ordering                     |

### Protocol integration

These methods are for transport adapters, not application writes. The corresponding request/response types are exported from `@usex/raft`.

| Method                             | Input                    | Output                             |
| ---------------------------------- | ------------------------ | ---------------------------------- |
| `handleVoteRequest(request)`       | `VoteRequest`            | `Promise<VoteResponse>`            |
| `handlePreVoteRequest(request)`    | `PreVoteRequest`         | `Promise<PreVoteResponse>`         |
| `handleAppendEntries(request)`     | `AppendEntriesRequest`   | `Promise<AppendEntriesResponse>`   |
| `handleInstallSnapshot(request)`   | `InstallSnapshotRequest` | `Promise<InstallSnapshotResponse>` |
| `handleTimeoutNowRequest(request)` | `TimeoutNowRequest`      | `Promise<void>`                    |

Request and response fields:

| Type                      | Fields                                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `VoteRequest`             | `term`, `candidateId`, `lastLogIndex`, `lastLogTerm`, optional numeric `weight`                            |
| `VoteResponse`            | `term`, boolean `voteGranted`, numeric `voterWeight`                                                       |
| `PreVoteRequest`          | Prospective `term`, `candidateId`, `lastLogIndex`, `lastLogTerm`                                           |
| `PreVoteResponse`         | Responder's `term`, boolean `voteGranted`                                                                  |
| `AppendEntriesRequest`    | `term`, `leaderId`, `prevLogIndex`, `prevLogTerm`, `entries: LogEntry[]`, `leaderCommit`                   |
| `AppendEntriesResponse`   | `term`, boolean `success`, `lastLogIndex`                                                                  |
| `InstallSnapshotRequest`  | `term`, `leaderId`, `lastIncludedIndex`, `lastIncludedTerm`, byte `offset`, `data: Buffer`, boolean `done` |
| `InstallSnapshotResponse` | `term`                                                                                                     |
| `TimeoutNowRequest`       | `term`, `leaderId`                                                                                         |

Terms and indices are numbers; IDs are strings. `LogEntry<TCommand>` contains `term`, `index`, `commandType: RaftCommandType`, `commandPayload`, `timestamp: Date`, and `checksum: string`. The node constructs these entries when you call `appendLog`; ordinary applications should not manufacture entries or checksums. A transport adapter must preserve Buffer and Date semantics when serializing protocol messages.

`RaftCommandType` values are `APPLICATION`, `CHANGE_CONFIG`, and `NO_OP`. `MessageType` identifies transport envelopes: `vote_request`, `vote_response`, `pre_vote_request`, `pre_vote_response`, `append_entries`, `append_entries_response`, `install_snapshot`, `install_snapshot_response`, and `timeout_now_request`. Their enum member names are uppercase versions of those strings.

Do not expose protocol handlers as unauthenticated application endpoints. The current snapshot path expects a complete snapshot buffer; chunk assembly is not implemented.

## Configuration reference

Start with `createDefaultConfiguration`, then override fields. Nested objects are not automatically deep-merged by callers; use `{ ...config.redis, port: 6389 }` to retain sibling fields.

All intervals/timeouts below are **milliseconds**, except `redis.ttl`, which is **seconds**. Byte sizes are stated explicitly.

| Field                                                                | Default                                                                | Purpose                                                                                              |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `nodeId`, `clusterId`                                                | Required arguments                                                     | Stable node identity and cluster namespace.                                                          |
| `httpHost`, `httpPort`                                               | `localhost`, `3000`                                                    | Advertised endpoint; does not create a listener.                                                     |
| `peers`                                                              | Unset                                                                  | Complete initial voting membership, including self. Keep the same list across nodes.                 |
| `electionTimeout`                                                    | `[300, 500]`                                                           | Randomized election timeout range.                                                                   |
| `heartbeatInterval`                                                  | `150`                                                                  | Leader heartbeat interval; keep below election timeout.                                              |
| `maxLogEntries`, `snapshotThreshold`                                 | `10000`, `1000`                                                        | Log/snapshot thresholds.                                                                             |
| `redis.host`, `redis.port`, `redis.db`                               | `REDIS_HOST` or `localhost`; `REDIS_PORT` or `6379`; `REDIS_DB` or `0` | Redis connection.                                                                                    |
| `redis.password`                                                     | `REDIS_PASSWORD`, if set                                               | Optional password.                                                                                   |
| `redis.keyPrefix`                                                    | Unset, effectively `""`                                                | Prefix for Raft state/log keys; explicitly set one for a new isolated application.                   |
| `redis.ttl`                                                          | Storage fallback `3600`                                                | State/log expiry. This version uses expiring persistence keys; `0` does not mean permanent storage.  |
| `peerDiscovery.registrationInterval`                                 | `5000`                                                                 | Discovery registration cadence.                                                                      |
| `peerDiscovery.healthCheckInterval`, `peerDiscovery.peerTimeout`     | `10000`, `30000`                                                       | Discovery health/expiry windows.                                                                     |
| `voting.enableWeighting`, `voting.defaultWeight`                     | `true`, `1`                                                            | Weighted voting switch and fallback weight. Set weighting to `false` for ordinary majority voting.   |
| `voting.weights`                                                     | Unset                                                                  | Fixed `Record<string, number>` shared by all members.                                                |
| `voting.weightMetrics`                                               | `cpuUsage`, `memoryUsage`, `networkLatency`, `uptime`                  | Legacy/configuration field; not automatic safe quorum-weight updates.                                |
| `network.requestTimeout`, `network.maxRetries`, `network.retryDelay` | `5000`, `3`, `100`                                                     | RPC timeout and retries.                                                                             |
| `network.circuitBreakerThreshold`, `network.circuitBreakerTimeout`   | `5`, `30000`                                                           | Network breaker configuration.                                                                       |
| `retry.maxAttempts`, `retry.backoffFactor`, `retry.initialDelay`     | `3`, `2`, `100`                                                        | Retry configuration.                                                                                 |
| `circuitBreaker.timeout`, `errorThresholdPercentage`, `resetTimeout` | `3000`, `50`, `30000`                                                  | Breaker timeout, percentage threshold, reset delay.                                                  |
| `metrics.enablePrometheus`, `metrics.enableInternal`                 | `true`, `true`                                                         | Metrics options.                                                                                     |
| `metrics.collectionInterval`, `metrics.retentionPeriod`              | `5000`, unset                                                          | Collection cadence and optional retention option.                                                    |
| `persistence.enableSnapshots`, `persistence.snapshotInterval`        | `true`, `300000`                                                       | Snapshot options.                                                                                    |
| `persistence.dataDir`                                                | `/var/lib/raft`                                                        | Set a writable, separate directory for each node.                                                    |
| `persistence.walEnabled`, `persistence.walSizeLimit`                 | `true`, `104857600` bytes                                              | WAL options. WAL presence does not guarantee crash-safe recovery in this release.                    |
| `logging.level`                                                      | `LogLevel.INFO`                                                        | `debug`, `info`, `warn`, `error`, `fatal`.                                                           |
| `logging.redactedFields`, `logging.enableStructured`                 | `["password", "token", "secret"]`, `true`                              | Structured logging and field redaction.                                                              |
| `adaptiveConsensus`                                                  | Unset                                                                  | Optional adaptive settings; supplying this object alone does not attach an algorithm to a core node. |

Additional logging options: `enableConsole`, `enableFile`, `filePath`, `enableColors`, `showTimestamps`, `showNodeIds`, and `pretty`. `pretty` accepts a boolean or `{ enabled, indent, showTypes?, maxObjectDepth?, maxArrayLength?, sortKeys?, showFunctions?, colorizeJson? }`.

### Existing Redis data

A prefix change does not rename existing keys. The core's legacy layout is `<nodeId>:state` and `<nodeId>:log:<index>`. An explicit empty `redis.keyPrefix` retains it. To migrate, stop every member, back up Redis and each data directory, then move only that cluster's keys without overwriting destination keys. Keep identities and encryption/application formats unchanged. The KV server has a different default prefix; its README documents that separately.

## Events

Subscribe to the node's **`raftEvent`** channel and inspect `event.type`:

```typescript
import { RaftEventType, type RaftEvent, type RaftNode } from "@usex/raft";

export function observe(node: RaftNode): () => void {
  const listener = (event: RaftEvent) => {
    if (event.type === RaftEventType.LOG_APPLIED) {
      console.log(event.nodeId, event.timestamp, event.data);
    }
  };
  node.on("raftEvent", listener);
  return () => node.off("raftEvent", listener);
}
```

An event contains `{ type, nodeId, timestamp: Date, data }`. `RaftEvent` is a **type-only root export**; do not import it as a runtime constructor.

| Event                                                                   | Meaning                                                        |
| ----------------------------------------------------------------------- | -------------------------------------------------------------- |
| `STATE_CHANGE`, `LEADER_ELECTED`                                        | Role transition / election notification.                       |
| `LOG_REPLICATED`                                                        | A log entry was appended; this event occurs before commitment. |
| `LOG_APPLIED`                                                           | Application of a committed entry completed locally.            |
| `NODE_STARTED`, `NODE_STOPPED`                                          | Node lifecycle.                                                |
| `VOTE_GRANTED`, `VOTE_DENIED`, `ELECTION_TIMEOUT`, `HEARTBEAT_RECEIVED` | Election and heartbeat observations.                           |
| `CONFIGURATION_CHANGED`, `PEER_DISCOVERED`, `PEER_LOST`                 | Membership/discovery observations.                             |
| `SNAPSHOT_CREATED`, `ERROR_OCCURRED`, `METRICS_UPDATED`                 | Snapshot, error, and metrics observations.                     |

The enum also names protocol/diagnostic categories. An enum member's existence does not guarantee that every code path emits it. `data` varies by event; it is not a universal command payload. Existing convenience channels `stateChange` and `leaderElected` remain available. Listening directly on `node.on("leader_elected", ...)` does not replace `node.on("raftEvent", ...)`.

## Metrics and logging

`RaftMetrics` has numeric fields `currentTerm`, `commitIndex`, `lastApplied`, `logLength`, `leaderHeartbeats`, `electionCount`, `voteCount`, `appendEntriesCount`, `peerCount`, plus `state`, `votedFor: string | null`, and `systemMetrics`. Metrics are sampled; use `getCommitIndex()`/`getLastApplied()` for immediate local positions.

`systemMetrics` includes `cpuUsage`, `memoryUsage`, `diskUsage`, `networkLatency`, `loadAverage`, and `uptime`. CPU is a process sample clamped to 0–100; memory is host memory usage percentage; uptime is process seconds. Disk usage is currently a memory-based approximation, and network statistics include placeholder calculations. These are not per-node resource measurements when several nodes share a process.

Serve Prometheus data yourself, for example with Bun:

```typescript
import type { RaftNode } from "@usex/raft";

export function serveMetrics(node: RaftNode) {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 9464,
    async fetch(request) {
      if (new URL(request.url).pathname !== "/metrics")
        return new Response("Not found", { status: 404 });
      return new Response(await node.getPrometheusMetrics(), {
        headers: { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" },
      });
    },
  });
}
```

Stop the returned server during application shutdown. `RaftMetricsCollector` also exposes `updateMetrics(nodeId, clusterId, partialMetrics)`, `getMetrics(nodeId)`, `getAllMetrics()`, `getPrometheusMetrics()`, `getPrometheusRegister()`, `incrementCounter(name, labels)`, and `observeHistogram(name, labels, value)` for instrumentation. The latter two operate on registered metrics; they do not declare arbitrary new metrics.

`node.getLogger()` provides `debug`, `info`, `warn`, `error`, `fatal`, and `success` with `(message, context?, error?)`, plus presentation helpers `section(title)`, `step(number, description)`, `result(success, message)`, `metric(name, value, unit?)`, and `progress(current, total, description?)`. You can also construct `new RaftLogger(config.logging)`.

`SystemMetrics` exports static `getCpuUsage()`, `getMemoryUsage()`, `getDiskUsage(path?)`, `getLoadAverage()`, `getUptime()`, `getNetworkInterfaces()`, `getNetworkStats()`, `getAllMetrics()`, and `measureNetworkLatency(host, port?)`. The latency helper defaults to port 80, uses a five-second timeout, and returns `1000` on error/timeout. Treat disk/network approximations as diagnostic hints, not billing or SLA data.

## Weighted voting and adaptive consensus

For fixed weighted voting, set the same map on **every** member before startup:

```typescript
const voting = {
  enableWeighting: true,
  defaultWeight: 1,
  weightMetrics: [],
  weights: { "node-1": 2, "node-2": 1, "node-3": 1 },
};
```

Quorum requires more than half of the total voting weight. Use positive weights and a consistent membership/map. This does not establish Byzantine fault tolerance. Runtime changes to weights are not a supported membership procedure.

Adaptive consensus is an experimental suggestion/measurement component. It does not automatically apply returned timing parameters to `RaftNode`. Some input measurements are synthetic, and timeout bounds have known failures.

```typescript
import {
  createAdaptiveConsensusAlgorithm,
  type AdaptiveConsensusConfig,
  type RaftNode,
} from "@usex/raft";

export async function inspectAdaptation(node: RaftNode) {
  const config: AdaptiveConsensusConfig = {
    enabled: true,
    adaptationInterval: 30_000,
    latencyThreshold: 100,
    throughputThreshold: 100,
    learningRate: 0.1,
    minElectionTimeout: 150,
    maxElectionTimeout: 2000,
    minHeartbeatInterval: 50,
    maxHeartbeatInterval: 500,
    networkQualityWeight: 0.4,
    throughputWeight: 0.3,
    stabilityWeight: 0.3,
  };
  const algorithm = createAdaptiveConsensusAlgorithm(
    config,
    node.getLogger(),
    node.getMetricsCollector(),
    node.getConfiguration().electionTimeout,
    node.getConfiguration().heartbeatInterval,
  );
  try {
    await algorithm.forceAdaptation();
    return algorithm.getCurrentParameters();
  } finally {
    algorithm.stop();
  }
}
```

`AdaptiveParameters` is `{ electionTimeout: [number, number], heartbeatInterval, batchSize, replicationTimeout }`. The factory starts with batch size `10` and replication timeout `1000`. `new AdaptiveConsensusAlgorithm(config, logger, collector, initialParameters)` accepts all four initial values directly.

| Method                   | Result                                                                 |
| ------------------------ | ---------------------------------------------------------------------- |
| `start()` / `stop()`     | Schedule/cancel adaptation cycles; `start` is a no-op when disabled.   |
| `forceAdaptation()`      | `Promise<void>`; one cycle when enabled.                               |
| `getCurrentParameters()` | Current `AdaptiveParameters`.                                          |
| `getAdaptationStats()`   | `totalAdaptations`, `averagePerformanceScore`, and `parameterHistory`. |
| `resetLearningState()`   | Clears learned/history state.                                          |

`NetworkQualityMetrics` contains `averageLatency`, `packetLoss`, `throughput`, `jitter`; `ClusterPerformanceMetrics` contains `leaderElections`, `logReplicationLatency`, `consensusTime`, `failureRate`.

## Errors and troubleshooting

All exported Raft error classes derive from `RaftException`: `RaftConfigurationException`, `RaftElectionException`, `RaftNetworkException`, `RaftPeerDiscoveryException`, `RaftReplicationException`, `RaftStorageException`, `RaftTimeoutException`, and `RaftValidationException`.

| Symptom                                       | Action                                                                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `Only a running leader can append logs`       | Wait for election; route the write to the current running leader. There is no automatic client redirect.                        |
| Replication timeout / uncertain write outcome | Check quorum and connectivity, then inspect application state using your command ID before retrying.                            |
| No state change after a successful proposal   | Pass a real state machine to `createNode`; the default is a no-op.                                                              |
| Missing metrics                               | Wait for collection; verify metrics settings and that the node is running.                                                      |
| State disappears or an old cluster appears    | Check Redis TTL, prefix, node IDs and data directory. Changing a cluster ID alone does not isolate unprefixed persistence keys. |
| Permission error under `/var/lib/raft`        | Set `persistence.dataDir` to your application's writable per-node directory.                                                    |
| A stopped node still says `leader`            | Combine role with `isRunning()`; role alone is not liveness.                                                                    |

From this package, run `bun run test:unit`, `bun run test:types`, and `bun run lint`. `bun run test run` includes Redis integration tests and requires Docker; known adversarial failures remain in that suite. The [Observatory guide](./playground/README.md) explains interactive experiments and their HTTP/SSE API.

## License

[MIT](../../LICENCE) · [Ali Torki](https://github.com/ali-master)
