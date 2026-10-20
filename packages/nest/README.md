<div align="center">
  <img src="../../assets/logo.svg" alt="Raft Quorum mark" width="88" height="88" />
  <h1>@usex/raft-nestjs</h1>
  <p>Configure Raft, inject nodes, and observe consensus from NestJS.</p>
  <p><a href="../../README.md">Workspace</a> · <a href="./playground/README.md">NestJS playground</a> · <a href="../raft/README.md">Core engine</a></p>
</div>

This package provides `RaftModule`, `RaftService`, injection decorators, event-decorator metadata, and an experimental `AdaptiveConsensusService`. `RaftModule` creates one default node, starts it during application bootstrap, and stops it during application shutdown.

**Current limits:** the default node uses a no-op state machine, and automatic event-decorator delivery has an unresolved mismatch with the core event channel. This guide shows working direct subscriptions and explicit state-machine wiring as well as the decorator reference. A committed proposal alone does not prove your application data changed. Core persistence/membership and adaptive-timing limitations also apply.

## Contents

- [Install and run](#install-and-run)
- [Module configuration](#module-configuration)
- [RaftService API](#raftservice-api)
- [Injection decorators and tokens](#injection-decorators-and-tokens)
- [Events and decorators](#events-and-decorators)

## Install and run

In a NestJS application using Bun >= 1.4.3:

```bash
bun add @usex/raft-nestjs @usex/raft \
  @nestjs/common@^12.1.3 @nestjs/core@^12.1.3 \
  @nestjs/config@^12.0.1 @nestjs/event-emitter@^12.0.1 \
  reflect-metadata@^0.2.2 rxjs@^7.8.2
```

The package also declares Node.js >= 22.22.3 compatibility. Use legacy TypeScript decorators in your application configuration:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true
  }
}
```

Bun's direct TypeScript execution does not replace Nest's metadata-emitting compilation workflow. The examples use explicit injection decorators where needed; for ordinary type-inferred constructor injection, compile with the application's Nest/TypeScript build and run the JavaScript with Bun.

For workspace development, run these from the repository root:

```bash
bun install --frozen-lockfile
bun run --cwd packages/raft build
bun run --cwd packages/nest build
```

Start disposable Redis in a separate terminal:

```bash
docker run --rm --name raft-redis -p 127.0.0.1:6389:6379 redis:7-alpine
```

Save this complete example as `main.ts`. It starts one node, waits for election, submits a diagnostic command, prints local consensus positions, and closes the Nest context:

```typescript
import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { RaftEngine, type RaftEvent } from "@usex/raft";
import { RaftModule, RaftService } from "@usex/raft-nestjs";

const defaults = RaftEngine.createDefaultConfiguration("node-1", "nest-readme");

@Module({
  imports: [
    RaftModule.forRoot({
      ...defaults,
      isGlobal: true,
      redis: {
        ...defaults.redis,
        host: process.env.REDIS_HOST ?? "127.0.0.1",
        port: Number(process.env.REDIS_PORT ?? 6389),
        keyPrefix: "raft:nest-readme:",
      },
      voting: { ...defaults.voting, enableWeighting: false },
      persistence: {
        ...defaults.persistence,
        dataDir: "./data/nest-readme/node-1",
      },
    }),
  ],
})
class AppModule {}

const app = await NestFactory.createApplicationContext(AppModule);
app.enableShutdownHooks();
try {
  const raft = app.get(RaftService);
  const node = raft.getNode()!;
  const onEvent = (event: RaftEvent) => console.log(event.type, event.data);
  node.on("raftEvent", onEvent);

  const deadline = Date.now() + 10_000;
  while (!raft.isLeader()) {
    if (Date.now() >= deadline) throw new Error("Leader election timed out");
    await Bun.sleep(50);
  }
  await raft.propose({ type: "diagnostic", message: "Hello from Nest" });
  console.log({
    leader: raft.getLeaderId(),
    commitIndex: node.getCommitIndex(),
  });
  node.off("raftEvent", onEvent);
} finally {
  await app.close();
}
```

```bash
REDIS_PORT=6389 bun main.ts
```

This example demonstrates consensus only. To store application data, use the state-machine example below. For an HTTP Nest app, call `app.enableShutdownHooks()` after `NestFactory.create(...)`; the module hooks perform cleanup when that app closes.

## Module configuration

### `RaftModule.forRoot(options)`

Returns a Nest `DynamicModule`. `RaftModuleOptions` requires `nodeId` and `clusterId`, accepts `isGlobal?: boolean`, and otherwise extends `Partial<RaftConfiguration>`.

The module applies core defaults and then **shallow-merges** options. Supplying `redis`, `network`, `voting`, or `persistence` replaces that entire nested object. Start with `RaftEngine.createDefaultConfiguration(nodeId, clusterId)` and spread each nested object when overriding a field.

| Option                                 | Default / purpose                                                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `nodeId`, `clusterId`                  | Required stable identities.                                                                                                                                  |
| `isGlobal`                             | Unset/false; otherwise exported providers are visible across the application.                                                                                |
| `httpHost`, `httpPort`                 | `localhost`, `3000`; advertised endpoint, not an HTTP server.                                                                                                |
| `peers`                                | Optional complete initial voting membership, including the local node itself.                                                                                |
| `electionTimeout`, `heartbeatInterval` | `[300, 500]`, `150`, in milliseconds.                                                                                                                        |
| `redis`                                | Host/port/password/db from `REDIS_*`; defaults `localhost:6379`, DB `0`. Optional `keyPrefix`, `ttl` (seconds). Use an explicit prefix for new applications. |
| `voting`                               | `enableWeighting: true`, `defaultWeight: 1`, `weightMetrics`; optional fixed `weights` map. Set `enableWeighting: false` for ordinary majority voting.       |
| `persistence`                          | Snapshots and WAL enabled, data directory `/var/lib/raft`, snapshot interval `300000` ms, WAL limit `104857600` bytes. Override the directory per node.      |
| `network`                              | `requestTimeout: 5000`, `maxRetries: 3`, `retryDelay: 100`, breaker threshold `5`, breaker timeout `30000` ms.                                               |
| `metrics`                              | Internal/Prometheus enabled; collection every `5000` ms.                                                                                                     |
| `logging`                              | `level: LogLevel.INFO`, structured logging, password/token/secret redaction.                                                                                 |
| `maxLogEntries`, `snapshotThreshold`   | `10000`, `1000`.                                                                                                                                             |
| `peerDiscovery`                        | `registrationInterval: 5000`, `healthCheckInterval: 10000`, `peerTimeout: 30000`, in milliseconds.                                                           |
| `retry`                                | `maxAttempts: 3`, `backoffFactor: 2`, `initialDelay: 100` ms.                                                                                                |
| `circuitBreaker`                       | `timeout: 3000` ms, `errorThresholdPercentage: 50`, `resetTimeout: 30000` ms.                                                                                |
| `adaptiveConsensus`                    | Optional complete adaptive configuration; disabled by default. See its reference below.                                                                      |

Membership, Redis state/log expiry, and WAL/snapshot limitations are inherited from the core. Redis namespace changes do not migrate existing data. Preserve an explicitly empty prefix when recovering a legacy unprefixed installation.

### `RaftModule.forRootAsync(options)`

Use exactly one of `useFactory`, `useClass`, or `useExisting`. `imports` makes dependencies available to the options provider; `inject` supplies arguments to `useFactory`. Set `isGlobal` on the outer async options.

```typescript
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { RaftEngine } from "@usex/raft";
import { RaftModule } from "@usex/raft-nestjs";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    RaftModule.forRootAsync({
      isGlobal: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (env: ConfigService) => {
        const nodeId = env.get<string>("NODE_ID", "node-1");
        const config = RaftEngine.createDefaultConfiguration(
          nodeId,
          "async-example",
        );
        return {
          ...config,
          redis: {
            ...config.redis,
            port: Number(env.get("REDIS_PORT", 6389)),
            keyPrefix: "raft:async-example:",
          },
          voting: { ...config.voting, enableWeighting: false },
          persistence: {
            ...config.persistence,
            dataDir: `./data/async-example/${nodeId}`,
          },
        };
      },
    }),
  ],
})
export class AsyncAppModule {}
```

For a class-based factory, implement `RaftOptionsFactory.createRaftOptions(): RaftModuleOptions | Promise<RaftModuleOptions>`. `useClass: YourFactory` creates a provider instance; `useExisting: YourFactory` reuses one exported by an imported module. Returned values must still include `nodeId` and `clusterId`. Async configuration errors reject application startup.

## RaftService API

Inject with `@Inject(RaftService)` when running uncompiled TypeScript in Bun, or normal constructor injection after a metadata-emitting build. An optional `nodeId` selects a node managed by the local `RaftEngine`; omitting it selects the module's default node.

| Method                                                             | Returns / behavior                                                                                   |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `getNode(nodeId?)`                                                 | `RaftNode \| undefined`                                                                              |
| `getState(nodeId?)`                                                | `RaftState \| undefined`                                                                             |
| `isLeader(nodeId?)`, `isFollower(nodeId?)`, `isCandidate(nodeId?)` | `boolean`; false for an unknown ID. Combine with `getNode()?.isRunning()` for liveness.              |
| `getLeaderId(nodeId?)`                                             | `string \| null`                                                                                     |
| `getCurrentTerm(nodeId?)`                                          | Number; `0` for unknown ID.                                                                          |
| `getPeers(nodeId?)`                                                | Voting member IDs, including self; `[]` for unknown ID.                                              |
| `getAllNodes()`                                                    | Array of locally managed nodes.                                                                      |
| `getClusterNodes()`                                                | Array of `{ nodeId, state, term, isLeader, peers }` for local nodes.                                 |
| `propose(value, nodeId?)`                                          | `Promise<void>`; delegates to `appendLog`, running leader only. Does not forward to a remote leader. |
| `getMetrics(nodeId?)`                                              | Metrics object or `undefined`; sampled, not a fresh read barrier.                                    |
| `addPeer(peerId, nodeId?)`                                         | `Promise<void>`; proposes membership including that ID. Does not create/start a remote process.      |
| `removePeer(peerId, nodeId?)`                                      | `Promise<void>`; proposes removal. Rejects removing the selected node itself.                        |
| `forceElection(nodeId?)`                                           | `Promise<void>`; requests an election.                                                               |
| `createSnapshot(nodeId?)`                                          | `Promise<void>`; delegates to core snapshot creation.                                                |

Mutating operations throw `Node <id> not found` for an unknown local ID. Core errors propagate, including non-leader, replication and storage errors. There is no service-level automatic retry or HTTP error mapping. Timeout means an uncertain outcome, not proof that a command was cancelled.

Access additional APIs through `getNode()`, for example `transferLeadership(peerId)`, `getCommitIndex()`, `getLastApplied()`, and `getPrometheusMetrics()`. Stop additional nodes you create yourself; `RaftModule` stops only its default node.

## Injection decorators and tokens

```typescript
import { Injectable } from "@nestjs/common";
import { RaftEngine, RaftNode as CoreNode } from "@usex/raft";
import {
  InjectRaftEngine,
  InjectRaftNode,
  InjectRaftEventBus,
} from "@usex/raft-nestjs";

