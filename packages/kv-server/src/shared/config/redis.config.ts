import type { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import { ENV_KEYS, DEFAULT_CONFIG } from './constants';

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
  keyPrefix?: string;
  ttl?: number;
}

export class RedisConfigFactory {
  static createKVStoreConfig(configService: ConfigService): RedisConfig {
    return {
      host: configService.get<string>(ENV_KEYS.REDIS_HOST, DEFAULT_CONFIG.REDIS.HOST),
      port: configService.get<number>(ENV_KEYS.REDIS_PORT, DEFAULT_CONFIG.REDIS.PORT),
      password: configService.get<string>(ENV_KEYS.REDIS_PASSWORD),
      db: configService.get<number>(ENV_KEYS.REDIS_DB, DEFAULT_CONFIG.REDIS.DB.KV_STORE),
    };
  }

  static createRaftConfig(
    configService: ConfigService,
    clusterId: string,
  ): RedisConfig {
    return {
      host: configService.get<string>(ENV_KEYS.REDIS_HOST, DEFAULT_CONFIG.REDIS.HOST),
      port: configService.get<number>(ENV_KEYS.REDIS_PORT, DEFAULT_CONFIG.REDIS.PORT),
      password: configService.get<string>(ENV_KEYS.REDIS_PASSWORD),
      db: configService.get<number>(ENV_KEYS.REDIS_DB, DEFAULT_CONFIG.REDIS.DB.RAFT),
      keyPrefix: `raft:${clusterId}:`,
      ttl: configService.get<number>('RAFT_REDIS_TTL', DEFAULT_CONFIG.REDIS.TTL),
    };
  }

  static createRedisInstance(config: RedisConfig): Redis {
    const IORedis = require('ioredis');
    return new IORedis({
      host: config.host,
      port: config.port,
      password: config.password,
      db: config.db || 0,
    });
  }
}
