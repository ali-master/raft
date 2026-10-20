<div align="center">
  <img src="../../assets/kv-server-logo.svg" alt="Raft Quorum mark" width="88" height="88" />
  <h1>@usex/raft-kv-server</h1>
  <p>An HTTP key-value service with Raft-backed writes and encrypted values.</p>
  <p><a href="../../README.md">Workspace</a> · <a href="../kv-server-sdk/README.md">TypeScript SDK</a> · <a href="../raft/README.md">Core engine</a></p>
</div>

This workspace is a Bun-run NestJS/Fastify application. Use its HTTP API to set, read, list and delete string values. Writes go through Raft; reads query the local application Redis store. You do not need to implement a state machine or use Nest decorators to call this server.

**Experimental:** application-key isolation, snapshot restore, health checks, OpenAPI schemas and consensus recovery have known defects. Start with a dedicated Redis instance and disposable data. Reads have no verified quorum barrier, so they are not guaranteed linearizable. The concrete limitations below are part of the current API contract.

## Contents

- [Run locally](#run-locally)
- [First write and read](#first-write-and-read)
- [HTTP API](#http-api)

## Run locally

Prerequisites: Bun >= 1.4.3, Docker for the development Redis example, and this repository. The package's runtime also declares Node.js >= 22.22.3, but all commands here use Bun.

From the repository root:

```bash
bun install --frozen-lockfile
bun run --cwd packages/raft build
bun run --cwd packages/kv-server build
```

Start disposable Redis in another terminal:

```bash
docker run --rm --name raft-kv-readme-redis -p 127.0.0.1:6389:6379 redis:7-alpine
```

From `packages/kv-server`, create a new `.env` with these settings. Replace the encryption-key placeholder with a private nonempty secret and preserve it across restarts:

```dotenv
PORT=3000
REDIS_HOST=127.0.0.1
REDIS_PORT=6389
RAFT_NODE_ID=node-1
RAFT_CLUSTER_ID=kv-example
RAFT_DATA_DIR=./data/kv-example/node-1
ENCRYPTION_KEY=replace-with-a-private-development-secret
RAFT_LOG_LEVEL=info
```

**Leave `REDIS_DB` unset in this example.** With no override, application data uses DB `1` and Raft uses DB `0`. Setting `REDIS_DB` applies the same database number to both factories. The repository's larger environment template sets `REDIS_DB=1`; copying it verbatim removes this separation.

```bash
cd packages/kv-server # Omit if already here.
bun run start:prod
# For editing the application with automatic recompilation:
# bun run start:dev
```

The HTTP listener binds to `0.0.0.0`. Open `http://127.0.0.1:3000/api` for Swagger. This application does not currently enforce authentication; the Swagger bearer-auth definition is documentation, not a guard. Keep evaluation deployments on a trusted local network.

## First write and read

Wait until this node reports `isLeader: true`:

```bash
curl -fsS http://127.0.0.1:3000/raft/leader
# {"isLeader":true}
```

Then write and read a string:

```bash
curl -i -X POST http://127.0.0.1:3000/kv/greeting \
  -H 'Content-Type: application/json' \
  -d '{"value":"hello"}'
# HTTP 201, empty response body

curl -i http://127.0.0.1:3000/kv/greeting
# HTTP 200, Content-Type: text/plain; charset=utf-8
# hello

curl -fsS http://127.0.0.1:3000/kv
# ["greeting"] on a fresh, otherwise empty application database

curl -i -X DELETE http://127.0.0.1:3000/kv/greeting
# HTTP 200, empty body

curl -i http://127.0.0.1:3000/kv/greeting
# HTTP 200, Content-Type: application/json; charset=utf-8
# null
```

The value is a **string**. Store structured data by serializing it first, for example `{ "value": "{\"theme\":\"dark\"}" }`, and parse it after reading. URL-encode key path segments. Do not use the key `health-check`: readiness checks currently overwrite/delete it.

## HTTP API

Paths below are relative to the node's HTTP base URL, for example `http://127.0.0.1:3000`. There is no `/api` prefix on business routes; `/api` is the Swagger UI.

### Values

| Method / path     | Request                                 | Successful response                                                                                                      |
| ----------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `POST /kv/:key`   | JSON `{ "value": string }`              | `201`, no payload; replaces any existing value. Send to the leader.                                                      |
| `GET /kv/:key`    | No body                                 | `200` plain-text string if present; `200` JSON `null` if absent.                                                         |
| `DELETE /kv/:key` | No body                                 | `200`, no payload. Send to the leader.                                                                                   |
| `GET /kv`         | No body or pagination/filter parameters | `200` JSON array of key strings. Current implementation lists the entire application Redis DB, including unrelated keys. |

There is no `{ key, value, encrypted }` read wrapper, `{ keys, total }` list wrapper, TTL API, transaction API, compare-and-set, or distributed-lock endpoint. Do not call `.json()` on a present string value, or on empty write/delete responses. Use content type to distinguish an absent value from the literal string `"null"`.

### Consensus status

| Method / path       | Response                                                                              |
| ------------------- | ------------------------------------------------------------------------------------- |
| `GET /raft/leader`  | `{ "isLeader": boolean }`; checks the queried node, not a cluster-wide leader lookup. |
| `GET /raft/status`  | `{ nodeId, state, isLeader, metrics }`; `metrics` can be absent before collection.    |
| `GET /raft/metrics` | Local Raft metrics JSON; not Prometheus text.                                         |

`state` is `"follower"`, `"candidate"`, or `"leader"`. Metrics include `currentTerm`, `state`, `votedFor`, `commitIndex`, `lastApplied`, `logLength`, `leaderHeartbeats`, `electionCount`, `voteCount`, `appendEntriesCount`, `peerCount`, and `systemMetrics`. Measurements are sampled, not a quorum-read certificate. System metrics are process/host measurements and some fields are approximations.

### Health

| Method / path           | Behavior                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| `GET /health/liveness`  | `200` `{ "status": "ok" }`; no KV write.                                                    |
| `GET /health`           | Terminus result `{ status, info, error, details }`; combines KV round trip and Raft checks. |
| `GET /health/readiness` | Same checks as `/health`; may return `503` on failure.                                      |

`/health` and `/health/readiness` are **not read-only**: they set and delete `health-check`. That key is not protected from application use. They can also fail on followers because the KV probe writes. Use liveness to check process reachability and evaluate readiness separately from application-data correctness.

### Internal protocol endpoints

These are transport-integration endpoints, not substitutes for `POST /kv/:key`:

| POST path                    | Core request / response type                         |
| ---------------------------- | ---------------------------------------------------- |
| `/raft/rpc/vote-request`     | `VoteRequest` → `VoteResponse`                       |
| `/raft/rpc/pre-vote`         | `PreVoteRequest` → `PreVoteResponse`                 |
| `/raft/rpc/append-entries`   | `AppendEntriesRequest` → `AppendEntriesResponse`     |
| `/raft/rpc/install-snapshot` | `InstallSnapshotRequest` → `InstallSnapshotResponse` |
| `/raft/rpc/timeout-now`      | `TimeoutNowRequest` → empty body                     |

They delegate to the core node. They are not application command delivery APIs and must not be exposed to untrusted callers. The controller's OpenAPI annotations advertise `200`, while the current POST handlers retain Nest's default `201` status because they do not set `HttpCode`. The generated schema is not authoritative for every runtime detail.

For transport integrations, request bodies have these fields:

| Request          | Body fields                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------- |
| Vote             | Numeric `term`, string `candidateId`, numeric `lastLogIndex`/`lastLogTerm`, optional numeric `weight` |
| Pre-vote         | Prospective numeric `term`, `candidateId`, `lastLogIndex`, `lastLogTerm`                              |
| Append entries   | `term`, `leaderId`, `prevLogIndex`, `prevLogTerm`, `entries`, `leaderCommit`                          |
| Install snapshot | `term`, `leaderId`, `lastIncludedIndex`, `lastIncludedTerm`, `offset`, `data`, `done`                 |
| Timeout now      | `term`, `leaderId`                                                                                    |

Vote responses contain `{ term, voteGranted, voterWeight }`; pre-vote responses contain `{ term, voteGranted }`; append responses contain `{ term, success, lastLogIndex }`; snapshot responses contain `{ term }`.

An entry contains `term`, `index`, `commandType`, `commandPayload`, `timestamp`, and `checksum`. These are consensus protocol values, not arbitrary client-generated writes. Core snapshot input expects a `Buffer`, and log timestamps are `Date` instances. The HTTP controller does not establish a validated JSON conversion contract for those values, so a JSON-serialized buffer is not a verified working snapshot-transfer format. Use the core's configured transport instead of treating these HTTP endpoints as a complete alternative transport.

### OpenAPI

- UI: `GET /api`
- JSON: `GET /api/docs/openapi.json`
- YAML: `GET /api/docs/openapi.yaml`

The schema currently omits the KV POST body and several response schemas. Consequently generated client responses can be `unknown`, and the generated POST validator rejects a valid `{ value: "..." }` before sending it. The [SDK guide](../kv-server-sdk/README.md) includes working read/delete examples and a Fetch write workaround.

## License

[MIT](../../LICENCE) · [Ali Torki](https://github.com/ali-master)
