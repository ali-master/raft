import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { CqrsModule } from "@nestjs/cqrs";
import { TerminusModule } from "@nestjs/terminus";
import { SwaggerModule } from "@nestjs/swagger";
import { KVStoreModule } from "./kv-store/kv-store.module";
import { EncryptionModule } from "./encryption/encryption.module";
import { RaftModule } from "./raft/raft.module";
import { HealthModule } from "./health/health.module";
import { SwaggerConfigFactory } from "./shared";
import type { INestApplication } from "@nestjs/common";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    CqrsModule,
    TerminusModule,
    RaftModule,
    KVStoreModule,
    EncryptionModule,
    HealthModule,
  ],
})
export class AppModule {
  static configureSwagger(app: INestApplication) {
    const swaggerConfig = SwaggerConfigFactory.createDocumentConfig();
    const swaggerUiOptions = SwaggerConfigFactory.createSwaggerUiOptions();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup("api", app, document, swaggerUiOptions);
  }
}
