<div align="center">
  <img src="../../assets/logo.svg" alt="Raft Quorum mark" width="88" height="88" />
  <h1>@usex/raft-nestjs</h1>
  <p>Configure Raft, inject nodes, and observe consensus from NestJS.</p>
  <p><a href="../../README.md">Workspace</a> · <a href="./playground/README.md">NestJS playground</a> · <a href="../raft/README.md">Core engine</a></p>
</div>

This package provides `RaftModule`, `RaftService`, injection decorators, event-decorator metadata, and an experimental `AdaptiveConsensusService`. `RaftModule` creates one default node, starts it during application bootstrap, and stops it during application shutdown.

**Current limits:** the default node uses a no-op state machine, and automatic event-decorator delivery has an unresolved mismatch with the core event channel. This guide shows working direct subscriptions and explicit state-machine wiring as well as the decorator reference. A committed proposal alone does not prove your application data changed. Core persistence/membership and adaptive-timing limitations also apply.

## Contents

- [Install and run](#install-and-run)
- [Module configuration](#module-configuration)

## Install and run

In a NestJS application using Bun >= 1.4.3:

```bash
bun add @usex/raft-nestjs @usex/raft \
  @nestjs/common@^12.1.3 @nestjs/core@^12.1.3 \
  @nestjs/config@^12.0.1 @nestjs/event-emitter@^12.0.1 \
  reflect-metadata@^0.2.2 rxjs@^7.8.2
```

The package also declares Node.js >= 22.22.3 compatibility. Use legacy TypeScript decorators in your application configuration:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true
  }
}
```

Bun's direct TypeScript execution does not replace Nest's metadata-emitting compilation workflow. The examples use explicit injection decorators where needed; for ordinary type-inferred constructor injection, compile with the application's Nest/TypeScript build and run the JavaScript with Bun.

For workspace development, run these from the repository root:

```bash
bun install --frozen-lockfile
bun run --cwd packages/raft build
bun run --cwd packages/nest build
```

Start disposable Redis in a separate terminal:

```bash
docker run --rm --name raft-redis -p 127.0.0.1:6389:6379 redis:7-alpine
```

Save this complete example as `main.ts`. It starts one node, waits for election, submits a diagnostic command, prints local consensus positions, and closes the Nest context:

```typescript
import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { RaftEngine, type RaftEvent } from "@usex/raft";
import { RaftModule, RaftService } from "@usex/raft-nestjs";

const defaults = RaftEngine.createDefaultConfiguration("node-1", "nest-readme");

@Module({
  imports: [
    RaftModule.forRoot({
      ...defaults,
      isGlobal: true,
      redis: {
        ...defaults.redis,
        host: process.env.REDIS_HOST ?? "127.0.0.1",
        port: Number(process.env.REDIS_PORT ?? 6389),
        keyPrefix: "raft:nest-readme:",
      },
      voting: { ...defaults.voting, enableWeighting: false },
      persistence: {
        ...defaults.persistence,
        dataDir: "./data/nest-readme/node-1",
      },
    }),
  ],
})
class AppModule {}