@Injectable()
export class ClusterAccess {
  constructor(
    @InjectRaftEngine() readonly engine: RaftEngine,
    @InjectRaftNode() readonly node: CoreNode,
    @InjectRaftEventBus() readonly events: CoreNode,
  ) {}
}
```

Register `ClusterAccess` in your module's `providers`, with `RaftModule` imported or global.

| Decorator / token                          | What it injects or declares                                                                                                                                          |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@InjectRaftEngine()` / `RAFT_ENGINE`      | Local `RaftEngine`.                                                                                                                                                  |
| `@InjectRaftNode()` / `RAFT_NODE`          | Default core `RaftNode`.                                                                                                                                             |
| `@InjectRaftNode("worker")`                | `Symbol.for("RAFT_NODE_worker")`; requires a provider you explicitly register for that token. Creating a node in the engine alone does not register a Nest provider. |
| `@InjectRaftEventBus()` / `RAFT_EVENT_BUS` | Default node's EventEmitter, not Nest's `EventEmitter2`.                                                                                                             |
| `@Inject(RAFT_MODULE_OPTIONS)`             | Supplied module options.                                                                                                                                             |
| `@RaftNode(nodeId?)`                       | Class metadata plus `@Injectable()`. Register the class in `providers`; it does not create/start a node, inject a property, or bind its events to the named node.    |

