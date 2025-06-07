# Architecture

This document provides a deep dive into the internal architecture of the RAFT library, explaining how the consensus algorithm is implemented and how various components work together.

## Table of Contents

- [Overview](#overview)
- [Core Components](#core-components)
- [Consensus Algorithm](#consensus-algorithm)
- [Storage Layer](#storage-layer)
- [Network Layer](#network-layer)
- [State Machine](#state-machine)
- [Monitoring and Metrics](#monitoring-and-metrics)
- [Fault Tolerance](#fault-tolerance)
- [Performance Optimizations](#performance-optimizations)

## Overview

The RAFT library is built with a modular architecture that separates concerns and allows for easy extension and customization:

```
┌─────────────────────────────────────────────────────────────┐
│                        Application Layer                    │
├─────────────────────────────────────────────────────────────┤
│                         RAFT Engine                         │
├──────────────┬────────────────┬────────────────┬────────────┤
│  RAFT Node   │  State Machine │    Storage     │  Network   │
├──────────────┼────────────────┼────────────────┼────────────┤
│ Consensus    │  Log Manager   │     Redis      │   HTTP     │
│ Elections    │  Snapshots     │     WAL        │   RPC      │
│ Replication  │  Compaction    │   Persistence  │  Circuit   │
│              │                │                │  Breaker   │
└──────────────┴────────────────┴────────────────┴────────────┘
```

### Design Principles

1. **Modularity**: Each component has a single responsibility
2. **Fault Tolerance**: Built-in retry mechanisms and circuit breakers
3. **Performance**: Optimized for high throughput and low latency
4. **Observability**: Comprehensive metrics and logging
5. **Extensibility**: Easy to extend with custom implementations

## Core Components

### RaftEngine

The `RaftEngine` is the main entry point and orchestrator:

```typescript
class RaftEngine {
  private nodes: Map<string, RaftNode>
  private logger: RaftLogger

  createNode(config: RaftConfiguration): Promise<RaftNode>
  startNode(nodeId: string): Promise<void>
  stopNode(nodeId: string): Promise<void>
}
```

**Responsibilities:**
- Node lifecycle management
- Configuration validation
- Resource coordination
- Global error handling

### RaftNode

The `RaftNode` implements the core RAFT consensus algorithm:

```typescript
class RaftNode extends EventEmitter {
  // Core state
  private state: RaftState
  private currentTerm: number
  private votedFor: string | null
  private commitIndex: number
  private lastApplied: number

  // Components
  private log: RaftLog
  private network: RaftNetwork
  private metrics: RaftMetricsCollector
  private peerDiscovery: PeerDiscoveryService
  private stateMachine: StateMachine // Manages application state and snapshot data

  // Snapshot metadata
  private latestSnapshotMeta: { // Tracks the latest snapshot file created or installed
    lastIncludedIndex: number,
    lastIncludedTerm: number,
    filePath: string
  } | null

  // Timers
  private electionTimer: NodeJS.Timeout
  private heartbeatTimer: NodeJS.Timeout
}
```

**State Transitions:**

```
                 ┌─────────────┐
                 │  FOLLOWER   │
                 └──────┬──────┘
                        │ Election timeout
                        ▼
                 ┌─────────────┐
                 │  CANDIDATE  │
                 └──────┬──────┘
                        │ Receives majority votes
                        ▼
                 ┌─────────────┐
                 │   LEADER    │
                 └─────────────┘
```

### Event System

The library uses an event-driven architecture for loose coupling:

```typescript
class RaftEventBus extends EventEmitter {
  // Type-safe event emission
  emit<T extends RaftEventType>(event: T, data: RaftEventData[T]): boolean

  // Buffered events for reliability
  private eventBuffer: CircularBuffer<RaftEvent>

  // Event replay for debugging
  replayEvents(from: Date, to: Date): RaftEvent[]
}
```

## Consensus Algorithm

### Leader Election

The leader election process follows the RAFT specification:

```typescript
class ElectionManager {
  private async startElection(): Promise<void> {
    // 1. Increment current term
    this.currentTerm++

    // 2. Vote for self
    this.votedFor = this.nodeId

    // 3. Reset election timer
    this.resetElectionTimer()

    // 4. Send RequestVote RPCs to all peers
    const votePromises = this.peers.map(peer =>
      this.requestVote(peer)
    )

    // 5. Count votes
    const votes = await Promise.allSettled(votePromises)
    const voteCount = this.countVotes(votes)

    // 6. Become leader if majority
    if (voteCount > Math.floor(this.peers.length / 2)) {
      this.becomeLeader()
    }
  }
}
```

### Weighted Voting

The library supports weighted voting for advanced scenarios:

```typescript
class VoteWeightCalculator {
  calculateWeight(peerMetrics: SystemMetricsSnapshot): number {
    const weights = {
      cpuUsage: 0.3,
      memoryUsage: 0.2,
      networkLatency: 0.3,
      uptime: 0.2
    }

    return (
      (100 - peerMetrics.cpuUsage) * weights.cpuUsage +
      (100 - peerMetrics.memoryUsage) * weights.memoryUsage +
      (100 - Math.min(peerMetrics.networkLatency, 100)) * weights.networkLatency +
      Math.min(peerMetrics.uptime / 86400, 100) * weights.uptime
    ) / 100
  }
}
```

### Log Replication

Log replication ensures consistency across the cluster:

```typescript
class ReplicationManager {
  private async replicateLogToFollowers(): Promise<void> {
    const promises = this.peers.map(async peer => {
      const nextIndex = this.nextIndex.get(peer) || 1
      const prevLogIndex = nextIndex - 1
      const prevLogTerm = await this.log.getTermAtIndex(prevLogIndex)
      const entries = await this.log.getEntriesFrom(nextIndex)

      const request: AppendEntriesRequest = {
        term: this.currentTerm,
        leaderId: this.nodeId,
        prevLogIndex,
        prevLogTerm,
        entries,
        leaderCommit: this.commitIndex
      }

      const response = await this.network.sendAppendEntries(peer, request)
      this.handleAppendEntriesResponse(peer, response)
    })

    await Promise.allSettled(promises)
  }
}
```

### Safety Properties

The implementation guarantees RAFT's safety properties:

1. **Election Safety**: At most one leader per term
2. **Leader Append-Only**: Leaders never overwrite entries
3. **Log Matching**: Logs with same index/term have identical commands
4. **Leader Completeness**: Committed entries appear in future leaders
5. **State Machine Safety**: Same sequence of commands on all nodes

### Leadership Transfer

Leadership transfer allows a current leader to gracefully hand off its leadership to another peer in the cluster. This is useful for planned maintenance or rebalancing. The process is designed to minimize downtime and ensure a smooth transition.

**Process Overview:**
1.  **Initiation:** The current leader calls `transferLeadership(targetPeerId)` on itself, specifying the ID of the peer to transfer leadership to.
2.  **Target Log Synchronization:** The leader first ensures the `targetPeerId`'s log is reasonably up-to-date with its own. It may send pending log entries via `AppendEntriesRequest` RPCs, retrying a few times if necessary. If the target cannot be brought up-to-date, the transfer attempt is aborted.
3.  **TimeoutNow Request:** Once the target is confirmed to be up-to-date (or sufficiently close), the leader sends a `TimeoutNowRequest` RPC to the `targetPeerId`. This request includes the leader's current term.
4.  **Leader Steps Down:** After successfully sending the `TimeoutNowRequest`, the current leader transitions to the `FOLLOWER` state and resets its election timer. This prevents it from interfering with the election it's trying to trigger for the target.
5.  **Target Initiates Election:**
    *   Upon receiving the `TimeoutNowRequest`, the `targetPeerId` verifies the sender's term. If the sender's term is valid (not older than its own), it immediately bypasses its own election timeout and starts an election.
    *   This election bypasses the Pre-Vote phase. The target node increments its term, votes for itself, and sends `VoteRequest` RPCs to all other peers in the current configuration.
6.  **New Leader Elected:** If the target node receives a majority of votes, it becomes the new leader for the new term. Other nodes, including the old leader, will become followers of this new leader.

This mechanism provides a more controlled way to change leaders compared to simply stopping the current leader and waiting for a new election to time out naturally.

## Storage Layer

### Redis Integration

Redis is used for persistent state and peer discovery:

```typescript
class RedisStateStore {
  // Persistent state
  async persistState(state: PersistentState): Promise<void> {
    const multi = this.redis.multi()

    multi.hset(`raft:${this.nodeId}:state`, {
      currentTerm: state.currentTerm,
      votedFor: state.votedFor || '',
      commitIndex: state.commitIndex,
      lastApplied: state.lastApplied
    })

    multi.expire(`raft:${this.nodeId}:state`, this.ttl)
    await multi.exec()
  }

  // Peer discovery
  async registerPeer(info: PeerInfo): Promise<void> {
    const key = `raft:${this.clusterId}:peer:${info.nodeId}`
    await this.redis.setex(key, this.peerTtl, JSON.stringify(info))
  }
}
```

### Write-Ahead Log (WAL)

The WAL ensures durability and crash recovery:

```typescript
class WALEngine {
  private fileHandle: fs.FileHandle
  private currentSegment: number
  private segmentSize: number

  async appendEntry(entry: LogEntry): Promise<void> {
    // 1. Serialize entry
    const serialized = this.serialize(entry)

    // 2. Calculate checksum
    const checksum = this.calculateChecksum(serialized)

    // 3. Write to current segment
    const record = Buffer.concat([
      Buffer.from([RECORD_TYPE.ENTRY]),
      Buffer.from(checksum, 'hex'),
      Buffer.from(serialized)
    ])

    await this.fileHandle.write(record)

    // 4. Rotate segment if needed
    if (await this.shouldRotate()) {
      await this.rotateSegment()
    }
  }

  async recover(): Promise<LogEntry[]> {
    const entries: LogEntry[] = []
    const segments = await this.listSegments()

    for (const segment of segments) {
      const segmentEntries = await this.readSegment(segment)
      entries.push(...segmentEntries)
    }

    return entries
  }
}
```

### Snapshots

Snapshots prevent unbounded log growth and allow faster recovery for lagging followers. The snapshot logic is primarily orchestrated by `RaftNode`, interacting with the `StateMachine` for data and `RaftLog` for WAL metadata and log truncation.

**Triggering Snapshots:**
- `RaftNode` automatically triggers a snapshot creation process when its log size (number of entries in memory) exceeds the `snapshotThreshold` defined in its configuration. This check is performed typically after new log entries are appended (in `maybeCreateSnapshot` called by `appendLog`).

**Snapshot Creation Process (Leader):**
1.  **Get Application State:** `RaftNode` calls `this.stateMachine.getSnapshotData()` to obtain the current state of the application as a `Buffer`.
2.  **Save to File:** `RaftNode` saves this `snapshotData` to a file in the directory specified by `config.persistence.dataDir`. The filename follows a convention like `snapshot-<lastIncludedTerm>-<lastIncludedIndex>.snap`.
3.  **Update Metadata:** `RaftNode` updates its internal `this.latestSnapshotMeta` object with the `lastIncludedIndex`, `lastIncludedTerm`, and `filePath` of the newly created snapshot.
4.  **Record in WAL:** `RaftNode` informs `RaftLog` about the new snapshot by calling `this.log.createSnapshot(lastIncludedIndex, lastIncludedTerm, snapshotFilePath)`. `RaftLog` then records *metadata* about this snapshot (including its term, index, and file path) into the Write-Ahead Log (WAL). This WAL entry is crucial for recovery, indicating that log entries up to `lastIncludedIndex` are covered by this snapshot. The WAL engine may then compact itself.
5.  **Truncate Log:** `RaftLog` truncates its in-memory log entries and corresponding persisted entries (e.g., in Redis) that are now covered by the snapshot, using `this.log.truncateBeforeIndex(lastIncludedIndex + 1)`. This method also attempts to delete older on-disk snapshot files that are now superseded by the log's new starting point.
6.  **Clean Up Previous Snapshot:** `RaftNode`, after successfully creating the new snapshot file and updating its metadata, deletes its *own* previously created snapshot file from disk.

**Snapshot Storage:**
- Snapshots are stored as individual files directly within the `config.persistence.dataDir`.
- `RaftNode` uses `latestSnapshotMeta` to keep track of the most recent snapshot it has created or installed.

**Installing Snapshots (via `InstallSnapshot` RPC):**
When a follower is too far behind for efficient log replication, the leader sends a snapshot.

-   **RPC Messages:**
    -   `InstallSnapshotRequest`: Contains `term`, `leaderId`, `lastIncludedIndex`, `lastIncludedTerm`, `offset` (for chunking, currently basic), `data` (snapshot content), and `done` flag.
    -   `InstallSnapshotResponse`: Contains `term` for the leader to update itself if necessary.
-   **Leader's Role:**
    1.  Determines a follower needs a snapshot (e.g., `nextIndex` for the follower is less than `this.log.getFirstIndex()`).
    2.  Reads its latest snapshot file (identified by `this.latestSnapshotMeta.filePath`) from disk.
    3.  Sends the snapshot data to the follower via the `InstallSnapshotRequest` RPC (using `this.network.sendInstallSnapshot`). For now, it sends the whole snapshot as one chunk.
-   **Follower's Role (`RaftNode.handleInstallSnapshot`):**
    1.  Receives the `InstallSnapshotRequest`. Handles term checks and may become a follower if the leader's term is higher.
    2.  If `request.done` is true (and assuming a single chunk for now):
        a.  Saves the received `request.data` to a snapshot file in its own `config.persistence.dataDir` (e.g., `snapshot-<request.lastIncludedTerm>-<request.lastIncludedIndex>.snap`).
        b.  Updates its `this.latestSnapshotMeta` with the details of this newly installed snapshot.
        c.  Calls `this.stateMachine.applySnapshot(request.data)` to apply the snapshot to its application state.
        d.  Updates its `commitIndex` and `lastApplied` to `request.lastIncludedIndex`.
        e.  Calls `this.log.truncateEntriesAfter(request.lastIncludedIndex, request.lastIncludedTerm)` to discard existing log entries that are inconsistent with the snapshot. If an existing log entry matches the snapshot's `lastIncludedIndex` and `lastIncludedTerm`, logs after it are discarded; otherwise, the entire log might be cleared.
        f.  Persists its updated state (term, votedFor, commitIndex, lastApplied).

## Network Layer

### RPC Implementation

The network layer handles all node-to-node communication:

```typescript
class RaftNetwork {
  private httpAgents: Map<string, http.Agent>
  private circuitBreakers: Map<string, CircuitBreaker>

  async sendVoteRequest(
    peer: string,
    request: VoteRequest
  ): Promise<VoteResponse> {
    const breaker = this.getCircuitBreaker(peer)

    return breaker.fire(async () => {
      const response = await this.httpRequest({
        method: 'POST',
        url: `http://${peer}/raft/vote`,
        data: request,
        timeout: this.config.network.requestTimeout
      })

      return response.data as VoteResponse
    })
  }
}
```

### Circuit Breaker Pattern

Circuit breakers prevent cascading failures:

```typescript
class CircuitBreaker {
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED'
  private failures: number = 0
  private lastFailureTime: number = 0

  async fire<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.resetTimeout) {
        this.state = 'HALF_OPEN'
      } else {
        throw new Error('Circuit breaker is OPEN')
      }
    }

    try {
      const result = await operation()
      this.onSuccess()
      return result
    } catch (error) {
      this.onFailure()
      throw error
    }
  }

  private onFailure(): void {
    this.failures++
    this.lastFailureTime = Date.now()

    if (this.failures >= this.threshold) {
      this.state = 'OPEN'
      this.emit('open')
    }
  }

  private onSuccess(): void {
    this.failures = 0
    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED'
      this.emit('close')
    }
  }
}
```

### Retry Strategy

Exponential backoff with jitter for retries:

```typescript
class RetryStrategy {
  async execute<T>(
    operation: () => Promise<T>,
    context: string
  ): Promise<T> {
    let lastError: Error

    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      try {
        return await operation()
      } catch (error) {
        lastError = error

        if (attempt < this.maxAttempts - 1) {
          const delay = this.calculateDelay(attempt)
          await this.sleep(delay)
        }
      }
    }

