# Configuration Guide

This guide provides detailed information about configuring RAFT nodes for different scenarios and requirements.

## Configuration Overview

RAFT uses a comprehensive configuration object that controls all aspects of node behavior. Configuration can be provided through:

1. Direct configuration objects
2. Environment variables
3. Default configuration helper
4. Configuration files (JSON/YAML)

## Complete Configuration Reference

```typescript
interface RaftConfiguration {
  // Core Identity
  nodeId: string;                    // Unique identifier for this node
  clusterId: string;                 // Cluster this node belongs to
  
  // Network Settings
  httpHost: string;                  // HTTP server host
  httpPort: number;                  // HTTP server port
  
  // Consensus Timing
  electionTimeout: [number, number]; // [min, max] milliseconds
  heartbeatInterval: number;         // Milliseconds between heartbeats
  
  // Storage Limits
  maxLogEntries?: number;            // Optional: Maximum log entries to keep in memory independent of snapshotting. (Not currently primary mechanism for log pruning, see snapshotThreshold)
  snapshotThreshold?: number;        // Number of log entries accumulated in memory since the last snapshot
                                     // before a new snapshot is automatically triggered. This is the primary
                                     // mechanism for log-size-based snapshot creation.
  
  // Redis Configuration
  redis: RedisConfig;                // Redis connection settings
  
  // Advanced Features
  peerDiscovery?: PeerDiscoveryConfig;
  voting: VotingConfig;
  retry?: RetryConfig;
  circuitBreaker?: CircuitBreakerConfig;
  metrics: MetricsConfig;
  logging: LoggingConfig;
  network: NetworkConfig;
  persistence: PersistenceConfig;
}
```

## Core Configuration

### Node Identity

```typescript
const config = {
  nodeId: 'node-1',        // Must be unique across cluster
  clusterId: 'my-cluster', // All nodes in cluster must match
  httpHost: 'localhost',   // Bind address for HTTP server
  httpPort: 3000,         // Port for HTTP API
};
```

### Consensus Timing

The timing configuration is crucial for cluster stability:

```typescript
const config = {
  // Election timeout range (randomized to prevent split votes)
  electionTimeout: [150, 300], // milliseconds
  
  // How often leader sends heartbeats
  heartbeatInterval: 50, // milliseconds
};
```

**Timing Guidelines:**
- `heartbeatInterval` should be much less than minimum `electionTimeout`
- Recommended ratio: 1:3 to 1:10 (heartbeat:election)
- Higher timeouts = more stable but slower failure detection
- Lower timeouts = faster failure detection but more elections

### Storage Configuration

```typescript
const config = {
  // Maximum log entries before compaction
  maxLogEntries: 10000,
  
  // Trigger snapshot after this many entries
  snapshotThreshold: 1000, // Default: 1000 (from RaftEngine.createDefaultConfiguration).
                           // This is the primary setting that determines how many log entries are
                           // accumulated in memory before the Raft node attempts to create a new snapshot.
                           // The check typically happens after a log entry is successfully appended.
  
  persistence: {
    enableSnapshots: true,     // Enables the snapshotting mechanism. Default: true.
    snapshotInterval: 300000, // Default: 300000 ms (5 minutes).
                              // This setting defines a time-based interval, in milliseconds, for creating snapshots.
                              // Note: The current snapshot triggering is primarily based on `snapshotThreshold`.
                              // A dedicated timer for this interval that proactively calls `maybeCreateSnapshot`
                              // would be needed for purely time-based snapshots irrespective of log activity.
                              // As of now, snapshots are created if `snapshotThreshold` is met OR if a
                              // time-based mechanism (if one were added to periodically check) found it was due.
    dataDir: '/var/lib/raft', // Directory for storing all persistent data, including:
                              // - Write-Ahead Log (WAL) files (if `walEnabled` is true).
                              // - Snapshot files (e.g., `snapshot-<term>-<index>.snap`).
    walEnabled: true,         // Enables the Write-Ahead Log for log entry durability. Default: true.
    walSizeLimit: 104857600,  // 100MB. A target for WAL size before it may be compacted or rotated.
  }
};
```

**Note on StateMachine for Snapshots:**

For snapshot functionality to be operational, a `StateMachine` implementation must be provided to the `RaftNode` when it's created (e.g., via `RaftEngine.createNode(config, stateMachine)`). This `StateMachine` is responsible for:
- Providing its current state when a snapshot is being created (via the `getSnapshotData` method).
- Restoring its state from a snapshot when one is loaded on startup or received from a leader (via the `applySnapshot` method).