At this package's root, **`RaftNode` is the class decorator**. The core node class is re-exported as `RaftNodeClass`; alternatively import `RaftNode` from `@usex/raft` under an alias, as above.

For a named node, register `{ provide: Symbol.for("RAFT_NODE_worker"), useFactory: ..., inject: [RAFT_ENGINE] }`. The factory should return the node created by `engine.createNode(...)`. Your application must start/stop it and give it separate IDs/storage. Internal provider factories are not root exports.

## Events and decorators

### Working direct subscription

Subscribe before application bootstrap to include election/startup observations, and unsubscribe during shutdown:

```typescript
import {
  Injectable,
  type OnModuleInit,
  type OnModuleDestroy,
} from "@nestjs/common";
import { RaftEventType, type RaftEvent, type RaftNode } from "@usex/raft";
import { InjectRaftNode } from "@usex/raft-nestjs";

@Injectable()
export class ConsensusObserver implements OnModuleInit, OnModuleDestroy {
  constructor(@InjectRaftNode() private readonly node: RaftNode) {}

  private readonly listener = (event: RaftEvent) => {
    if (event.type === RaftEventType.LOG_APPLIED) {
      console.log("Applied locally:", event.nodeId, event.data);
    }
  };

  onModuleInit() {
    this.node.on("raftEvent", this.listener);
  }
  onModuleDestroy() {
    this.node.off("raftEvent", this.listener);
  }
}
```