    throw lastError
  }

  private calculateDelay(attempt: number): number {
    // Exponential backoff with jitter
    const exponentialDelay = this.initialDelay * Math.pow(this.backoffFactor, attempt)
    const jitter = Math.random() * exponentialDelay * 0.1
    return Math.min(exponentialDelay + jitter, this.maxDelay)
  }
}
```

## State Machine

### Abstract State Machine

The library provides an abstract state machine interface:

```typescript
interface StateMachine {
  apply(command: any): Promise<void>;
  getSnapshotData(): Promise<Buffer>; // To get state from application for snapshot
  applySnapshot(data: Buffer): Promise<void>; // To apply snapshot to application
}

class StateMachineManager {
  private stateMachine: StateMachine
  private applyLock: AsyncLock

  async applyCommittedEntries(): Promise<void> {
    while (this.lastApplied < this.commitIndex) {
      this.lastApplied++

      const entry = await this.log.getEntry(this.lastApplied)
      if (!entry) continue

      await this.applyLock.acquire(async () => {
        await this.stateMachine.apply(entry.command)
        this.emit('entryApplied', { index: this.lastApplied, entry })
      })
    }
  }
}
```

### Command Processing Pipeline

Commands go through multiple stages:

```
  Client Request
       │
       ▼
  ┌─────────────┐
  │   Leader    │──── Not Leader ──→ Forward/Reject
  └─────┬───────┘
        │
        ▼
  ┌─────────────┐
  │ Append Log  │
  └─────┬───────┘
        │
        ▼
  ┌─────────────┐
  │ Replicate   │
  └─────┬───────┘
        │
        ▼
  ┌─────────────┐
  │   Commit    │
  └─────┬───────┘
        │
        ▼
  ┌─────────────┐
  │Apply to FSM │
  └─────┬───────┘
        │
        ▼
  Client Response
