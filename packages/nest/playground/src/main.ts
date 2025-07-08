import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { ConfigService } from "@nestjs/config";
import * as compression from "compression";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { Logger } from "@nestjs/common";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const logger = new Logger("Bootstrap");

  // Security
  app.use(helmet());
  app.use(compression());

  // CORS
  if (configService.get("ENABLE_CORS") === "true") {
    app.enableCors({
      origin: configService.get("ALLOWED_ORIGINS")?.split(",") || true,
      credentials: true,
    });
  }

  // Validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Note: WebSocket adapter will be configured by specific modules as needed

  // Swagger
  const config = new DocumentBuilder()
    .setTitle("Raft-NestJS Playground")
    .setDescription("Interactive playground for distributed consensus")
    .setVersion("1.0")
    .addTag("cluster", "Cluster management endpoints")
    .addTag("cache", "Distributed cache endpoints")
    .addTag("queue", "Task queue endpoints")
    .addTag("locks", "Distributed lock endpoints")
    .addTag("game", "Game server endpoints")
    .addTag("admin", "Admin endpoints")
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api", app, document);

  // Start server
  const port = configService.get("HTTP_PORT") || 3001;
  await app.listen(port);

  logger.log(`🚀 Application is running on: http://localhost:${port}`);
  logger.log(`📚 API Documentation: http://localhost:${port}/api`);
  logger.log(`🔧 Node ID: ${configService.get("NODE_ID")}`);
  logger.log(`🌐 Cluster ID: ${configService.get("CLUSTER_ID")}`);
}

bootstrap();
