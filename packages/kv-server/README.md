<div align="center">
  <img src="../../assets/kv-server-logo.svg" alt="Raft Quorum mark" width="88" height="88" />
  <h1>@usex/raft-kv-server</h1>
  <p>A key-value service built on the Raft toolkit.</p>
  <p><a href="../../README.md">Workspace</a> · <a href="../kv-server-sdk/README.md">SDK</a> · <a href="./docs/architecture.md">Architecture</a></p>
</div>

A NestJS/Fastify application with CQRS handlers, a Raft-backed write path, Redis storage, value encryption, health endpoints, and OpenAPI documentation. The application and development commands run with Bun.

**Status:** experimental. The [data-integrity audit](../../docs/raft-spec-audit.md) records unresolved application-key isolation, snapshot, health-check, read-consistency, and OpenAPI/SDK defects, in addition to core consensus issues. Use an isolated Redis database and disposable data while evaluating it. Local reads do not have a verified quorum read barrier.

## Run locally

From the repository root, with Bun >= 1.4.3:

```bash
bun install --frozen-lockfile
bun run build
cd packages/kv-server
cp .env.example .env
```

Set a private `ENCRYPTION_KEY`, point Redis configuration at a disposable instance, and use a separate `RAFT_DATA_DIR` for each node. Keep the same encryption key for members of the same cluster.

```bash
bun run start:dev
# Or use the compiled application:
bun run start:prod
```

Defaults are HTTP port `3000`, Redis port `6379`, and Redis database `1`. See [`.env.example`](./.env.example) for configuration names. For container examples, see [installation](./docs/installation.md), [self-hosting](./docs/self-hosted.md), and [`docker-compose.cluster.yml`](./docker-compose.cluster.yml).

## API

| Method   | Route                                              | Current controller result                                   |
| -------- | -------------------------------------------------- | ----------------------------------------------------------- |
| `POST`   | `/kv/:key`                                         | Set a string from `{ "value": "..." }`; no response payload |
| `GET`    | `/kv/:key`                                         | String value or an empty result for a missing key           |
| `DELETE` | `/kv/:key`                                         | Delete a key; no response payload                           |
| `GET`    | `/kv`                                              | Array of key strings                                        |
| `GET`    | `/raft/status`                                     | `nodeId`, `state`, `isLeader`, and `metrics`                |
| `GET`    | `/raft/leader`                                     | `{ "isLeader": boolean }`                                   |
| `GET`    | `/raft/metrics`                                    | Node metrics                                                |
| `GET`    | `/health`, `/health/liveness`, `/health/readiness` | Health checks with distinct scopes                          |

Send writes to the current leader. Check HTTP status before interpreting the response. The current controller returns values directly; it does not wrap reads in `{ key, value, encrypted }` or lists in `{ keys, total }`.

```bash
curl http://localhost:3000/raft/leader

curl -i -X POST http://localhost:3000/kv/example \
  -H 'Content-Type: application/json' \
  -d '{"value":"hello"}'

curl http://localhost:3000/kv/example
curl http://localhost:3000/kv
```

A KV set/delete pair is not a compare-and-set lock and must not be treated as one.

- Swagger UI: `http://localhost:3000/api`
- OpenAPI JSON: `http://localhost:3000/api/docs/openapi.json`
- Client generation: [KV SDK](../kv-server-sdk/README.md)

The current OpenAPI document lacks schemas for parts of the runtime contract. Generated validators can reject a valid write before it reaches the server. See the audit and [`data-contract.spec.ts`](./test/integration/data-contract.spec.ts).

## Configuration

| Variable                                                            | Purpose                                           |
| ------------------------------------------------------------------- | ------------------------------------------------- |
| `PORT`                                                              | Application HTTP port                             |
| `RAFT_NODE_ID`, `RAFT_CLUSTER_ID`                                   | Stable node and cluster identities                |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_DB`            | Redis connection                                  |
| `ENCRYPTION_KEY`                                                    | Value encryption key; preserve it across restarts |
| `RAFT_DATA_DIR`                                                     | Per-node snapshot/WAL location                    |
| `RAFT_ENABLE_SNAPSHOTS`, `RAFT_WAL_ENABLED`                         | Persistence switches                              |
| `RAFT_ELECTION_MIN`, `RAFT_ELECTION_MAX`, `RAFT_HEARTBEAT_INTERVAL` | Timing configuration                              |
| `RAFT_REDIS_KEY_PREFIX`                                             | Raft state/log prefix; see migration below        |

See [configuration source](./src/shared/config/) and [`.env.example`](./.env.example) for other options. Example configurations are not a production security or durability guarantee.

## Redis prefix migration

Raft state/log keys default to `raft:<RAFT_CLUSTER_ID>:`. `RAFT_REDIS_KEY_PREFIX` overrides this prefix. An explicitly empty value (`RAFT_REDIS_KEY_PREFIX=`) selects the legacy unprefixed layout, `<nodeId>:state` and `<nodeId>:log:<index>`. Application KV keys are a separate concern.

The [migration report](../../docs/raft-playground-validation.md) covers core persistence compatibility. Separately, the [spec audit](../../docs/raft-spec-audit.md) found that the application's `createRedisInstance` factory ignores its `keyPrefix` option and that KV listing/snapshots include unrelated keys. Setting the Raft prefix does not isolate application data or repair those defects.

For an existing installation, stop every cluster member and back up Redis and each node's `RAFT_DATA_DIR` before upgrading. Keep node IDs, Redis database, encryption key, and data directories unchanged. Retain the old layout with an explicit empty prefix, or migrate only the state/log keys for those node IDs while all members are stopped. Do not overwrite an existing destination key. Apply the same effective prefix on every member before restarting; changing a prefix setting does not move data.

## Development and tests

From this directory:

```bash
bun run build
bun run test run
bun run test:unit
bun run test:coverage
bun run test:types
bun run lint
```

Integration fixtures require Docker. The [audit](../../docs/raft-spec-audit.md) records the current failing regressions; there is no verified throughput comparison or production consistency guarantee implied by this README.

## Documentation

- [Installation](./docs/installation.md) and [development](./docs/development.md)
- [Architecture](./docs/architecture.md) and [HTTP controllers](./src/kv-store/kv-store.controller.ts)
- [Deployment examples](./docs/deployment.md)
- [Core engine](../raft/README.md), [SDK](../kv-server-sdk/README.md), and [Observatory](../raft/playground/README.md)
- [Brand assets](../../assets/BRAND_ASSETS.md)

## License

[MIT](../../LICENCE) · [Ali Torki](https://github.com/ali-master)
