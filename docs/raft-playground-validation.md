# Raft playground validation

The later [workspace specification audit](raft-spec-audit.md) reproduces additional consensus and data-correctness failures. The successful scenarios below describe the earlier tested paths; they do not establish full Raft conformance.

Validated on October 18–19, 2026 with Bun 1.4.3, Vitest 5.0.5, and disposable local Redis containers. The work covers `packages/raft` and its playground. Existing Bun migration changes remain in the checkout.

## What was repaired

- **Commit and application:** single-node writes now commit; successful appends wait for state-machine application. Application and snapshot work are serialized so concurrent requests cannot apply an entry twice. Follower commit positions never move backward and acknowledgements cover only the matched log prefix.
- **Membership and elections:** losing a discovery record no longer removes a voting member. Elections and commits use the configured quorum, including both configurations during joint consensus. Per-peer replication prevents an unreachable member from starving healthy followers. Static voting weights are shared across election and commit decisions.
- **Replication and persistence:** duplicate or partial AppendEntries batches preserve an already matching suffix. Snapshots cover applied entries, preserve uncommitted suffixes, retain the snapshot boundary term, and survive a fresh node's WAL recovery. Snapshot buffers are restored after Redis JSON transport. Snapshot files are written through a temporary file and rename.
- **Transport and restart:** blocking response reads use separate reusable Redis connections, avoiding blocked storage writes and connection churn. Stop/start closes and restores the messaging path. Leadership transfer catches up the target, pauses new writes, and confirms the target's election before returning.
- **Namespace isolation:** Raft state and log keys now honor `redis.keyPrefix`. Playground cleanup is scoped to its own cluster. KV examples prefix keys exactly once and clear/restore only their own keys. Counter commands preserve an explicit zero amount.
- **Executable scenarios:** missing CLI/visualizer entry points now run. Partition scenarios actually block cross-group RPCs while leaving the nodes running. Transfer scenarios call the transfer API. Weighted scenarios use configured weights. Recovery creates a fresh node to verify persisted recovery; the misleading corruption simulation was removed. Failed result checks throw and standalone commands report failure through their exit status.
- **Interactive controls:** stopped nodes can be found and restarted, active counts reflect running nodes, the visualizer lists its controls and routes logs into its panel, and quitting waits for cleanup. Progress rendering clamps percentages so a timed stress run cannot crash after crossing 100%.

The quorum, log-prefix, and snapshot checks follow the invariants described in the [Raft paper](https://raft.github.io/raft.pdf). Passing these examples is not a formal safety or linearizability proof.

## Individual executions

Commands were run independently against disposable Redis, using the normal playground configuration. Expected timeouts during deliberate failures are part of the scenarios. Successful runs below finished with exit code 0 and no failed result markers. Timing varies with local load.

| Script | Result | Checked |
| --- | --- | --- |
| `cluster` | Passed | Election, committed writes, convergence |
| `election` | Passed | Elections, failure, recovery |
| `replication` | Passed | Replication and matching state |
| `membership` | Passed | Membership changes and continued writes |
| `snapshot` | Passed | Compaction and recovery |
| `failures` | Passed | Failure, quorum loss, partition, recovery of stopped nodes |
| `performance` | Passed | Throughput/latency loads; no socket-reset crash |
| `monitoring` | Passed | Metrics and running-node counts |
| `weighted-voting` | Passed | Static weight quorum and recovery |
| `network-partition` | Passed | Minority rejects writes; healed nodes converge |
| `leadership-transfer` | Passed | Handover to the requested node |
| `concurrent-writes` | Passed | Concurrent clients and final consistency assertion |
| `recovery` | Passed | Lost quorum, rolling restart, fresh-instance recovery |
| `stress-test` | Completed; workload errors observed | Throughput, concurrent clients, memory, chaos, endurance, final consistency |
| `interactive` | Passed | Create 3 nodes, increment, stop/start, status, add/remove a node, exit |
| `visualizer` | Passed | Submit, fail, restart, partition, heal, quit; cleanup completed |

Also executed the main command dispatcher with `bun run start --no-interactive showcase --showcase cluster`; it ran only the selected scenario and exited successfully. `all-examples` now lists all 14 non-interactive scenarios; the same scenarios were exercised individually during validation.

The final 100-client stress batch recorded **1,806 successful requests and 194 rejected requests out of 2,000** (90.30% success). The observed rejection was loss of leadership while awaiting commitment. The stress scenario measures overload and failure behavior; a completed run does not mean zero request errors. It separately asserts final state convergence, which passed. The full stress run took 6.6 minutes and exited with code 0; its built-in performance score was 24/100 (Needs Improvement). No production throughput SLA is inferred from a seven-node cluster sharing one local process.

## Automated checks

- Core Raft suite: **199 passed, 0 failed, 10 skipped**, across 32 passing test files. The 10 skipped tests were already skipped; no failing tests were disabled to obtain this result.
- Seven integration regressions cover single-node commitment and fresh recovery, concurrent application/transfer, monotonic commit positions, snapshot catch-up and minority rejection, static weighted quorum, prefix isolation, and joint consensus membership.
- Additional focused regressions cover KV namespace isolation, counter zero values, duplicate log batches, snapshot boundary terms, response connection reuse/shutdown, and progress bounds.
- Real Redis tests use real timers and consistent member IDs. Tests now wait for actual discovery/election and account for leader no-op entries instead of stale fixed indices.
- Workspace build, typecheck, and lint passed. The final core/playground typechecks and Raft lint also passed after the last source edits.
- The original playground run left **14 Nest and 3 KV failures**. The October 19 follow-up repaired all 17: the full workspace now has **Core 203 passed / 10 existing skips**, **Nest 64 passed**, **KV 22 passed**, and **dashboard 14 passed**, with no failures. It also adds current-term leader reporting, public election controls, and legacy Redis recovery coverage. See [the follow-up report](bun-migration.md#nestkv-follow-up).

## Run again

```bash
# Repository root; Docker must be running for integration tests.
bun install --frozen-lockfile
bun run build
bun run --cwd packages/raft test run
bun run test:types
bun run lint

# Point to an empty, disposable Redis instance.
REDIS_HOST=127.0.0.1 REDIS_PORT=6379 bun run --cwd packages/raft/playground all-examples
bun run --cwd packages/raft/playground interactive
bun run --cwd packages/raft/playground visualizer
```

Use the same Redis environment variables for the interactive commands. Do not run the same example twice concurrently on one machine: its snapshot directory is named by the example's cluster ID, independent of the Redis port.

## Compatibility and limits

`redis.keyPrefix` was previously ignored for Raft state/log storage. Existing installations that already have unprefixed keys must explicitly use an empty prefix to retain that layout, or migrate the state/log keys while stopped before enabling a prefix. KV server now exposes `RAFT_REDIS_KEY_PREFIX=` for this empty-prefix compatibility mode; leaving the variable unset selects `raft:<RAFT_CLUSTER_ID>:`. A real Redis regression verifies legacy recovery. See [the migration instructions](bun-migration.md#existing-redis-data). No existing user data was migrated or deleted during these checks.

`appendLog()` now means committed and applied when it resolves. A timeout can still have an unknown outcome if an entry commits later; client retries need application-level idempotency. This work does not add request deduplication.

Weighted voting requires identical positive static maps on every member; live weight changes are not supported. The tests do not establish Byzantine tolerance, physical disk-corruption recovery, multi-host durability, or production readiness. No commit, push, or deployment was performed.
