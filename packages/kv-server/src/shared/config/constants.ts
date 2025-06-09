export const DEFAULT_CONFIG = {
  // Server defaults
  SERVER: {
    PORT: 3000,
    HOST: '0.0.0.0',
    CORS_ORIGIN: '*',
  },

  // Redis defaults
  REDIS: {
    HOST: 'localhost',
    PORT: 6379,
    DB: {
      KV_STORE: 1,
      RAFT: 0,
    },
    TTL: 3600,
  },

  // Raft defaults
  RAFT: {
    HTTP_PORT: 4000,
    ELECTION: {
      MIN: 150,
      MAX: 300,
    },
    HEARTBEAT_INTERVAL: 50,
    MAX_LOG_ENTRIES: 10000,
    SNAPSHOT_THRESHOLD: 1000,
    SNAPSHOT_INTERVAL: 300000,
    DATA_DIR: './data/raft',
    WAL_SIZE_LIMIT: 104857600,
  },

  // Network defaults
  NETWORK: {
    REQUEST_TIMEOUT: 5000,
    MAX_RETRIES: 3,
    RETRY_DELAY: 1000,
    CIRCUIT_BREAKER_THRESHOLD: 5,
    CIRCUIT_BREAKER_TIMEOUT: 30000,
  },

  // Peer discovery defaults
  PEER_DISCOVERY: {
    REGISTRATION_INTERVAL: 5000,
    HEALTH_CHECK_INTERVAL: 10000,
    PEER_TIMEOUT: 30000,
  },

  // Retry configuration defaults
  RETRY: {
    MAX_ATTEMPTS: 3,
    BACKOFF_FACTOR: 2,
    INITIAL_DELAY: 100,
  },

  // Circuit breaker defaults
  CIRCUIT_BREAKER: {
    TIMEOUT: 5000,
    ERROR_THRESHOLD_PERCENTAGE: 50,
    RESET_TIMEOUT: 30000,
  },

  // Metrics defaults
  METRICS: {
    COLLECTION_INTERVAL: 5000,
    RETENTION_PERIOD: 3600000,
  },

  // Logging defaults
  LOGGING: {
    LEVEL: 'INFO' as const,
    FILE_PATH: './logs/raft.log',
    REDACTED_FIELDS: ['password', 'token', 'secret'],
  },

  // Voting defaults
  VOTING: {
    DEFAULT_WEIGHT: 1,
    WEIGHT_METRICS: ['cpu', 'memory', 'latency'],
  },
} as const;

export const ENV_KEYS = {
  // Server environment keys
  PORT: 'PORT',
  CORS_ORIGIN: 'CORS_ORIGIN',

  // Redis environment keys
  REDIS_HOST: 'REDIS_HOST',
  REDIS_PORT: 'REDIS_PORT',
  REDIS_PASSWORD: 'REDIS_PASSWORD',
  REDIS_DB: 'REDIS_DB',

  // Raft environment keys
  RAFT_NODE_ID: 'RAFT_NODE_ID',
  RAFT_CLUSTER_ID: 'RAFT_CLUSTER_ID',
  RAFT_HTTP_HOST: 'RAFT_HTTP_HOST',
  RAFT_HTTP_PORT: 'RAFT_HTTP_PORT',
  RAFT_ELECTION_MIN: 'RAFT_ELECTION_MIN',
  RAFT_ELECTION_MAX: 'RAFT_ELECTION_MAX',
  RAFT_HEARTBEAT_INTERVAL: 'RAFT_HEARTBEAT_INTERVAL',

  // Encryption environment keys
  ENCRYPTION_KEY: 'ENCRYPTION_KEY',
} as const;

export const NODE_DEFAULTS = {
  NODE_ID: 'node-1',
  CLUSTER_ID: 'kv-cluster',
} as const;
