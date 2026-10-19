# Dashboard commands and node metrics

Validated on 2026-10-19 with Bun 1.4.3.

## Delivered behavior

- The interactive playground sends allowlisted `inspect` and `sha256` application commands through the running leader's `appendLog`. Destinations are a particular voting member, all members except the submitting leader, or all members.
- All nodes replicate the same command. The interactive `ObservatoryStateMachine` runs the probe only at selected destinations after apply. Counter value, version and snapshot format are preserved.
- SSE exposes proposal/commit/receipt events and per-destination outputs, execution time and delivery time. Duplicate apply within the retained session does not repeat execution. Unobserved destinations expire after 15 seconds; an expired command cannot run after healing.
- A proposal timeout leaves commit outcome unknown. Later apply can confirm it. Receipts are local observer telemetry, not a distributed response protocol, durable job queue or exactly-once guarantee.
- Node charts expose measured outgoing RPC rate, p50/p95 round-trip latency and replication lag; tables include incoming acknowledged requests, failures, in-flight requests and applied events. History is bounded to 60 samples, successful latency observations to 1,000 within 60 seconds. CPU and memory are explicitly attributed to the shared Bun process.

## Checks

| Check                                                   | Result                                                                                                                                                  |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run --cwd packages/raft/playground test:dashboard` | 22 passed, 0 failed                                                                                                                                     |
| `bun run --cwd packages/raft/playground test:commands`  | 8 passed, 0 failed; isolated Docker Redis, three real Raft nodes                                                                                        |
| Playground `test:types`                                 | Passed                                                                                                                                                  |
| Playground `lint`                                       | Passed                                                                                                                                                  |
| Bun browser bundling and local HTTP/SSE boundary        | Passed in dashboard tests                                                                                                                               |
| Browser, 10 configured nodes                            | All 9 followers returned node reports; only node-3 executed SHA-256 of `abc`; receipt output matched the known digest; counter stayed at 1 on all nodes |
| Browser node selection and charts                       | Selected node drives inspector/charts; followers without outgoing RPC samples show no latency value                                                     |

Integration checks cover specific/broadcast destinations, SSE receipts, stopped-node catch-up, actual partitions and expiry, leadership transfer, quorum loss and later commit, rejected input, metrics and export. The test container and its cluster namespace are cleaned up.

The existing core playground regression suite was also attempted. Testcontainers failed to bind its dynamically requested Redis port to the host (`HostPort: "0"`, empty mapped ports), timed out after 30 seconds, and its old fixture fell back to `redis: null`. The legacy-prefix test consequently failed at `redis.set`. The aggregate was 9 passing / 1 failing, but this run is **not accepted as successful isolated-Redis validation**. The failed-start container was removed. This task did not change the shared core test fixture or its fallback behavior.

No full workspace safety audit, power-loss/exactly-once proof, multi-host job execution, or mobile-browser verification was performed for this feature. Existing core correctness findings in [the spec audit](raft-spec-audit.md) remain unresolved. `NODE_COUNT` retains the user's current value in `src/dashboard/main.ts`.