```

## Monitoring and Metrics

### Metrics Collection

Comprehensive metrics for observability:

```typescript
class RaftMetricsCollector {
  private metrics: Map<string, RaftMetrics> = new Map()
  private prometheusRegistry: Registry

  collectMetrics(nodeId: string): void {
    const node = this.getNode(nodeId)
    const systemMetrics = SystemMetrics.collect()

    const metrics: RaftMetrics = {
      // Consensus metrics
      state: node.getState(),
      term: node.getCurrentTerm(),
      commitIndex: node.getCommitIndex(),
      lastApplied: node.getLastApplied(),

      // Performance metrics
      logLength: node.getLogLength(),
      messagesReceived: this.messageCounters.received,
      messagesSent: this.messageCounters.sent,

      // System metrics
      systemMetrics,

      // Timing metrics
      electionTimeout: node.getElectionTimeout(),
      heartbeatInterval: node.getHeartbeatInterval(),
      averageRPCLatency: this.calculateAverageLatency(),

      // Error metrics
      networkErrors: this.errorCounters.network,
      storageErrors: this.errorCounters.storage,

      timestamp: new Date()
    }

    this.metrics.set(nodeId, metrics)
    this.updatePrometheusMetrics(nodeId, metrics)
  }
}
```

### Prometheus Integration

Export metrics in Prometheus format:

```typescript
class PrometheusMetrics {
  private readonly stateGauge = new Gauge({
    name: 'raft_node_state',
    help: 'Current state of the RAFT node (0=follower, 1=candidate, 2=leader)',
    labelNames: ['node_id', 'cluster_id']
  })

