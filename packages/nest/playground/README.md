<div align="center">
  <img src="../../../assets/logo.svg" alt="Raft Quorum mark" width="88" height="88" />
  <h1>Raft · NestJS Playground</h1>
  <p>Explore application patterns around distributed consensus.</p>
  <p><a href="../../../README.md">Workspace</a> · <a href="../README.md">NestJS integration</a> · <a href="../../raft/playground/README.md">Live Observatory</a></p>
</div>

The `@usex/raft-nestjs-playground` workspace demonstrates cache, queue, lock, game, and monitoring services in a NestJS application. Adaptive-consensus examples also live in this package. These are integration experiments, not verified distributed application primitives.

**Status:** the [data-integrity audit](../../../docs/raft-spec-audit.md#nest-and-application-data) reproduces failures in decorated event delivery, application state, replay, monitoring, and adaptive settings. A successful HTTP request or proposal does not prove that a task, lock, cache entry, or game was correctly replicated.

## Run

From the repository root, with Bun >= 1.4.3 and disposable Redis:

```bash
bun install --frozen-lockfile
bun run build
cd packages/nest/playground

REDIS_HOST=127.0.0.1 REDIS_PORT=6379 NODE_ID=node-1 HTTP_PORT=3001 bun run start:dev
```

Open Swagger at `http://localhost:3001/api`. `HTTP_PORT` controls the application port. Set `CLUSTER_ID` to isolate a cluster and `RAFT_DATA_DIR` to give each process a separate persistence directory.

For the configured three-process example:

```bash
bun run start:cluster
```

The node scripts use HTTP ports 3001, 3002, and 3003. Review your Redis and storage configuration before starting multiple processes.

## Scenarios

| Scenario           | Source                                                      | Scope                                                                      |
| ------------------ | ----------------------------------------------------------- | -------------------------------------------------------------------------- |
| Cache              | [`distributed-cache`](./src/scenarios/distributed-cache/)   | Set/get/delete and TTL behavior                                            |
| Task queue         | [`task-queue`](./src/scenarios/task-queue/)                 | Tasks, priorities, assignments, and results                                |
| Lock service       | [`lock-service`](./src/scenarios/lock-service/)             | Ownership and expiration experiments                                       |
| Game server        | [`game-server`](./src/scenarios/game-server/)               | Games, players, state, and WebSocket events                                |
| Monitoring         | [`monitoring`](./src/scenarios/monitoring/)                 | Health and metrics demonstrations                                          |
| Adaptive consensus | [`adaptive-consensus`](./src/scenarios/adaptive-consensus/) | Timing/load experiments; module is not imported by the default application |

Some monitoring values are placeholders or synthetic, as detailed in the audit. For actual RPC measurements, node charts, SSE, and leader-to-node probes, use the separate [Raft Observatory](../../raft/playground/README.md):

```bash
# From the repository root:
bun run --cwd packages/raft/playground dashboard
```

The legacy `start:dashboard` and `start:cli` scripts refer to entry files that are not present. The Observatory above is the maintained web entry point.

## Tests

```bash
# From this package; requires Docker for the Redis integration fixture.
bun run test
```

[`test/data-integrity.spec.ts`](./test/data-integrity.spec.ts) boots actual services and verifies their data after real proposals. It retains the failing cases described in the [audit](../../../docs/raft-spec-audit.md); it does not replace failures with skips.

The scripts under [`scripts/`](./scripts/) are additional manual scenario helpers. Consult their commands and ports before running them against a local cluster.

## Documentation

- [NestJS package](../README.md)
- [Raft engine](../../raft/README.md) and [Observatory](../../raft/playground/README.md)
- [Workspace validation](../../../docs/raft-spec-audit.md)
- [Brand assets](../../../assets/BRAND_ASSETS.md)

## License

[MIT](../../../LICENCE) · [Ali Torki](https://github.com/ali-master)
