import { Module } from "@nestjs/common";
import { CqrsModule } from "@nestjs/cqrs";
import { KVStoreController } from "./kv-store.controller";
import { KVStoreService } from "./kv-store.service";
import { EncryptionModule } from "../encryption/encryption.module";
import { RaftModule } from "../raft/raft.module";

// Commands
import { SetValueHandler } from "./commands/set-value.command";
import { DeleteValueHandler } from "./commands/delete-value.command";

// Queries
import { GetValueHandler } from "./queries/get-value.query";
import { ListKeysHandler } from "./queries/list-keys.query";

// Events
import { ValueSetHandler } from "./events/value-set.event";
import { ValueDeletedHandler } from "./events/value-deleted.event";

const CommandHandlers = [SetValueHandler, DeleteValueHandler];
const QueryHandlers = [GetValueHandler, ListKeysHandler];
const EventHandlers = [ValueSetHandler, ValueDeletedHandler];

@Module({
  imports: [CqrsModule, EncryptionModule, RaftModule],
  controllers: [KVStoreController],
  providers: [KVStoreService, ...CommandHandlers, ...QueryHandlers, ...EventHandlers],
  exports: [KVStoreService],
})
export class KVStoreModule {}
