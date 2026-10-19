# Raft and workspace audit — October 19, 2026

**Verdict: the current implementation cannot be described as Raft-conformant or safe for authoritative production data.** Reproducible failures affect persistent term/vote recovery, log matching, membership, snapshots, application data and the SDK contract. The normal-path tests passing does not establish these properties.

This change is an audit deliverable: executable failing regressions, activation of previously skipped tests, a test command for the Nest playground, and this report. It does **not** repair the protocol or application defects listed below. Existing source changes from the preceding Bun/playground work were preserved.

## Scope and reference

Reference: [Raft extended paper](https://raft.github.io/raft.pdf), Figure 2 and sections 5–8. Weighted voting, adaptive timing, Redis transport, Nest integration, application state machines and dashboards are extensions and need their own checks.

| Package                | Audit scope                                                                                                | Status                                                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `@usex/raft`           | Elections, terms/votes, log matching, quorum/commit, membership, snapshot, WAL, recovery, network, metrics | 213 passed; 9 failed; 0 skipped                                                                                                 |
| `@usex/raft-nestjs`    | Existing DI, lifecycle and facade suite                                                                    | 64 passed; event/adaptive failures reproduced in the playground integration below                                               |
| `@usex/raft-kv-server` | Consensus writes, encryption round trip, isolation, snapshots, HTTP/OpenAPI, health and generated SDK      | 25 passed; 7 failed                                                                                                             |
| `@usex/kv-server-sdk`  | Generate from actual local OpenAPI, compile using its configuration, real HTTP client calls                | Generation/compilation and GET/list pass; POST fails validation. These 3 tests are included in the KV totals, not counted twice |
| Raft playground        | Dashboard tests, actual 20-node controls/SSE/data, all 14 executable showcases                             | 14 automated dashboard tests pass; live dashboard passes; stress result below                                                   |
| Nest playground        | Actual cache, lock, queue, game, monitoring and adaptive behavior                                          | 12 failed                                                                                                                       |

**Combined automated result: 316 passed, 28 failed, 0 skipped (344 tests).** Added 31 tests and enabled all 10 formerly skipped engine tests with isolated filesystem fixtures. All 10 now pass. No failing test was converted to a skip or an expected failure.

`bun run build`, `bun run test:types`, `bun run lint`, and `git diff --check` pass. The SDK's ordinary build still skips generation when `src/client` is absent; its real generated output was compiled separately by the new KV integration test. Its own existing test command still has zero tests.

The root `bun run test` stops on the core failures. The other package commands were therefore also run independently to obtain the complete totals above.

## Baseline

The existing suites were run with coverage before adding these regressions: Core 203 passed/10 skipped, Nest 64 passed, KV 22 passed. Together with the 14 dashboard tests, the preceding baseline was 303 passing tests. The new failures expose previously untested behavior; they are not evidence that the audit introduced production-code regressions.

Pre-audit Istanbul coverage, measured from `coverage-final.json`:

| Package | Statements | Functions | Branches |
| ------- | ---------: | --------: | -------: |
| Core    |     77.38% |    81.10% |   67.23% |
| Nest    |     40.13% |    34.29% |   39.18% |
| KV      |     54.08% |    54.44% |   45.71% |

These are baseline coverage figures, not a claim about the expanded suite. The static 90% badge in the core README does not match this measurement. CI currently runs coverage scripts; the dashboard and Nest playground do not have coverage scripts, so their tests also need an explicit CI invocation.

## Reproduced core failures

All nine assertions live in [`spec-compliance.spec.ts`](../packages/raft/test/integration/spec-compliance.spec.ts), using real Redis, unique temporary directories and actual node/WAL implementations. P0 denotes a consensus/data-loss blocker; P1 denotes an important correctness/API defect.

| ID  | Priority | Trigger and observed result                                                                                                                                                              | Implementation                                                                                                         |
| --- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| R1  | P0       | Persist term/vote/log with Redis TTL=1. Persistent keys report TTL **1**, rather than **-1**; an idle node loses them on expiry.                                                         | `RaftNode.persistState`, `RaftLog.persistEntry` use `SETEX`                                                            |
| R2  | P0       | Commit a value, grant a term-7 vote, stop cleanly, remove only that fixture's Redis state, restart using its intact WAL. The node restores **term 0**, rather than 7.                    | `RaftLog.loadFromStorage` discards recovered hard state; startup restores term/vote from Redis only                    |
| R3  | P0       | Replace the fixture's persisted state with invalid JSON. `start()` succeeds instead of rejecting an unknown term/vote history.                                                           | `RaftNode.loadPersistedState` catches corruption and resets state                                                      |
| R4  | P1       | State-machine snapshot creation throws. Public `createSnapshot()` nevertheless resolves successfully.                                                                                    | `RaftNode.saveSnapshot` swallows the exception                                                                         |
| R5  | P0       | Hold an old term-2 AppendEntries at an async step, commit term-3 data, then release the old request. The stale RPC returns **success=true**.                                             | `handleAppendEntries` does not revalidate term after awaited work; stale work can replace the committed log entry      |
| R6  | P0       | Submit two membership changes concurrently. Although one request eventually rejects, **two joint configurations** have already been appended.                                            | `changeClusterConfiguration` checks exclusivity before an await, then mutates the log without reserving the transition |
| R7  | P0       | Install a snapshot whose boundary conflicts with the local suffix. The suffix disappears in memory, but a fresh WAL recovery resurrects index **2**, beyond the expected boundary **1**. | `truncateEntriesAfter`/WAL snapshot recovery do not durably discard the conflicting suffix                             |
| R8  | P0       | Receive an uncommitted joint-configuration entry. The follower continues to expose its previous voting configuration.                                                                    | Followers update membership only in `applyEntries`, after commit                                                       |
| R9  | P0       | Compact a size-limited WAL containing hard state and 12 unsnapshotted entries. Fresh recovery fails: **expected index 1, found 7**.                                                      | `WALEngine.compact` removes old segments based on size, without a safe snapshot boundary                               |

The Raft reference requires persistent term/vote/log state before responses, consistent log-prefix handling, configuration changes with the prescribed voting rules, and snapshot metadata that preserves the configuration. R1–R3, R5–R9 prevent a positive conformance finding. Pre-vote, weighted voting and adaptive timing are extensions; their successful normal-path tests do not repair these failures.

### Additional core findings from code review

These are **code-review findings**, not additional counted reproductions:

- `WALEngine.writeEntry` normally queues writes for a 100 ms timer. `persistEntry` uses `appendFile` without an `fsync` durability barrier. A returned acknowledgement is not proof of stable storage; abrupt process/power-loss durability was not tested.
- `sync()` removes pending writes before finishing disk I/O, and `readSegment()` skips malformed/checksum-invalid records. Combined with recovery catch-and-reset behavior, persistence errors can conceal data loss.
- Snapshot files and InstallSnapshot payloads contain application bytes and index/term, but no voting configuration. A node catching up after configuration entries have been compacted cannot reconstruct membership from that snapshot alone.
- Chunked InstallSnapshot is not assembled: `done=false` is acknowledged and the final chunk is treated as a full snapshot. Normal transport currently sends one complete buffer, so existing examples do not exercise chunking.
- There is no verified automatic completion of an interrupted joint transition after leadership changes, and no rollback of an uncommitted configuration when its log entry is replaced.

## Nest and application data

[`data-integrity.spec.ts`](../packages/nest/playground/test/data-integrity.spec.ts) boots a real Nest module and elected Raft node, registers the actual playground services/handlers, and checks the data after successful proposals. It does not manually emit the events that it expects the core to deliver.

| Failure                                       | Evidence / cause                                                                                                                                                                                                                        |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decorated events are not delivered            | After actual election and proposal, both probe arrays remain empty. `raftEventHandlerProvider` subscribes to enum names such as `leader_elected`; the supplied bus is the node, which emits `raftEvent` and camel-case aliases instead. |
| Cache writes do not materialize               | `set("committed", {value:42})` resolves; `get` returns `null`.                                                                                                                                                                          |
| Lock acquisition does not establish ownership | `acquireLock` returns a lock-shaped object; `getLock` has no stored owner.                                                                                                                                                              |
| Tasks are not stored/assignable               | `createTask` returns an object; `getTask` does not contain its payload.                                                                                                                                                                 |
| Games are not stored/joinable                 | `createGame` returns an object; `getGame` is absent.                                                                                                                                                                                    |
| Cache TTL changes during replay               | Applying a command timestamped 10 seconds earlier with TTL=1 second returns a live value. Expiry uses local apply time instead of the committed timestamp.                                                                              |
| Queue wire data loses required Date values    | JSON round trip changes `createdAt` to a string; application replay does not restore it. Queue operations later use Date methods.                                                                                                       |
| Monitoring shows false log data               | After real committed writes, `getRaftMetrics()` reports term=0 and commitIndex=0. These fields are hard-coded placeholders.                                                                                                             |
| Monitoring reports a stopped cluster healthy  | `healthyNodes` is assigned `nodes.length`; its health comparison is always true.                                                                                                                                                        |
| Adaptive bounds are exceeded                  | Controlled latency=1000 ms and maxElectionTimeout=2000 produce max timeout=2400.                                                                                                                                                        |
| Adaptive changes do not reach the node        | Algorithm returns `[1600,2400]`, while the actual node configuration remains `[10000,20000]`.                                                                                                                                           |
| Adaptive configuration import is ineffective  | Importing `[800,1600]` and other requested values leaves the old algorithm parameters intact. The implementation only logs success.                                                                                                     |

The event mismatch is not the only application issue: `OnLogCommitted` aliases `LOG_REPLICATED`, which occurs before commit; handlers expect command data while the emitted event contains metadata; the default Nest state machine is a no-op. A repair must apply commands exactly once after commitment and provide snapshot/replay support, rather than just rename an event.

Code review also found `Math.random()`-generated adaptive throughput, packet-loss and performance values, and random counters in Nest playground monitoring. These must not be presented as measured telemetry. Locks/tasks/games make concurrency decisions before proposing and use local clocks while applying; mutual exclusion, worker assignment and deterministic replay need further tests after the broken application path is repaired. Cache/monitoring constructor timers lack shutdown hooks; the audit fixture explicitly cleans up its captured timers.

## KV and SDK

[`data-contract.spec.ts`](../packages/kv-server/test/integration/data-contract.spec.ts) uses a real Fastify HTTP server, the actual CQRS/Raft/encryption path, and disposable Redis. It generates the SDK from that running application's OpenAPI and compiles it with the SDK's TypeScript configuration.

**Passed:** Unicode HTTP SET/GET/list/DELETE, generated SDK compilation, generated SDK GET/list against the real server. Existing KV tests also pass.

**Seven failures:**

1. Health checking overwrites and deletes user data stored under the fixed key `health-check`.
2. Invalid HTTP `{value: {invalid:true}}` produces HTTP 500 rather than validation error 400.
3. OpenAPI lacks the POST body schema and GET/list response content schemas.
4. Consequently generated SDK POST rejects a valid `{value: "SDK write"}` with Zod **expected never, received object**, before sending it.
5. Listing keys includes unrelated Redis keys; the accepted `keyPrefix` configuration is ignored by `createRedisInstance`.
6. Snapshots include unrelated keys from the entire logical database.
7. Applying a snapshot calls `FLUSHDB` and deletes unrelated data in that database.

The isolation failures matter when the database is shared. Both Raft and KV factories read `REDIS_DB` when it is explicitly set, even though their unset defaults differ, so enabling that option can also put consensus state and application data together. The audit exercised this only in its own disposable database.

Code review: application reads go straight to Redis, with no quorum/read-index barrier. Strongly consistent or linearizable read claims are therefore not established. The encryption service uses passphrase AES; this audit checked plaintext round trips, not authenticated encryption/tamper resistance. Multiple state machines pointed at one Redis database also share application state directly, which can mask missing replication.

## Raft playground and dashboard

All 14 commands in `all-examples` completed in sequence against a disposable Redis with overall exit code **0**: `cluster`, `election`, `replication`, `membership`, `snapshot`, `failures`, `performance`, `monitoring`, `weighted-voting`, `network-partition`, `leadership-transfer`, `concurrent-writes`, `recovery`, `stress-test`. Stress took **7.2 minutes**, passed final state convergence, and reported **24/100 — Needs Improvement**. The endurance phase completed 2,353 operations with no errors; the chaos phase completed 293 of 307 operations.

A separate real 20-node dashboard cluster passed API controls for write, burst, stop/start, leadership transfer, snapshot, partition/heal and leader failure/recovery. All nodes converged to value=12; every displayed commit index, applied index and value matched its actual node/state machine. SSE contained application and action events; export contained the same cluster state. A browser click on Append entry then displayed value=13 and a matching committed/applied position. Node selection updated the inspector without the oversized default browser outline. These controls used a separate audit port.

At the final environment check, the previous port-3210 preview process had exited with status 137; its cause was not established. The preview was restarted with Bun, the existing preview Redis and the current `NODE_COUNT` source setting. No user storage was migrated or cleared.

These checks establish the behavior of the tested normal paths. They do not contradict the adversarial persistence and membership failures above. A successful stress script exit must also be distinguished from zero workload errors; the 100-client batch in this run recorded **1,074 successes / 926 rejections out of 2,000**. Other audit processes shared the local machine, so this is not an isolated performance benchmark or a production SLA.

## Reproduce

Build the workspace first; Nest and KV resolve the built core package. Docker is required for the Redis fixtures.

```bash
bun run build
bun run --cwd packages/raft test run
bun run --cwd packages/nest test run
bun run --cwd packages/kv-server test run
bun run --cwd packages/nest/playground test
bun run --cwd packages/raft/playground test
bun run test:types
bun run lint
```

Expect nonzero exits in core, KV and Nest playground until the reported defects are fixed. To isolate the new assertions:

```bash
bun run --cwd packages/raft test run test/integration/spec-compliance.spec.ts
bun run --cwd packages/kv-server test run test/integration/data-contract.spec.ts
bun run --cwd packages/nest/playground test
```

For the showcases, point `REDIS_HOST`/`REDIS_PORT` at a separate disposable Redis and set `RAFT_DASHBOARD_OPEN=0` to suppress browser launches. Do not run identical showcase cluster IDs concurrently: they share a filesystem path regardless of Redis port.

## Boundaries and repair order

This is an empirical audit and source review, not exhaustive model checking or a proof of all executions. No production data, external deployment, Git commit or push was performed. Temporary audit clusters use their own keys/directories and are cleaned up.

First repair stable term/vote/log recovery and stale RPC handling; then configuration transitions and snapshot/WAL consistency. Next repair application state-machine/event integration, deterministic commands and KV isolation/health, followed by API/SDK contracts and real adaptive telemetry. The new assertions provide concrete acceptance criteria.

Not established here: physical power-loss recovery, disk-full/permission-failure durability, complete linearizability histories under retries, every interrupted joint-consensus transition, multi-host network behavior, Redis failover/sentinel/cluster operations, authentication/TLS/security claims, or all Nest WebSocket/load/chaos scenarios. Those application scenarios cannot be certified while their basic committed writes fail. The terminal CLI/visualizer have prior validation in the earlier report; they were not re-exercised interactively in this audit.