Refer to the [Architecture Guide](./architecture.md#state-machine) for more details on the `StateMachine` interface and its role in the system.

## Redis Configuration

RAFT uses Redis for state persistence and peer discovery:

```typescript
interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
  keyPrefix?: string;  // Prefix for all keys (default: 'raft')
  ttl?: number;        // TTL for ephemeral keys in seconds
}
```

### Basic Redis Setup

```typescript
const config = {
  redis: {
    host: 'localhost',
    port: 6379,
    password: 'your-password',
    db: 0,
  }
};
```

### Redis Cluster/Sentinel

```typescript
const config = {
  redis: {
    // For Redis Cluster
    host: 'redis-cluster-endpoint',
    port: 6379,
    
    // For Redis Sentinel (use ioredis options)
    sentinels: [
      { host: 'sentinel-1', port: 26379 },
      { host: 'sentinel-2', port: 26379 },
      { host: 'sentinel-3', port: 26379 },
    ],
    name: 'mymaster',
  }
};
```

### Environment Variables

```bash
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=secret
REDIS_DB=0
```

## Network Configuration

Control network behavior and fault tolerance:

```typescript
interface NetworkConfig {
  requestTimeout: number;        // Timeout for RPC calls
  maxRetries: number;           // Maximum retry attempts
  retryDelay: number;           // Initial retry delay
  circuitBreakerThreshold: number; // Failures before opening
  circuitBreakerTimeout: number;   // Time before half-open
}
```

### Example Network Configuration

```typescript
const config = {
  network: {
    requestTimeout: 5000,      // 5 second timeout
    maxRetries: 3,            // Try 3 times
    retryDelay: 100,          // Start with 100ms delay
    circuitBreakerThreshold: 5, // Open after 5 failures
    circuitBreakerTimeout: 30000, // Try again after 30s
  }
};
```

## Peer Discovery Configuration

Automatic peer discovery settings:

```typescript
interface PeerDiscoveryConfig {
  registrationInterval: number;  // How often to register
  healthCheckInterval: number;   // How often to check peers
  peerTimeout: number;          // When to consider peer dead
}
```

### Example Peer Discovery

```typescript
const config = {
  peerDiscovery: {
    registrationInterval: 5000,  // Register every 5s
    healthCheckInterval: 10000,  // Check peers every 10s
    peerTimeout: 30000,         // Dead after 30s silence
  }
};
```

## Voting Configuration

Advanced leader election with weighted voting:

```typescript
interface VotingConfig {
  enableWeighting: boolean;     // Use weighted voting
  weightMetrics: string[];      // Metrics to consider
  defaultWeight: number;        // Default vote weight
}
```

### Weighted Voting Example

```typescript
const config = {
  voting: {
    enableWeighting: true,
    weightMetrics: [
      'cpuUsage',      // Lower CPU = higher weight
      'memoryUsage',   // Lower memory = higher weight
      'networkLatency', // Lower latency = higher weight
      'uptime',        // Higher uptime = higher weight
    ],
    defaultWeight: 1,
  }
};
```

## Retry Configuration

Configure retry behavior for failed operations:

```typescript
interface RetryConfig {
  maxAttempts: number;    // Maximum retry attempts
  backoffFactor: number;  // Exponential backoff multiplier
  initialDelay: number;   // First retry delay
}
```

### Retry Strategy Example

```typescript
const config = {
  retry: {
    maxAttempts: 3,      // Try up to 3 times
    backoffFactor: 2,    // Double delay each time
    initialDelay: 100,   // Start with 100ms
    // Results in: 100ms, 200ms, 400ms
  }
};
```

## Circuit Breaker Configuration

Prevent cascading failures:

```typescript
interface CircuitBreakerConfig {
  timeout: number;                // Operation timeout
  errorThresholdPercentage: number; // Error % to open
  resetTimeout: number;           // Time before retry
}
```

### Circuit Breaker Example

```typescript
const config = {
  circuitBreaker: {
    timeout: 3000,               // 3s operation timeout
    errorThresholdPercentage: 50, // Open at 50% errors
    resetTimeout: 30000,         // Try again after 30s
  }
};
```

## Metrics Configuration

Control metrics collection and export:

```typescript
interface MetricsConfig {
  enablePrometheus: boolean;     // Enable Prometheus export
  enableInternal: boolean;       // Enable internal metrics
  collectionInterval: number;    // Collection frequency
  retentionPeriod?: number;     // How long to keep metrics
}
```

### Metrics Example

```typescript
const config = {
  metrics: {
    enablePrometheus: true,
    enableInternal: true,
    collectionInterval: 5000,    // Every 5 seconds
    retentionPeriod: 3600000,   // Keep for 1 hour
  }
};
```

## Logging Configuration

Configure logging behavior:

```typescript
interface LoggingConfig {
  level: LogLevel;              // Minimum log level
  redactedFields?: string[];    // Fields to redact
  enableStructured?: boolean;   // JSON logging
  enableConsole?: boolean;      // Console output
  enableFile?: boolean;         // File output
  filePath?: string;           // Log file path
}
```

### Logging Example

```typescript
const config = {
  logging: {
    level: LogLevel.INFO,
    redactedFields: ['password', 'token', 'secret'],
    enableStructured: true,
    enableConsole: true,
    enableFile: true,
    filePath: '/var/log/raft/node.log',
  }
};
```

### Log Levels

- `DEBUG` - Detailed debugging information
- `INFO` - General informational messages
- `WARN` - Warning messages
- `ERROR` - Error messages
- `FATAL` - Fatal errors that cause shutdown

## Persistence Configuration

Configure data persistence and WAL:

```typescript
interface PersistenceConfig {
  enableSnapshots: boolean;      // Enable/disable the snapshotting feature.
  snapshotInterval: number;      // Time-based snapshot creation interval in milliseconds.
                                 // See the note in the "Storage Configuration" example regarding current trigger mechanisms.
  dataDir: string;              // Directory path for storing WAL (Write-Ahead Log) files and snapshot files.
  walEnabled: boolean;          // Enable/disable the Write-Ahead Log for durable log storage.
  walSizeLimit: number;         // Approximate maximum size limit for the WAL before compaction/rotation may occur.
}
```

### Persistence Example

```typescript
const config = {
  persistence: {
    enableSnapshots: true,
    snapshotInterval: 300000,    // Every 5 minutes
    dataDir: '/var/lib/raft',
    walEnabled: true,
    walSizeLimit: 104857600,     // 100MB
  }
};
```

## Environment-Based Configuration

### Development Configuration

```typescript
const devConfig = {
  ...RaftEngine.createDefaultConfiguration('dev-node', 'dev-cluster'),
  logging: {
    level: LogLevel.DEBUG,
    enableStructured: false, // Human-readable logs
  },
  electionTimeout: [500, 1000], // Longer timeouts for debugging
  metrics: {
    enablePrometheus: true,
    enableInternal: true,
    collectionInterval: 1000, // More frequent in dev
  }
};
```

### Production Configuration

```typescript
const prodConfig = {
  ...RaftEngine.createDefaultConfiguration('prod-node', 'prod-cluster'),
  logging: {
    level: LogLevel.WARN,
    enableStructured: true,
    enableFile: true,
    filePath: '/var/log/raft/production.log',
  },
  electionTimeout: [150, 300],
  heartbeatInterval: 50,
  network: {
    requestTimeout: 5000,
    maxRetries: 5,
    retryDelay: 100,
    circuitBreakerThreshold: 10,
    circuitBreakerTimeout: 60000,
  },
  persistence: {
    enableSnapshots: true,
    snapshotInterval: 600000, // 10 minutes
    dataDir: '/var/lib/raft',
    walEnabled: true,
    walSizeLimit: 1073741824, // 1GB
  }
};
```

## Configuration Best Practices

### 1. Node Identification

```typescript
// Use meaningful, persistent node IDs
const nodeId = `${serviceName}-${datacenter}-${instanceId}`;

// Use environment-specific cluster IDs
const clusterId = `${appName}-${environment}`;
```

### 2. Network Configuration

```typescript
// For LAN (low latency)
const lanConfig = {
  electionTimeout: [150, 300],
  heartbeatInterval: 50,
  network: { requestTimeout: 1000 }
};

// For WAN (high latency)
const wanConfig = {
  electionTimeout: [1000, 2000],
  heartbeatInterval: 250,
  network: { requestTimeout: 5000 }
};
```

### 3. Cluster Size Considerations

```typescript
// 3-node cluster
const smallCluster = {
  electionTimeout: [150, 300],
  heartbeatInterval: 50,
};

// 5+ node cluster
const largeCluster = {
  electionTimeout: [300, 600],
  heartbeatInterval: 100,
  network: {
    requestTimeout: 10000,
    maxRetries: 5,
  }
};
```

### 4. Resource Constraints

```typescript
// Low memory environment
const lowMemoryConfig = {
  maxLogEntries: 1000,
  snapshotThreshold: 500,
  metrics: {
    retentionPeriod: 1800000, // 30 minutes
  }
};

// High throughput environment
const highThroughputConfig = {
  maxLogEntries: 100000,
  snapshotThreshold: 10000,
  network: {
    requestTimeout: 10000,
    maxRetries: 3,
  }
};
```

## Configuration Validation

RAFT validates configuration on node creation:

```typescript
try {
  const node = await engine.createNode(config);
} catch (error) {
  if (error instanceof RaftConfigurationException) {
    console.error('Invalid configuration:', error.message);
    // Handle specific configuration errors
  }
}
```

### Common Validation Errors

1. **Duplicate Node ID**: Each node must have unique ID
2. **Invalid Port**: Port must be between 1-65535
3. **Invalid Timeouts**: Election timeout must be > heartbeat interval
4. **Missing Required Fields**: nodeId, clusterId are required

## Dynamic Configuration

Some configurations can be updated at runtime:

```typescript
// Update log level dynamically
node.updateLogLevel(LogLevel.DEBUG);

// Update metrics collection interval
node.updateMetricsInterval(10000);
```

## Configuration Templates

### Minimal Configuration

```typescript
const minimal = {
  nodeId: 'node-1',
  clusterId: 'cluster',
  httpHost: 'localhost',
  httpPort: 3000,
  redis: { host: 'localhost', port: 6379 },
  voting: { enableWeighting: false, defaultWeight: 1 },
  metrics: { enablePrometheus: false, enableInternal: true },
  logging: { level: LogLevel.INFO },
  network: { requestTimeout: 5000, maxRetries: 3 },
  persistence: { enableSnapshots: false, walEnabled: false },
};
```

### Full Production Configuration

```typescript
const production = {
  nodeId: process.env.NODE_ID || 'prod-node-1',
  clusterId: process.env.CLUSTER_ID || 'prod-cluster',
  httpHost: '0.0.0.0',
  httpPort: parseInt(process.env.PORT || '3000'),
  electionTimeout: [150, 300],
  heartbeatInterval: 50,
  maxLogEntries: 100000,
  snapshotThreshold: 10000,
  redis: {
    host: process.env.REDIS_HOST || 'redis',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    db: 0,
    keyPrefix: 'raft:prod',
    ttl: 86400,
  },
  peerDiscovery: {
    registrationInterval: 5000,
    healthCheckInterval: 10000,
    peerTimeout: 30000,
  },
  voting: {
    enableWeighting: true,
    weightMetrics: ['cpuUsage', 'memoryUsage', 'networkLatency', 'uptime'],
    defaultWeight: 1,
  },
  retry: {
    maxAttempts: 5,
    backoffFactor: 2,
    initialDelay: 100,
  },
  circuitBreaker: {
    timeout: 5000,
    errorThresholdPercentage: 50,
    resetTimeout: 60000,
  },
  metrics: {
    enablePrometheus: true,
    enableInternal: true,
    collectionInterval: 10000,
    retentionPeriod: 7200000,
  },
  logging: {
    level: LogLevel.INFO,
    redactedFields: ['password', 'token', 'secret', 'key'],
    enableStructured: true,
    enableConsole: false,
    enableFile: true,
    filePath: '/var/log/raft/node.log',
  },
  network: {
    requestTimeout: 10000,
    maxRetries: 5,
    retryDelay: 200,
    circuitBreakerThreshold: 10,
    circuitBreakerTimeout: 60000,
  },
  persistence: {
    enableSnapshots: true,
    snapshotInterval: 600000,
    dataDir: '/var/lib/raft',
    walEnabled: true,
    walSizeLimit: 1073741824,
  },
};
```

## Next Steps

- [API Reference](./api-reference.md) - Detailed API documentation
- [Advanced Usage](./advanced-usage.md) - Advanced configuration patterns
- [Deployment](./deployment.md) - Production deployment configurations
- [Monitoring](./monitoring.md) - Metrics and monitoring setup