const app = await NestFactory.createApplicationContext(AppModule);
app.enableShutdownHooks();
try {
  const raft = app.get(RaftService);
  const node = raft.getNode()!;
  const onEvent = (event: RaftEvent) => console.log(event.type, event.data);
  node.on("raftEvent", onEvent);

  const deadline = Date.now() + 10_000;
  while (!raft.isLeader()) {
    if (Date.now() >= deadline) throw new Error("Leader election timed out");
    await Bun.sleep(50);
  }
  await raft.propose({ type: "diagnostic", message: "Hello from Nest" });
  console.log({
    leader: raft.getLeaderId(),
    commitIndex: node.getCommitIndex(),
  });
  node.off("raftEvent", onEvent);
} finally {
  await app.close();
}
```

```bash
REDIS_PORT=6389 bun main.ts
```

This example demonstrates consensus only. To store application data, use the state-machine example below. For an HTTP Nest app, call `app.enableShutdownHooks()` after `NestFactory.create(...)`; the module hooks perform cleanup when that app closes.

## Module configuration

### `RaftModule.forRoot(options)`

Returns a Nest `DynamicModule`. `RaftModuleOptions` requires `nodeId` and `clusterId`, accepts `isGlobal?: boolean`, and otherwise extends `Partial<RaftConfiguration>`.

The module applies core defaults and then **shallow-merges** options. Supplying `redis`, `network`, `voting`, or `persistence` replaces that entire nested object. Start with `RaftEngine.createDefaultConfiguration(nodeId, clusterId)` and spread each nested object when overriding a field.

| Option                                 | Default / purpose                                                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `nodeId`, `clusterId`                  | Required stable identities.                                                                                                                                  |
| `isGlobal`                             | Unset/false; otherwise exported providers are visible across the application.                                                                                |
| `httpHost`, `httpPort`                 | `localhost`, `3000`; advertised endpoint, not an HTTP server.                                                                                                |
| `peers`                                | Optional complete initial voting membership, including the local node itself.                                                                                |
| `electionTimeout`, `heartbeatInterval` | `[300, 500]`, `150`, in milliseconds.                                                                                                                        |
| `redis`                                | Host/port/password/db from `REDIS_*`; defaults `localhost:6379`, DB `0`. Optional `keyPrefix`, `ttl` (seconds). Use an explicit prefix for new applications. |
| `voting`                               | `enableWeighting: true`, `defaultWeight: 1`, `weightMetrics`; optional fixed `weights` map. Set `enableWeighting: false` for ordinary majority voting.       |
| `persistence`                          | Snapshots and WAL enabled, data directory `/var/lib/raft`, snapshot interval `300000` ms, WAL limit `104857600` bytes. Override the directory per node.      |
| `network`                              | `requestTimeout: 5000`, `maxRetries: 3`, `retryDelay: 100`, breaker threshold `5`, breaker timeout `30000` ms.                                               |
| `metrics`                              | Internal/Prometheus enabled; collection every `5000` ms.                                                                                                     |
| `logging`                              | `level: LogLevel.INFO`, structured logging, password/token/secret redaction.                                                                                 |
| `maxLogEntries`, `snapshotThreshold`   | `10000`, `1000`.                                                                                                                                             |
| `peerDiscovery`                        | `registrationInterval: 5000`, `healthCheckInterval: 10000`, `peerTimeout: 30000`, in milliseconds.                                                           |
| `retry`                                | `maxAttempts: 3`, `backoffFactor: 2`, `initialDelay: 100` ms.                                                                                                |
| `circuitBreaker`                       | `timeout: 3000` ms, `errorThresholdPercentage: 50`, `resetTimeout: 30000` ms.                                                                                |
| `adaptiveConsensus`                    | Optional complete adaptive configuration; disabled by default. See its reference below.                                                                      |

Membership, Redis state/log expiry, and WAL/snapshot limitations are inherited from the core. Redis namespace changes do not migrate existing data. Preserve an explicitly empty prefix when recovering a legacy unprefixed installation.

### `RaftModule.forRootAsync(options)`

Use exactly one of `useFactory`, `useClass`, or `useExisting`. `imports` makes dependencies available to the options provider; `inject` supplies arguments to `useFactory`. Set `isGlobal` on the outer async options.

```typescript
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { RaftEngine } from "@usex/raft";
import { RaftModule } from "@usex/raft-nestjs";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    RaftModule.forRootAsync({
      isGlobal: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (env: ConfigService) => {
        const nodeId = env.get<string>("NODE_ID", "node-1");
        const config = RaftEngine.createDefaultConfiguration(
          nodeId,
          "async-example",
        );
        return {
          ...config,
          redis: {
            ...config.redis,
            port: Number(env.get("REDIS_PORT", 6389)),
            keyPrefix: "raft:async-example:",
          },
          voting: { ...config.voting, enableWeighting: false },
          persistence: {
            ...config.persistence,
            dataDir: `./data/async-example/${nodeId}`,
          },
        };
      },
    }),
  ],
})
export class AsyncAppModule {}
```

For a class-based factory, implement `RaftOptionsFactory.createRaftOptions(): RaftModuleOptions | Promise<RaftModuleOptions>`. `useClass: YourFactory` creates a provider instance; `useExisting: YourFactory` reuses one exported by an imported module. Returned values must still include `nodeId` and `clusterId`. Async configuration errors reject application startup.

## License

[MIT](../../LICENCE) · [Ali Torki](https://github.com/ali-master)
