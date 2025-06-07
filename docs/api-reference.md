# API Reference

Complete API documentation for the RAFT library, including all classes, methods, types, and interfaces.

## Table of Contents

- [Core Classes](#core-classes)
  - [RaftEngine](#raftengine)
  - [RaftNode](#raftnode)
- [Types and Interfaces](#types-and-interfaces)
- [Constants and Enums](#constants-and-enums)
- [Exceptions](#exceptions)
- [Events](#events)
- [Utilities](#utilities)

## Core Classes

### RaftEngine

The main entry point for creating and managing RAFT nodes.

```typescript
class RaftEngine {
  constructor()
  createNode(config: RaftConfiguration): Promise<RaftNode>
  startNode(nodeId: string): Promise<void>
  stopNode(nodeId: string): Promise<void>
  getNode(nodeId: string): RaftNode | undefined
  getAllNodes(): Map<string, RaftNode>
  stopAllNodes(): Promise<void>
  static createDefaultConfiguration(nodeId: string, clusterId: string): RaftConfiguration
}
```

#### Constructor

```typescript
const engine = new RaftEngine()
```

Creates a new RaftEngine instance.

#### createNode

```typescript
async createNode(config: RaftConfiguration): Promise<RaftNode>
```

Creates a new RAFT node with the specified configuration.

**Parameters:**
- `config: RaftConfiguration` - Node configuration object

**Returns:**
- `Promise<RaftNode>` - The created node instance

**Throws:**
- `RaftConfigurationException` - If node with same ID already exists

**Example:**
```typescript
const config = RaftEngine.createDefaultConfiguration('node-1', 'my-cluster');
const node = await engine.createNode(config);
```

#### startNode

```typescript
async startNode(nodeId: string): Promise<void>
```

Starts a previously created node.

**Parameters:**
- `nodeId: string` - ID of the node to start

**Throws:**
- `RaftConfigurationException` - If node not found
- `RaftException` - If node fails to start

**Example:**
```typescript
await engine.startNode('node-1');
```

#### stopNode

```typescript
async stopNode(nodeId: string): Promise<void>
```

Stops a running node.

**Parameters:**
- `nodeId: string` - ID of the node to stop

**Throws:**
- `RaftConfigurationException` - If node not found

**Example:**
```typescript
await engine.stopNode('node-1');
```

#### getNode

```typescript
getNode(nodeId: string): RaftNode | undefined
```

Retrieves a node by its ID.

**Parameters:**
- `nodeId: string` - ID of the node to retrieve

**Returns:**
- `RaftNode | undefined` - The node instance or undefined if not found

**Example:**
```typescript
const node = engine.getNode('node-1');
if (node) {
  console.log('Node state:', node.getState());
}
```

#### getAllNodes

```typescript
getAllNodes(): Map<string, RaftNode>
```

Gets all nodes managed by this engine.

**Returns:**
- `Map<string, RaftNode>` - Map of node IDs to node instances

**Example:**
```typescript
const nodes = engine.getAllNodes();
nodes.forEach((node, id) => {
  console.log(`Node ${id}: ${node.getState()}`);
});
```

#### stopAllNodes

```typescript
async stopAllNodes(): Promise<void>
```

Stops all nodes managed by this engine.

**Example:**
```typescript
await engine.stopAllNodes();
```

#### createDefaultConfiguration (static)

```typescript
static createDefaultConfiguration(nodeId: string, clusterId: string): RaftConfiguration
```

Creates a default configuration with sensible defaults.

**Parameters:**
- `nodeId: string` - Unique node identifier
- `clusterId: string` - Cluster identifier

**Returns:**
- `RaftConfiguration` - Complete configuration object

**Example:**
```typescript
const config = RaftEngine.createDefaultConfiguration('node-1', 'my-cluster');
```

### RaftNode

Represents a single node in the RAFT cluster.

```typescript
class RaftNode extends EventEmitter {
  start(): Promise<void>
  stop(): Promise<void>
  appendLog(command: any): Promise<boolean>
  getState(): RaftState
  getCurrentTerm(): number
  getMetrics(): RaftMetrics | undefined
  getPrometheusMetrics(): Promise<string>
  getPeers(): string[]
  getPeerInfo(nodeId: string): PeerInfo | undefined
  transferLeadership(targetPeerId: string): Promise<void>
}
```

#### start

```typescript
async start(): Promise<void>
```

Starts the node and begins participating in the cluster.

**Throws:**
- `RaftException` - If startup fails

**Example:**
```typescript
await node.start();
```

#### stop

```typescript
async stop(): Promise<void>
```

Stops the node and cleans up resources.

**Example:**
```typescript
await node.stop();
```

#### appendLog

```typescript
async appendLog(command: any): Promise<boolean>
```

Appends a new entry to the replicated log. Only works on leader nodes.

**Parameters:**
- `command: any` - The command to replicate

**Returns:**
- `Promise<boolean>` - True if successfully appended

**Throws:**
- `RaftValidationException` - If not leader
- `RaftReplicationException` - If replication fails

**Example:**
```typescript
if (node.getState() === RaftState.LEADER) {
  await node.appendLog({ 
    type: 'SET', 
    key: 'user:1', 
    value: { name: 'John' } 
  });
}
```

#### getState

```typescript
getState(): RaftState
```

Gets the current state of the node.

**Returns:**
- `RaftState` - Current state (FOLLOWER, CANDIDATE, or LEADER)

**Example:**
```typescript
const state = node.getState();
console.log(`Node is ${state}`);
```

#### getCurrentTerm

```typescript
getCurrentTerm(): number
```

Gets the current term number.

**Returns:**
- `number` - Current term

**Example:**
```typescript
const term = node.getCurrentTerm();
console.log(`Current term: ${term}`);
```

#### getMetrics

```typescript
getMetrics(): RaftMetrics | undefined
```

Gets internal metrics for this node.

**Returns:**
- `RaftMetrics | undefined` - Metrics object or undefined if not available

**Example:**
```typescript
const metrics = node.getMetrics();
if (metrics) {
  console.log(`Log length: ${metrics.logLength}`);
  console.log(`Commit index: ${metrics.commitIndex}`);
}
```

#### getPrometheusMetrics

```typescript
async getPrometheusMetrics(): Promise<string>
```

Gets metrics in Prometheus format.

**Returns:**
- `Promise<string>` - Prometheus-formatted metrics

**Example:**
```typescript
const prometheusMetrics = await node.getPrometheusMetrics();
// Serve this at /metrics endpoint
```

#### getPeers

```typescript
getPeers(): string[]
```

Gets list of peer node IDs.

**Returns:**
- `string[]` - Array of peer node IDs

**Example:**
```typescript
const peers = node.getPeers();
console.log(`Connected to ${peers.length} peers`);
```

#### getPeerInfo

```typescript
getPeerInfo(nodeId: string): PeerInfo | undefined
```

Gets detailed information about a specific peer.

**Parameters:**
- `nodeId: string` - ID of the peer

**Returns:**
- `PeerInfo | undefined` - Peer information or undefined if not found

**Example:**
```typescript
const peerInfo = node.getPeerInfo('node-2');
if (peerInfo) {
  console.log(`Peer state: ${peerInfo.state}`);
  console.log(`Last seen: ${peerInfo.lastSeen}`);
}
```

#### transferLeadership

```typescript
async transferLeadership(targetPeerId: string): Promise<void>
```

Initiates a leadership transfer to the specified `targetPeerId`.

The current leader will attempt to ensure the target peer is up-to-date with its log entries. If successful, it sends a `TimeoutNowRequest` to the target, prompting it to start an election immediately (bypassing Pre-Vote). The current leader then transitions to the follower state.

**Parameters:**
- `targetPeerId: string` - The unique ID of the peer node to transfer leadership to.

**Returns:**
- `Promise<void>` - Resolves when the `TimeoutNowRequest` has been successfully sent and the current leader has transitioned to a follower. Rejects if the transfer cannot be initiated or fails (e.g., current node is not leader, target peer is invalid or not up-to-date after retries, or RPC fails).

**Throws:**
- `RaftValidationException` - If the current node is not the leader, or if `targetPeerId` is invalid (e.g., non-existent, not in the current configuration, or the leader itself).
- `RaftReplicationException` - If the leader fails to bring the target peer's log up-to-date after multiple attempts, or if sending the `TimeoutNowRequest` RPC fails.

**Example:**
```typescript
if (node.getState() === RaftState.LEADER) {
  try {
    await node.transferLeadership('node-2');
    console.log('Leadership transfer initiated to node-2.');
  } catch (error) {
    console.error('Leadership transfer failed:', error);
  }
}
```

## Types and Interfaces

### RaftConfiguration

Complete configuration for a RAFT node.

```typescript
interface RaftConfiguration {
  nodeId: string
  clusterId: string
  httpHost: string
  httpPort: number
  electionTimeout: [number, number]
  heartbeatInterval: number
  maxLogEntries?: number
  snapshotThreshold?: number
  redis: RedisConfig
  peerDiscovery?: PeerDiscoveryConfig
  voting: VotingConfig
  retry?: RetryConfig
  circuitBreaker?: CircuitBreakerConfig
  metrics: MetricsConfig
  logging: LoggingConfig
  network: NetworkConfig
  persistence: PersistenceConfig
}
```

### RedisConfig

Redis connection configuration.

```typescript
interface RedisConfig {
  host: string
  port: number
  password?: string
  db?: number
  keyPrefix?: string
  ttl?: number
}
```

### NetworkConfig

Network behavior configuration.

```typescript
interface NetworkConfig {
  requestTimeout: number
  maxRetries: number
  retryDelay: number
  circuitBreakerThreshold: number
  circuitBreakerTimeout: number
}
```

### PersistenceConfig

Data persistence configuration.

```typescript
interface PersistenceConfig {
  enableSnapshots: boolean
  snapshotInterval: number
  dataDir: string
  walEnabled: boolean
  walSizeLimit: number
}
```

### PeerDiscoveryConfig

Peer discovery configuration.

```typescript
interface PeerDiscoveryConfig {
  registrationInterval: number
  healthCheckInterval: number
  peerTimeout: number
}
```

### VotingConfig

Leader election voting configuration.

```typescript
interface VotingConfig {
  enableWeighting: boolean
  weightMetrics: string[]
  defaultWeight: number
}
```

### RetryConfig

Retry strategy configuration.

```typescript
interface RetryConfig {
  maxAttempts: number
  backoffFactor: number
  initialDelay: number
}
```

### CircuitBreakerConfig

Circuit breaker configuration.

```typescript
interface CircuitBreakerConfig {
  timeout: number
  errorThresholdPercentage: number
  resetTimeout: number
}
```

### MetricsConfig

Metrics collection configuration.

```typescript
interface MetricsConfig {
  enablePrometheus: boolean
  enableInternal: boolean
  collectionInterval: number
  retentionPeriod?: number
}
```

### LoggingConfig

Logging configuration.

```typescript
interface LoggingConfig {
  level: LogLevel
  redactedFields?: string[]
  enableStructured?: boolean
  enableConsole?: boolean
  enableFile?: boolean
  filePath?: string
}
```

### LogEntry

Represents an entry in the replicated log.

```typescript
interface LogEntry {
  index: number
  term: number
  command: any
  timestamp: Date
}
```

### PeerInfo

Information about a peer node.

```typescript
interface PeerInfo {
  nodeId: string
  clusterId: string
  httpHost: string
  httpPort: number
  state: RaftState
  term: number
  lastSeen: Date
  weight: number
  metrics?: SystemMetricsSnapshot
}
```

### RaftMetrics

Internal metrics for a node.

```typescript
interface RaftMetrics {
  nodeId: string
  state: RaftState
  term: number
  commitIndex: number
  lastApplied: number
  logLength: number
  peers: number
  messagesReceived: number
  messagesSent: number
  electionsStarted: number
  votesGranted: number
  systemMetrics?: SystemMetricsSnapshot
}
```

### SystemMetricsSnapshot

System resource metrics.

```typescript
interface SystemMetricsSnapshot {
  timestamp: Date
  cpuUsage: number        // Percentage (0-100)
  memoryUsage: number     // Percentage (0-100)
  diskUsage: number       // Percentage (0-100)
  networkLatency: number  // Milliseconds
  loadAverage: [number, number, number]
  uptime: number          // Seconds
}
```

### Message Types

#### VoteRequest

```typescript
interface VoteRequest {
  type: MessageType.VOTE_REQUEST
  term: number
  candidateId: string
  lastLogIndex: number
  lastLogTerm: number
}
```

#### VoteResponse

```typescript
interface VoteResponse {
  type: MessageType.VOTE_RESPONSE
  term: number
  voteGranted: boolean
  voterId: string
  weight?: number
}
```

#### AppendEntriesRequest

```typescript
interface AppendEntriesRequest {
  type: MessageType.APPEND_ENTRIES
  term: number
  leaderId: string
  prevLogIndex: number
  prevLogTerm: number
  entries: LogEntry[]
  leaderCommit: number
}
```

#### AppendEntriesResponse

```typescript
interface AppendEntriesResponse {
  type: MessageType.APPEND_ENTRIES_RESPONSE
  term: number
  success: boolean
  matchIndex?: number
}
```

## Constants and Enums

### RaftState

Node states in the RAFT protocol.

```typescript
enum RaftState {
  FOLLOWER = "follower",
  CANDIDATE = "candidate",
  LEADER = "leader"
}
```

### MessageType

RAFT protocol message types.

```typescript
enum MessageType {
  VOTE_REQUEST = "vote_request",
  VOTE_RESPONSE = "vote_response",
  APPEND_ENTRIES = "append_entries",
  APPEND_ENTRIES_RESPONSE = "append_entries_response",
  INSTALL_SNAPSHOT = "install_snapshot",
  INSTALL_SNAPSHOT_RESPONSE = "install_snapshot_response"
}
```

### LogLevel

Logging levels.

```typescript
enum LogLevel {
  DEBUG = "debug",
  INFO = "info",
  WARN = "warn",
  ERROR = "error",
  FATAL = "fatal"
}
```

### RaftEventType

Event types emitted by nodes.

```typescript
enum RaftEventType {
  STATE_CHANGE = "state_change",
  LEADER_ELECTED = "leader_elected",
  VOTE_GRANTED = "vote_granted",
  VOTE_DENIED = "vote_denied",
  LOG_REPLICATED = "log_replicated",
  HEARTBEAT_RECEIVED = "heartbeat_received",
  ELECTION_TIMEOUT = "election_timeout",
  CONFIGURATION_CHANGED = "configuration_changed",
  SNAPSHOT_CREATED = "snapshot_created",
  ERROR_OCCURRED = "error_occurred",
  METRICS_UPDATED = "metrics_updated",
  PEER_DISCOVERED = "peer_discovered",
  PEER_LOST = "peer_lost"
  // ... and more
}
```

## Exceptions

All RAFT-specific exceptions extend from `RaftException`.

### Exception Hierarchy

```typescript
class RaftException extends Error
class RaftConfigurationException extends RaftException
class RaftElectionException extends RaftException
class RaftNetworkException extends RaftException
class RaftPeerDiscoveryException extends RaftException
class RaftReplicationException extends RaftException
class RaftStorageException extends RaftException
class RaftTimeoutException extends RaftException
class RaftValidationException extends RaftException
```

### Usage Example

```typescript
try {
  await node.appendLog(command);
} catch (error) {
  if (error instanceof RaftValidationException) {
    console.error('Validation failed:', error.message);
  } else if (error instanceof RaftReplicationException) {
    console.error('Replication failed:', error.message);
  } else if (error instanceof RaftException) {
    console.error('RAFT error:', error.message);
  } else {
    console.error('Unexpected error:', error);
  }
}
```

## Events

RaftNode extends EventEmitter and emits various events.

### Event Types

#### stateChange

Emitted when node state changes.

```typescript
node.on('stateChange', (data: { state: RaftState, term: number }) => {
  console.log(`State changed to ${data.state} in term ${data.term}`);
});
```

#### leaderElected

Emitted when a new leader is elected.

```typescript
node.on('leaderElected', (data: { leaderId: string, term: number }) => {
  console.log(`Leader ${data.leaderId} elected in term ${data.term}`);
});
```

#### logReplicated

Emitted when a log entry is successfully replicated.

```typescript
node.on('logReplicated', (data: { index: number, command: any, term: number }) => {
  console.log(`Log entry ${data.index} replicated`);
});
```

#### peerDiscovered

Emitted when a new peer is discovered.

```typescript
node.on('peerDiscovered', (data: { nodeId: string, address: string }) => {
  console.log(`Discovered peer ${data.nodeId} at ${data.address}`);
});
```

#### error

Emitted when an error occurs.

```typescript
node.on('error', (error: Error) => {
  console.error('Node error:', error);
});
```

### Complete Event List

- `stateChange` - Node state transitions
- `leaderElected` - New leader elected
- `logReplicated` - Log entry replicated
- `peerDiscovered` - New peer found
- `peerLost` - Peer disconnected
- `heartbeatReceived` - Heartbeat from leader
- `electionTimeout` - Election timer expired
- `snapshotCreated` - Snapshot created
- `configurationChanged` - Configuration updated
- `metricsUpdated` - Metrics collected
- `error` - Error occurred

## Utilities

### SystemMetrics

Utility class for collecting system metrics.

```typescript
class SystemMetrics {
  static async collect(): Promise<SystemMetricsSnapshot>
  static getCpuUsage(): number
  static getMemoryUsage(): number
  static getDiskUsage(): Promise<number>
  static getLoadAverage(): [number, number, number]
  static getUptime(): number
}
```

#### Usage Example

```typescript
const metrics = await SystemMetrics.collect();
console.log(`CPU Usage: ${metrics.cpuUsage}%`);
console.log(`Memory Usage: ${metrics.memoryUsage}%`);
console.log(`Uptime: ${metrics.uptime} seconds`);
```

## Advanced Usage Examples

### Custom Event Handling

```typescript
class RaftClusterManager {
  private nodes: Map<string, RaftNode> = new Map();
  
  setupNode(node: RaftNode, nodeId: string) {
    // Track all state changes
    node.on('stateChange', ({ state, term }) => {
      this.logStateChange(nodeId, state, term);
      
      if (state === RaftState.LEADER) {
        this.onLeaderElected(nodeId);
      }
    });
    
    // Monitor replication
    node.on('logReplicated', ({ index, command }) => {
      this.updateReplicationMetrics(nodeId, index);
    });
    
    // Handle errors
    node.on('error', (error) => {
      this.handleNodeError(nodeId, error);
    });
    
    this.nodes.set(nodeId, node);
  }
  
  private logStateChange(nodeId: string, state: RaftState, term: number) {
    console.log(`[${new Date().toISOString()}] Node ${nodeId}: ${state} (term ${term})`);
  }
  
  private onLeaderElected(nodeId: string) {
    console.log(`New leader: ${nodeId}`);
    // Update routing, notify clients, etc.
  }
  
  private updateReplicationMetrics(nodeId: string, index: number) {
    // Track replication lag, throughput, etc.
  }
  
  private handleNodeError(nodeId: string, error: Error) {
    console.error(`Node ${nodeId} error:`, error);
    // Implement recovery logic
  }
}
```

### Type Guards

```typescript
// Type guard for RaftException types
function isRaftException(error: any): error is RaftException {
  return error instanceof RaftException;
}

// Type guard for specific exceptions
function isValidationError(error: any): error is RaftValidationException {
  return error instanceof RaftValidationException;
}

// Usage
try {
  await node.appendLog(command);
} catch (error) {
  if (isValidationError(error)) {
    // Handle validation errors
  } else if (isRaftException(error)) {
    // Handle other RAFT errors
  } else {
    // Handle unexpected errors
  }
}
```

### Metrics Collection

```typescript
class MetricsCollector {
  async collectClusterMetrics(engine: RaftEngine): Promise<ClusterMetrics> {
    const nodes = engine.getAllNodes();
    const metrics: ClusterMetrics = {
      totalNodes: nodes.size,
      leaders: 0,
      followers: 0,
      candidates: 0,
      totalLogs: 0,
      averageLatency: 0,
    };
    
    for (const [nodeId, node] of nodes) {
      const state = node.getState();
      switch (state) {
        case RaftState.LEADER:
          metrics.leaders++;
          break;
        case RaftState.FOLLOWER:
          metrics.followers++;
          break;
        case RaftState.CANDIDATE:
          metrics.candidates++;
          break;
      }
      
      const nodeMetrics = node.getMetrics();
      if (nodeMetrics) {
        metrics.totalLogs += nodeMetrics.logLength;
      }
    }
    
    return metrics;
  }
}
```

## Version Compatibility

| RAFT Version | Node.js | TypeScript |
|--------------|---------|------------|
| 0.x          | ≥18.12  | ≥5.0       |

## See Also

- [Configuration Guide](./configuration.md) - Detailed configuration options
- [Advanced Usage](./advanced-usage.md) - Advanced patterns and techniques
- [Examples](./examples.md) - Practical examples
- [Architecture](./architecture.md) - Internal architecture details