  private readonly termCounter = new Counter({
    name: 'raft_term_total',
    help: 'Total number of terms',
    labelNames: ['node_id', 'cluster_id']
  })

  private readonly logSizeGauge = new Gauge({
    name: 'raft_log_size',
    help: 'Current size of the RAFT log',
    labelNames: ['node_id', 'cluster_id']
  })

  updateMetrics(nodeId: string, metrics: RaftMetrics): void {
    const labels = { node_id: nodeId, cluster_id: this.clusterId }

    this.stateGauge.set(labels, this.stateToNumber(metrics.state))
    this.termCounter.set(labels, metrics.term)
    this.logSizeGauge.set(labels, metrics.logLength)
  }
}
```

## Fault Tolerance

### Peer Discovery

Automatic peer discovery and health checking:

```typescript
class PeerDiscoveryService extends EventEmitter {
  private peers: Map<string, PeerInfo> = new Map()
  private healthCheckInterval: NodeJS.Timeout

  async discoverPeers(): Promise<void> {
    const pattern = `raft:${this.clusterId}:peer:*`
    const keys = await this.redis.keys(pattern)

    for (const key of keys) {
      const data = await this.redis.get(key)
      if (!data) continue

      const peerInfo = JSON.parse(data) as PeerInfo

      // Skip self
      if (peerInfo.nodeId === this.nodeId) continue

      // Check if peer is healthy
      if (this.isPeerHealthy(peerInfo)) {
        this.addPeer(peerInfo)
      } else {
        this.removePeer(peerInfo.nodeId)
      }
    }
  }

