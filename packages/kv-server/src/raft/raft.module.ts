import { Module, Global } from "@nestjs/common";
import { ConfigService, ConfigModule } from "@nestjs/config";
import { RaftNode, RaftEngine } from "@usex/raft";
import { KVStateMachine } from "../kv-store/kv-state-machine";
import { EncryptionService } from "../encryption/encryption.service";
import { RaftService } from "./raft.service";
import { RaftController } from "./raft.controller";
import { RedisConfigFactory, RaftConfigFactory } from "../shared";

@Global()
@Module({
  imports: [ConfigModule],
  controllers: [RaftController],
  providers: [
    {
      provide: KVStateMachine,
      useFactory: (
        encryptionService: EncryptionService,
        configService: ConfigService,
      ) => {
        const redisConfig = RedisConfigFactory.createKVStoreConfig(configService);
        return new KVStateMachine(encryptionService, redisConfig);
      },
      inject: [EncryptionService, ConfigService],
    },
    {
      provide: RaftNode,
      useFactory: async (
        stateMachine: KVStateMachine,
        configService: ConfigService,
      ) => {
        const raftConfig = RaftConfigFactory.createRaftConfiguration(configService);

        const raftEngine = new RaftEngine();
        const node = await raftEngine.createNode(raftConfig, stateMachine);
        await node.start();

        return node;
      },
      inject: [KVStateMachine, ConfigService],
    },
    RaftService,
  ],
  exports: [RaftNode, KVStateMachine, RaftService],
})
export class RaftModule {}