Add `ConsensusObserver` to `providers`. `RaftEvent` contains `{ type, nodeId, timestamp: Date, data }`. Payloads differ by event. Use a state machine for application updates; an observer is for telemetry.

### Event decorator syntax and current behavior

```typescript
import type { RaftEvent as CoreEvent } from "@usex/raft";
import {
  RaftNode,
  RaftEvent,
  RaftEventType,
  OnLeaderElected,
} from "@usex/raft-nestjs";

@RaftNode()
export class DeclarativeObserver {
  @OnLeaderElected()
  onLeader(event: CoreEvent) {
    console.log(event.nodeId, event.data);
  }

  @RaftEvent(RaftEventType.LOG_APPLIED)
  onApplied(event: CoreEvent) {
    console.log(event.data);
  }
}
```

This is valid decorator syntax, **not a working automatic event subscription in this release**. The automatic handler provider subscribes to enum-named channels (`leader_elected`, etc.), whereas the core emits structured events on `raftEvent` and selected camel-case aliases. Use `ConsensusObserver` above for reliable observation until that integration is repaired. Register decorated classes in `providers`; decorators alone do not instantiate them.

`@RaftEvent(type)` stores metadata for the decorated method. Every convenience decorator below takes **no arguments** and selects the listed `RaftEventType` member:

