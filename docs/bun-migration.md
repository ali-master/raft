# Bun migration

Toolchain migration validated on October 18, 2026. The October 19 follow-up repairs the 17 remaining Nest/KV failures and verifies legacy Redis prefix compatibility. See [Raft playground validation](raft-playground-validation.md).

## Project structure

- `packages/raft`: consensus implementation, Redis messaging and discovery, WAL/snapshots, adaptive parameters, and metrics. Built as ESM and CommonJS with declarations.
- `packages/nest`: Nest module, decorators, events, and service facade over the core library.
- `packages/kv-server`: Nest/Fastify HTTP server, CQRS handlers, encryption, health checks, and OpenAPI.
- `packages/kv-server-sdk`: OpenAPI client generator. Generated client source is absent from the checkout.
- `packages/raft/playground` and `packages/nest/playground`: CLI scenarios and a Nest demonstration application.

## Toolchain

All seven manifests use Bun workspaces and Bun 1.4.3. `bun.lock` replaces the pnpm lockfile, and `.bun-version` pins CI and local setup. `bunfig.toml` runs JavaScript package scripts with Bun. Direct dependency versions were checked against registry `latest` tags; `bun outdated --filter '*'` reports none outstanding.

| Component | Version |
| --- | --- |
| Bun | 1.4.3 |
| TypeScript compiler | 7.0.2 |
| Nest core/common | 12.1.3 |
| Fastify | 5.12.7 |
| ioredis | 6.0.0 |
| Vitest | 5.0.5 |
| ESLint | 10.13.0 |

TypeScript 7 is installed as `@typescript/native` and supplies `tsc`. The `typescript` import points to `@typescript/typescript6@6.0.2` because Nest CLI, unbuild, and ESLint still use the JavaScript compiler API. This compatibility package is intentional. TypeScript configurations now use supported module resolution and preserve the previous strictness settings.

Vitest continues to run the existing suites, using Bun and Istanbul coverage. Nest tests retain SWC decorator metadata. Coverage includes each package's `src/**/*.ts`, excluding generated playground builds and source maps.

The libraries retain Node.js-compatible output; their Node engine minimum is now 22.22.3. Major dependency updates also raise the Nest peer range to 12 and ioredis to 6, so consumers must update accordingly.

## Development

Run from the repository root:

```bash
bun install --frozen-lockfile
bun run build
bun run test:types
bun run lint
bun run test
bun run test:coverage
```

Docker must be available for the Redis-backed tests. Build before testing because tests import the built workspace libraries. Integration fixtures use disposable Redis containers and temporary persistence directories.

```bash
# Build and start the KV application, using its configured Redis instance
bun run --cwd packages/kv-server start

# Show CLI help without launching any showcase clusters
bun run --cwd packages/raft/playground start --help

# Generate the SDK from a running KV server before building it
bun run --cwd packages/kv-server-sdk generate:client -i http://localhost:3000/api/docs/openapi.json
bun run --cwd packages/kv-server-sdk build
```

The SDK build explicitly skips when generated sources are absent, and propagates compiler errors when sources exist. Generator compatibility was checked with both a temporary fixture and the running Docker image's OpenAPI, followed by strict typechecks; a generated SDK is not included in this change.

## Compatibility changes

- Replaced retired `fastify-*` plugins with the maintained `@fastify/*` packages. Swagger uses the existing Nest OpenAPI setup without a duplicate Fastify registration.
- Aligned Fastify to 5.12.7 through an override so Nest and plugin type augmentations share one version.
- Updated Terminus health indicators and added tests for healthy, unhealthy, and throwing checks.
- Preserved runtime constructor imports required by Nest dependency injection and configured ESLint to preserve them.
- Moved KV's runtime `ioredis` dependency out of devDependencies and included its encryption module where the Raft provider needs it.
- Corrected Nest/KV package export paths to the actual compiled files and the SDK paths to its generated client directory.
- Updated the Nest playground's configuration to the current Raft contract, removed source aliases from compiled runtime imports, and declared monitoring module dependencies.
- Guarded CLI showcases with `import.meta.main` so importing them does not start every scenario.

