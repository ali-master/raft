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
- [Cluster API](#cluster-api)
- [Cache API](#cache-api)
- [Task queue API](#task-queue-api)
- [Lock API](#lock-api)
- [Game API](#game-api)
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

## Cluster API

| Method and path             | Body                                   | Success response                                                         |
| --------------------------- | -------------------------------------- | ------------------------------------------------------------------------ |
| `GET /cluster`              | —                                      | `{ clusterId, nodes, leaderId, term, commitIndex, lastApplied }`         |
| `GET /cluster/nodes`        | —                                      | Locally registered node summaries                                        |
| `GET /cluster/nodes/:id`    | —                                      | `{ found: true, node }`, or `{ found: false, node: null }` with HTTP 200 |
| `GET /cluster/leader`       | —                                      | `{ hasLeader, leader }`                                                  |
| `GET /cluster/health`       | —                                      | `{ healthy, hasLeader, nodeCount, minimumNodes: 3, status }`             |
| `POST /cluster/nodes`       | `{ nodeId: string, endpoint: string }` | 201, `{ success: true, nodeId }`                                         |
| `DELETE /cluster/nodes/:id` | —                                      | 200, `{ success: true }`                                                 |

A node summary has `id`, `state`, `isLeader`, `endpoint`, `lastSeen`, and `status`. Remote states may be `unknown`. `lastSeen` is generated when the request is handled, not a measured heartbeat timestamp; generated endpoints can differ from actual HTTP ports. The cluster's `term`, `commitIndex`, and `lastApplied` fields are currently hardcoded to zero.

**Add/remove only change an endpoint map and emit application events. They do not call Raft membership reconfiguration, launch a process, or stop a node.** Use the core membership API when implementing actual membership changes.

## Cache API

`value` accepts JSON. `ttl` is optional and measured in **seconds**; omit it for no expiry. Use positive TTLs. Expiration is calculated from local application time, so replay currently does not preserve an original absolute expiry.

| Method and path      | Body / query                      | Success response                                                                      |
| -------------------- | --------------------------------- | ------------------------------------------------------------------------------------- |
| `POST /cache/:key`   | `{ value: any, ttl?: number }`    | 201, `{ success: true, key }`                                                         |
| `GET /cache/:key`    | —                                 | 200, `{ found, value }`; absent value is `null`                                       |
| `DELETE /cache/:key` | —                                 | 204, empty body                                                                       |
| `DELETE /cache/all`  | —                                 | 204, clears all cache entries                                                         |
| `GET /cache/keys`    | Optional `pattern`, e.g. `user:*` | 200, key array                                                                        |
| `GET /cache/size`    | —                                 | 200, `{ size }`                                                                       |
| `GET /cache/stats`   | —                                 | Node/leader identity, size, memory estimate, expiry/TTL counts, oldest/newest entries |

Reserve route names `stats`, `keys`, `size`, and `all` rather than using them as application keys. The intended flow is set → read → list → delete → verify `found: false`; the write example above currently stops at DTO validation. A `null` value is not a useful way to distinguish presence because the read wrapper uses null to represent absence.

```bash
curl -sS "$API/cache/readme:greeting"
curl -sS --get "$API/cache/keys" --data-urlencode 'pattern=readme:*'
curl -sS "$API/cache/size"
```

## Task queue API

Priority values: `LOW=0`, `NORMAL=1`, `HIGH=2`, `CRITICAL=3`. Creation defaults to priority 1 and `maxRetries: 3`. Status strings are `PENDING`, `ASSIGNED`, `PROCESSING`, `COMPLETED`, `FAILED`, and `CANCELLED`.

| Method and path                | JSON body                                                                | Success response                                                           |
| ------------------------------ | ------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `POST /tasks`                  | `{ type: string, payload: any, priority?: number, maxRetries?: number }` | 201, task object                                                           |
| `GET /tasks/:id`               | —                                                                        | `{ found, task }`; missing task is `null`, HTTP 200                        |
| `GET /tasks/status/:status`    | —                                                                        | Tasks with the given uppercase status                                      |
| `GET /tasks/worker/:workerId`  | —                                                                        | Tasks assigned to that worker                                              |
| `POST /tasks/assign/:workerId` | —                                                                        | 201, `{ assigned, task }`; `task: null` when none is pending               |
| `PUT /tasks/:id/status`        | `{ status: string, workerId: string }`                                   | 200, `{ success: true }`                                                   |
| `POST /tasks/:id/complete`     | `{ workerId: string, result: any }`                                      | 201, `{ success: true }`                                                   |
| `POST /tasks/:id/fail`         | `{ workerId: string, error: string }`                                    | 201, `{ success: true }`                                                   |
| `DELETE /tasks/:id`            | —                                                                        | 204, cancels the task                                                      |
| `GET /tasks/stats`             | —                                                                        | `totalTasks`, `tasksByStatus`, `tasksByType`, `workerStats`, node identity |

A task contains `id`, `type`, `payload`, `priority`, `status`, `retries`, `maxRetries`, `createdAt`, and `updatedAt`. Later states can add `assignedTo`, `startedAt`, `completedAt`, `failedAt`, `result`, and `error`.

The intended worker sequence is create → assign next pending task → mark `PROCESSING` → complete or fail. Assignment chooses the highest pending priority. Failure requeues while retries remain, then marks the task failed. This package does not execute arbitrary task payloads: a worker application must perform the work. Because state delivery/replay is incomplete, do not rely on it for durable delivery or exactly-once processing.

Example creation body (currently subject to the validation issue above):

```json
{
  "type": "send-report",
  "payload": { "reportId": "r-42" },
  "priority": 2,
  "maxRetries": 3
}
```

```bash
curl -sS "$API/tasks/status/PENDING"
curl -sS "$API/tasks/worker/worker-1"
curl -sS "$API/tasks/stats"
```

## Lock API

`resource` is the lock key; `owner` identifies its caller. `ttl` is in **seconds**, not milliseconds. Omit it for no expiry. Metadata can be any JSON value.

| Method and path              | JSON body                                         | Success response                                                         |
| ---------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------ |
| `POST /locks/:resource`      | `{ owner: string, ttl?: number, metadata?: any }` | 201, lock object                                                         |
| `PUT /locks/:resource/renew` | `{ owner: string, ttl?: number }`                 | 200, updated lock                                                        |
| `DELETE /locks/:resource`    | `{ owner: string }`                               | 204, empty body                                                          |
| `GET /locks/:resource`       | —                                                 | `{ found, lock }`; absent/expired lock is `null`                         |
| `GET /locks`                 | —                                                 | Active locks                                                             |
| `GET /locks/owner/:owner`    | —                                                 | Active locks for an owner                                                |
| `GET /locks/stats`           | —                                                 | Active/expired/total counts, per-owner counts, oldest/most-renewed locks |

A lock has `resource`, `owner`, `acquiredAt`, optional `expiresAt`, optional `ttl`/`metadata`, and `renewCount`. An existing active lock produces 409; missing locks or mismatched owners in release/renew produce 400. Reserve `stats` as a resource name.

Intended acquisition body:

```json
{ "owner": "worker-1", "ttl": 30, "metadata": { "jobId": "job-42" } }
```

The intended flow is acquire → verify ownership → do work → renew if needed → release with the same owner. Release requires a JSON body even though its method is DELETE. The DTO/event-delivery limitations prevent treating this example as a distributed mutual-exclusion guarantee. It also has no fencing token for external resources. A renewal response without a new TTL can retain an old displayed expiry even when the operation reuses the previous TTL.

## Game API

Game states are `WAITING`, `STARTING`, `IN_PROGRESS`, `PAUSED`, and `FINISHED`. New games default to four players and empty settings. Starting requires a waiting game with at least two players. Joining is allowed while waiting or in progress, subject to capacity and a player not already belonging to a game.

| Method and path                   | JSON body                                                                  | Success response                                                 |
| --------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `POST /games`                     | `{ name: string, maxPlayers?: number, settings?: any }`                    | 201, `{ id, name, state, maxPlayers, createdAt }`                |
| `GET /games`                      | —                                                                          | Active-game summaries with `playerCount`; finished games omitted |
| `GET /games/:id`                  | —                                                                          | `{ found, game }`; HTTP 200 with `game: null` when absent        |
| `GET /games/player/:playerId`     | —                                                                          | `{ found, game }` for the player's current game                  |
| `POST /games/:id/join`            | `{ playerId: string, playerName: string }`                                 | 201, player object                                               |
| `POST /games/:id/leave/:playerId` | —                                                                          | 204, empty body                                                  |
| `POST /games/:id/start`           | —                                                                          | 201, `{ success: true }`                                         |
| `PUT /games/:id/player/:playerId` | `{ position?: { x: number, y: number }, health?: number, score?: number }` | 200, `{ success: true }`                                         |
| `PUT /games/:id/world`            | `{ objects?: any[], powerups?: any[], events?: any[], time?: number }`     | 200, `{ success: true }`                                         |
| `POST /games/:id/finish`          | `{ winnerId?: string }`                                                    | 201, `{ success: true }`                                         |
| `GET /games/stats`                | —                                                                          | Game-state/player counts and duration/popularity summaries       |

Detailed games include `players` as a JSON array, `settings`, `worldState`, and optional start/finish/winner fields. A player has `id`, `name`, `score`, `position`, `health`, `joinedAt`, `lastSeen`, and `isActive`. Initial score is 0 and health is 100.

Intended flow: create a game → join two players → start → update players/world → finish. Verify the game after creation before continuing: the current service can return a created object without an applied game record. Missing games in join/start produce 404; invalid state, capacity, or insufficient players produce 400. Create/join/update DTOs also have the validation limitation described above.

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
