<p align="center">
  <img src="https://raw.githubusercontent.com/ali-master/raft/master/assets/logo.svg" alt="Raft NestJS Logo" width="200">
</p>

<h1 align="center">@usex/raft-nestjs</h1>

<p align="center">
  <strong>🚀 The Ultimate NestJS Wrapper for Raft Consensus</strong><br>
  <sub>Build distributed systems with the elegance of decorators and the power of consensus</sub>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@usex/raft-nestjs">
    <img src="https://img.shields.io/npm/v/@usex/raft-nestjs.svg" alt="npm version">
  </a>
  <a href="https://www.npmjs.com/package/@usex/raft-nestjs">
    <img src="https://img.shields.io/npm/dm/@usex/raft-nestjs.svg" alt="npm downloads">
  </a>
  <a href="https://github.com/ali-master/raft/blob/master/LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License">
  </a>
  <a href="https://github.com/ali-master/raft/actions">
    <img src="https://github.com/ali-master/raft/workflows/CI/badge.svg" alt="Build Status">
  </a>
</p>

<p align="center">
  <a href="#-why-raft-nestjs">Why?</a> •
  <a href="#-features">Features</a> •
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-real-world-examples">Examples</a> •
  <a href="#-api-reference">API</a> •
  <a href="#-best-practices">Best Practices</a>
</p>

---

## 🎯 Why Raft-NestJS?

Building distributed systems is hard. Building them with great developer experience is even harder. **@usex/raft-nestjs** bridges this gap by bringing the power of Raft consensus to NestJS with an intuitive, decorator-based API that feels natural to any NestJS developer.

```typescript
// This is all it takes to handle leader election! 🎉
@OnLeaderElected()
handleNewLeader(event: RaftEvent) {
  console.log('👑 I am the leader now!');
}
```

## ✨ Features

- 🎨 **50+ Event Decorators** - Handle every Raft event with elegant decorators
- 🔌 **Plug & Play** - Zero configuration required to get started
- 🎭 **Multi-Node Support** - Manage multiple Raft nodes in a single application
- 💉 **Dependency Injection** - First-class NestJS DI integration
- 🔄 **Async Configuration** - Dynamic configuration with factory patterns
- 📊 **Built-in Metrics** - Production-ready monitoring out of the box
- 🛡️ **Type Safety** - Full TypeScript support with comprehensive types
- 🚀 **High Performance** - Optimized for production workloads

## 📦 Installation

```bash
npm install @usex/raft-nestjs @usex/raft
# or
yarn add @usex/raft-nestjs @usex/raft
# or
pnpm add @usex/raft-nestjs @usex/raft
```

## 🚀 Quick Start

### 1️⃣ Basic Setup (30 seconds)

```typescript
import { Module } from '@nestjs/common';
import { RaftModule } from '@usex/raft-nestjs';

@Module({
  imports: [
    RaftModule.forRoot({
      nodeId: 'node-1',
      clusterId: 'my-cluster',
      isGlobal: true, // Make it available everywhere!
    }),
  ],
})
export class AppModule {}
```

### 2️⃣ Handle Events with Style

```typescript
import { Injectable } from '@nestjs/common';
import {
  RaftNode,
  OnLeaderElected,
  OnStateChange,
  RaftService
} from '@usex/raft-nestjs';

@Injectable()
@RaftNode() // Mark as Raft event handler
export class ClusterManager {
  constructor(private readonly raft: RaftService) {}

  @OnLeaderElected()
  async handleLeaderElection(event: RaftEvent) {
    console.log('🎉 New leader elected!');

    if (this.raft.isLeader()) {
      await this.initializeLeaderTasks();
    }
  }

  @OnStateChange()
  handleStateTransition(event: RaftEvent) {
    const { oldState, newState } = event.data;
    console.log(`📊 State: ${oldState} → ${newState}`);
  }
}
```

## 🌟 Real-World Examples

### 🏗️ Building a Distributed Cache

