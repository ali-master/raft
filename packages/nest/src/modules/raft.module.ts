import type {
  Provider,
  OnApplicationShutdown,
  OnApplicationBootstrap,
  DynamicModule,
} from "@nestjs/common";
import { Module, Inject } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import { EventEmitterModule } from "@nestjs/event-emitter";
import type { RaftNode, RaftEngine } from "@usex/raft";
import {
  RAFT_NODE,
  RAFT_MODULE_OPTIONS,
  RAFT_EVENT_BUS,
  RAFT_ENGINE,
} from "../constants";
import {
  raftNodeProvider,
  raftEventHandlerProvider,
  raftEventBusProvider,
  raftEngineProvider,
} from "../providers";
import { RaftService, AdaptiveConsensusService } from "../services";
import type {
  RaftOptionsFactory,
  RaftModuleOptions,
  RaftModuleAsyncOptions,
} from "../interfaces";

@Module({})
export class RaftModule
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  constructor(
    @Inject(RAFT_ENGINE) private readonly engine: RaftEngine,
    @Inject(RAFT_NODE) private readonly node: RaftNode,
  ) {}

  static forRoot(options: RaftModuleOptions): DynamicModule {
    const providers: Provider[] = [
      {
        provide: RAFT_MODULE_OPTIONS,
        useValue: options,
      },
      raftEngineProvider,
      raftNodeProvider,
      raftEventBusProvider,
      raftEventHandlerProvider,
      RaftService,
      AdaptiveConsensusService,
    ];

    const dynamicModule: DynamicModule = {
      module: RaftModule,
      imports: [DiscoveryModule, ConfigModule, EventEmitterModule.forRoot()],
      providers,
      exports: [
        RAFT_ENGINE,
        RAFT_NODE,
        RAFT_EVENT_BUS,
        RAFT_MODULE_OPTIONS,
        RaftService,
        AdaptiveConsensusService,
      ],
    };

    if (options.isGlobal) {
      dynamicModule.global = true;
    }

    return dynamicModule;
  }

  static forRootAsync(options: RaftModuleAsyncOptions): DynamicModule {
    const providers: Provider[] = [
      ...this.createAsyncProviders(options),
      raftEngineProvider,
      raftNodeProvider,
      raftEventBusProvider,
      raftEventHandlerProvider,
      RaftService,
      AdaptiveConsensusService,
    ];

    const dynamicModule: DynamicModule = {
      module: RaftModule,
      imports: [
        DiscoveryModule,
        ConfigModule,
        EventEmitterModule.forRoot(),
        ...(options.imports || []),
      ],
      providers,
      exports: [
        RAFT_ENGINE,
        RAFT_NODE,
        RAFT_EVENT_BUS,
        RAFT_MODULE_OPTIONS,
        RaftService,
        AdaptiveConsensusService,
      ],
    };

    if (options.isGlobal) {
      dynamicModule.global = true;
    }

    return dynamicModule;
  }

  private static createAsyncProviders(
    options: RaftModuleAsyncOptions,
  ): Provider[] {
    if (options.useExisting || options.useFactory) {
      return [this.createAsyncOptionsProvider(options)];
    }

    return [
      this.createAsyncOptionsProvider(options),
      {
        provide: options.useClass!,
        useClass: options.useClass!,
      },
    ];
  }

  private static createAsyncOptionsProvider(
    options: RaftModuleAsyncOptions,
  ): Provider {
    if (options.useFactory) {
      return {
        provide: RAFT_MODULE_OPTIONS,
        useFactory: options.useFactory,
        inject: options.inject || [],
      };
    }

    return {
      provide: RAFT_MODULE_OPTIONS,
      useFactory: async (optionsFactory: RaftOptionsFactory) =>
        await optionsFactory.createRaftOptions(),
      inject: [options.useExisting || options.useClass!],
    };
  }

  async onApplicationBootstrap() {
    await this.node.start();
  }

  async onApplicationShutdown() {
    await this.node.stop();
  }
}
