// @ts-nocheck
import * as path from "node:path";
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { RaftModule } from "@usex/raft-nestjs";

import { CliModule } from "./cli/cli.module";
import { ClusterModule } from "./cluster/cluster.module";
// Scenarios
import { DistributedCacheModule } from "./scenarios/distributed-cache/distributed-cache.module";
import { GameServerModule } from "./scenarios/game-server/game-server.module";
import { LockServiceModule } from "./scenarios/lock-service/lock-service.module";

import { MonitoringModule } from "./scenarios/monitoring/monitoring.module";
import { TaskQueueModule } from "./scenarios/task-queue/task-queue.module";
// Shared
import { SharedModule } from "./shared/shared.module";

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env.local", ".env"],
    }),

    // Event system
    EventEmitterModule.forRoot({
      wildcard: true,
      delimiter: ".",
      maxListeners: 10,
      verboseMemoryLeak: false,
      ignoreErrors: false,
    }),

    // Raft Consensus
    RaftModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        nodeId: process.env.NODE_ID || "node-1",
        peers: process.env.PEERS?.split(",") || [],
        storageDir: path.join(
          __dirname,
          "../data",
          process.env.NODE_ID || "node-1",
        ),
        electionTimeout: {
          min: Number.parseInt(process.env.ELECTION_MIN_TIMEOUT || "150", 10),
          max: Number.parseInt(process.env.ELECTION_MAX_TIMEOUT || "300", 10),
        },
        heartbeatInterval: Number.parseInt(
          process.env.HEARTBEAT_INTERVAL || "50",
          10,
        ),
        persistence: {
          provider: "redis",
          config: {
            host: process.env.REDIS_HOST || "localhost",
            port: Number.parseInt(process.env.REDIS_PORT || "6379", 10),
            password: process.env.REDIS_PASSWORD,
          },
        },
      }),
      inject: [ConfigService],
    }),

    // Core modules
    SharedModule,
    ClusterModule,
    CliModule,

    // Scenario modules
    DistributedCacheModule,
    TaskQueueModule,
    LockServiceModule,
    GameServerModule,
    MonitoringModule,
  ],
})
export class AppModule {}
