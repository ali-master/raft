<div align="center">
  <img src="../../assets/logo.svg" alt="Raft Quorum mark" width="88" height="88" />
  <h1>@usex/raft</h1>
  <p>Leader election, replicated commands, and application state machines in TypeScript.</p>
  <p><a href="../../README.md">Workspace</a> · <a href="./playground/README.md">Observatory</a> · <a href="../nest/README.md">NestJS integration</a></p>
</div>

Use this package when your application needs several nodes to agree on an ordered sequence of commands. The leader appends commands; each member applies committed commands to its own state machine. Redis provides transport, discovery, and log/state storage. Local files provide WAL and snapshot storage.

**Development status:** normal-path examples work, but persistence, concurrent membership changes, and snapshot recovery have known correctness failures. Use disposable data while evaluating this version. It is not yet verified for authoritative production data. The limitations relevant to each API are described below; the [audit](../../docs/raft-spec-audit.md) contains the regression results.

## Contents

- [Install](#install)
- [Run a replicated counter](#run-a-replicated-counter)
- [Application state and snapshots](#application-state-and-snapshots)

## Install

```bash
bun add @usex/raft ioredis opossum prom-client
```

Use Bun >= 1.4.3. ESM and CommonJS consumers on Node.js >= 22.22.3 are also supported by the package exports. The examples below run with Bun.

For a checkout of this repository, build the package before running an example; workspace imports resolve its compiled output:

```bash
bun install --frozen-lockfile
bun run --cwd packages/raft build
```

Start a dedicated development Redis in a separate terminal:

```bash
docker run --rm --name raft-redis -p 127.0.0.1:6389:6379 redis:7-alpine
```

## Run a replicated counter

Save the following as `counter.ts` in your application. It creates three local nodes, waits for a leader, commits one increment, checks that every state machine applied it, and shuts down. A fresh data directory prints `[1, 1, 1]`.

```typescript
import { RaftEngine, RaftState, type StateMachine } from "@usex/raft";

class Counter implements StateMachine {
  value = 0;

  async apply(command: unknown): Promise<void> {
    if (
      typeof command !== "object" ||
      command === null ||
      !("type" in command) ||
      command.type !== "increment" ||
      !("amount" in command) ||
      typeof command.amount !== "number" ||
      !Number.isSafeInteger(command.amount) ||
      !Number.isSafeInteger(this.value + command.amount)
    )
      throw new Error("Invalid counter command");
    this.value += command.amount;
  }

  async getSnapshotData(): Promise<Buffer> {
    return Buffer.from(JSON.stringify({ value: this.value }));
  }

  async applySnapshot(data: Buffer): Promise<void> {
    const snapshot = JSON.parse(data.toString());
    if (!Number.isSafeInteger(snapshot.value))
      throw new Error("Invalid snapshot");
    this.value = snapshot.value;
  }
}

async function waitFor(
  check: () => boolean,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error("Cluster did not become ready");
    await Bun.sleep(50);
  }
}

const engine = new RaftEngine();
const clusterId = process.env.CLUSTER_ID ?? "readme-counter";
const ids = ["node-1", "node-2", "node-3"];
const counters = ids.map(() => new Counter());

try {
  const nodes = await Promise.all(
    ids.map((id, index) => {
      const config = RaftEngine.createDefaultConfiguration(id, clusterId);
      config.peers = ids;
      config.httpPort = 4101 + index;
      config.redis = {
        ...config.redis,
        host: process.env.REDIS_HOST ?? "127.0.0.1",
        port: Number(process.env.REDIS_PORT ?? 6389),
        keyPrefix: `raft:${clusterId}:`,
      };
      config.voting = { ...config.voting, enableWeighting: false };
      config.persistence = {
        ...config.persistence,
        dataDir: `./data/${clusterId}/${id}`,
      };
      return engine.createNode(config, counters[index]);
    }),
  );

  await Promise.all(ids.map((id) => engine.startNode(id)));
  await waitFor(
    () =>
      nodes.filter((node) => node.getState() === RaftState.LEADER).length === 1,
  );
  const leader = nodes.find((node) => node.getState() === RaftState.LEADER)!;
  const leaderIndex = nodes.indexOf(leader);
  const expected = counters[leaderIndex]!.value + 1;

  await leader.appendLog({ type: "increment", amount: 1 });
  await waitFor(() => counters.every((counter) => counter.value === expected));
  console.log(
    "Replicated values:",
    counters.map((counter) => counter.value),
  );
} finally {
  await engine.stopAllNodes();
}
```

```bash
REDIS_PORT=6389 bun counter.ts
```

Each node needs a unique `nodeId` and writable `persistence.dataDir`. Members share the same `clusterId`, Redis connection, voting map, and Raft key prefix. **`peers` is the complete initial voting membership, including the local node itself.** Omitting self prevents that node from starting elections. For separate processes, create one node in each process and configure the same complete membership. Redis discovery can find peers, but do not treat discovery alone as an atomic cluster membership change.

A `RaftNode` does not start an HTTP listener. `httpHost`/`httpPort` describe its advertised endpoint; the default transport uses Redis. The HTTP KV server and the Observatory start their own listeners.

## Application state and snapshots

The public contract is:

```typescript
import type { StateMachine } from "@usex/raft";

type SetCommand = { type: "set"; key: string; value: string };

// Contract illustration; the Counter above is a complete implementation.
type ApplicationState = StateMachine<SetCommand>;
// apply(command: SetCommand): Promise<void>
// getSnapshotData(): Promise<Buffer>
// applySnapshot(data: Buffer): Promise<void>
```

`new RaftNode<TCommand>(config, stateMachine)` preserves your command type. `engine.createNode(config, stateMachine?)` is the lifecycle-managed convenience API. Omitting its state machine installs a no-op implementation: proposals can commit without changing application data.

- **`apply`** receives the application payload, not a `LogEntry` wrapper. Keep it deterministic: put timestamps, IDs, and intended values in the proposed command instead of generating them independently on each replica. Validate input before proposing; an exception during apply can prevent later application progress.
- **`getSnapshotData`** serializes the complete application state into bytes. Include your own format version when the application schema evolves.
- **`applySnapshot`** replaces local application state with the supplied snapshot. Validate the entire payload before replacing existing state. Restore JSON dates/maps explicitly when your state uses them.
- An application must implement its own command IDs/deduplication if retrying a write could repeat a side effect. The library does not provide a persistent distributed job queue or exactly-once external execution.
- Reads from your state machine are local reads. There is no public read-index/quorum-barrier API establishing linearizable reads.

`await node.createSnapshot()` requests a snapshot. Snapshot errors can currently be logged and swallowed, so a resolved call is not sufficient proof that a usable snapshot exists. Snapshot/WAL recovery has additional known defects; test your application's restore path before relying on it.

## License

[MIT](../../LICENCE) · [Ali Torki](https://github.com/ali-master)
