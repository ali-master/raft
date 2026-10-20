<div align="center">
  <img src="../../assets/logo.svg" alt="Raft Quorum mark" width="88" height="88" />
  <h1>@usex/kv-server-sdk</h1>
  <p>A generated TypeScript client for Raft KV Server.</p>
  <p><a href="../../README.md">Workspace</a> · <a href="../kv-server/README.md">KV server</a></p>
</div>

This workspace generates a Fetch client, TypeScript types, Zod validators, schemas, and response transformers from a running KV server. Generate the client before importing the package: generated code is not checked in.

The current server contract supports generated reads, listing, and deletion. Its OpenAPI document omits write request bodies, so generated POST validators reject valid bodies. The quick start uses Fetch for writes and the generated SDK for reads and deletion.

## Contents

- [Generate and install](#generate-and-install)
- [First round trip](#first-round-trip)
- [Configuration and errors](#configuration-and-errors)
- [Operation reference](#operation-reference)
- [Types and validation](#types-and-validation)
- [Troubleshooting](#troubleshooting)

## Generate and install

Use Bun >= 1.4.3. Start the [KV server](../kv-server/README.md#run-locally) and wait until `GET /raft/leader` reports `{ "isLeader": true }`. From this repository:

```bash
bun install --frozen-lockfile
cd packages/kv-server-sdk

# Use the schema from the server you will actually call.
bun run generate:client -i http://127.0.0.1:3000/api/docs/openapi.json
bun run build
```

Run the examples below from `packages/kv-server-sdk`. After generation and compilation, another Bun project can install the local package:

```bash
# From the consuming project; replace this path with your checkout.
bun add /absolute/path/to/raft/packages/kv-server-sdk
```

In that consuming project, import operations from `@usex/kv-server-sdk` instead of `./src/client`. The package entry is `lib/client/index.js`, with declarations in `lib/client/index.d.ts`. This guide describes the workspace version, not an independently verified registry release.

Without `-i`, generation uses the configured hosted schema. Prefer an explicit URL to align client and server versions. Generation replaces `src/client` because `clean: true` is enabled. Keep handwritten application code outside that directory.

## First round trip

Save as `example.ts` in the SDK package. It writes a string, reads it through the SDK, lists keys, deletes it, and checks that it is absent.

```typescript
import {
  kvStoreControllerDeleteValue,
  kvStoreControllerGetValue,
  kvStoreControllerListKeys,
} from "./src/client";

const baseUrl = process.env.KV_URL ?? "http://127.0.0.1:3000";
const key = "readme:sdk-example";
const value = JSON.stringify({ theme: "dark" });

// The current OpenAPI write schema has no body. Use the actual HTTP contract.
const write = await fetch(`${baseUrl}/kv/${encodeURIComponent(key)}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ value }),
});
if (!write.ok)
  throw new Error(`Write failed: ${write.status} ${await write.text()}`);
// Successful writes return an empty body: do not call write.json().

const read = await kvStoreControllerGetValue({
  baseUrl,
  path: { key },
  throwOnError: true,
});
if (typeof read.data !== "string" || read.data !== value) {
  throw new Error("Unexpected stored value");
}
console.log("Stored:", read.data);

const listed = await kvStoreControllerListKeys({ baseUrl, throwOnError: true });
if (
  !Array.isArray(listed.data) ||
  !listed.data.every((item) => typeof item === "string")
) {
  throw new Error("Expected an array of keys");
}
if (!listed.data.includes(key)) throw new Error("Written key was not listed");
console.log("Keys:", listed.data);

await kvStoreControllerDeleteValue({
  baseUrl,
  path: { key },
  throwOnError: true,
});
const deleted = await kvStoreControllerGetValue({
  baseUrl,
  path: { key },
  throwOnError: true,
});
if (deleted.data !== null) throw new Error("Deleted key is still present");
console.log("Round trip complete");
```

```bash
KV_URL=http://127.0.0.1:3000 bun example.ts
```

A stored value is a **string**, even when it contains JSON. A present value returns HTTP 200 with a text content type; an absent key returns HTTP 200 with JSON `null`. Keep automatic content-type parsing so the string `"null"` remains distinguishable from absence. Reads use the server's local state; this API has no linearizable-read barrier.

## Configuration and errors

Every operation accepts an options object. Operations with `{key}` require `path: { key: string }`; pass the unescaped key and let the client encode it.

| Option         | Meaning                                                          |
| -------------- | ---------------------------------------------------------------- |
| `baseUrl`      | Server origin, e.g. `http://127.0.0.1:3000`; no `/api` prefix    |
| `path`         | Named URL parameters, e.g. `{ key: "user:42" }`                  |
| `headers`      | Additional request headers                                       |
| `signal`       | An `AbortSignal` for cancellation or timeout                     |
| `throwOnError` | Defaults to `false`; `true` enables exception-based handling     |
| `client`       | An isolated Fetch client created with `createClient`             |
| `fetch`        | A custom Fetch implementation if needed                          |
| `parseAs`      | Defaults to `"auto"`; overriding it changes content-type parsing |

The default response style returns `data`, `request`, and `response`. With `throwOnError: false`, failures return an `error`; a network failure can have no `response`. Handle validation failures too. With `throwOnError: true`, use `try/catch`.

Save this separate example as `status.ts`:

```typescript
import { raftControllerGetStatus } from "./src/client";
import { createClient, createConfig } from "./src/client/client";

const client = createClient(
  createConfig({
    baseUrl: process.env.KV_URL ?? "http://127.0.0.1:3000",
    headers: { Accept: "application/json" },
  }),
);

try {
  const result = await raftControllerGetStatus({
    client,
    signal: AbortSignal.timeout(5_000),
    throwOnError: true,
  });
  console.log(result.response.status, result.data);
} catch (error) {
  console.error("Status request failed:", error);
  process.exitCode = 1;
}
```

`createClient` and `createConfig` are exported by the generated `client` subdirectory, not the package root. For the built package, use `@usex/kv-server-sdk/lib/client/client`. Alternatively, configure the shared `client` with `client.setConfig({ baseUrl })`, importing it from `./src/client/client.gen` (or `@usex/kv-server-sdk/lib/client/client.gen` after installation).

Use separate client instances for different origins. The server does not currently enforce bearer authentication; an Authorization header alone does not add access control.

## Operation reference

These are the exact function names produced by the current server schema. All return promises. Optional options can be omitted only when the shared client already has a usable base URL.

### Key-value operations

| Function                                | Request                                 | Successful behavior                                                                             |
| --------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `kvStoreControllerGetValue(options)`    | `GET /kv/{key}`; requires `path.key`    | 200, string or `null`; generated data type is `unknown`                                         |
| `kvStoreControllerListKeys(options?)`   | `GET /kv`                               | 200, string array; generated data type is `unknown`                                             |
| `kvStoreControllerDeleteValue(options)` | `DELETE /kv/{key}`; requires `path.key` | 200, empty body; deleting an absent key also succeeds                                           |
| `kvStoreControllerSetValue(options)`    | `POST /kv/{key}`; requires `path.key`   | Server expects `{ value: string }`, returns 201 empty; generated body type is currently `never` |

Do not cast the POST body to `any` or disable validators to hide the missing contract. Use the Fetch write above until the server declares a request-body schema and you regenerate. The server also does not guarantee a consistent 4xx response for malformed write bodies; validate input in your application.

### Node information and health

| Function                              | Route                   | Data                                                                                           |
| ------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------- |
| `raftControllerGetStatus(options?)`   | `GET /raft/status`      | `{ nodeId, state, isLeader, metrics }`; `metrics` includes term and log indices when available |
| `raftControllerIsLeader(options?)`    | `GET /raft/leader`      | `{ isLeader: boolean }`                                                                        |
| `raftControllerGetMetrics(options?)`  | `GET /raft/metrics`     | JSON metrics snapshot                                                                          |
| `healthControllerCheck(options?)`     | `GET /health`           | Health report; 200 or 503                                                                      |
| `healthControllerLiveness(options?)`  | `GET /health/liveness`  | 200, `{ status: "ok" }`                                                                        |
| `healthControllerReadiness(options?)` | `GET /health/readiness` | Readiness report; 200 or 503                                                                   |

General health and readiness reports contain `status`, `info`, `error`, and `details`; liveness returns `{ status: "ok" }`. Generated health operations validate against their documented schemas. **General health and readiness probes write and delete the application key `health-check`. Reserve that key.** The liveness probe is read-only.

### Internal Raft RPC operations

| Function                                           | POST route                   |
| -------------------------------------------------- | ---------------------------- |
| `raftRpcControllerHandleVoteRequest(options?)`     | `/raft/rpc/vote-request`     |
| `raftRpcControllerHandleAppendEntries(options?)`   | `/raft/rpc/append-entries`   |
| `raftRpcControllerHandlePreVote(options?)`         | `/raft/rpc/pre-vote`         |
| `raftRpcControllerHandleInstallSnapshot(options?)` | `/raft/rpc/install-snapshot` |
| `raftRpcControllerHandleTimeoutNow(options?)`      | `/raft/rpc/timeout-now`      |

These are node-to-node protocol operations, not application task dispatch. Their generated bodies are also `never`, so they are not usable as typed RPC senders yet. Successful POST handlers currently return 201. See the [KV server protocol reference](../kv-server/README.md#internal-protocol-endpoints) for actual request fields.

## Types and validation

The root exports operation functions and their generated types. Examples:

- `KvStoreControllerGetValueData`: request shape, including `path: { key: string }`.
- `KvStoreControllerGetValueResponses`: status-code-to-response mapping.
- `HealthControllerCheckErrors`: documented health errors.
- `Options<TData, ThrowOnError>`: SDK options.

Types describe only what the OpenAPI document declares. Most KV and Raft response schemas currently become `unknown`; narrow them before use, as the quick start does. An imported TypeScript interface is not runtime JSON validation. Date transformers affect only fields declared as dates.

After server contract changes, regenerate, rebuild, and run a real round trip. Keep generated artifacts aligned with the server schema version.

```bash
# In this package, after generation:
bun run build
bun run test

# From the repository root; requires Docker Redis:
bun run --cwd packages/kv-server test run test/integration/data-contract.spec.ts
```

The package test command permits zero tests. The build prints a skip message when generated source is absent. Neither proves a client exists or the HTTP contract works. The contract suite contains known regression failures; successful generation does not resolve them.

## Troubleshooting

| Symptom                                 | Action                                                          |
| --------------------------------------- | --------------------------------------------------------------- |
| Package cannot be imported              | Generate, build, then install/link the local package            |
| URL cannot be parsed                    | Set `baseUrl` to the server origin                              |
| POST body rejected before a request     | Current schema omission; use the Fetch write above              |
| `data` is `unknown`                     | Narrow it with runtime checks                                   |
| Write fails on a follower               | Send writes to a running leader; check `raftControllerIsLeader` |
| Empty response cannot be parsed as JSON | Check status only for write/delete operations                   |
| Absent key does not produce 404         | Absence is represented by 200 and JSON `null`                   |

## License

[MIT](../../LICENCE) · [Ali Torki](https://github.com/ali-master)