CI, release tooling, documentation, Dockerfiles, and Compose build contexts now use Bun. Both Dockerfiles install from the frozen lockfile, separate production dependencies, and run as the `bun` user with writable persistence directories. The Docker context excludes local data, secrets, and generated output.

## Validation

Passed: frozen installation, workspace builds, workspace typechecks and lint, Bun/Node ESM and CommonJS core imports, SDK generation and typecheck against fixtures and the live OpenAPI, Compose configuration validation, and both Docker image builds. Targeted Istanbul runs passed 6 core checksum tests, 14 Nest decorator tests, and 14 KV unit tests.

Both local Bun applications and the production Docker images returned HTTP 200 for KV liveness, Raft status, and OpenAPI (13 paths), and for the Nest playground's cluster, monitoring health, and OpenAPI (43 paths). Containers used a disposable Redis instance and their configured non-root user. These checks establish startup and route availability, not consensus correctness.

The October 19 Nest/KV follow-up resolves the 14 Nest and 3 KV failures reproduced before this repair. Final workspace test results are:

| Package | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Core Raft | 203 | 0 | 10 |
| Nest integration | 64 | 0 | 0 |
| KV server | 22 | 0 | 0 |
| Raft dashboard | 14 | 0 | 0 |

During the original migration, an isolated baseline checkout with the original lockfile and the user's existing local changes reproduced 9 Nest service failures and 7 core membership/snapshot/cluster failures under Node.js. The follow-up reproduced all 17 outstanding Nest/KV failures under Bun before fixing them; it did not repeat the original-dependency baseline for each failure.

The single-node commit failure observed during migration has been repaired in the core. A successful append now waits for commitment and state-machine application; regression tests cover single-node writes and fresh-instance recovery. The original failure also reproduced with the old dependencies under Node.js.

### Nest/KV follow-up

- Nest's `propose` now calls `appendLog`, so success means committed and applied. Membership methods call the joint-consensus configuration API. Removing the current node is rejected until leadership is transferred and the operation is submitted through another node.
- Core exposes `forceElection` through the normal election/pre-vote/quorum path and `getLeaderId` from the current term's leader contact. Stopped nodes cannot start elections and do not report a leader. Nest snapshot and election methods delegate to these public APIs.
- Nest fixtures now respect dynamic-module dependency scope and test actual application startup/shutdown. Expectations for node arrays and default timing match the existing public API. A real Redis-backed Nest test elects a node, commits a proposal, creates a snapshot, and verifies shutdown.
- KV integration waits for an elected leader before writes and explicitly checks write rejection after leadership ends. Its Redis and disk storage are isolated from local application configuration. Application shutdown closes the KV state machine's Redis client after the Raft node stops.
- `bun run build`, `bun run test:types`, `bun run lint`, and `bun run test` pass. No failing tests were skipped; the 10 existing core skips remain. SDK generation, coverage and Docker image builds were not repeated for this follow-up; the SDK build still skips when generated sources are absent.

### Existing Redis data

`redis.keyPrefix` now applies to Raft state and log storage. Legacy keys are `<nodeId>:state` and `<nodeId>:log:<index>`; prefixed keys prepend the configured value exactly once. A Redis-backed regression seeds the legacy layout, recovers its committed state, and appends successfully with `redis.keyPrefix: ""`.

For the KV server, set **`RAFT_REDIS_KEY_PREFIX=`** explicitly to retain that legacy layout. Leaving it unset uses `raft:<RAFT_CLUSTER_ID>:`; a custom value selects that namespace. For direct core/Nest configuration, set **`redis.keyPrefix: ""`**. There is no automatic fallback between namespaces.

Stop all members and back up Redis and their WAL/snapshot directories before upgrading an existing cluster. Keep node IDs, Redis database, encryption key and data directories unchanged. Either retain the empty prefix, or copy the state/log keys for the cluster's exact node IDs to the chosen prefix while stopped, verifying the contents and refusing destination collisions before restart. Use the same prefix on every member. This repair did not rename, delete or migrate any existing user data.
