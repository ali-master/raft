import { NestFactory } from "@nestjs/core";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import { ValidationPipe } from "@nestjs/common";
import { AppModule } from "./app.module";
import { ENV_KEYS, DEFAULT_CONFIG } from "./shared";
import fastifyCompress from "fastify-compress";
import fastifyCors from "fastify-cors";
import fastifyHelmet from "fastify-helmet";
import fastifyRateLimit from "fastify-rate-limit";
import fastifySwagger from "fastify-swagger";

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: true,
    }),
  );

  // Register Fastify plugins
  await app.register(fastifyCompress);
  await app.register(fastifyCors, {
    origin:
      process.env[ENV_KEYS.CORS_ORIGIN] || DEFAULT_CONFIG.SERVER.CORS_ORIGIN,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    credentials: true,
  });
  await app.register(fastifyHelmet);
  await app.register(fastifyRateLimit, {
    max: 100,
    timeWindow: "1 minute",
  });
  await app.register(fastifySwagger, {
    routePrefix: "/api",
    swagger: {
      info: {
        title: "Raft KV Server API",
        description: "Enterprise-grade Raft KV Server API documentation",
        version: "1.0.0",
      },
      securityDefinitions: {
        bearer: {
          type: "apiKey",
          name: "Authorization",
          in: "header",
        },
      },
    },
    exposeRoute: true,
  });

  // Global pipes
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Configure Swagger
  AppModule.configureSwagger(app);

  const port = process.env[ENV_KEYS.PORT] || DEFAULT_CONFIG.SERVER.PORT;
  await app.listen(port, "0.0.0.0");
  console.log(`Application is running on: ${await app.getUrl()}`);
}

void bootstrap();
