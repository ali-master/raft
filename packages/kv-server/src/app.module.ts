import { Module } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { KvStoreService } from './kv-store/kv-store.service';
import { RaftIntegrationService } from './raft/raft-integration.service';
// KvController and KvService are now in KvModule
import { KvModule } from './kv/kv.module';
import { EncryptionService } from './encryption/encryption.service';
import { HealthcheckController } from './health/health.controller';
import { HealthcheckService } from './health/health.service';
import { ConfigModule } from '@nestjs/config'; // Added

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // Makes ConfigService available throughout the application
      envFilePath: process.env.NODE_ENV === 'test' ? '.env.test' : '.env', // Use .env.test for tests
      // ignoreEnvFile: process.env.NODE_ENV === 'production', // Optionally ignore .env file in production
    }),
    KvModule,
  ],
  controllers: [
    AppController,
    HealthcheckController, // Added
  ],
  providers: [
    AppService,
    KvStoreService,
    RaftIntegrationService,
    EncryptionService,
    HealthcheckService, // Added
  ],
})
export class AppModule {}