  private isPeerHealthy(peer: PeerInfo): boolean {
    const now = Date.now()
    const lastSeenMs = new Date(peer.lastSeen).getTime()
    return now - lastSeenMs < this.config.peerTimeout
  }
}
```

### Network Partitions

Handling network partitions gracefully:

```typescript
class PartitionDetector {
  detectPartition(): PartitionInfo | null {
    const visiblePeers = this.getVisiblePeers()
    const totalPeers = this.getTotalPeers()

    // If we can see less than half the cluster, we're in minority partition
    if (visiblePeers.length < Math.floor(totalPeers / 2)) {
      return {
        type: 'MINORITY',
        visibleNodes: visiblePeers,
        totalNodes: totalPeers
      }
    }

    // Check for asymmetric partitions
    const peerVisibility = this.checkPeerVisibility()
    if (this.hasAsymmetricPartition(peerVisibility)) {
      return {
        type: 'ASYMMETRIC',
        details: peerVisibility
      }
    }

    return null
  }
}
```

### Recovery Mechanisms

Automatic recovery from failures:

```typescript
class RecoveryManager {
  async recoverFromCrash(): Promise<void> { // This describes a general recovery flow.
    // Actual startup sequence in RaftNode.start():
    // 1. Load persisted Raft state (term, votedFor, etc.) via `loadPersistedState()`.
    // 2. Initialize WAL engine via `this.log.initializeWALEngine()`.
    // 3. Load log entries from storage (Redis or recovered from WAL) via `this.log.loadFromStorage()`.
    // 4. Load the latest snapshot from disk via `this.loadLatestSnapshotFromDisk()`:
    //    a. Scans `config.persistence.dataDir` for snapshot files.
    //    b. Identifies the latest valid snapshot file based on term and index in its filename.
    //    c. If a snapshot is found:
    //        i. Reads its data.
    //        ii. Calls `this.stateMachine.applySnapshot(snapshotData)` to restore application state.
    //        iii. Updates `this.commitIndex` and `this.lastApplied` to the snapshot's `lastIncludedIndex`.
    //        iv. Updates `this.latestSnapshotMeta` with the loaded snapshot's details.
    //        v. Calls `this.log.setFirstIndex(snapshot.lastIncludedIndex + 1)` to inform `RaftLog` that entries up to this index are covered by the snapshot, so it can adjust its internal `logStartIndex`.
    // 5. Start peer discovery and network services.
    // 6. Start election timers.
    // Note: Re-applying committed entries from the log beyond the snapshot's lastApplied happens as part of normal operation
    // once the node is active and receives new commits or applies entries from its log.
  }
}
```

## Performance Optimizations

### Batching

Batch multiple operations for efficiency:

```typescript
class BatchProcessor {
  private pendingBatch: LogEntry[] = []
  private batchTimer: NodeJS.Timeout | null = null

