import { Module, Injectable } from "@nestjs/common";
import { ConfigService, ConfigModule } from "@nestjs/config";
import type { RaftOptionsFactory, RaftModuleOptions } from "@usex/raft-nestjs";
import { RaftModule } from "@usex/raft-nestjs";

// Configuration factory
@Injectable()
export class RaftConfigService implements RaftOptionsFactory {
  constructor(private readonly configService: ConfigService) {}

  createRaftOptions(): RaftModuleOptions {
    return {
      nodeId: this.configService.get("RAFT_NODE_ID", "node-1"),
      clusterId: this.configService.get("RAFT_CLUSTER_ID", "my-cluster"),
      httpHost: this.configService.get("RAFT_HTTP_HOST", "localhost"),
      httpPort: this.configService.get("RAFT_HTTP_PORT", 3001),
      electionTimeout: [150, 300],
      heartbeatInterval: 50,
      redis: {
        host: this.configService.get("REDIS_HOST", "localhost"),
        port: this.configService.get("REDIS_PORT", 6379),
        password: this.configService.get("REDIS_PASSWORD"),
      },
      metrics: {
        enablePrometheus: true,
        enableInternal: true,
        collectionInterval: 5000,
      },
      logging: {
        level: this.configService.get("LOG_LEVEL", "info") as any,
        enableStructured: true,
      },
    };
  }
}

// Application module with async configuration
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    RaftModule.forRootAsync({
      imports: [ConfigModule],
      useClass: RaftConfigService,
      isGlobal: true,
    }),
  ],
})
export class AppModule {}

// Alternative: Using factory function
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    RaftModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (
        configService: ConfigService,
      ): Promise<RaftModuleOptions> => ({
        nodeId: configService.get("RAFT_NODE_ID", "node-1"),
        clusterId: configService.get("RAFT_CLUSTER_ID", "my-cluster"),
        httpHost: configService.get("RAFT_HTTP_HOST", "localhost"),
        httpPort: configService.get("RAFT_HTTP_PORT", 3001),
        electionTimeout: [150, 300],
        heartbeatInterval: 50,
        redis: {
          host: configService.get("REDIS_HOST", "localhost"),
          port: configService.get("REDIS_PORT", 6379),
          password: configService.get("REDIS_PASSWORD"),
        },
      }),
      inject: [ConfigService],
      isGlobal: true,
    }),
  ],
})
export class AlternativeAppModule {}
