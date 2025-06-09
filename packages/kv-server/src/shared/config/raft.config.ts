import type { ConfigService } from '@nestjs/config';
import type { RaftConfiguration } from '@usex/raft';
import { NODE_DEFAULTS, ENV_KEYS, DEFAULT_CONFIG } from './constants';
import { RedisConfigFactory } from './redis.config';

export class RaftConfigFactory {
  static createRaftConfiguration(configService: ConfigService): RaftConfiguration {
    const nodeId = configService.get<string>(ENV_KEYS.RAFT_NODE_ID, NODE_DEFAULTS.NODE_ID);
    const clusterId = configService.get<string>(ENV_KEYS.RAFT_CLUSTER_ID, NODE_DEFAULTS.CLUSTER_ID);

    return {
      nodeId,
      clusterId,
      httpHost: configService.get<string>(ENV_KEYS.RAFT_HTTP_HOST, DEFAULT_CONFIG.SERVER.HOST),
      httpPort: configService.get<number>(ENV_KEYS.RAFT_HTTP_PORT, DEFAULT_CONFIG.RAFT.HTTP_PORT),
      electionTimeout: [
        configService.get<number>(ENV_KEYS.RAFT_ELECTION_MIN, DEFAULT_CONFIG.RAFT.ELECTION.MIN),
        configService.get<number>(ENV_KEYS.RAFT_ELECTION_MAX, DEFAULT_CONFIG.RAFT.ELECTION.MAX),
      ],
      heartbeatInterval: configService.get<number>(
        ENV_KEYS.RAFT_HEARTBEAT_INTERVAL,
        DEFAULT_CONFIG.RAFT.HEARTBEAT_INTERVAL,
      ),
      maxLogEntries: configService.get<number>(
        'RAFT_MAX_LOG_ENTRIES',
        DEFAULT_CONFIG.RAFT.MAX_LOG_ENTRIES,
      ),
      snapshotThreshold: configService.get<number>(
        'RAFT_SNAPSHOT_THRESHOLD',
        DEFAULT_CONFIG.RAFT.SNAPSHOT_THRESHOLD,
      ),
      redis: RedisConfigFactory.createRaftConfig(configService, clusterId),
      peerDiscovery: {
        registrationInterval: configService.get<number>(
          'RAFT_PEER_REGISTRATION_INTERVAL',
          DEFAULT_CONFIG.PEER_DISCOVERY.REGISTRATION_INTERVAL,
        ),
        healthCheckInterval: configService.get<number>(
          'RAFT_PEER_HEALTH_CHECK_INTERVAL',
          DEFAULT_CONFIG.PEER_DISCOVERY.HEALTH_CHECK_INTERVAL,
        ),
        peerTimeout: configService.get<number>(
          'RAFT_PEER_TIMEOUT',
          DEFAULT_CONFIG.PEER_DISCOVERY.PEER_TIMEOUT,
        ),
      },
      voting: {
        enableWeighting: configService.get<boolean>('RAFT_ENABLE_VOTE_WEIGHTING', false),
        weightMetrics: [...DEFAULT_CONFIG.VOTING.WEIGHT_METRICS],
        defaultWeight: DEFAULT_CONFIG.VOTING.DEFAULT_WEIGHT,
      },
      retry: {
        maxAttempts: configService.get<number>(
          'RAFT_RETRY_MAX_ATTEMPTS',
          DEFAULT_CONFIG.RETRY.MAX_ATTEMPTS,
        ),
        backoffFactor: configService.get<number>(
          'RAFT_RETRY_BACKOFF_FACTOR',
          DEFAULT_CONFIG.RETRY.BACKOFF_FACTOR,
        ),
        initialDelay: configService.get<number>(
          'RAFT_RETRY_INITIAL_DELAY',
          DEFAULT_CONFIG.RETRY.INITIAL_DELAY,
        ),
      },
      circuitBreaker: {
        timeout: configService.get<number>(
          'RAFT_CIRCUIT_BREAKER_TIMEOUT',
          DEFAULT_CONFIG.CIRCUIT_BREAKER.TIMEOUT,
        ),
        errorThresholdPercentage: configService.get<number>(
          'RAFT_CIRCUIT_BREAKER_ERROR_THRESHOLD',
          DEFAULT_CONFIG.CIRCUIT_BREAKER.ERROR_THRESHOLD_PERCENTAGE,
        ),
        resetTimeout: configService.get<number>(
          'RAFT_CIRCUIT_BREAKER_RESET_TIMEOUT',
          DEFAULT_CONFIG.CIRCUIT_BREAKER.RESET_TIMEOUT,
        ),
      },
      metrics: {
        enablePrometheus: configService.get<boolean>('RAFT_ENABLE_PROMETHEUS', true),
        enableInternal: configService.get<boolean>('RAFT_ENABLE_INTERNAL_METRICS', true),
        collectionInterval: configService.get<number>(
          'RAFT_METRICS_COLLECTION_INTERVAL',
          DEFAULT_CONFIG.METRICS.COLLECTION_INTERVAL,
        ),
        retentionPeriod: configService.get<number>(
          'RAFT_METRICS_RETENTION_PERIOD',
          DEFAULT_CONFIG.METRICS.RETENTION_PERIOD,
        ),
      },
      logging: {
        level: configService.get<any>('RAFT_LOG_LEVEL', DEFAULT_CONFIG.LOGGING.LEVEL),
        redactedFields: [...DEFAULT_CONFIG.LOGGING.REDACTED_FIELDS],
        enableStructured: configService.get<boolean>('RAFT_ENABLE_STRUCTURED_LOGGING', true),
        enableConsole: configService.get<boolean>('RAFT_ENABLE_CONSOLE_LOGGING', true),
        enableFile: configService.get<boolean>('RAFT_ENABLE_FILE_LOGGING', false),
        filePath: configService.get<string>('RAFT_LOG_FILE_PATH', DEFAULT_CONFIG.LOGGING.FILE_PATH),
      },
      network: {
        requestTimeout: configService.get<number>(
          'RAFT_REQUEST_TIMEOUT',
          DEFAULT_CONFIG.NETWORK.REQUEST_TIMEOUT,
        ),
        maxRetries: configService.get<number>(
          'RAFT_NETWORK_MAX_RETRIES',
          DEFAULT_CONFIG.NETWORK.MAX_RETRIES,
        ),
        retryDelay: configService.get<number>(
          'RAFT_NETWORK_RETRY_DELAY',
          DEFAULT_CONFIG.NETWORK.RETRY_DELAY,
        ),
        circuitBreakerThreshold: configService.get<number>(
          'RAFT_NETWORK_CIRCUIT_BREAKER_THRESHOLD',
          DEFAULT_CONFIG.NETWORK.CIRCUIT_BREAKER_THRESHOLD,
        ),
        circuitBreakerTimeout: configService.get<number>(
          'RAFT_NETWORK_CIRCUIT_BREAKER_TIMEOUT',
          DEFAULT_CONFIG.NETWORK.CIRCUIT_BREAKER_TIMEOUT,
        ),
      },
      persistence: {
        enableSnapshots: configService.get<boolean>('RAFT_ENABLE_SNAPSHOTS', true),
        snapshotInterval: configService.get<number>(
          'RAFT_SNAPSHOT_INTERVAL',
          DEFAULT_CONFIG.RAFT.SNAPSHOT_INTERVAL,
        ),
        dataDir: configService.get<string>('RAFT_DATA_DIR', DEFAULT_CONFIG.RAFT.DATA_DIR),
        walEnabled: configService.get<boolean>('RAFT_WAL_ENABLED', true),
        walSizeLimit: configService.get<number>(
          'RAFT_WAL_SIZE_LIMIT',
          DEFAULT_CONFIG.RAFT.WAL_SIZE_LIMIT,
        ),
      },
    };
  }
}
