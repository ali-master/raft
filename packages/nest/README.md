<div align="center">
  <img src="../../assets/logo.svg" alt="Raft Quorum mark" width="88" height="88" />
  <h1>@usex/raft-nestjs</h1>
  <p>Raft, integrated into the NestJS application lifecycle.</p>
  <p><a href="../../README.md">Workspace</a> · <a href="./playground/README.md">NestJS playground</a> · <a href="../raft/playground/README.md">Observatory</a></p>
</div>

NestJS modules, providers, injection tokens, decorators, and a service facade around [`@usex/raft`](../raft/README.md). Configuration supports synchronous options and asynchronous factories. The module starts the default node during application bootstrap and stops that node on shutdown. Applications that create additional nodes must manage their cleanup.

**Status:** the [workspace audit](../../docs/raft-spec-audit.md#nest-and-application-data) records unresolved event-delivery, state-machine, and adaptive-timing defects. A successful proposal does not establish that a playground cache, task, lock, or game was correctly updated. These integrations are under development.

## Install

In an existing NestJS application:

```bash
bun add @usex/raft-nestjs @usex/raft
```

Use the NestJS 12 peer dependencies listed in [`package.json`](./package.json), including `@nestjs/config`, `@nestjs/event-emitter`, `reflect-metadata`, and `rxjs`. The workspace uses Bun >= 1.4.3. A reachable Redis instance is required.

## Quick start

Use defaults as a base when overriding nested configuration. The module merges top-level options; it does not deep-merge nested objects.

```typescript
import { Module } from "@nestjs/common";
import { RaftEngine } from "@usex/raft";
import { RaftModule } from "@usex/raft-nestjs";

const defaults = RaftEngine.createDefaultConfiguration(
  "node-1",
  "nest-example",
);

@Module({
  imports: [
    RaftModule.forRoot({
      ...defaults,
      isGlobal: true,
      redis: { ...defaults.redis, host: "127.0.0.1", port: 6379 },
      voting: { ...defaults.voting, enableWeighting: false },
      persistence: { ...defaults.persistence, dataDir: "./data/node-1" },
    }),
  ],
})
export class AppModule {}
```

Enable Nest shutdown hooks in the application bootstrap so termination signals reach module cleanup:

```typescript
app.enableShutdownHooks();
```

Inspect the node from an injected service:

```typescript
import { Injectable } from "@nestjs/common";
import { RaftService } from "@usex/raft-nestjs";

@Injectable()
export class ClusterStatusService {
  constructor(private readonly raft: RaftService) {}

  status() {
    return {
      state: this.raft.getState(),
      leaderId: this.raft.getLeaderId(),
      term: this.raft.getCurrentTerm(),
      isLeader: this.raft.isLeader(),
    };
  }
}
```

The default node provider creates the core's no-op state machine. Application state needs an explicit committed-log apply and snapshot/replay implementation. Event decorators alone do not supply that storage layer; see the [audit](../../docs/raft-spec-audit.md#nest-and-application-data) before using them to mutate application data.

## Configuration and services

| API                                                     | Purpose                                                                             |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `RaftModule.forRoot(options)`                           | Configure the module directly                                                       |
| `RaftModule.forRootAsync(options)`                      | Configure with `useFactory`, `useClass`, or `useExisting` and injected dependencies |
| `RaftService.getNode(nodeId?)`                          | Access the default node or a managed node                                           |
| `getState`, `getLeaderId`, `getCurrentTerm`, `isLeader` | Inspect local consensus state                                                       |
| `propose(value, nodeId?)`                               | Delegate a proposal to the node's `appendLog`                                       |
| `getMetrics(nodeId?)`                                   | Access the node's metrics                                                           |
| `getAllNodes()` / `getClusterNodes()`                   | Inspect nodes managed by this process                                               |
| `addPeer` / `removePeer`                                | Propose configuration changes through the service facade                            |

Managed nodes are not a complete remote-cluster inventory. A process normally manages its own node; use peer and protocol state when interpreting remote membership.

Available injection tokens include `RAFT_ENGINE`, `RAFT_NODE`, `RAFT_EVENT_BUS`, and `RAFT_MODULE_OPTIONS`. See the [module](./src/modules/raft.module.ts), [options](./src/interfaces/index.ts), [service](./src/services/raft.service.ts), and [decorators](./src/decorators/) for current signatures.

The package also exposes `AdaptiveConsensusService`. Bounds enforcement, parameter application, configuration import, and synthetic measurements have open findings in the audit; returned suggestions are not proof that a running node changed its timing.

## Playgrounds

- [NestJS playground](./playground/README.md): cache, tasks, locks, games, monitoring, and adaptive-consensus demonstrations with data-integrity regressions.
- [Raft Observatory](../raft/playground/README.md): Bun/React dashboard with real RPC traffic, SSE, leader-dispatched probes, and per-node metrics. This is the live web dashboard for the workspace.

From the repository root:

```bash
bun install --frozen-lockfile
bun run build
bun run --cwd packages/raft/playground dashboard
```

## Testing

From this directory:

```bash
bun run test run
bun run test:unit
bun run test:coverage
bun run test:types
bun run lint

# Exercise actual application data and event integration:
bun run --cwd playground test
```

Docker is required for Redis integration fixtures. The facade/DI tests and playground integrity tests cover different layers; consult the [audit](../../docs/raft-spec-audit.md) for their separate results and known failures.

## Documentation

- [Core engine and state machines](../raft/README.md)
- [Workspace architecture](../../docs/architecture.md)
- [Bun migration](../../docs/bun-migration.md)
- [Brand assets](../../assets/BRAND_ASSETS.md)

## License

[MIT](../../LICENCE) · [Ali Torki](https://github.com/ali-master)
