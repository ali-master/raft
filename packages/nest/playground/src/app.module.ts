import * as path from "node:path";
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { RaftModule } from "@usex/raft-nestjs";
import type { RaftModuleOptions } from "@usex/raft-nestjs";
import { RaftEngine } from "@usex/raft";

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
      isGlobal: true,
      imports: [ConfigModule],
      useFactory: (configService: ConfigService): RaftModuleOptions => {
        const nodeId = configService.get<string>("NODE_ID", "node-1");
        const config = RaftEngine.createDefaultConfiguration(
          nodeId,
          configService.get<string>("CLUSTER_ID", "playground-cluster"),
        );
        return {
          ...config,
          electionTimeout: [
            Number(configService.get("ELECTION_MIN_TIMEOUT", config.electionTimeout[0])),
            Number(configService.get("ELECTION_MAX_TIMEOUT", config.electionTimeout[1])),
          ],
          heartbeatInterval: Number(
            configService.get("HEARTBEAT_INTERVAL", config.heartbeatInterval),
          ),
          persistence: {
            ...config.persistence,
            dataDir: configService.get<string>(
              "RAFT_DATA_DIR",
              path.join(__dirname, "../data", nodeId),
            ),
          },
        };
      },
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
