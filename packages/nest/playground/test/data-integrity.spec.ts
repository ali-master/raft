import "reflect-metadata";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Injectable } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { TestingModule } from "@nestjs/testing";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { LogLevel, RaftEngine } from "@usex/raft";
import {
  RaftModule,
  RaftService,
  OnLeaderElected,
  OnLogCommitted,
  AdaptiveConsensusService,
} from "@usex/raft-nestjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getGlobalRedisContext } from "../../test/shared/test-setup";
import { SharedModule } from "../src/shared/shared.module";
import { DistributedCacheService } from "../src/scenarios/distributed-cache/distributed-cache.service";
import { CacheEventHandler } from "../src/scenarios/distributed-cache/cache-event.handler";
import { LockService } from "../src/scenarios/lock-service/lock-service.service";
import { LockEventHandler } from "../src/scenarios/lock-service/lock-event.handler";
import { TaskQueueService } from "../src/scenarios/task-queue/task-queue.service";
import { TaskEventHandler } from "../src/scenarios/task-queue/task-event.handler";
import { GameServerService } from "../src/scenarios/game-server/game-server.service";
import { GameEventHandler } from "../src/scenarios/game-server/game-event.handler";
import { MonitoringService } from "../src/scenarios/monitoring/monitoring.service";

@Injectable()
class EventProbe {
  leaders: unknown[] = [];
  commits: unknown[] = [];

  @OnLeaderElected()
  onLeader(event: unknown) {
    this.leaders.push(event);
  }

  @OnLogCommitted()
  onCommit(event: unknown) {
    this.commits.push(event);
  }
}