  async addToBatch(entry: LogEntry): Promise<void> {
    this.pendingBatch.push(entry)

    if (this.pendingBatch.length >= this.maxBatchSize) {
      await this.processBatch()
    } else if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => {
        this.processBatch()
      }, this.batchInterval)
    }
  }

  private async processBatch(): Promise<void> {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer)
      this.batchTimer = null
    }

    if (this.pendingBatch.length === 0) return

    const batch = this.pendingBatch.splice(0)
    await this.log.appendBatch(batch)
    await this.replicateBatch(batch)
  }
}
```

### Pipeline Optimization

Pipeline requests for better throughput:

```typescript
class PipelinedReplication {
  async replicateWithPipeline(entries: LogEntry[]): Promise<void> {
    const pipeline = new Pipeline(this.maxPipelineDepth)

    for (const peer of this.peers) {
      pipeline.add(async () => {
        const request = this.createAppendEntriesRequest(peer, entries)
        return this.network.sendAppendEntries(peer, request)
      })
    }

    const results = await pipeline.execute()
    this.processReplicationResults(results)
  }
}
```

### Memory Management

Efficient memory usage:

```typescript
class MemoryManager {
  private memoryPressureThreshold = 0.8

  monitorMemoryUsage(): void {
    setInterval(() => {
      const usage = process.memoryUsage()
      const heapUsedRatio = usage.heapUsed / usage.heapTotal

      if (heapUsedRatio > this.memoryPressureThreshold) {
        this.handleMemoryPressure()
      }
    }, 5000)
  }

