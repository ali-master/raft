<div align="center">
  <img src="../../../assets/logo.svg" alt="Raft Quorum mark" width="88" height="88" />
  <h1>Raft · NestJS Playground</h1>
  <p>Explore application patterns around distributed consensus.</p>
  <p><a href="../../../README.md">Workspace</a> · <a href="../README.md">NestJS integration</a> · <a href="../../raft/playground/README.md">Live Observatory</a></p>
</div>

This private workspace runs a NestJS HTTP and Socket.IO application with cache, task queue, lock, game, and monitoring examples. It is an executable teaching application, not a package to install as a production cache or lock manager.

**Current limits:** read endpoints and monitoring connections can be explored immediately. Most JSON mutation DTOs have no validation decorators, so the application's whitelist rejects their fields with HTTP 400. Application event delivery and replay also have unresolved data-integrity issues. The reference below distinguishes handler contracts from verified persistence; a successful proposal is not proof that an application record exists.

For a complete working custom state-machine integration, use the [NestJS package guide](../README.md#use-your-own-state-machine). For live cluster experiments, measured RPC metrics, and leader-to-node tasks, use [Raft Observatory](../../raft/playground/README.md).

## Contents

- [Start the application](#start-the-application)
- [Configuration](#configuration)
- [HTTP conventions and current validation behavior](#http-conventions-and-current-validation-behavior)
- [CLI and package commands](#cli-and-package-commands)
- [Troubleshooting and tests](#troubleshooting-and-tests)

## Start the application

Requirements: Bun >= 1.4.3 and Redis. Use a dedicated Redis database for these experiments:

```bash
docker run --rm --name nest-playground-redis -p 127.0.0.1:6389:6379 redis:7-alpine
```

In another terminal, from the repository root:

```bash
bun install --frozen-lockfile
bun run --cwd packages/raft build
bun run --cwd packages/nest build
bun run --cwd packages/nest/playground build
cd packages/nest/playground

export REDIS_HOST=127.0.0.1
export REDIS_PORT=6389
export NODE_ID=node-1
export CLUSTER_ID=nest-playground-example
export HTTP_PORT=3001
export RAFT_DATA_DIR=./data/readme-node-1
bun run start:prod
```

The server uses Bun to run compiled JavaScript. Compilation is needed for Nest constructor-injection metadata; do not replace this with direct execution of the TypeScript application entry point. For rebuilds while developing, use `bun run start:dev`.

Open [Swagger](http://localhost:3001/api). Its JSON document is at `/api-json`. The main application has no global `/api` route prefix; the documentation UI path does not prefix business routes.

In a third terminal:

```bash
export API=http://127.0.0.1:3001
curl -sS "$API/cluster/leader"
curl -sS "$API/cache/stats"
curl -sS "$API/tasks/stats"
curl -sS "$API/monitoring/dashboard"
```

Wait for `hasLeader: true` before attempting mutations. On a clean instance, the cache and task counts begin at zero. Stop with `Ctrl+C`.

### Three processes

From the playground directory, export Redis settings and run:

```bash
REDIS_HOST=127.0.0.1 REDIS_PORT=6389 CLUSTER_ID=nest-three bun run start:cluster
```

This starts `node-1`, `node-2`, and `node-3` on HTTP ports 3001–3003. Ensure no single-node example still occupies those ports. **Unset `RAFT_DATA_DIR` for this command** so each process gets its own default directory; a shared explicit directory would mix their files.

Discovery registers members, but the HTTP `/cluster/nodes` view lists nodes in the current process's engine registry, not all remote processes. Do not expect that endpoint or its health heuristic to prove three-process quorum membership.

## Configuration

The application loads `.env.local`, then `.env`; exported process values also apply.

| Variable                                       | Default                                                    | Meaning                                                                               |
| ---------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `NODE_ID`                                      | `node-1`                                                   | Unique Raft identity; export it explicitly so scenario services use the same identity |
| `CLUSTER_ID`                                   | `playground-cluster`                                       | Peer discovery and transport cluster                                                  |
| `HTTP_PORT`                                    | `3001`                                                     | Nest HTTP and Socket.IO port                                                          |
| `REDIS_HOST`, `REDIS_PORT`                     | `localhost`, `6379`                                        | Core Redis connection                                                                 |
| `REDIS_DB`, `REDIS_PASSWORD`                   | `0`, unset                                                 | Logical database and optional authentication                                          |
| `RAFT_DATA_DIR`                                | Per-node `data/<NODE_ID>` relative to compiled application | Local WAL/snapshot directory; never share between nodes                               |
| `ELECTION_MIN_TIMEOUT`, `ELECTION_MAX_TIMEOUT` | `300`, `500`                                               | Election timeout range, milliseconds                                                  |
| `HEARTBEAT_INTERVAL`                           | `150`                                                      | Heartbeat interval, milliseconds                                                      |
| `ENABLE_CORS`                                  | Disabled                                                   | Set exactly `true` to enable HTTP CORS                                                |
| `ALLOWED_ORIGINS`                              | Reflects the requesting origin when unset                  | Comma-separated HTTP origins when CORS is enabled; configure an explicit list         |
| `INTERACTIVE_MODE`                             | Disabled                                                   | Set exactly `true` to show the built-in terminal prompt                               |

This application does not configure a Redis persistence `keyPrefix`. Changing `CLUSTER_ID` alone does **not** isolate all persisted node keys. Use separate Redis instances/databases for unrelated experiments, unique node IDs, and independent data directories. Do not reuse a database containing another cluster's state.

No application authentication or authorization guard is installed by default. `owner`, `workerId`, and `playerId` are request values, not authenticated identities. Run the playground on a trusted development machine.

## HTTP conventions and current validation behavior

Send JSON bodies with `Content-Type: application/json`. Dates in HTTP responses are ISO strings. Reads inspect local application state without a linearizable-read barrier. Writes generally require the leader; a follower returns a 400 error identifying the known leader instead of forwarding the request.

The route tables give the **handler's success response**. A DTO validation error can prevent the handler from running. This exact cache request currently reproduces the problem:

```bash
curl -i "$API/cache/readme:greeting" \
  -H 'Content-Type: application/json' \
  -d '{"value":"hello","ttl":60}'
```

```json
{
  "message": [
    "property value should not exist",
    "property ttl should not exist"
  ],
  "error": "Bad Request",
  "statusCode": 400
}
```

This is not an invalid payload according to the intended cache contract. The DTO lacks validation metadata while the global pipe uses `whitelist: true` and `forbidNonWhitelisted: true`. Cache/task/lock/game DTOs and the add-node DTO share that issue; their Swagger schemas also omit fields. Do not work around it by sending empty objects or removing global validation: required inputs would then go unchecked.

After a mutation succeeds, read the record back on the serving node and other replicas. Current `@OnLogCommitted()` handlers subscribe through a broken event bridge and the default Raft module has no application state machine. A returned task/lock/game object can therefore describe a proposal whose record was never added to application state. TTL replay and serialized `Date` handling have additional limitations.

Several Swagger success annotations differ from runtime defaults. Tables below use Nest's actual handler status: a POST without `@HttpCode` returns 201; a DELETE without it returns 200.

## CLI and package commands

Enable the built-in prompt in the normal application process:

```bash
INTERACTIVE_MODE=true bun run start:prod
```

| Prompt command                                 | Behavior                                                             |
| ---------------------------------------------- | -------------------------------------------------------------------- |
| `help`, `status`, `nodes`, `leader`, `metrics` | Show commands and local diagnostic information                       |
| `scenario list`                                | List cache, queue, lock, game and monitor examples                   |
| `scenario info cache`                          | Describe one scenario; replace `cache` with its name                 |
| `scenario test cache`                          | Run the CLI's demonstration sequence; not a data-integrity assertion |
| `election`, `step-down`                        | Print placeholder messages; do not change consensus                  |
| `clear`, `exit`, `quit`                        | Clear the terminal or exit                                           |

| Package command                                       | Purpose                                             |
| ----------------------------------------------------- | --------------------------------------------------- |
| `bun run build`                                       | Compile TypeScript and Nest injection metadata      |
| `bun run start:prod`                                  | Run compiled application with Bun                   |
| `bun run start` / `bun run start:dev`                 | Nest watch mode using Bun                           |
| `bun run start:node1` / `start:node2` / `start:node3` | Single configured node on ports 3001/3002/3003      |
| `bun run start:cluster`                               | Run all three configured node processes             |
| `bun run test`                                        | Integration/data-integrity tests using Docker Redis |

Legacy `start:dashboard` and `start:cli` target missing entry points; `start:monitoring` depends on the former. `test:load` and `test:chaos` also refer to files absent from this checkout. Use the normal application prompt and the maintained Observatory instead of those scripts. Do not interpret these script names as working features.

## Troubleshooting and tests

| Symptom                                        | Meaning / action                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------------- |
| Constructor dependency is undefined            | Build with the TypeScript compiler and run the compiled app with Bun            |
| Redis connection fails                         | Check exported host/port and the dedicated Redis container                      |
| `property ... should not exist`                | Current DTO validation bug, not a need to rename valid fields                   |
| Mutation says it succeeded but a read is empty | Current application event/state-machine integration issue; readback is required |
| Node count remains 1 with three processes      | Engine registry is process-local; this endpoint is not global membership        |
| Health endpoints disagree                      | Different demo heuristics and placeholder metrics                               |
| Adaptive routes return 404                     | Module is not imported by the default application                               |
| A date method fails during replay              | JSON persistence does not restore `Date` instances automatically                |

```bash
# From this playground; requires Docker for its isolated Redis fixture.
bun run build
bun run test
```

The test suite contains unresolved data-integrity cases. The [audit](../../../docs/raft-spec-audit.md#nest-and-application-data) explains their scope; it is historical validation, not a promise that all scenarios pass. This guide documents the existing behavior without disabling validation or disguising failures.

## License

[MIT](../../../LICENCE) · [Ali Torki](https://github.com/ali-master)