```typescript
@Injectable()
@RaftNode()
export class DistributedCache {
  private cache = new Map<string, any>();

  constructor(
    private readonly raft: RaftService,
    @InjectRaftEventBus() private eventBus: EventEmitter,
  ) {}

  async set(key: string, value: any): Promise<void> {
    if (!this.raft.isLeader()) {
      throw new Error('Only leader can write');
    }

    // Propose the change to the cluster
    await this.raft.propose({
      type: 'SET',
      key,
      value,
      timestamp: Date.now(),
    });
  }

  @OnLogReplicated()
  private applyToCache(event: RaftEvent) {
    const { type, key, value } = event.data.entry;

    switch (type) {
      case 'SET':
        this.cache.set(key, value);
        break;
      case 'DELETE':
        this.cache.delete(key);
        break;
    }
  }

  get(key: string): any {
    return this.cache.get(key);
  }
}
```

### 🎮 Distributed Game Server

```typescript
@Injectable()
@RaftNode()
export class GameStateManager {
  private players = new Map<string, Player>();
  private gameState: GameState = { status: 'waiting' };

  @OnLeaderElected()
  async becomeGameMaster() {
    console.log('🎮 This server is now the Game Master!');
    await this.startGameLoop();
  }

  @OnNodeJoined()
  async handleNewServer(event: RaftEvent) {
    console.log(`🖥️ New game server joined: ${event.data.nodeId}`);

    if (this.raft.isLeader()) {
      // Sync game state to new server
      await this.syncGameState(event.data.nodeId);
    }
  }

  @OnNodeLeft()
  async handleServerCrash(event: RaftEvent) {
    console.log(`💥 Server crashed: ${event.data.nodeId}`);

    // Redistribute players from crashed server
    await this.redistributePlayers(event.data.nodeId);
  }

  @OnReplicationFailure()
  async handleSyncError(event: RaftEvent) {
    // Implement retry logic for critical game state
    await this.retrySyncGameState(event.data.peerId);
  }
}
```

### 📊 Distributed Task Queue

```typescript
@Injectable()
@RaftNode()
export class TaskQueueManager {
  private queue: Task[] = [];
  private workers = new Map<string, WorkerStatus>();

  constructor(
    private readonly raft: RaftService,
    private readonly logger: Logger,
  ) {}

  async enqueueTask(task: Task): Promise<void> {
    if (!this.raft.isLeader()) {
      const leaderId = this.raft.getLeaderId();
      throw new Error(`Forward request to leader: ${leaderId}`);
    }

    await this.raft.propose({
      type: 'ENQUEUE_TASK',
      task,
    });
  }

  @OnLogReplicated()
  private handleTaskOperation(event: RaftEvent) {
    const { type, task } = event.data.entry;

    switch (type) {
      case 'ENQUEUE_TASK':
        this.queue.push(task);
        this.distributeTask();
        break;
      case 'COMPLETE_TASK':
        this.markTaskComplete(task.id);
        break;
    }
  }

  @OnPeerDiscovered()
  private registerWorker(event: RaftEvent) {
    this.workers.set(event.data.peerId, {
      id: event.data.peerId,
      status: 'idle',
      tasksCompleted: 0,
    });
  }

  @OnMetricsUpdated()
  private optimizeTaskDistribution(event: RaftEvent) {
    // Use metrics to distribute tasks to least loaded workers
    const metrics = event.data;
    this.rebalanceWorkload(metrics);
  }
}
```

### 🔐 Distributed Lock Service

```typescript
@Injectable()
@RaftNode()
export class DistributedLockService {
  private locks = new Map<string, LockInfo>();

  @OnLeaderElected()
  initializeLockService() {
    this.logger.log('🔒 Lock service initialized on leader');
  }

  async acquireLock(
    resource: string,
    clientId: string,
    ttl: number = 30000
  ): Promise<boolean> {
    if (!this.raft.isLeader()) {
      throw new Error('Lock operations must go through leader');
    }

    const lockInfo = this.locks.get(resource);

    if (lockInfo && lockInfo.expiresAt > Date.now()) {
      return false; // Lock is held by another client
    }

    await this.raft.propose({
      type: 'ACQUIRE_LOCK',
      resource,
      clientId,
      ttl,
      timestamp: Date.now(),
    });

    return true;
  }

  @OnLogReplicated()
  private applyLockOperation(event: RaftEvent) {
    const { type, resource, clientId, ttl, timestamp } = event.data.entry;

    switch (type) {
      case 'ACQUIRE_LOCK':
        this.locks.set(resource, {
          clientId,
          acquiredAt: timestamp,
          expiresAt: timestamp + ttl,
        });
        break;
      case 'RELEASE_LOCK':
        this.locks.delete(resource);
        break;
    }
  }

  @OnHeartbeat()
  private cleanupExpiredLocks() {
    const now = Date.now();

    for (const [resource, lock] of this.locks.entries()) {
      if (lock.expiresAt < now) {
        this.locks.delete(resource);
        this.logger.debug(`Lock expired: ${resource}`);
      }
    }
  }
}
```

