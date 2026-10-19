<div align="center">
  <img src="./assets/social-preview.png" alt="Raft — Many nodes. One shared state. A TypeScript consensus toolkit." width="1280" />
  <h1>Raft</h1>
  <p>A TypeScript consensus toolkit, built and explored with Bun.</p>
  <p>
    <a href="#watch-the-observatory">Watch</a> ·
    <a href="#quick-start">Quick start</a> ·
    <a href="#packages">Packages</a> ·
    <a href="./packages/raft/playground/README.md">Observatory</a> ·
    <a href="./docs/raft-spec-audit.md">Validation</a> ·
    <a href="./assets/BRAND_ASSETS.md">Brand assets</a>
  </p>
</div>

Raft brings together a consensus engine, a NestJS integration, a key-value server, and tools for watching a cluster work. Explore leader election, replicated logs, snapshots, membership changes, and failure recovery through executable scenarios and a live dashboard.

**Status:** this workspace is under active development. The [Raft and package audit](./docs/raft-spec-audit.md) documents unresolved consensus, persistence, application-data, and API-contract failures. Passing demonstration scenarios do not establish Raft conformance or production safety. APIs may change before 1.0.

## Watch the Observatory

A one-minute, full-page tour of the live five-node dashboard: leadership transfer, committed commands, replicated logs, and per-node metrics. Smooth camera moves bring each detail into focus.

https://github.com/user-attachments/assets/c2b09429-cc3c-4879-89f8-ac24e7407cfc

**5 nodes · Live capture** · [Download the MP4](./assets/raft-observatory.mp4)

## Packages

| Package                                                                | Purpose                                                                                    | Start here                                                                   |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| [`@usex/raft`](./packages/raft/README.md)                              | Consensus engine, Redis transport/storage, state machines, snapshots, WAL, and metrics     | [Core API](./packages/raft/README.md#quick-start)                            |
| [`@usex/raft-nestjs`](./packages/nest/README.md)                       | NestJS modules, dependency injection, lifecycle, decorators, and a service facade          | [NestJS setup](./packages/nest/README.md#quick-start)                        |
| [`@usex/raft-kv-server`](./packages/kv-server/README.md)               | NestJS/Fastify key-value service with encryption and a Raft-backed write path              | [Run the server](./packages/kv-server/README.md#run-locally)                 |
| [`@usex/kv-server-sdk`](./packages/kv-server-sdk/README.md)            | Fetch client, types, and validators generated from the KV server's OpenAPI document        | [Generate the client](./packages/kv-server-sdk/README.md#generate-and-build) |
| [`@usex/raft-playground`](./packages/raft/playground/README.md)        | Bun observatory, command center, node metrics, CLI, and 14 scenarios                       | [Open the dashboard](./packages/raft/playground/README.md#raft-observatory)  |
| [`@usex/raft-nestjs-playground`](./packages/nest/playground/README.md) | Integration demonstrations for cache, tasks, locks, games, monitoring, and adaptive timing | [Explore the scenarios](./packages/nest/playground/README.md#scenarios)      |

## Quick start

Use **Bun 1.4.3 or later** and a disposable Redis instance. Run from the repository root:

```bash
bun install --frozen-lockfile
bun run build

REDIS_HOST=127.0.0.1 REDIS_PORT=6379 bun run --cwd packages/raft/playground dashboard
```

The **Raft Observatory** opens at `http://127.0.0.1:3210`. If the port is occupied, the server prints the selected address. Change `NODE_COUNT` in [`dashboard/main.ts`](./packages/raft/playground/src/dashboard/main.ts) to set the cluster size. Stop with `Ctrl+C` to clean up the playground cluster.

The dashboard runs on **Bun.serve**, React, Tailwind CSS, and locally owned shadcn/ui components. SSE carries the live cluster state and events.

- Watch real RPC traffic, elections, log replication, snapshots, and network partitions.
- Send a node report or SHA-256 probe from the leader to one node, all other nodes, or all members.
- Inspect per-node responses, execution timings, RPC rates, p50/p95 latency, errors, and replication lag.
- Stop nodes, transfer leadership, partition/heal the network, and compare state after recovery.
- Filter, pause, inspect, and export the event feed.

The command center executes selected probes after log commitment. Its receipts and history are local session telemetry; it is not a durable distributed job queue. CPU and memory measurements describe the shared Bun process. See the [playground README](./packages/raft/playground/README.md#command-semantics) for exact semantics.

To use the core library in an application:

```bash
bun add @usex/raft
```

Follow the [core package guide](./packages/raft/README.md) to configure a node and implement a state machine.

## What is implemented

The core contains leader election and pre-vote, log replication, membership changes, leadership transfer, snapshots, Redis-backed state, a write-ahead log, circuit breakers, structured events, and metrics. Weighted voting and adaptive timing extend the implementation and have separate constraints; they are not features of the base Raft protocol.

The [audit](./docs/raft-spec-audit.md) distinguishes implemented code, passing checks, and remaining correctness defects. For legacy Redis data, follow the [prefix migration notes](./packages/kv-server/README.md#redis-prefix-migration) before changing storage configuration.

## Development

```bash
bun run build
bun run test:types
bun run lint
bun run test
bun run test:coverage
```

Docker is required for Redis integration fixtures. The root test command stops at the first failing package; run a package directly to investigate its results:

```bash
bun run --cwd packages/raft test run
bun run --cwd packages/nest test run
bun run --cwd packages/kv-server test run
bun run --cwd packages/nest/playground test
bun run --cwd packages/raft/playground test:dashboard
bun run --cwd packages/raft/playground test:commands
```

The SDK needs generation before its build produces a client; its standalone test command currently permits zero tests. See its [README](./packages/kv-server-sdk/README.md).

## Documentation

| Topic                         | Guide                                                                                                                                                                              |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Installation and toolchain    | [Installation](./docs/installation.md) · [Bun migration](./docs/bun-migration.md)                                                                                                  |
| Engine and state machines     | [Architecture](./docs/architecture.md) · [Interfaces](./docs/interfaces-guide.md) · [Configuration](./docs/configuration.md)                                                       |
| Executable examples           | [Raft playground](./packages/raft/playground/README.md) · [NestJS playground](./packages/nest/playground/README.md)                                                                |
| Validation and known failures | [Raft spec audit](./docs/raft-spec-audit.md) · [Playground validation](./docs/raft-playground-validation.md) · [Command center validation](./docs/dashboard-command-validation.md) |
| Operations                    | [Monitoring](./docs/monitoring.md) · [Deployment](./docs/deployment.md) · [Troubleshooting](./docs/troubleshooting.md)                                                             |
| Visual identity               | [Logo, social preview, and usage](./assets/BRAND_ASSETS.md)                                                                                                                        |

## Contributing

Start with the affected package's README and existing tests. Include a reproducible case for changes to elections, persistence, membership, snapshots, or application data. Report issues and proposed changes in [GitHub Issues](https://github.com/ali-master/raft/issues).

## License

[MIT](./LICENCE) · [Ali Torki](https://github.com/ali-master)
