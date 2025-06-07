import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config'; // Added

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    // { logger: ['error', 'warn', 'log', 'debug', 'verbose'] } // Optionally enable more detailed logging
  );

  const configService = app.get(ConfigService); // Get ConfigService instance
  const port = configService.get<number>('PORT', 3000); // Use ConfigService for port

  await app.listen(port, '0.0.0.0');
  Logger.log(`Application is running on: ${await app.getUrl()}`, 'Bootstrap');
}
bootstrap();