## 🎨 Advanced Configuration

### 🔄 Async Configuration with ConfigService

```typescript
@Module({
  imports: [
    ConfigModule.forRoot(),
    RaftModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (config: ConfigService) => ({
        nodeId: config.get('RAFT_NODE_ID'),
        clusterId: config.get('RAFT_CLUSTER_ID'),
        httpPort: config.get('RAFT_PORT', 3001),

        // Redis configuration
        redis: {
          host: config.get('REDIS_HOST'),
          port: config.get('REDIS_PORT'),
          password: config.get('REDIS_PASSWORD'),
          keyPrefix: `raft:${config.get('ENVIRONMENT')}:`,
        },

        // Advanced options
        electionTimeout: [150, 300],
        heartbeatInterval: 50,

        // Monitoring
        metrics: {
          enablePrometheus: true,
          collectionInterval: 5000,
        },

        // Logging
        logging: {
          level: config.get('LOG_LEVEL', 'info'),
          enableStructured: true,
        },
      }),
      inject: [ConfigService],
    }),
  ],
})
export class AppModule {}
```

### 🏭 Factory Pattern Configuration

```typescript
@Injectable()
export class RaftConfigFactory implements RaftOptionsFactory {
  constructor(
    private readonly config: ConfigService,
    private readonly discovery: DiscoveryService,
  ) {}

  async createRaftOptions(): Promise<RaftModuleOptions> {
    const environment = this.config.get('NODE_ENV');
    const region = this.config.get('AWS_REGION');

    return {
      nodeId: await this.generateNodeId(),
      clusterId: `cluster-${environment}-${region}`,

      // Dynamic peer discovery
      peerDiscovery: {
        enabled: true,
        service: environment === 'production' ? 'consul' : 'static',
        config: await this.getPeerDiscoveryConfig(),
      },

      // Performance tuning based on environment
      ...this.getPerformanceConfig(environment),
    };
  }

  private async generateNodeId(): Promise<string> {
    // Generate unique node ID based on instance metadata
    const instanceId = await this.getInstanceId();
    return `node-${instanceId}`;
  }
}
```

## 🎭 Multi-Node Architecture

```typescript
@Injectable()
export class MultiNodeOrchestrator {
  private nodes = new Map<string, NodeInfo>();

  constructor(
    @InjectRaftEngine() private engine: RaftEngine,
  ) {}

  async createNode(config: NodeConfig): Promise<RaftNode> {
    const node = await this.engine.createNode({
      ...RaftEngine.createDefaultConfiguration(config.id, config.clusterId),
      httpPort: config.port,
      role: config.role,
    });

    await this.engine.startNode(config.id);

    this.nodes.set(config.id, {
      id: config.id,
      role: config.role,
      status: 'running',
      createdAt: new Date(),
    });

    return node;
  }

  async createCluster(size: number): Promise<void> {
    const basePort = 3000;

    for (let i = 0; i < size; i++) {
      await this.createNode({
        id: `node-${i + 1}`,
        clusterId: 'my-cluster',
        port: basePort + i,
        role: i === 0 ? 'seed' : 'follower',
      });
    }
  }

  @OnElectionStarted()
  handleElectionStart(event: RaftEvent) {
    this.logger.log(`🗳️ Election started on ${event.nodeId}`);
  }

  @OnElectionEnded()
  handleElectionEnd(event: RaftEvent) {
    this.logger.log(`✅ Election completed: ${event.data.winner}`);
  }
}
```

## 📊 Production Monitoring