describe("Nest playground: committed application data", () => {
  let module: TestingModule;
  let raft: RaftService;
  let dataDir: string;
  const intervals: ReturnType<typeof setInterval>[] = [];

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "raft-nest-audit-"));
    const { container } = getGlobalRedisContext();
    const config = RaftEngine.createDefaultConfiguration("audit-node", dataDir);
    config.redis = {
      ...config.redis,
      host: container.getHost(),
      port: container.getMappedPort(6379),
      keyPrefix: `${dataDir}:`,
    };
    config.persistence = { ...config.persistence, dataDir };
    config.logging = {
      ...config.logging,
      level: LogLevel.ERROR,
      enableConsole: false,
    };
    config.electionTimeout = [10000, 20000];
    config.peers = [config.nodeId];
    // Capture constructor timers because cache and monitoring lack shutdown hooks.
    const realSetInterval = globalThis.setInterval;
    const timerSpy = vi.spyOn(globalThis, "setInterval").mockImplementation(((
      ...args: Parameters<typeof setInterval>
    ) => {
      const timer = realSetInterval(...args);
      intervals.push(timer);
      return timer;
    }) as typeof setInterval);
    try {
      module = await Test.createTestingModule({
        imports: [
          EventEmitterModule.forRoot(),
          RaftModule.forRoot({ ...config, isGlobal: true }),
          SharedModule,
        ],
        providers: [
          EventProbe,
          DistributedCacheService,
          CacheEventHandler,
          LockService,
          LockEventHandler,
          TaskQueueService,
          TaskEventHandler,
          GameServerService,
          GameEventHandler,
          MonitoringService,
        ],
      }).compile();
      await module.init();
      raft = module.get(RaftService);
      await raft.forceElection();
    } finally {
      timerSpy.mockRestore();
    }
  });

  afterAll(async () => {
    for (const timer of intervals) clearInterval(timer);
    await module?.close();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  it("delivers actual election and commit events to decorated handlers", async () => {
    await raft.propose({ audit: true });
    const probe = module.get(EventProbe);
    expect.soft(probe.leaders.length).toBeGreaterThan(0);
    expect(probe.commits.length).toBeGreaterThan(0);
  });

  it("reads a cache value after the write is committed", async () => {
    const cache = module.get(DistributedCacheService);
    await cache.set("committed", { value: 42 });
    expect(await cache.get("committed")).toEqual({ value: 42 });
  });

  it("records ownership before a successful lock acquisition returns", async () => {
    const locks = module.get(LockService);
    const acquired = await locks.acquireLock({
      resource: "committed-lock",
      owner: "alice",
    });
    expect(locks.getLock(acquired.resource)?.owner).toBe("alice");
  });

  it("stores a newly created task and allows it to be assigned", async () => {
    const queue = module.get(TaskQueueService);
    const task = await queue.createTask("audit", { value: 42 });
    expect(queue.getTask(task.id)?.payload).toEqual({ value: 42 });
    expect((await queue.assignNextTask("worker"))?.id).toBe(task.id);
  });

  it("stores a created game and accepts a player", async () => {
    const games = module.get(GameServerService);
    const game = await games.createGame("Audit game");
    expect(games.getGame(game.id)?.name).toBe("Audit game");
    await games.joinGame(game.id, "alice", "Alice");
    expect(games.getGame(game.id)?.players.has("alice")).toBe(true);
  });

  it("derives cache expiry from the committed command timestamp", async () => {
    const cache = module.get(DistributedCacheService);
    cache.applyOperation({
      type: "SET",
      key: "expired-at-source",
      value: "old",
      ttl: 1,
      timestamp: Date.now() - 10000,
    });
    expect(await cache.get("expired-at-source")).toBeNull();
  });

  it("keeps queue dates usable after the Redis JSON wire round trip", async () => {
    const queue = module.get(TaskQueueService);
    const task = await queue.createTask("wire", {});
    queue.applyOperation(
      JSON.parse(
        JSON.stringify({ type: "CREATE", task, timestamp: Date.now() }),
      ),
    );
    expect(queue.getTask(task.id)?.createdAt).toBeInstanceOf(Date);
  });

  it("reports the actual Raft term and commit index", async () => {
    await raft.propose({ metric: true });
    const metrics = await module.get(MonitoringService).getRaftMetrics();
    const node = raft.getNode()!;
    expect.soft(metrics.term).toBe(node.getCurrentTerm());
    expect(metrics.commitIndex).toBe(node.getCommitIndex());
  });

  async function adaptToSlowNetwork() {
    const service = module.get(AdaptiveConsensusService);
    await service.updateConfiguration({
      enabled: true,
      learningRate: 1,
      latencyThreshold: 0,
      minElectionTimeout: 150,
      maxElectionTimeout: 2000,
    });
    const algorithm = service.getAdaptiveAlgorithm("audit-node")!;
    vi.spyOn(algorithm as any, "collectNetworkMetrics").mockResolvedValue({
      averageLatency: 1000,
      packetLoss: 0,
      throughput: 500,
      jitter: 0,
    });
    await service.forceAdaptation("audit-node");
    return { service, algorithm };
  }

  it("keeps adaptive election timeouts within configured bounds", async () => {
    const { algorithm } = await adaptToSlowNetwork();
    expect(
      algorithm.getCurrentParameters().electionTimeout[1],
    ).toBeLessThanOrEqual(2000);
  });

  it("applies adaptive parameters to the actual Raft node", async () => {
    const { algorithm } = await adaptToSlowNetwork();
    const parameters = algorithm.getCurrentParameters();
    expect(raft.getNode()!.getConfiguration().electionTimeout).toEqual(
      parameters.electionTimeout,
    );
  });

  it("restores node parameters when importing adaptive configuration", async () => {
    const { service } = await adaptToSlowNetwork();
    const parameters = {
      electionTimeout: [800, 1600] as [number, number],
      heartbeatInterval: 100,
      batchSize: 10,
      replicationTimeout: 900,
    };
    await service.importConfiguration({
      serviceConfig: {},
      nodeConfigurations: { "audit-node": parameters },
    });
    expect(service.getCurrentParameters("audit-node")).toEqual(parameters);
  });

  it("does not label a stopped cluster healthy", async () => {
    await raft.getNode()!.stop();
    expect(
      (await module.get(MonitoringService).getClusterHealth()).healthy,
    ).toBe(false);
  });
});
