import type { LogLevel } from "../constants";

export interface RaftConfiguration {
  nodeId: string;
  clusterId: string;
  httpHost: string;
  httpPort: number;
  electionTimeout: [number, number]; // [min, max] in ms
  heartbeatInterval: number;
  maxLogEntries?: number;
  snapshotThreshold?: number;
  peers?: string[];
  redis: RedisConfig;
  peerDiscovery?: PeerDiscoveryConfig;
  voting: VotingConfig;
  retry?: RetryConfig;
  circuitBreaker?: CircuitBreakerConfig;
  metrics: MetricsConfig;
  logging: LoggingConfig;
  network: NetworkConfig;
  persistence: PersistenceConfig;
  adaptiveConsensus?: AdaptiveConsensusConfig;
}

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
  keyPrefix?: string;
  ttl?: number;
}

export interface NetworkConfig {
  requestTimeout: number;
  maxRetries: number;
  retryDelay: number;
  circuitBreakerThreshold: number;
  circuitBreakerTimeout: number;
}

export interface PersistenceConfig {
  enableSnapshots: boolean;
  snapshotInterval: number;
  dataDir: string;
  walEnabled: boolean;
  walSizeLimit: number;
}

export interface PeerDiscoveryConfig {
  registrationInterval: number;
  healthCheckInterval: number;
  peerTimeout: number;
}

export interface VotingConfig {
  enableWeighting: boolean;
  weightMetrics: string[];
  defaultWeight: number;
}

export interface RetryConfig {
  maxAttempts: number;
  backoffFactor: number;
  initialDelay: number;
}

export interface CircuitBreakerConfig {
  timeout: number;
  errorThresholdPercentage: number;
  resetTimeout: number;
}

export interface MetricsConfig {
  enablePrometheus: boolean;
  enableInternal: boolean;
  collectionInterval: number;
  retentionPeriod?: number;
}

export interface LoggingConfig {
  level: LogLevel;
  redactedFields?: string[];
  enableStructured?: boolean;
  enableConsole?: boolean;
  enableFile?: boolean;
  filePath?: string;
}

export interface AdaptiveConsensusConfig {
  enabled: boolean;
  adaptationInterval: number; // How often to adapt (ms)
  latencyThreshold: number; // Network latency threshold (ms)
  throughputThreshold: number; // Operations per second threshold
  learningRate: number; // How aggressively to adapt (0-1)
  minElectionTimeout: number; // Minimum election timeout (ms)
  maxElectionTimeout: number; // Maximum election timeout (ms)
  minHeartbeatInterval: number; // Minimum heartbeat interval (ms)
  maxHeartbeatInterval: number; // Maximum heartbeat interval (ms)
  networkQualityWeight: number; // Weight for network quality factor (0-1)
  throughputWeight: number; // Weight for throughput factor (0-1)
  stabilityWeight: number; // Weight for cluster stability factor (0-1)
}