```typescript
@Injectable()
@RaftNode()
export class RaftMetricsCollector {
  private metrics = {
    elections: 0,
    stateChanges: 0,
    replicationSuccess: 0,
    replicationFailure: 0,
    networkLatency: new Map<string, number>(),
  };

  @OnElectionStarted()
  trackElection() {
    this.metrics.elections++;
  }

  @OnStateChange()
  trackStateChange(event: RaftEvent) {
    this.metrics.stateChanges++;

    // Export to Prometheus
    this.prometheusGauge.set(
      'raft_state_changes_total',
      this.metrics.stateChanges,
      { node: event.nodeId, state: event.data.newState }
    );
  }

  @OnReplicationSuccess()
  trackReplicationSuccess(event: RaftEvent) {
    this.metrics.replicationSuccess++;

    // Calculate network latency
    const latency = Date.now() - event.data.startTime;
    this.metrics.networkLatency.set(event.data.peerId, latency);
  }

  @OnMetricsUpdated()
  exportMetrics(event: RaftEvent) {
    // Export comprehensive metrics
    return {
      ...this.metrics,
      nodeMetrics: event.data,
      timestamp: new Date(),
    };
  }
}
```

## 🛡️ Error Handling & Recovery

```typescript
@Injectable()
@RaftNode()
export class RaftErrorHandler {
  private errorCount = 0;
  private lastError: Date;

  @OnErrorOccurred()
  async handleError(event: RaftEvent) {
    this.errorCount++;
    this.lastError = new Date();

    const { error, context } = event.data;

    // Implement exponential backoff
    const backoffMs = Math.min(1000 * Math.pow(2, this.errorCount), 30000);

    this.logger.error(`Raft error: ${error.message}`, error.stack);

    // Auto-recovery strategies
    switch (error.type) {
      case 'NETWORK_ERROR':
        await this.handleNetworkError(error, context);
        break;
      case 'REPLICATION_ERROR':
        await this.handleReplicationError(error, context);
        break;
      case 'ELECTION_ERROR':
        await this.handleElectionError(error, context);
        break;
    }

    // Reset error count after successful recovery
    setTimeout(() => {
      if (Date.now() - this.lastError.getTime() > 60000) {
        this.errorCount = 0;
      }
    }, backoffMs);
  }

  @OnReplicationFailure()
  async handleReplicationFailure(event: RaftEvent) {
    const { peerId, error, attemptNumber } = event.data;

    if (attemptNumber < 3) {
      // Retry with exponential backoff
      await this.scheduleRetry(peerId, attemptNumber);
    } else {
      // Mark peer as unhealthy
      await this.markPeerUnhealthy(peerId);
    }
  }
}
```

## 🔧 Testing Your Raft Integration

```typescript
describe('RaftModule Integration', () => {
  let app: TestingModule;
  let raftService: RaftService;
  let eventHandler: MyEventHandler;

  beforeEach(async () => {
    app = await Test.createTestingModule({
      imports: [
        RaftModule.forRoot({
          nodeId: 'test-node',
          clusterId: 'test-cluster',
        }),
      ],
      providers: [MyEventHandler],
    }).compile();

    raftService = app.get(RaftService);
    eventHandler = app.get(MyEventHandler);
  });

  it('should handle leader election', async () => {
    const spy = jest.spyOn(eventHandler, 'handleLeaderElected');

    // Simulate leader election
    await raftService.forceElection();

    expect(spy).toHaveBeenCalled();
    expect(raftService.isLeader()).toBe(true);
  });

  it('should replicate data across cluster', async () => {
    const data = { key: 'test', value: 'data' };

    await raftService.propose(data);

    // Verify replication
    expect(eventHandler.replicatedData).toContain(data);
  });
});
```

## 📚 Complete Event Reference

### 🎯 State Management Events
- `@OnStateChange()` - Node state transitions
- `@OnLeaderElected()` - New leader election
- `@OnElectionStarted()` - Election process begins
- `@OnElectionEnded()` - Election process completes
- `@OnElectionTimeout()` - Election timeout occurs

### 🗳️ Voting Events
- `@OnVoteRequest()` - Vote request received
- `@OnVoteResponse()` - Vote response received
- `@OnVoteGranted()` - Vote granted to candidate
- `@OnVoteDenied()` - Vote denied to candidate

### 📝 Log Replication Events
- `@OnLogReplicated()` - Log entry successfully replicated
- `@OnAppendEntries()` - Append entries request
- `@OnAppendEntriesResponse()` - Append entries response
- `@OnReplicationStarted()` - Replication process begins
- `@OnReplicationEnded()` - Replication process completes
- `@OnReplicationSuccess()` - Replication succeeded
- `@OnReplicationFailure()` - Replication failed

### 💓 Heartbeat Events
- `@OnHeartbeat()` - Heartbeat sent
- `@OnHeartbeatReceived()` - Heartbeat received
- `@OnHeartbeatResponse()` - Heartbeat response
- `@OnHeartbeatTimeout()` - Heartbeat timeout