  private handleMemoryPressure(): void {
    // 1. Trigger log compaction
    this.log.compact()

    // 2. Clear caches
    this.clearCaches()

    // 3. Force garbage collection if available
    if (global.gc) {
      global.gc()
    }

    // 4. Create snapshot if needed
    if (this.log.size() > this.snapshotThreshold) {
      this.createSnapshot()
    }
  }
}
```

## Security Considerations

### Authentication

Node-to-node authentication:

```typescript
class NodeAuthenticator {
  async authenticateRequest(request: Request): Promise<boolean> {
    const signature = request.headers['x-raft-signature']
    const timestamp = request.headers['x-raft-timestamp']

    // Check timestamp to prevent replay attacks
    if (!this.isTimestampValid(timestamp)) {
      return false
    }

    // Verify signature
    const expectedSignature = this.calculateSignature(
      request.body,
      timestamp,
      this.sharedSecret
    )

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    )
  }
}
```

### Encryption

TLS support for secure communication:

```typescript
class SecureNetwork extends RaftNetwork {
  protected createHttpAgent(): https.Agent {
    return new https.Agent({
      cert: fs.readFileSync(this.config.tls.cert),
      key: fs.readFileSync(this.config.tls.key),
      ca: fs.readFileSync(this.config.tls.ca),
      rejectUnauthorized: true,
      keepAlive: true,
      maxSockets: 50
    })
  }
}
```

## Future Architecture Improvements

### Planned Enhancements

1. **Multi-Raft**: Support multiple RAFT groups in a single process
2. **Learner Nodes**: Non-voting nodes for read scaling
3. **Joint Consensus**: Safe membership changes
4. **Optimistic Replication**: Speculative execution
5. **Hierarchical Consensus**: Multi-level consensus for geo-distribution

### Extensibility Points

The architecture provides several extension points:

1. **Custom State Machines**: Implement the `StateMachine` interface
2. **Storage Backends**: Implement the `Storage` interface
3. **Network Transports**: Extend the `Network` class
4. **Metrics Exporters**: Implement custom metrics exporters
5. **Log Compaction**: Custom compaction strategies

## Summary

The RAFT library architecture is designed for:

- **Reliability**: Multiple layers of fault tolerance
- **Performance**: Optimizations at every level
- **Observability**: Comprehensive monitoring and metrics
- **Extensibility**: Clean interfaces and extension points
- **Security**: Built-in authentication and encryption support

The modular design allows users to customize components while maintaining the strong consistency guarantees of the RAFT algorithm.
