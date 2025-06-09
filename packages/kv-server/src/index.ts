// Main application module
export { AppModule } from './app.module';

// Encryption module exports
export { EncryptionModule } from './encryption/encryption.module';
export { EncryptionService } from './encryption/encryption.service';
export { HealthController } from './health/health.controller';
// Health module exports
export { HealthModule } from './health/health.module';
export { KVStateMachine } from './kv-store/kv-state-machine';

export type { KVOperation, KVSnapshot } from './kv-store/kv-state-machine';
export { KVStoreController } from './kv-store/kv-store.controller';
// KV Store module exports
export { KVStoreModule } from './kv-store/kv-store.module';

export { KVStoreService } from './kv-store/kv-store.service';
export { RaftController } from './raft/raft.controller';

// Raft module exports
export { RaftModule } from './raft/raft.module';
export { RaftService } from './raft/raft.service';

// Shared utilities
export * from './shared';