| Decorator                                                            | Event                                                                    |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `OnStateChange`                                                      | `STATE_CHANGE`                                                           |
| `OnLeaderElected`                                                    | `LEADER_ELECTED`                                                         |
| `OnVoteGranted` / `OnVoteDenied`                                     | `VOTE_GRANTED` / `VOTE_DENIED`                                           |
| `OnLogReplicated`                                                    | `LOG_REPLICATED`                                                         |
| `OnLogCommitted`                                                     | **`LOG_REPLICATED`**, an append-time event, not a commit/apply guarantee |
| `OnHeartbeatReceived` / `OnElectionTimeout`                          | `HEARTBEAT_RECEIVED` / `ELECTION_TIMEOUT`                                |
| `OnConfigurationChanged`                                             | `CONFIGURATION_CHANGED`                                                  |
| `OnSnapshotCreated`                                                  | `SNAPSHOT_CREATED`                                                       |
| `OnErrorOccurred` / `OnRaftError`                                    | `ERROR_OCCURRED`                                                         |
| `OnMetricsUpdated` / `OnMetricsCollected`                            | `METRICS_UPDATED` / `METRICS_COLLECTED`                                  |
| `OnPeerDiscovered` / `OnPeerLost`                                    | `PEER_DISCOVERED` / `PEER_LOST`                                          |
| `OnInstallSnapshot` / `OnInstallSnapshotResponse`                    | `INSTALL_SNAPSHOT` / `INSTALL_SNAPSHOT_RESPONSE`                         |
| `OnAppendEntries` / `OnAppendEntriesResponse`                        | `APPEND_ENTRIES` / `APPEND_ENTRIES_RESPONSE`                             |
| `OnVoteRequest` / `OnVoteResponse`                                   | `VOTE_REQUEST` / `VOTE_RESPONSE`                                         |
| `OnHeartbeat` / `OnHeartbeatResponse`                                | `HEARTBEAT` / `HEARTBEAT_RESPONSE`                                       |
| `OnConfigurationRequest` / `OnConfigurationResponse`                 | `CONFIGURATION_REQUEST` / `CONFIGURATION_RESPONSE`                       |
| `OnReplicationFailure` / `OnReplicationSuccess`                      | `REPLICATION_FAILURE` / `REPLICATION_SUCCESS`                            |
| `OnSnapshotRequest` / `OnSnapshotResponse`                           | `SNAPSHOT_REQUEST` / `SNAPSHOT_RESPONSE`                                 |
| `OnLogCompacted` / `OnLogTruncated`                                  | `LOG_COMPACTED` / `LOG_TRUNCATED`                                        |
| `OnNodeJoined` / `OnNodeLeft`                                        | `NODE_JOINED` / `NODE_LEFT`                                              |
| `OnHeartbeatTimeout` / `OnConfigurationUpdate`                       | `HEARTBEAT_TIMEOUT` / `CONFIGURATION_UPDATE`                             |
| `OnElectionStarted` / `OnElectionEnded`                              | `ELECTION_STARTED` / `ELECTION_ENDED`                                    |
| `OnReplicationStarted` / `OnReplicationEnded`                        | `REPLICATION_STARTED` / `REPLICATION_ENDED`                              |
| `OnSnapshotStarted` / `OnSnapshotEnded`                              | `SNAPSHOT_STARTED` / `SNAPSHOT_ENDED`                                    |
| `OnInstallSnapshotStarted` / `OnInstallSnapshotEnded`                | `INSTALL_SNAPSHOT_STARTED` / `INSTALL_SNAPSHOT_ENDED`                    |
| `OnInstallSnapshotFailed` / `OnInstallSnapshotSuccess`               | `INSTALL_SNAPSHOT_FAILED` / `INSTALL_SNAPSHOT_SUCCESS`                   |
| `OnVoteRequestReceived` / `OnVoteResponseReceived`                   | `VOTE_REQUEST_RECEIVED` / `VOTE_RESPONSE_RECEIVED`                       |
| `OnAppendEntriesReceived` / `OnAppendEntriesResponseReceived`        | `APPEND_ENTRIES_RECEIVED` / `APPEND_ENTRIES_RESPONSE_RECEIVED`           |
| `OnConfigurationRequestReceived` / `OnConfigurationResponseReceived` | `CONFIGURATION_REQUEST_RECEIVED` / `CONFIGURATION_RESPONSE_RECEIVED`     |
| `OnSnapshotRequestReceived`                                          | `SNAPSHOT_REQUEST_RECEIVED`                                              |

There is no `OnLogApplied` convenience export; use `RaftEvent(RaftEventType.LOG_APPLIED)` for metadata or the direct subscription above. Not every enum category is emitted on every path.

Advanced metadata exports are `RAFT_EVENT_METADATA`, `RAFT_METADATA`, `RaftEventHandlerMetadata`, `RaftNodeMetadata`, and `RaftEventHandler`. `new RaftEventScanner(discoveryService).scanForEventHandlers()` returns registered handler metadata, not bound listeners. `createRaftEventHandler(eventType, handler)` creates a method decorator; its `handler` argument is currently ignored and the decorated method is recorded instead. Neither helper repairs automatic delivery.

## License

[MIT](../../LICENCE) · [Ali Torki](https://github.com/ali-master)
