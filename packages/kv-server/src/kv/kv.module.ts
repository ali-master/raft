import { Module, Logger } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { KvController } from './kv.controller';
import { KvService } from './kv.service'; // For reads
import { CommandHandlers } from './commands/handlers';
// RaftIntegrationService and KvStoreService are assumed to be provided by AppModule
// or a dedicated RaftModule that AppModule exports and KvModule imports.
// If they are global in AppModule, no explicit import needed here for them to be injectable in handlers/services.

@Module({
  imports: [
    CqrsModule,
    // If RaftIntegrationService & KvStoreService are in a separate module (e.g. RaftModule) that exports them:
    // forwardRef(() => RaftModule), // or whatever module provides these
  ],
  controllers: [KvController],
  providers: [
    KvService, // For reads, depends on KvStoreService
    ...CommandHandlers, // Depends on RaftIntegrationService
    // Logger, // If you want to inject Logger, it's usually available globally or per class
  ],
})
export class KvModule {
    constructor() {
        const logger = new Logger(KvModule.name);
        logger.log("KvModule initialized and CQRS configured.");
    }
}
