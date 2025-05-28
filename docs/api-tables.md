# RAFT API Reference Tables

This document provides comprehensive table-based documentation for all interfaces, classes, properties, and methods in the RAFT library.

## Table of Contents

- [Core Interfaces](#core-interfaces)
  - [RaftConfiguration](#raftconfiguration)
  - [RedisConfig](#redisconfig)
  - [NetworkConfig](#networkconfig)
  - [PersistenceConfig](#persistenceconfig)
  - [PeerDiscoveryConfig](#peerdiscoveryconfig)
  - [VotingConfig](#votingconfig)
  - [RetryConfig](#retryconfig)
  - [CircuitBreakerConfig](#circuitbreakerconfig)
  - [MetricsConfig](#metricsconfig)
  - [LoggingConfig](#loggingconfig)
- [Message Interfaces](#message-interfaces)
  - [LogEntry](#logentry)
  - [VoteRequest](#voterequest)
  - [VoteResponse](#voteresponse)
  - [AppendEntriesRequest](#appendentriesrequest)
  - [AppendEntriesResponse](#appendentriesresponse)
- [Data Types](#data-types)
  - [PeerInfo](#peerinfo)
  - [RaftMetrics](#raftmetrics)
  - [SystemMetricsSnapshot](#systemmetricssnapshot)
  - [RaftEvent](#raftevent)
- [Core Classes](#core-classes)
  - [RaftEngine](#raftengine-class)
  - [RaftNode](#raftnode-class)
- [Enumerations](#enumerations)
  - [RaftState](#raftstate)
  - [LogLevel](#loglevel)
  - [MessageType](#messagetype)
  - [RaftEventType](#rafteventtype)
- [Exception Classes](#exception-classes)

---

## Core Interfaces

### RaftConfiguration

**Description**: Main configuration interface for a RAFT node. Contains all settings needed to initialize and operate a node in the cluster.

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `nodeId` | `string` | ✅ Yes | - | Unique identifier for this node. Must be unique across the entire cluster. Used for node identification in voting, replication, and peer discovery. |
| `clusterId` | `string` | ✅ Yes | - | Identifies which cluster this node belongs to. All nodes in a cluster must have the same clusterId. Used for peer discovery and preventing cross-cluster communication. |
| `httpHost` | `string` | ✅ Yes | - | The hostname or IP address where the HTTP server will bind. Use '0.0.0.0' to bind to all interfaces or 'localhost' for local only. |
| `httpPort` | `number` | ✅ Yes | - | The port number for the HTTP server. Each node in the cluster must use a unique port if running on the same host. Range: 1-65535. |
| `electionTimeout` | `[number, number]` | ✅ Yes | - | Election timeout range in milliseconds [min, max]. A random value between min and max is chosen to prevent split votes. Recommended: [150, 300] for LAN, [500, 1000] for WAN. |
| `heartbeatInterval` | `number` | ✅ Yes | - | Interval in milliseconds between heartbeat messages sent by the leader. Must be significantly less than the minimum election timeout. Recommended: electionTimeout/3. |
| `maxLogEntries` | `number` | ❌ No | `10000` | Maximum number of log entries to keep in memory before triggering compaction. Higher values use more memory but reduce snapshot frequency. |
| `snapshotThreshold` | `number` | ❌ No | `1000` | Number of log entries to accumulate before creating a snapshot. Lower values create snapshots more frequently, reducing recovery time but increasing I/O. |
| `redis` | `RedisConfig` | ✅ Yes | - | Redis connection configuration for state persistence and peer discovery. See RedisConfig interface for details. |
| `peerDiscovery` | `PeerDiscoveryConfig` | ❌ No | See defaults | Configuration for automatic peer discovery. If not provided, uses default values for registration and health checking. |
| `voting` | `VotingConfig` | ✅ Yes | - | Configuration for leader election voting behavior, including weighted voting support. |
| `retry` | `RetryConfig` | ❌ No | See defaults | Retry strategy configuration for failed operations. Uses exponential backoff with configurable parameters. |
| `circuitBreaker` | `CircuitBreakerConfig` | ❌ No | See defaults | Circuit breaker configuration to prevent cascading failures in distributed communication. |
| `metrics` | `MetricsConfig` | ✅ Yes | - | Metrics collection and export configuration. Controls both internal metrics and Prometheus integration. |
| `logging` | `LoggingConfig` | ✅ Yes | - | Logging configuration including level, format, and output destinations. |
| `network` | `NetworkConfig` | ✅ Yes | - | Network communication settings including timeouts and retry behavior. |
| `persistence` | `PersistenceConfig` | ✅ Yes | - | Data persistence configuration including snapshots and write-ahead logging. |

### RedisConfig

**Description**: Configuration for Redis connection used for persistent state storage and peer discovery.

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `host` | `string` | ✅ Yes | - | Redis server hostname or IP address. Use 'localhost' for local Redis or specific IP/hostname for remote Redis. |
| `port` | `number` | ✅ Yes | - | Redis server port number. Standard Redis port is 6379. Must be accessible from all nodes in the cluster. |
| `password` | `string` | ❌ No | `undefined` | Redis authentication password. Required if Redis server has authentication enabled. Store securely and never commit to version control. |
| `db` | `number` | ❌ No | `0` | Redis database number to use (0-15). Allows logical separation of data within a single Redis instance. |
| `keyPrefix` | `string` | ❌ No | `'raft'` | Prefix for all Redis keys used by this cluster. Helps prevent key collisions when multiple applications share Redis. Format: 'prefix:clusterId:...' |
| `ttl` | `number` | ❌ No | `86400` | Time-to-live in seconds for ephemeral keys (like peer discovery). Default is 24 hours. Prevents stale data accumulation. |

### NetworkConfig

**Description**: Network communication configuration controlling timeouts, retries, and circuit breaker behavior.

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `requestTimeout` | `number` | ✅ Yes | - | Maximum time in milliseconds to wait for RPC responses. Should be based on network latency: LAN: 5000ms, WAN: 15000ms. |
| `maxRetries` | `number` | ✅ Yes | - | Maximum number of retry attempts for failed network requests. Higher values improve reliability but increase latency for failed operations. |
| `retryDelay` | `number` | ✅ Yes | - | Initial delay in milliseconds between retry attempts. Subsequent retries use exponential backoff based on this value. |
| `circuitBreakerThreshold` | `number` | ✅ Yes | - | Number of consecutive failures before opening the circuit breaker. Prevents repeated attempts to unreachable nodes. |
| `circuitBreakerTimeout` | `number` | ✅ Yes | - | Time in milliseconds before attempting to close an open circuit breaker. During this time, all requests fail immediately. |

### PersistenceConfig

**Description**: Configuration for data persistence including snapshots and write-ahead logging (WAL).

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `enableSnapshots` | `boolean` | ✅ Yes | - | Whether to enable periodic snapshots. Snapshots reduce recovery time and log size but require disk I/O. |
| `snapshotInterval` | `number` | ✅ Yes | - | Interval in milliseconds between automatic snapshots. Recommended: 300000 (5 minutes) for production. |
| `dataDir` | `string` | ✅ Yes | - | Directory path for storing persistent data (snapshots, WAL). Must be writable by the process and have sufficient space. |
| `walEnabled` | `boolean` | ✅ Yes | - | Whether to enable Write-Ahead Logging for durability. WAL ensures data survives crashes but adds write latency. |
| `walSizeLimit` | `number` | ✅ Yes | - | Maximum size in bytes for WAL files before rotation. Larger values reduce rotation frequency but use more disk space. |

### PeerDiscoveryConfig

**Description**: Configuration for automatic peer discovery and health monitoring.

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `registrationInterval` | `number` | ❌ No | `5000` | Interval in milliseconds between peer registration updates. Lower values provide faster discovery but increase Redis load. |
| `healthCheckInterval` | `number` | ❌ No | `10000` | Interval in milliseconds between peer health checks. Determines how quickly failed nodes are detected. |
| `peerTimeout` | `number` | ❌ No | `30000` | Time in milliseconds before considering a peer dead. Should be > 2 * healthCheckInterval to prevent false positives. |

### VotingConfig

**Description**: Configuration for leader election voting behavior including weighted voting support.

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `enableWeighting` | `boolean` | ✅ Yes | - | Whether to use weighted voting based on node metrics. Weighted voting prefers healthier nodes as leaders. |
| `weightMetrics` | `string[]` | ✅ Yes | - | List of metrics to consider for vote weight calculation. Options: 'cpuUsage', 'memoryUsage', 'networkLatency', 'uptime'. |
| `defaultWeight` | `number` | ✅ Yes | - | Default vote weight for nodes (typically 1). Can be overridden based on metrics when enableWeighting is true. |

### RetryConfig

**Description**: Configuration for retry behavior using exponential backoff strategy.

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `maxAttempts` | `number` | ❌ No | `3` | Maximum number of retry attempts including the initial attempt. Set to 1 to disable retries. |
| `backoffFactor` | `number` | ❌ No | `2` | Multiplier for exponential backoff. Each retry waits backoffFactor times longer than the previous attempt. |
| `initialDelay` | `number` | ❌ No | `100` | Initial delay in milliseconds before the first retry. Subsequent delays are multiplied by backoffFactor. |

### CircuitBreakerConfig

**Description**: Circuit breaker configuration to prevent cascading failures in distributed systems.

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `timeout` | `number` | ❌ No | `3000` | Operation timeout in milliseconds. Operations exceeding this time are considered failures. |
| `errorThresholdPercentage` | `number` | ❌ No | `50` | Error percentage threshold (0-100) to open the circuit. Circuit opens when error rate exceeds this threshold. |
| `resetTimeout` | `number` | ❌ No | `30000` | Time in milliseconds before attempting to close an open circuit. During this time, a single test request is allowed. |

### MetricsConfig

**Description**: Configuration for metrics collection and export.

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `enablePrometheus` | `boolean` | ✅ Yes | - | Whether to enable Prometheus metrics export. Exposes metrics in Prometheus format on the metrics endpoint. |
| `enableInternal` | `boolean` | ✅ Yes | - | Whether to enable internal metrics collection. Required for getMetrics() API and system monitoring. |
| `collectionInterval` | `number` | ✅ Yes | - | Interval in milliseconds between metrics collection. Lower values provide more granular data but increase CPU usage. |
| `retentionPeriod` | `number` | ❌ No | `3600000` | Time in milliseconds to retain metrics history. Default is 1 hour. Longer retention uses more memory. |

### LoggingConfig

**Description**: Logging configuration for structured and traditional logging output.

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `level` | `LogLevel` | ✅ Yes | - | Minimum log level to output. Messages below this level are ignored. See LogLevel enum for options. |
| `redactedFields` | `string[]` | ❌ No | `[]` | List of field names to redact from logs for security. Common values: ['password', 'token', 'secret', 'key']. |
| `enableStructured` | `boolean` | ❌ No | `true` | Whether to output logs in structured JSON format. Structured logs are easier to parse but less human-readable. |
| `enableConsole` | `boolean` | ❌ No | `true` | Whether to output logs to console (stdout/stderr). Useful for development and containerized environments. |
| `enableFile` | `boolean` | ❌ No | `false` | Whether to output logs to a file. Requires filePath to be set. Useful for traditional deployments. |
| `filePath` | `string` | ❌ No | `undefined` | Path to log file when enableFile is true. Directory must exist and be writable. Supports log rotation externally. |

---

## Message Interfaces

### LogEntry

**Description**: Represents a single entry in the replicated log. The fundamental unit of data replication in RAFT.

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `index` | `number` | ✅ Yes | - | Unique, monotonically increasing index of this log entry. Starts at 1 and increments for each new entry. |
| `term` | `number` | ✅ Yes | - | The term number when this entry was created. Used to detect inconsistencies and determine log ordering. |
| `command` | `any` | ✅ Yes | - | The actual command/data to be replicated. Can be any JSON-serializable data structure. Applied to state machine when committed. |
| `timestamp` | `Date` | ✅ Yes | - | When this log entry was created. Used for debugging, monitoring, and time-based log compaction. |

### VoteRequest

**Description**: Request sent by candidates during leader election to request votes from other nodes.

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `type` | `MessageType.VOTE_REQUEST` | ✅ Yes | - | Message type identifier. Always set to VOTE_REQUEST for vote request messages. |
| `term` | `number` | ✅ Yes | - | The candidate's current term. Nodes reject requests from older terms and update their term if this is newer. |
| `candidateId` | `string` | ✅ Yes | - | The node ID of the candidate requesting votes. Used to track who to vote for in this term. |
| `lastLogIndex` | `number` | ✅ Yes | - | Index of the candidate's last log entry. Used for log completeness check - candidates with incomplete logs are rejected. |
| `lastLogTerm` | `number` | ✅ Yes | - | Term of the candidate's last log entry. Combined with lastLogIndex to ensure only up-to-date candidates can become leader. |

### VoteResponse

**Description**: Response to a vote request indicating whether the vote was granted.

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `type` | `MessageType.VOTE_RESPONSE` | ✅ Yes | - | Message type identifier. Always set to VOTE_RESPONSE for vote response messages. |
| `term` | `number` | ✅ Yes | - | The current term of the responding node. Candidates step down if they receive a response with a higher term. |
| `voteGranted` | `boolean` | ✅ Yes | - | Whether the vote was granted. True if the candidate received this node's vote, false otherwise. |
| `voterId` | `string` | ✅ Yes | - | The node ID of the voter. Used for vote counting and debugging election issues. |
| `weight` | `number` | ❌ No | `1` | Vote weight when weighted voting is enabled. Higher weights give nodes more influence in elections. |

### AppendEntriesRequest

**Description**: Request sent by leaders to replicate log entries and serve as heartbeat.

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `type` | `MessageType.APPEND_ENTRIES` | ✅ Yes | - | Message type identifier. Always set to APPEND_ENTRIES for append entries messages. |
| `term` | `number` | ✅ Yes | - | Leader's current term. Followers reject requests from old terms and update their term if this is newer. |
| `leaderId` | `string` | ✅ Yes | - | The node ID of the current leader. Followers redirect clients to this node and use it for monitoring. |
| `prevLogIndex` | `number` | ✅ Yes | - | Index of log entry immediately preceding new ones. Used for log consistency check. |
| `prevLogTerm` | `number` | ✅ Yes | - | Term of prevLogIndex entry. Combined with prevLogIndex to ensure log consistency. |
| `entries` | `LogEntry[]` | ✅ Yes | - | Log entries to replicate (empty for heartbeat). Followers append these after consistency check passes. |
| `leaderCommit` | `number` | ✅ Yes | - | Leader's commitIndex. Followers advance their commitIndex to min(leaderCommit, index of last new entry). |

### AppendEntriesResponse

**Description**: Response to append entries request indicating success or failure of log replication.

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `type` | `MessageType.APPEND_ENTRIES_RESPONSE` | ✅ Yes | - | Message type identifier. Always set to APPEND_ENTRIES_RESPONSE. |
| `term` | `number` | ✅ Yes | - | Current term of the follower. Leaders step down if they receive a response with a higher term. |
| `success` | `boolean` | ✅ Yes | - | Whether the follower successfully appended the entries. False indicates log inconsistency. |
| `matchIndex` | `number` | ❌ No | `undefined` | Highest log index known to be replicated on this follower. Used by leader to track replication progress. |

---

## Data Types

### PeerInfo

**Description**: Comprehensive information about a peer node in the cluster, used for discovery and monitoring.

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `nodeId` | `string` | ✅ Yes | - | Unique identifier of the peer node. Must match the nodeId in that node's configuration. |
| `clusterId` | `string` | ✅ Yes | - | Cluster identifier. Must match for nodes to communicate. Prevents cross-cluster communication. |
| `httpHost` | `string` | ✅ Yes | - | Hostname or IP address where the peer's HTTP server is accessible. Used for RPC communication. |
| `httpPort` | `number` | ✅ Yes | - | Port number of the peer's HTTP server. Combined with httpHost to form the complete endpoint. |
| `state` | `RaftState` | ✅ Yes | - | Current state of the peer (FOLLOWER, CANDIDATE, or LEADER). Used for routing and monitoring. |
| `term` | `number` | ✅ Yes | - | Current term of the peer. Used to detect outdated information and for debugging. |
| `lastSeen` | `Date` | ✅ Yes | - | Timestamp of last successful communication with this peer. Used for health checking and failure detection. |
| `weight` | `number` | ✅ Yes | - | Voting weight of this peer. Used in weighted leader elections to prefer certain nodes. |
| `metrics` | `SystemMetricsSnapshot` | ❌ No | `undefined` | System resource metrics for this peer. Used for weighted voting and monitoring cluster health. |

### RaftMetrics

**Description**: Comprehensive metrics for a RAFT node including consensus, performance, and system metrics.

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `nodeId` | `string` | ✅ Yes | - | The node identifier these metrics belong to. Used for multi-node monitoring. |
| `state` | `RaftState` | ✅ Yes | - | Current consensus state of the node. Critical for monitoring cluster health. |
| `term` | `number` | ✅ Yes | - | Current term number. Frequent term changes indicate election issues. |
| `commitIndex` | `number` | ✅ Yes | - | Highest log entry known to be committed. Indicates replication progress. |
| `lastApplied` | `number` | ✅ Yes | - | Highest log entry applied to state machine. Lag from commitIndex indicates apply backlog. |
| `logLength` | `number` | ✅ Yes | - | Total number of entries in the log. Used for capacity planning and snapshot triggers. |
| `peers` | `number` | ✅ Yes | - | Number of known peer nodes. Should match expected cluster size minus one. |
| `messagesReceived` | `number` | ✅ Yes | - | Total number of RPC messages received. Used for traffic analysis and debugging. |
| `messagesSent` | `number` | ✅ Yes | - | Total number of RPC messages sent. High values may indicate network issues. |
| `electionsStarted` | `number` | ✅ Yes | - | Number of elections this node has initiated. High values indicate stability issues. |
| `votesGranted` | `number` | ✅ Yes | - | Number of votes granted to other candidates. Used for election analysis. |
| `systemMetrics` | `SystemMetricsSnapshot` | ❌ No | `undefined` | System resource usage metrics. Used for capacity planning and health monitoring. |

### SystemMetricsSnapshot

**Description**: System resource metrics snapshot for monitoring node health and performance.

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `timestamp` | `Date` | ✅ Yes | - | When this metrics snapshot was taken. Used for time-series analysis. |
| `cpuUsage` | `number` | ✅ Yes | - | CPU usage percentage (0-100). High CPU may indicate performance issues or need for scaling. |
| `memoryUsage` | `number` | ✅ Yes | - | Memory usage percentage (0-100). High memory usage may require increasing resources or reducing log size. |
| `diskUsage` | `number` | ✅ Yes | - | Disk usage percentage (0-100). Critical for nodes with persistence enabled. Monitor to prevent disk full errors. |
| `networkLatency` | `number` | ✅ Yes | - | Average network latency to peers in milliseconds. High latency affects consensus performance. |
| `loadAverage` | `[number, number, number]` | ✅ Yes | - | System load average [1min, 5min, 15min]. High load indicates resource contention. |
| `uptime` | `number` | ✅ Yes | - | System uptime in seconds. Used for weighted voting to prefer stable nodes as leaders. |

### RaftEvent

**Description**: Event emitted by RAFT nodes for monitoring state changes and important occurrences.

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `type` | `RaftEventType` | ✅ Yes | - | Type of event that occurred. See RaftEventType enum for all possible events. |
| `nodeId` | `string` | ✅ Yes | - | Node that emitted this event. Used for filtering and correlation in multi-node setups. |
| `timestamp` | `Date` | ✅ Yes | - | When the event occurred. Used for event ordering and latency analysis. |
| `data` | `any` | ❌ No | `undefined` | Event-specific data. Structure depends on event type. May include state transitions, error details, etc. |

---

## Core Classes

### RaftEngine Class

**Description**: Main entry point for creating and managing RAFT nodes. Handles lifecycle and provides factory methods.

#### Constructor

| Method | Parameters | Returns | Description |
|--------|-----------|---------|-------------|
| `constructor()` | None | `RaftEngine` | Creates a new RaftEngine instance. Initializes internal node registry and default logger configuration. No parameters needed as configuration is per-node. |

#### Methods

| Method | Parameters | Returns | Async | Description |
|--------|-----------|---------|-------|-------------|
| `createNode` | `config: RaftConfiguration` | `Promise<RaftNode>` | ✅ Yes | Creates a new RAFT node with the specified configuration. Validates configuration, initializes storage connections, and prepares the node for starting. Throws `RaftConfigurationException` if nodeId already exists. |
| `startNode` | `nodeId: string` | `Promise<void>` | ✅ Yes | Starts a previously created node, beginning participation in the cluster. Initializes network listeners, starts election timer, and begins peer discovery. Throws `RaftConfigurationException` if node not found. |
| `stopNode` | `nodeId: string` | `Promise<void>` | ✅ Yes | Gracefully stops a running node. Cancels timers, closes network connections, persists final state, and removes from active nodes. Throws `RaftConfigurationException` if node not found. |
| `getNode` | `nodeId: string` | `RaftNode \| undefined` | ❌ No | Retrieves a node instance by ID. Returns undefined if node doesn't exist. Used for direct node access and operations. |
| `getAllNodes` | None | `Map<string, RaftNode>` | ❌ No | Returns a map of all nodes managed by this engine. The map is a copy to prevent external modifications. Keys are nodeIds, values are RaftNode instances. |
| `stopAllNodes` | None | `Promise<void>` | ✅ Yes | Stops all nodes managed by this engine. Useful for cleanup in tests or graceful shutdown. Processes nodes in parallel for efficiency. |
| `createDefaultConfiguration` | `nodeId: string, clusterId: string` | `RaftConfiguration` | ❌ No | **Static method**. Creates a complete configuration with sensible defaults. Includes recommended settings for timeouts, networking, and persistence. Requires only nodeId and clusterId. |

### RaftNode Class

**Description**: Represents a single node in the RAFT cluster. Extends EventEmitter for state change notifications.

#### Properties

| Property | Type | Access | Description |
|----------|------|--------|-------------|
| `nodeId` | `string` | Read-only | Unique identifier for this node. Set during construction and immutable. |
| `state` | `RaftState` | Private | Current consensus state. Use `getState()` for access. Changes trigger events. |
| `currentTerm` | `number` | Private | Current term number. Monotonically increasing. Use `getCurrentTerm()` for access. |
| `votedFor` | `string \| null` | Private | NodeId voted for in current term. Null if haven't voted. Persisted to prevent double voting. |
| `commitIndex` | `number` | Private | Highest log entry known to be committed. Advances as entries are replicated to majority. |
| `lastApplied` | `number` | Private | Highest log entry applied to state machine. Always <= commitIndex. |

#### Methods

| Method | Parameters | Returns | Async | Description |
|--------|-----------|---------|-------|-------------|
| `start` | None | `Promise<void>` | ✅ Yes | Starts the node and begins cluster participation. Loads persisted state, initializes WAL, starts peer discovery, and begins election timer. Emits 'started' event on success. |
| `stop` | None | `Promise<void>` | ✅ Yes | Gracefully stops the node. Persists current state, closes network connections, stops timers, and cleans up resources. Emits 'stopped' event. |
| `appendLog` | `command: any` | `Promise<boolean>` | ✅ Yes | Appends a new entry to the replicated log (leader only). Replicates to followers and returns true when committed. Throws `RaftValidationException` if not leader. |
| `getState` | None | `RaftState` | ❌ No | Returns the current consensus state (FOLLOWER, CANDIDATE, or LEADER). Safe to call at any time. |
| `getCurrentTerm` | None | `number` | ❌ No | Returns the current term number. Useful for debugging and monitoring. |
| `getMetrics` | None | `RaftMetrics \| undefined` | ❌ No | Returns comprehensive metrics including consensus state, log information, and system metrics. Returns undefined if metrics collection is disabled. |
| `getPrometheusMetrics` | None | `Promise<string>` | ✅ Yes | Returns metrics formatted for Prometheus scraping. Includes all internal metrics with appropriate labels. Empty string if Prometheus export is disabled. |
| `getPeers` | None | `string[]` | ❌ No | Returns array of known peer node IDs. Does not include self. Updates as peers are discovered or lost. |
| `getPeerInfo` | `nodeId: string` | `PeerInfo \| undefined` | ❌ No | Returns detailed information about a specific peer. Returns undefined if peer is unknown or not discovered yet. |

#### Events

| Event | Data Type | Description |
|-------|-----------|-------------|
| `stateChange` | `{ state: RaftState, term: number, previousState: RaftState }` | Emitted when node transitions between states. Critical for monitoring cluster stability. |
| `leaderElected` | `{ leaderId: string, term: number }` | Emitted when a new leader is elected in the cluster. LeaderId may be this node or a peer. |
| `logReplicated` | `{ index: number, command: any, term: number }` | Emitted when a log entry is successfully committed. Indicates the command can be applied to state machine. |
| `peerDiscovered` | `{ nodeId: string, address: string }` | Emitted when a new peer is discovered through peer discovery. Address is in host:port format. |
| `peerLost` | `{ nodeId: string, lastSeen: Date }` | Emitted when a peer is considered lost (no response within timeout). May reconnect later. |
| `error` | `Error` | Emitted when an error occurs that doesn't halt operation. Includes network errors, storage errors, etc. |

---

## Enumerations

### RaftState

**Description**: Possible states for a RAFT node following the RAFT consensus protocol.

| Value | String | Description |
|-------|--------|-------------|
| `FOLLOWER` | `"follower"` | Default state for all nodes. Responds to RPCs from leaders and candidates. Grants votes when appropriate. Becomes candidate if election timeout occurs without hearing from leader. |
| `CANDIDATE` | `"candidate"` | Transitional state when attempting to become leader. Votes for self and requests votes from peers. Becomes leader with majority votes, reverts to follower if higher term discovered. |
| `LEADER` | `"leader"` | Active leader of the cluster. Handles all client requests, replicates log entries, sends heartbeats. Only one leader per term. Steps down if higher term discovered. |

### LogLevel

**Description**: Logging levels in order of increasing severity. Only messages at or above configured level are output.

| Value | String | Description |
|-------|--------|-------------|
| `DEBUG` | `"debug"` | Detailed debugging information. Includes message traces, state transitions, internal operations. High volume, not for production. |
| `INFO` | `"info"` | General informational messages. Includes startup/shutdown, state changes, normal operations. Default for production. |
| `WARN` | `"warn"` | Warning messages for potentially harmful situations. Includes retry attempts, slow operations, non-critical errors. |
| `ERROR` | `"error"` | Error messages for serious problems. Includes failed operations, network errors, storage errors. Always logged. |
| `FATAL` | `"fatal"` | Fatal errors that cause node shutdown. Includes unrecoverable errors, panic situations. Always logged before exit. |

### MessageType

**Description**: Types of RPC messages in the RAFT protocol.

| Value | String | Description |
|-------|--------|-------------|
| `VOTE_REQUEST` | `"vote_request"` | Request for vote during leader election. Sent by candidates to all other nodes. |
| `VOTE_RESPONSE` | `"vote_response"` | Response to vote request. Indicates whether vote was granted and current term. |
| `APPEND_ENTRIES` | `"append_entries"` | Log replication and heartbeat message. Sent by leaders to maintain authority and replicate entries. |
| `APPEND_ENTRIES_RESPONSE` | `"append_entries_response"` | Response to append entries. Indicates success/failure and matching log index. |
| `INSTALL_SNAPSHOT` | `"install_snapshot"` | Snapshot transfer for nodes far behind. Sent by leader when log difference is too large. |
| `INSTALL_SNAPSHOT_RESPONSE` | `"install_snapshot_response"` | Response to snapshot installation. Indicates success/failure of snapshot application. |

### RaftEventType

**Description**: Types of events emitted by RAFT nodes for monitoring and integration. Comprehensive list for observability.

| Value | String | Description |
|-------|--------|-------------|
| `STATE_CHANGE` | `"state_change"` | Node changed state (FOLLOWER/CANDIDATE/LEADER). Most important event for monitoring cluster stability. |
| `LEADER_ELECTED` | `"leader_elected"` | New leader was elected in the cluster. May be this node or another node. |
| `VOTE_GRANTED` | `"vote_granted"` | This node granted its vote to a candidate. Useful for debugging elections. |
| `VOTE_DENIED` | `"vote_denied"` | This node denied a vote request. Includes reason (term, log completeness). |
| `LOG_REPLICATED` | `"log_replicated"` | Log entry was successfully replicated to majority and committed. |
| `HEARTBEAT_RECEIVED` | `"heartbeat_received"` | Received heartbeat from leader. Resets election timer. |
| `ELECTION_TIMEOUT` | `"election_timeout"` | Election timer expired without hearing from leader. Will transition to candidate. |
| `CONFIGURATION_CHANGED` | `"configuration_changed"` | Cluster configuration changed (nodes added/removed). |
| `SNAPSHOT_CREATED` | `"snapshot_created"` | New snapshot was created. Includes snapshot metadata. |
| `ERROR_OCCURRED` | `"error_occurred"` | Non-fatal error occurred. Includes error type and details. |
| `METRICS_UPDATED` | `"metrics_updated"` | New metrics data available. Emitted at configured interval. |
| `PEER_DISCOVERED` | `"peer_discovered"` | New peer node discovered through peer discovery mechanism. |
| `PEER_LOST` | `"peer_lost"` | Peer node considered lost after timeout. May reconnect later. |

---

## Exception Classes

**Description**: Hierarchy of exceptions for different error scenarios. All extend from base `RaftException`.

| Exception | Extends | Description | Common Causes |
|-----------|---------|-------------|---------------|
| `RaftException` | `Error` | Base exception for all RAFT-specific errors. Catch this to handle any RAFT error. | Various RAFT-related failures |
| `RaftConfigurationException` | `RaftException` | Configuration validation or application errors. | Invalid config values, duplicate node IDs, missing required fields |
| `RaftElectionException` | `RaftException` | Errors during leader election process. | Split votes, network partitions during election |
| `RaftNetworkException` | `RaftException` | Network communication failures. | Connection timeouts, unreachable nodes, network partitions |
| `RaftPeerDiscoveryException` | `RaftException` | Peer discovery mechanism failures. | Redis unavailable, invalid peer data |
| `RaftReplicationException` | `RaftException` | Log replication failures. | Follower too far behind, inconsistent logs |
| `RaftStorageException` | `RaftException` | Storage layer errors (Redis, disk). | Redis connection lost, disk full, corrupted data |
| `RaftTimeoutException` | `RaftException` | Operation timeout errors. | Slow network, overloaded nodes |
| `RaftValidationException` | `RaftException` | Input validation errors. | Invalid commands, wrong node state for operation |

---

## Usage Examples

### Basic Configuration

```typescript
// Minimal configuration with defaults
const config: RaftConfiguration = {
  nodeId: 'node-1',
  clusterId: 'my-cluster',
  httpHost: 'localhost',
  httpPort: 3001,
  electionTimeout: [150, 300],
  heartbeatInterval: 50,
  redis: {
    host: 'localhost',
    port: 6379
  },
  voting: {
    enableWeighting: false,
    weightMetrics: [],
    defaultWeight: 1
  },
  metrics: {
    enablePrometheus: true,
    enableInternal: true,
    collectionInterval: 5000
  },
  logging: {
    level: LogLevel.INFO
  },
  network: {
    requestTimeout: 5000,
    maxRetries: 3,
    retryDelay: 100,
    circuitBreakerThreshold: 5,
    circuitBreakerTimeout: 30000
  },
  persistence: {
    enableSnapshots: true,
    snapshotInterval: 300000,
    dataDir: '/var/lib/raft',
    walEnabled: true,
    walSizeLimit: 104857600
  }
};
```

### Production Configuration

```typescript
// Production configuration with all options
const productionConfig: RaftConfiguration = {
  nodeId: process.env.NODE_ID || 'prod-node-1',
  clusterId: 'production-cluster',
  httpHost: '0.0.0.0',
  httpPort: 3001,
  electionTimeout: [200, 400], // Adjusted for production
  heartbeatInterval: 75,
  maxLogEntries: 50000,
  snapshotThreshold: 5000,
  redis: {
    host: process.env.REDIS_HOST || 'redis.internal',
    port: 6379,
    password: process.env.REDIS_PASSWORD,
    db: 1,
    keyPrefix: 'raft:prod',
    ttl: 86400
  },
  peerDiscovery: {
    registrationInterval: 5000,
    healthCheckInterval: 10000,
    peerTimeout: 30000
  },
  voting: {
    enableWeighting: true,
    weightMetrics: ['cpuUsage', 'memoryUsage', 'uptime'],
    defaultWeight: 1
  },
  retry: {
    maxAttempts: 5,
    backoffFactor: 2,
    initialDelay: 200
  },
  circuitBreaker: {
    timeout: 5000,
    errorThresholdPercentage: 60,
    resetTimeout: 60000
  },
  metrics: {
    enablePrometheus: true,
    enableInternal: true,
    collectionInterval: 10000,
    retentionPeriod: 7200000 // 2 hours
  },
  logging: {
    level: LogLevel.WARN,
    redactedFields: ['password', 'token', 'secret'],
    enableStructured: true,
    enableConsole: false,
    enableFile: true,
    filePath: '/var/log/raft/node.log'
  },
  network: {
    requestTimeout: 10000,
    maxRetries: 5,
    retryDelay: 200,
    circuitBreakerThreshold: 10,
    circuitBreakerTimeout: 60000
  },
  persistence: {
    enableSnapshots: true,
    snapshotInterval: 600000, // 10 minutes
    dataDir: '/data/raft',
    walEnabled: true,
    walSizeLimit: 1073741824 // 1GB
  }
};
```

This documentation provides comprehensive information about every interface, class, property, and method in the RAFT library, making it easy for developers to understand and use the library effectively.