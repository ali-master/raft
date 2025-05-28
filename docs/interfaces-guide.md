# RAFT Interfaces & Types Guide

A comprehensive, developer-friendly guide to all interfaces, types, and their usage in the RAFT library.

## Quick Navigation

- 🔧 [Configuration Interfaces](#configuration-interfaces)
- 📨 [Message Types](#message-types)
- 📊 [Data Structures](#data-structures)
- 🎯 [Enums & Constants](#enums--constants)
- ⚡ [Event Types](#event-types)
- 🚨 [Error Types](#error-types)
- 💡 [Common Patterns](#common-patterns)

---

## Configuration Interfaces

### 🔧 RaftConfiguration

The master configuration interface that controls all aspects of a RAFT node.

```typescript
interface RaftConfiguration {
  // Identity (Required)
  nodeId: string;        // Unique node identifier
  clusterId: string;     // Cluster membership identifier
  
  // Network (Required)
  httpHost: string;      // Bind address (e.g., '0.0.0.0', 'localhost')
  httpPort: number;      // HTTP port (1-65535)
  
  // Consensus Timing (Required)
  electionTimeout: [number, number];  // [min, max] in ms
  heartbeatInterval: number;          // Leader heartbeat interval in ms
  
  // Storage Limits (Optional)
  maxLogEntries?: number;      // Default: 10000
  snapshotThreshold?: number;  // Default: 1000
  
  // Sub-configurations (Mixed)
  redis: RedisConfig;                    // Required
  peerDiscovery?: PeerDiscoveryConfig;   // Optional
  voting: VotingConfig;                  // Required
  retry?: RetryConfig;                   // Optional
  circuitBreaker?: CircuitBreakerConfig; // Optional
  metrics: MetricsConfig;                // Required
  logging: LoggingConfig;                // Required
  network: NetworkConfig;                // Required
  persistence: PersistenceConfig;        // Required
}
```

#### 📝 Complete Example with All Options

```typescript
const config: RaftConfiguration = {
  // Identity - These must be unique across your cluster
  nodeId: 'prod-node-us-east-1a',
  clusterId: 'payment-service-cluster',
  
  // Network - Where this node listens
  httpHost: '0.0.0.0',  // Bind to all interfaces
  httpPort: 3001,       // Each node needs unique port if on same host
  
  // Timing - Critical for consensus performance
  electionTimeout: [150, 300],  // Random between 150-300ms
  heartbeatInterval: 50,        // Must be << electionTimeout
  
  // Storage - Log management
  maxLogEntries: 10000,     // Keep last 10k entries in memory
  snapshotThreshold: 1000,  // Snapshot every 1k entries
  
  // Redis - For persistence and discovery
  redis: {
    host: 'redis.internal.company.com',
    port: 6379,
    password: process.env.REDIS_PASSWORD,
    db: 1,
    keyPrefix: 'raft:prod',
    ttl: 86400  // 24 hours
  },
  
  // Peer Discovery - How nodes find each other
  peerDiscovery: {
    registrationInterval: 5000,   // Register every 5s
    healthCheckInterval: 10000,   // Check peers every 10s
    peerTimeout: 30000           // Consider dead after 30s
  },
  
  // Voting - Leader election behavior
  voting: {
    enableWeighting: true,
    weightMetrics: ['cpuUsage', 'memoryUsage', 'uptime'],
    defaultWeight: 1
  },
  
  // Retry - For failed operations
  retry: {
    maxAttempts: 3,
    backoffFactor: 2,
    initialDelay: 100  // 100ms, 200ms, 400ms
  },
  
  // Circuit Breaker - Prevent cascading failures
  circuitBreaker: {
    timeout: 3000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000
  },
  
  // Metrics - Monitoring and observability
  metrics: {
    enablePrometheus: true,
    enableInternal: true,
    collectionInterval: 5000,
    retentionPeriod: 3600000  // 1 hour
  },
  
  // Logging - Structured logging configuration
  logging: {
    level: LogLevel.INFO,
    redactedFields: ['password', 'token', 'apiKey'],
    enableStructured: true,
    enableConsole: true,
    enableFile: true,
    filePath: '/var/log/raft/node.log'
  },
  
  // Network - Communication settings
  network: {
    requestTimeout: 5000,
    maxRetries: 3,
    retryDelay: 100,
    circuitBreakerThreshold: 5,
    circuitBreakerTimeout: 30000
  },
  
  // Persistence - Data durability
  persistence: {
    enableSnapshots: true,
    snapshotInterval: 300000,  // 5 minutes
    dataDir: '/var/lib/raft',
    walEnabled: true,
    walSizeLimit: 104857600    // 100MB
  }
};
```

### 🔌 Sub-Configuration Interfaces

#### RedisConfig

```typescript
interface RedisConfig {
  host: string;          // Redis hostname
  port: number;          // Redis port (default: 6379)
  password?: string;     // Optional auth password
  db?: number;           // Database number (0-15)
  keyPrefix?: string;    // Key namespace (default: 'raft')
  ttl?: number;          // Key expiration in seconds
}
```

**💡 Pro Tips:**
- Use different `db` numbers for different environments
- Set `keyPrefix` to avoid conflicts with other apps
- `ttl` prevents stale data accumulation

**⚠️ Common Pitfalls:**
- Forgetting to set password in production
- Using same db/prefix for multiple clusters

#### NetworkConfig

```typescript
interface NetworkConfig {
  requestTimeout: number;          // RPC timeout in ms
  maxRetries: number;              // Retry attempts
  retryDelay: number;              // Initial retry delay
  circuitBreakerThreshold: number; // Failures before open
  circuitBreakerTimeout: number;   // Reset timeout in ms
}
```

**📊 Recommended Values by Environment:**

| Environment | requestTimeout | maxRetries | Notes |
|-------------|---------------|------------|-------|
| Local/Dev   | 2000ms       | 2          | Fast feedback |
| LAN/Staging | 5000ms       | 3          | Balanced |
| WAN/Prod    | 10000ms      | 5          | High reliability |

#### PersistenceConfig

```typescript
interface PersistenceConfig {
  enableSnapshots: boolean;    // Enable periodic snapshots
  snapshotInterval: number;    // Snapshot frequency in ms
  dataDir: string;            // Storage directory path
  walEnabled: boolean;        // Write-ahead logging
  walSizeLimit: number;       // WAL rotation size in bytes
}
```

**📁 Directory Structure Created:**
```
/var/lib/raft/
├── snapshots/
│   ├── snapshot-1234567890.dat
│   └── snapshot-1234567891.dat
├── wal/
│   ├── segment-00001.wal
│   └── segment-00002.wal
└── metadata.json
```

---

## Message Types

### 📨 Core Protocol Messages

#### VoteRequest

Used during leader elections to request votes from peers.

```typescript
interface VoteRequest {
  type: MessageType.VOTE_REQUEST;
  term: number;          // Candidate's term
  candidateId: string;   // Who wants to be leader
  lastLogIndex: number;  // For log completeness check
  lastLogTerm: number;   // For log completeness check
}
```

**Example Request:**
```typescript
const voteRequest: VoteRequest = {
  type: MessageType.VOTE_REQUEST,
  term: 42,
  candidateId: 'node-2',
  lastLogIndex: 1523,
  lastLogTerm: 41
};
```

**🔍 Log Completeness Check:**
- Voters only vote for candidates with logs at least as complete as theirs
- Prevents data loss by ensuring new leaders have all committed entries

#### AppendEntriesRequest

Dual-purpose message for log replication and heartbeats.

```typescript
interface AppendEntriesRequest {
  type: MessageType.APPEND_ENTRIES;
  term: number;              // Leader's term
  leaderId: string;          // Current leader
  prevLogIndex: number;      // Index before new entries
  prevLogTerm: number;       // Term of prevLogIndex
  entries: LogEntry[];       // Empty for heartbeat
  leaderCommit: number;      // Leader's commit index
}
```

**Heartbeat Example (empty entries):**
```typescript
const heartbeat: AppendEntriesRequest = {
  type: MessageType.APPEND_ENTRIES,
  term: 42,
  leaderId: 'node-1',
  prevLogIndex: 1523,
  prevLogTerm: 41,
  entries: [],  // Empty = heartbeat
  leaderCommit: 1520
};
```

**Replication Example:**
```typescript
const replication: AppendEntriesRequest = {
  type: MessageType.APPEND_ENTRIES,
  term: 42,
  leaderId: 'node-1',
  prevLogIndex: 1523,
  prevLogTerm: 41,
  entries: [
    {
      index: 1524,
      term: 42,
      command: { type: 'SET', key: 'user:123', value: {...} },
      timestamp: new Date()
    }
  ],
  leaderCommit: 1522
};
```

---

## Data Structures

### 📊 LogEntry

The fundamental unit of replication in RAFT.

```typescript
interface LogEntry {
  index: number;      // Unique, monotonically increasing
  term: number;       // Term when created
  command: any;       // Your application data
  timestamp: Date;    // Creation time
}
```

**✅ Valid Commands Examples:**
```typescript
// Key-Value Store
{ type: 'SET', key: 'user:123', value: { name: 'Alice', age: 30 } }
{ type: 'DELETE', key: 'session:xyz' }
{ type: 'INCREMENT', key: 'counter', amount: 1 }

// Configuration Management
{ type: 'UPDATE_CONFIG', service: 'api', config: { timeout: 5000 } }

// Task Queue
{ type: 'ENQUEUE', task: { id: 'job-123', handler: 'sendEmail' } }
```

**❌ Invalid Commands (Not JSON-serializable):**
```typescript
// Functions not allowed
{ handler: () => console.log('Hello') }  // ❌

// Circular references not allowed
const obj = { name: 'test' };
obj.self = obj;  // ❌

// Undefined values stripped
{ key: undefined }  // Becomes: {}
```

### 🔍 PeerInfo

Complete information about a cluster peer.

```typescript
interface PeerInfo {
  nodeId: string;               // Peer's unique ID
  clusterId: string;            // Must match yours
  httpHost: string;             // Peer's address
  httpPort: number;             // Peer's port
  state: RaftState;             // Current state
  term: number;                 // Current term
  lastSeen: Date;               // Last contact time
  weight: number;               // Voting weight
  metrics?: SystemMetricsSnapshot; // Resource usage
}
```

**🏥 Health Status Determination:**
```typescript
function isPeerHealthy(peer: PeerInfo): boolean {
  const timeSinceLastSeen = Date.now() - peer.lastSeen.getTime();
  const isReachable = timeSinceLastSeen < 30000; // 30s timeout
  
  const hasGoodMetrics = peer.metrics ? 
    peer.metrics.cpuUsage < 90 && 
    peer.metrics.memoryUsage < 90 : true;
    
  return isReachable && hasGoodMetrics;
}
```

### 📈 RaftMetrics

Comprehensive metrics for monitoring node health.

```typescript
interface RaftMetrics {
  // Identity
  nodeId: string;
  
  // Consensus State
  state: RaftState;
  term: number;
  
  // Log Progress
  commitIndex: number;    // Highest committed
  lastApplied: number;    // Highest applied
  logLength: number;      // Total entries
  
  // Network Activity
  peers: number;          // Known peer count
  messagesReceived: number;
  messagesSent: number;
  
  // Elections
  electionsStarted: number;
  votesGranted: number;
  
  // System Resources
  systemMetrics?: SystemMetricsSnapshot;
}
```

**📊 Key Metrics to Monitor:**

| Metric | Healthy Range | Warning Signs |
|--------|--------------|---------------|
| `commitIndex - lastApplied` | < 100 | Large gap indicates apply backlog |
| `electionsStarted` | Low, stable | Rapid increase means instability |
| `messagesSent/Received` ratio | ~1:1 | Imbalance indicates network issues |
| `peers` | Expected - 1 | Less means nodes are unreachable |

---

## Enums & Constants

### 🎯 RaftState

The three states of the RAFT consensus protocol.

```typescript
enum RaftState {
  FOLLOWER = "follower",    // Default state, follows leader
  CANDIDATE = "candidate",  // Seeking leadership
  LEADER = "leader"        // Active leader
}
```

**State Transition Diagram:**
```
┌─────────────┐  election timeout   ┌──────────────┐
│  FOLLOWER   │ ──────────────────> │  CANDIDATE   │
└─────────────┘                     └──────────────┘
       ↑                                    │
       │                                    │ receives majority votes
       │                                    ↓
       │         higher term seen    ┌──────────────┐
       └─────────────────────────────│   LEADER     │
                                     └──────────────┘
```

### 📝 LogLevel

Logging verbosity levels.

```typescript
enum LogLevel {
  DEBUG = "debug",   // Development only
  INFO = "info",     // Normal operations
  WARN = "warn",     // Potential issues
  ERROR = "error",   // Definite problems
  FATAL = "fatal"    // Unrecoverable
}
```

**Best Practices by Environment:**
- **Development**: `DEBUG` - See everything
- **Staging**: `INFO` - Normal verbosity
- **Production**: `WARN` - Only problems
- **High-Performance**: `ERROR` - Minimal overhead

---

## Event Types

### ⚡ Core Events

Events emitted by RaftNode for monitoring and integration.

```typescript
// State change event
node.on('stateChange', (data: {
  state: RaftState;
  term: number;
  previousState: RaftState;
}) => {
  console.log(`Transitioned from ${data.previousState} to ${data.state}`);
});

// Leader election event
node.on('leaderElected', (data: {
  leaderId: string;
  term: number;
}) => {
  if (data.leaderId === node.nodeId) {
    console.log('This node is now the leader!');
  }
});

// Log replication event
node.on('logReplicated', (data: {
  index: number;
  command: any;
  term: number;
}) => {
  console.log(`Command at index ${data.index} is now committed`);
  // Safe to apply to state machine
});
```

### 📊 Event Patterns

**Monitoring Pattern:**
```typescript
class EventMonitor {
  private eventCounts = new Map<string, number>();
  
  constructor(node: RaftNode) {
    // Track all events
    const events = [
      'stateChange', 'leaderElected', 'logReplicated',
      'peerDiscovered', 'peerLost', 'error'
    ];
    
    events.forEach(event => {
      node.on(event, () => {
        const count = this.eventCounts.get(event) || 0;
        this.eventCounts.set(event, count + 1);
      });
    });
  }
  
  getStats() {
    return Object.fromEntries(this.eventCounts);
  }
}
```

---

## Error Types

### 🚨 Exception Hierarchy

All RAFT exceptions extend from `RaftException`:

```typescript
try {
  await node.appendLog(command);
} catch (error) {
  if (error instanceof RaftValidationException) {
    // Not leader, invalid state
    console.log('Cannot append: ', error.message);
  } else if (error instanceof RaftReplicationException) {
    // Replication failed
    console.log('Replication error: ', error.message);
  } else if (error instanceof RaftException) {
    // Other RAFT error
    console.log('RAFT error: ', error.message);
  } else {
    // Non-RAFT error
    throw error;
  }
}
```

**Common Error Scenarios:**

| Exception | When Thrown | How to Handle |
|-----------|-------------|---------------|
| `RaftConfigurationException` | Invalid config, duplicate nodeId | Fix configuration |
| `RaftValidationException` | Wrong state for operation | Check node state first |
| `RaftNetworkException` | Can't reach peers | Check network, retry |
| `RaftStorageException` | Redis down, disk full | Fix storage, retry |
| `RaftTimeoutException` | Operation too slow | Increase timeouts |

---

## Common Patterns

### 💡 Leader-Only Operations

```typescript
async function executeOnLeader(
  node: RaftNode,
  command: any
): Promise<void> {
  // Check if we're the leader
  if (node.getState() === RaftState.LEADER) {
    await node.appendLog(command);
    return;
  }
  
  // Find and redirect to leader
  const peers = node.getPeers();
  for (const peerId of peers) {
    const peerInfo = node.getPeerInfo(peerId);
    if (peerInfo?.state === RaftState.LEADER) {
      // Redirect to leader
      throw new Error(`Redirect to leader at ${peerInfo.httpHost}:${peerInfo.httpPort}`);
    }
  }
  
  // No leader found
  throw new Error('No leader available');
}
```

### 🔄 Retry with Backoff

```typescript
async function retryOperation<T>(
  operation: () => Promise<T>,
  config: RetryConfig
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      
      if (attempt < config.maxAttempts - 1) {
        const delay = config.initialDelay * 
          Math.pow(config.backoffFactor, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError!;
}
```

### 📏 Configuration Validation

```typescript
function validateConfig(config: RaftConfiguration): void {
  // Timing constraints
  const [minElection, maxElection] = config.electionTimeout;
  if (config.heartbeatInterval >= minElection) {
    throw new Error('heartbeatInterval must be much less than min election timeout');
  }
  
  // Network constraints  
  if (config.httpPort < 1 || config.httpPort > 65535) {
    throw new Error('httpPort must be between 1 and 65535');
  }
  
  // Storage constraints
  if (config.persistence.walEnabled && !config.persistence.dataDir) {
    throw new Error('dataDir required when WAL is enabled');
  }
}
```

### 🎯 Type Guards

```typescript
// Type guard for RaftException
function isRaftException(error: any): error is RaftException {
  return error instanceof RaftException;
}

// Type guard for specific state
function isLeader(node: RaftNode): boolean {
  return node.getState() === RaftState.LEADER;
}

// Type guard for healthy peer
function isHealthyPeer(peer: PeerInfo): boolean {
  const now = Date.now();
  const timeSinceLastSeen = now - peer.lastSeen.getTime();
  return timeSinceLastSeen < 30000; // 30 second timeout
}
```

---

## Quick Reference Card

### 🚀 Creating a Node

```typescript
const engine = new RaftEngine();
const config = RaftEngine.createDefaultConfiguration('node-1', 'my-cluster');
const node = await engine.createNode(config);
await engine.startNode('node-1');
```

### 📊 Monitoring Health

```typescript
const metrics = node.getMetrics();
if (metrics) {
  console.log(`State: ${metrics.state}`);
  console.log(`Term: ${metrics.term}`);
  console.log(`Log length: ${metrics.logLength}`);
  console.log(`Replication lag: ${metrics.commitIndex - metrics.lastApplied}`);
}
```

### 🔍 Finding the Leader

```typescript
function findLeader(engine: RaftEngine): RaftNode | null {
  const nodes = engine.getAllNodes();
  for (const [id, node] of nodes) {
    if (node.getState() === RaftState.LEADER) {
      return node;
    }
  }
  return null;
}
```

### 📝 Appending Logs

```typescript
const leader = findLeader(engine);
if (leader) {
  await leader.appendLog({
    type: 'SET',
    key: 'config:feature-flags',
    value: { darkMode: true, betaFeatures: false }
  });
}
```

This guide provides a complete reference for all interfaces and types in the RAFT library with practical examples and best practices for developers.