### 🌐 Cluster Management Events
- `@OnPeerDiscovered()` - New peer discovered
- `@OnPeerLost()` - Peer connection lost
- `@OnNodeJoined()` - Node joined cluster
- `@OnNodeLeft()` - Node left cluster
- `@OnConfigurationChanged()` - Cluster configuration changed
- `@OnConfigurationUpdate()` - Configuration update

### 📸 Snapshot Events
- `@OnSnapshotCreated()` - Snapshot created
- `@OnSnapshotStarted()` - Snapshot process started
- `@OnSnapshotEnded()` - Snapshot process ended
- `@OnInstallSnapshot()` - Install snapshot request
- `@OnInstallSnapshotResponse()` - Install snapshot response

### 📊 Monitoring Events
- `@OnMetricsUpdated()` - Metrics updated
- `@OnMetricsCollected()` - Metrics collected
- `@OnErrorOccurred()` - Error occurred

### 🔧 Log Management Events
- `@OnLogCompacted()` - Log compaction completed
- `@OnLogTruncated()` - Log truncated

## 🎯 Best Practices

### 1. **Event Handler Organization**

```typescript
// ❌ Don't: Monolithic handler
@Injectable()
@RaftNode()
export class EverythingHandler {
  @OnLeaderElected() handleLeader() {}
  @OnStateChange() handleState() {}
  @OnErrorOccurred() handleError() {}
  // ... 50 more handlers
}

// ✅ Do: Separate concerns
@Injectable()
@RaftNode()
export class LeadershipHandler {
  @OnLeaderElected() handleElection() {}
  @OnElectionStarted() trackElection() {}
}

@Injectable()
@RaftNode()
export class ReplicationHandler {
  @OnLogReplicated() handleReplication() {}
  @OnReplicationFailure() handleFailure() {}
}
```

### 2. **Resource Management**

```typescript
@Injectable()
@RaftNode()
export class ResourceAwareHandler {
  private resources: Resource[] = [];

  @OnLeaderElected()
  async initializeResources() {
    // Only initialize on leader
    this.resources = await this.createExpensiveResources();
  }

  @OnStateChange()
  async cleanupOnFollower(event: RaftEvent) {
    if (event.data.newState === 'follower') {
      // Clean up leader-only resources
      await this.cleanup();
    }
  }

  async onModuleDestroy() {
    // Always clean up on shutdown
    await this.cleanup();
  }
}
```

### 3. **Error Recovery**

```typescript
@Injectable()
@RaftNode()
export class ResilientHandler {
  @OnErrorOccurred()
  async handleError(event: RaftEvent) {
    // Don't panic! Implement graceful degradation
    await this.enableSafeMode();

    // Notify monitoring
    await this.alertOpsTeam(event.data.error);

    // Attempt recovery
    await this.attemptRecovery();
  }
}
```

## 🚀 Performance Tips

1. **Use Event Filtering**
   ```typescript
   @OnLogReplicated()
   handleOnlyImportantLogs(event: RaftEvent) {
     if (event.data.entry.type !== 'CRITICAL') return;
     // Process only critical logs
   }
   ```

2. **Batch Operations**
   ```typescript
   private buffer: Operation[] = [];

   @OnLogReplicated()
   bufferOperation(event: RaftEvent) {
     this.buffer.push(event.data.entry);

     if (this.buffer.length >= 100) {
       this.processBatch();
     }
   }
   ```

3. **Async Event Handlers**
   ```typescript
   @OnStateChange()
   async handleStateChange(event: RaftEvent) {
     // Non-blocking async operations
     setImmediate(() => this.updateMetrics(event));
   }
   ```

## 🤝 Contributing

We love contributions! Please see our [Contributing Guide](../../CONTRIBUTING.md) for details.

## 📄 License

MIT © [Ali Torki](https://github.com/ali-master)

## 🙏 Acknowledgments

Built with ❤️ by the [Ali Torki](https://github.com/ali-master) and the open source community.

---

<p align="center">
  <strong>Ready to build something amazing?</strong><br>
  <a href="https://github.com/ali-master/raft">Star us on GitHub</a> •
  <a href="https://www.npmjs.com/package/@usex/raft-nestjs">Install from NPM</a>
</p>
