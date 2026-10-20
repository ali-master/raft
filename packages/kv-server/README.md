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
- [TypeScript client example](#typescript-client-example)
- [Configuration](#configuration)
- [Multiple nodes](#multiple-nodes)
- [Persistence and migration](#persistence-and-migration)
- [Errors and troubleshooting](#errors-and-troubleshooting)

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

## TypeScript client example

Save as `kv-client.ts` and run with `bun kv-client.ts` after the server becomes leader. This example uses Bun's built-in Fetch and checks runtime response types:

```typescript
const baseUrl = process.env.KV_URL ?? "http://127.0.0.1:3000";
const key = encodeURIComponent("readme:profile");
const value = JSON.stringify({ name: "Ada", theme: "dark" });

async function checked(response: Response): Promise<Response> {
  if (!response.ok)
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  return response;
}

await checked(
  await fetch(`${baseUrl}/kv/${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  }),
);

const response = await checked(await fetch(`${baseUrl}/kv/${key}`));
if (response.headers.get("content-type")?.includes("application/json")) {
  const missing: unknown = await response.json();
  if (missing === null) throw new Error("Value is missing");
  throw new Error("Unexpected JSON response");
}
const stored = await response.text();
if (stored !== value) throw new Error("Round trip mismatch");
console.log(JSON.parse(stored));

const keys: unknown = await (
  await checked(await fetch(`${baseUrl}/kv`))
).json();
if (!Array.isArray(keys) || !keys.every((item) => typeof item === "string")) {
  throw new Error("Unexpected keys response");
}
console.log(keys);
await checked(await fetch(`${baseUrl}/kv/${key}`, { method: "DELETE" }));
export {};
```

No automatic retries are included: after a write timeout, verify the intended value/operation outcome before retrying. This API has no idempotency-key contract.

## Configuration

Set environment variables before starting Bun. `ENCRYPTION_KEY` is required and must remain the same when reading existing values. It is used as a CryptoJS AES passphrase; the application only checks that it is nonempty. Encryption at rest is not HTTP TLS or authenticated/tamper-proof storage.

Defaults below are used when options are **unset**. Timeouts/intervals are milliseconds unless specified otherwise.

| Variables                                                                                                    | Default / purpose                                                                            |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `PORT`, `CORS_ORIGIN`                                                                                        | `3000`, `*`; HTTP port and CORS origin.                                                      |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`                                                                 | `localhost`, `6379`, unset.                                                                  |
| `REDIS_DB`                                                                                                   | Unset means KV DB `1`, Raft DB `0`; an explicit value applies to both.                       |
| `RAFT_NODE_ID`, `RAFT_CLUSTER_ID`                                                                            | `node-1`, `kv-cluster`; use stable identities.                                               |
| `RAFT_HTTP_HOST`, `RAFT_HTTP_PORT`                                                                           | `0.0.0.0`, `4000`; advertised Raft endpoint, not a second server listener.                   |
| `RAFT_REDIS_KEY_PREFIX`                                                                                      | `raft:<clusterId>:` for Raft state/log keys; empty string selects legacy unprefixed storage. |
| `RAFT_REDIS_TTL`                                                                                             | `3600` seconds; state/log expiry, not application-value TTL.                                 |
| `RAFT_ELECTION_MIN`, `RAFT_ELECTION_MAX`, `RAFT_HEARTBEAT_INTERVAL`                                          | `150`, `300`, `50`.                                                                          |
| `RAFT_MAX_LOG_ENTRIES`, `RAFT_SNAPSHOT_THRESHOLD`                                                            | `10000`, `1000`.                                                                             |
| `RAFT_ENABLE_SNAPSHOTS`, `RAFT_SNAPSHOT_INTERVAL`                                                            | `true`, `300000`.                                                                            |
| `RAFT_DATA_DIR`                                                                                              | `./data/raft`; give each node its own directory.                                             |
| `RAFT_WAL_ENABLED`, `RAFT_WAL_SIZE_LIMIT`                                                                    | `true`, `104857600` bytes.                                                                   |
| `RAFT_REQUEST_TIMEOUT`, `RAFT_NETWORK_MAX_RETRIES`, `RAFT_NETWORK_RETRY_DELAY`                               | `5000`, `3`, `1000`.                                                                         |
| `RAFT_NETWORK_CIRCUIT_BREAKER_THRESHOLD`, `RAFT_NETWORK_CIRCUIT_BREAKER_TIMEOUT`                             | `5`, `30000`.                                                                                |
| `RAFT_PEER_REGISTRATION_INTERVAL`, `RAFT_PEER_HEALTH_CHECK_INTERVAL`, `RAFT_PEER_TIMEOUT`                    | `5000`, `10000`, `30000`.                                                                    |
| `RAFT_ENABLE_VOTE_WEIGHTING`                                                                                 | `false` when unset.                                                                          |
| `RAFT_RETRY_MAX_ATTEMPTS`, `RAFT_RETRY_BACKOFF_FACTOR`, `RAFT_RETRY_INITIAL_DELAY`                           | `3`, `2`, `100`.                                                                             |
| `RAFT_CIRCUIT_BREAKER_TIMEOUT`, `RAFT_CIRCUIT_BREAKER_ERROR_THRESHOLD`, `RAFT_CIRCUIT_BREAKER_RESET_TIMEOUT` | `5000`, `50` percent, `30000`.                                                               |
| `RAFT_ENABLE_PROMETHEUS`, `RAFT_ENABLE_INTERNAL_METRICS`                                                     | `true`, `true`.                                                                              |
| `RAFT_METRICS_COLLECTION_INTERVAL`, `RAFT_METRICS_RETENTION_PERIOD`                                          | `5000`, `3600000`.                                                                           |
| `RAFT_LOG_LEVEL`                                                                                             | Factory default `INFO`; use lowercase core levels such as `info` or `debug` explicitly.      |
| `RAFT_ENABLE_STRUCTURED_LOGGING`, `RAFT_ENABLE_CONSOLE_LOGGING`, `RAFT_ENABLE_FILE_LOGGING`                  | `true`, `true`, `false`.                                                                     |
| `RAFT_LOG_FILE_PATH`                                                                                         | `./logs/raft.log`; logging option, not a durability guarantee.                               |

**Environment conversion caveat:** these factories use typed `ConfigService.get<T>()` calls without a schema that converts environment strings. The generic type does not turn `"false"` into `false` or numeric strings into numbers. In particular, do not rely on `FLAG=false` to disable a boolean feature. Use typed configuration in an embedding application or validate the effective configuration when changing these options. The minimal startup example leaves boolean/numeric tuning at its built-in defaults.

## Multiple nodes

Run one application process per node with distinct `PORT`, `RAFT_NODE_ID`, `RAFT_HTTP_PORT`, and `RAFT_DATA_DIR`. Use the same `RAFT_CLUSTER_ID`, encryption key and compatible Redis settings. Example process identities:

| Node     | HTTP port | Advertised Raft port | Data directory             |
| -------- | --------- | -------------------- | -------------------------- |
| `node-1` | `3001`    | `4001`               | `./data/kv-example/node-1` |
| `node-2` | `3002`    | `4002`               | `./data/kv-example/node-2` |
| `node-3` | `3003`    | `4003`               | `./data/kv-example/node-3` |

Query `/raft/leader` on each node and send writes to the one returning `true`. The API does not redirect follower writes or return a leader URL. Redis discovery and shared application Redis are part of this implementation; several nodes pointing to the same application DB share that data directly, which is not independent-replica proof.

## Persistence and migration

Application values are encrypted, but keys and metadata are not secret. Keep backups of the application Redis DB, Raft Redis keys, per-node data directories, and the encryption key together. Changing the encryption key does not re-encrypt existing data.

Raft persistence uses `RAFT_REDIS_KEY_PREFIX`, defaulting to `raft:<RAFT_CLUSTER_ID>:`. An explicitly empty value retains `<nodeId>:state` and `<nodeId>:log:<index>`. Stop all members before a prefix migration; back up first, move only the intended cluster's keys, avoid overwriting destination keys, and restart all members with the same effective prefix. Merely editing configuration does not move data.

The application KV store does **not** gain namespace isolation from this Raft prefix. Current listing/snapshot creation scan the application DB, and snapshot restoration calls `FLUSHDB`. Do not share that DB with other applications. Raft state/log TTL and WAL recovery also have known durability failures; neither a successful response nor the presence of a WAL establishes power-loss durability.

## Errors and troubleshooting

| Outcome                                                        | Meaning / action                                                                                                                                                                          |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Startup says `ENCRYPTION_KEY environment variable is required` | Supply a nonempty key; preserve the original key for existing data.                                                                                                                       |
| `/raft/leader` returns false                                   | Wait for election or select the actual leader before writing.                                                                                                                             |
| HTTP `500` on a write                                          | Can be non-leader, invalid value shape, replication or storage failure. The current controller does not consistently map these to `400`/`409`; inspect logs and check the resulting data. |
| HTTP `429`                                                     | Default rate limit is 600 requests per minute per rate-limit client identity. Back off.                                                                                                   |
| GET returns JSON `null`                                        | Key absent; this is `200`, not `404`.                                                                                                                                                     |
| SDK says `expected never, received object`                     | Incomplete OpenAPI POST body schema; use the checked Fetch example.                                                                                                                       |
| Readiness is failing but liveness is OK                        | Readiness performs a write and consensus check; process reachability alone is not readiness.                                                                                              |
| Unrelated keys appear / data disappears on restore             | Application DB isolation defect; use a dedicated database/instance.                                                                                                                       |

Development commands from this package: `bun run build`, `bun run test:unit`, `bun run test:types`, `bun run lint`. Integration/HTTP contract tests use Docker (`bun run test run`) and retain known failures documented in the [audit](../../docs/raft-spec-audit.md). This README documents current behavior; it does not mark those defects as repaired.

## License

[MIT](../../LICENCE) · [Ali Torki](https://github.com/ali-master)
