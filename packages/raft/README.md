<div align="center">
  <img src="../../assets/logo.svg" alt="Raft Quorum mark" width="88" height="88" />
  <h1>@usex/raft</h1>
  <p>The consensus engine behind the Raft toolkit.</p>
  <p><a href="../../README.md">Workspace</a> · <a href="./playground/README.md">Observatory</a> · <a href="../../docs/raft-spec-audit.md">Validation</a></p>
</div>

A TypeScript implementation of Raft with Redis transport and storage, pluggable state machines, snapshots, a write-ahead log, structured events, and metrics. Bun is the workspace runtime and toolchain; the package also exports ESM and CommonJS entry points for Node.js consumers.

**Status:** active development. The [spec audit](../../docs/raft-spec-audit.md) documents unresolved persistence, log-matching, membership, and snapshot failures. This implementation is not yet verified as Raft-conformant or safe for authoritative production data.

## Install

```bash
bun add @usex/raft ioredis opossum prom-client
```

The workspace requires Bun >= 1.4.3. Node.js consumers require >= 22.22.3. A reachable Redis instance is required. For source development, run `bun install --frozen-lockfile` and `bun run build` from the repository root.

## Quick start

This example starts a node and observes its lifecycle. Use a disposable Redis instance and a writable data directory:

```typescript
import { RaftEngine } from "@usex/raft";

const engine = new RaftEngine();
const config = RaftEngine.createDefaultConfiguration("node-1", "example");
config.redis = { ...config.redis, host: "127.0.0.1", port: 6379 };
config.persistence = { ...config.persistence, dataDir: "./data/node-1" };
config.voting = { ...config.voting, enableWeighting: false };

const node = await engine.createNode(config);
node.on("stateChange", ({ state, term }) => {
  console.log({ state, term });
});
node.on("raftEvent", (event) => console.log(event));

await engine.startNode("node-1");
// At application shutdown:
// await engine.stopAllNodes();
```

A node created without a state machine uses a no-op implementation. To maintain application data, implement [`StateMachine`](./src/types/state-machine.ts) and pass it as the second argument to `engine.createNode(config, stateMachine)`. The core invokes `apply(command)` after commitment; implement `getSnapshotData()` and `applySnapshot(data)` to preserve and restore application state. See the working [counter](./playground/src/state-machines/counter-state-machine.ts) and [key-value](./playground/src/state-machines/kv-state-machine.ts) examples.

The leader proposes commands with `await node.appendLog(command)`. `RaftNode` does not expose a `propose` method; the NestJS service provides that facade. An appended/replicated event is not evidence that application state has been applied.

## Capabilities

| Area          | Implementation                                                         |
| ------------- | ---------------------------------------------------------------------- |
| Elections     | Follower/candidate/leader states, pre-vote, election timeouts          |
| Replication   | AppendEntries, commit/application positions, state-machine application |
| Membership    | Joint configuration changes and leadership transfer                    |
| Storage       | Redis-backed state/logs, WAL, snapshots, recovery paths                |
| Networking    | Redis transport, peer discovery, retries, circuit breakers             |
| Observability | Structured `raftEvent` stream, state aliases, metrics                  |
| Extensions    | Static weighted quorums and adaptive-consensus components              |

Read the [audit](../../docs/raft-spec-audit.md) before relying on these mechanisms. Weighted voting requires a consistent positive weight map on every member; the [weighted-voting scenario](./playground/README.md#scenarios) explains its constraints.

## Core API

| Entry point                                                        | Purpose                                         |
| ------------------------------------------------------------------ | ----------------------------------------------- |
| `RaftEngine.createDefaultConfiguration(nodeId, clusterId)`         | Start with the library's configuration defaults |
| `engine.createNode(config, stateMachine?)`                         | Create and register a node                      |
| `engine.startNode(nodeId)` / `engine.stopAllNodes()`               | Manage node lifecycle                           |
| `engine.getNode(nodeId)` / `engine.getAllNodes()`                  | Access managed nodes                            |
| `node.appendLog(command)`                                          | Propose an application command on the leader    |
| `node.getState()` / `node.getLeaderId()` / `node.getCurrentTerm()` | Inspect local consensus state                   |
| `node.changeClusterConfiguration(members)`                         | Propose a membership change                     |
| `node.createSnapshot()`                                            | Request a snapshot                              |
| `node.getMetrics()`                                                | Read node metrics                               |

Configuration uses `redis`, `httpHost`, `httpPort`, `logging`, `network`, `voting`, and `persistence`. See the current [`RaftConfiguration`](./src/types/config.ts); earlier `storageAdapter`, `logger`, and `port` examples do not match this interface.

## Observatory and commands

From the repository root:

```bash
bun run build
bun run --cwd packages/raft/playground dashboard
```

The Bun dashboard visualizes real RPC traffic, replication, elections, failures, and recovery over SSE. Its command center adds read-only node reports and SHA-256 probes through application log entries, with destination receipts and per-node metrics. This is a playground state-machine extension, not a general-purpose remote execution API.

See [Raft Playground](./playground/README.md) for the configurable node count, 14 scenarios, CLI, metrics definitions, and command-delivery limits.

## Testing

From this directory:

```bash
bun run test run
bun run test:unit
bun run test:watch
bun run test:coverage
bun run test:types
bun run lint
```

Redis integration tests require Docker. Known failing regressions are retained in [`spec-compliance.spec.ts`](./test/integration/spec-compliance.spec.ts). Test commands are not a claim that all checks pass. Read the [testing guide](./docs/TESTING.md), [audit](../../docs/raft-spec-audit.md), and [playground report](../../docs/raft-playground-validation.md) for measured results.

## Documentation

- [Architecture](../../docs/architecture.md) and [state-machine interfaces](../../docs/interfaces-guide.md)
- [Configuration](../../docs/configuration.md) and [monitoring](../../docs/monitoring.md)
- [Adaptive consensus](./docs/adaptive-consensus.md)
- [Bun migration and compatibility](../../docs/bun-migration.md)
- [Brand assets](../../assets/BRAND_ASSETS.md)

## License

[MIT](../../LICENCE) · [Ali Torki](https://github.com/ali-master)
