# Advanced Usage

This guide covers advanced patterns, techniques, and best practices for using RAFT in production environments.

## Table of Contents

- [Multi-Region Deployments](#multi-region-deployments)
- [Custom State Machines](#custom-state-machines)
- [Dynamic Membership Changes](#dynamic-membership-changes)
- [Performance Optimization](#performance-optimization)
- [Fault Tolerance Patterns](#fault-tolerance-patterns)
- [Integration Patterns](#integration-patterns)
- [Testing Strategies](#testing-strategies)
- [Production Patterns](#production-patterns)

## Multi-Region Deployments

### Cross-Region Configuration

For deployments across multiple regions, adjust timing parameters to account for network latency:

```typescript
class MultiRegionCluster {
  private regions: Map<string, RegionConfig> = new Map([
    ['us-east', { latency: 10, nodes: ['node-1', 'node-2'] }],
    ['us-west', { latency: 50, nodes: ['node-3', 'node-4'] }],
    ['eu-west', { latency: 100, nodes: ['node-5', 'node-6'] }],
  ]);
  
  createNodeConfig(nodeId: string, region: string): RaftConfiguration {
    const regionConfig = this.regions.get(region);
    const baseLatency = regionConfig?.latency || 10;
    
    return {
      ...RaftEngine.createDefaultConfiguration(nodeId, 'global-cluster'),
      // Adjust timeouts based on region latency
      electionTimeout: [300 + baseLatency, 600 + baseLatency * 2],
      heartbeatInterval: 100 + Math.floor(baseLatency / 2),
      network: {
        requestTimeout: 5000 + baseLatency * 10,
        maxRetries: 5,
        retryDelay: 200,
        circuitBreakerThreshold: 10,
        circuitBreakerTimeout: 60000,
      },
      // Weighted voting favors low-latency regions
      voting: {
        enableWeighting: true,
        weightMetrics: ['networkLatency', 'cpuUsage', 'uptime'],
        defaultWeight: 1,
      },
    };
  }
  
  async setupGlobalCluster() {
    const engine = new RaftEngine();
    
    for (const [region, config] of this.regions) {
      for (const nodeId of config.nodes) {
        const nodeConfig = this.createNodeConfig(nodeId, region);
        const node = await engine.createNode(nodeConfig);
        
        // Add region-specific monitoring
        this.monitorRegionalNode(node, nodeId, region);
      }
    }
    
    return engine;
  }
  
  private monitorRegionalNode(node: RaftNode, nodeId: string, region: string) {
    node.on('stateChange', ({ state }) => {
      console.log(`[${region}/${nodeId}] State: ${state}`);
    });
    
    // Track cross-region communication
    node.on('messagesSent', ({ targetRegion, latency }) => {
      this.updateRegionMetrics(region, targetRegion, latency);
    });
  }
}
```

### Region-Aware Leader Election

Implement custom logic to prefer leaders in specific regions:

```typescript
class RegionAwareVoting {
  private preferredRegion: string = 'us-east';
  
  configureVoting(config: RaftConfiguration, nodeRegion: string): RaftConfiguration {
    return {
      ...config,
      voting: {
        enableWeighting: true,
        weightMetrics: ['networkLatency', 'regionPriority'],
        defaultWeight: nodeRegion === this.preferredRegion ? 2 : 1,
      },
    };
  }
}
```

## Custom State Machines

### Implementing a Key-Value Store

```typescript
interface Command {
  type: 'SET' | 'DELETE' | 'INCREMENT';
  key: string;
  value?: any;
}

class KeyValueStateMachine {
  private store: Map<string, any> = new Map();
  private node: RaftNode;
  
  constructor(node: RaftNode) {
    this.node = node;
    this.setupEventHandlers();
  }
  
  private setupEventHandlers() {
    // Apply committed entries to state machine
    this.node.on('logCommitted', async ({ index, command }) => {
      await this.applyCommand(command as Command);
    });
  }
  
  private async applyCommand(command: Command) {
    switch (command.type) {
      case 'SET':
        this.store.set(command.key, command.value);
        break;
      case 'DELETE':
        this.store.delete(command.key);
        break;
      case 'INCREMENT':
        const current = this.store.get(command.key) || 0;
        this.store.set(command.key, current + (command.value || 1));
        break;
    }
  }
  
  async executeCommand(command: Command): Promise<void> {
    if (this.node.getState() !== RaftState.LEADER) {
      throw new Error('Not leader');
    }
    
    await this.node.appendLog(command);
  }
  
  get(key: string): any {
    return this.store.get(key);
  }
  
  getAll(): Record<string, any> {
    return Object.fromEntries(this.store);
  }
}
```

### Implementing a Distributed Lock

```typescript
interface LockCommand {
  type: 'ACQUIRE' | 'RELEASE' | 'EXTEND';
  lockId: string;
  owner: string;
  ttl?: number;
  timestamp?: number;
}

class DistributedLockManager {
  private locks: Map<string, LockInfo> = new Map();
  private node: RaftNode;
  
  interface LockInfo {
    owner: string;
    acquiredAt: number;
    ttl: number;
    version: number;
  }
  
  constructor(node: RaftNode) {
    this.node = node;
    this.setupHandlers();
    this.startCleanupTimer();
  }
  
  private setupHandlers() {
    this.node.on('logCommitted', ({ command }) => {
      this.applyLockCommand(command as LockCommand);
    });
  }
  
  private applyLockCommand(command: LockCommand) {
    const now = Date.now();
    
    switch (command.type) {
      case 'ACQUIRE':
        const existing = this.locks.get(command.lockId);
        if (!existing || this.isExpired(existing, now)) {
          this.locks.set(command.lockId, {
            owner: command.owner,
            acquiredAt: now,
            ttl: command.ttl || 30000,
            version: (existing?.version || 0) + 1,
          });
        }
        break;
        
      case 'RELEASE':
        const lock = this.locks.get(command.lockId);
        if (lock && lock.owner === command.owner) {
          this.locks.delete(command.lockId);
        }
        break;
        
      case 'EXTEND':
        const currentLock = this.locks.get(command.lockId);
        if (currentLock && currentLock.owner === command.owner) {
          currentLock.ttl = command.ttl || currentLock.ttl;
          currentLock.acquiredAt = now;
        }
        break;
    }
  }
  
  async acquireLock(lockId: string, owner: string, ttl: number = 30000): Promise<boolean> {
    if (this.node.getState() !== RaftState.LEADER) {
      throw new Error('Not leader');
    }
    
    // Check if lock is available
    const existing = this.locks.get(lockId);
    if (existing && !this.isExpired(existing, Date.now())) {
      return false;
    }
    
    // Acquire through consensus
    await this.node.appendLog({
      type: 'ACQUIRE',
      lockId,
      owner,
      ttl,
    } as LockCommand);
    
    // Verify acquisition
    await new Promise(resolve => setTimeout(resolve, 100));
    const acquired = this.locks.get(lockId);
    return acquired?.owner === owner;
  }
  
  private isExpired(lock: LockInfo, now: number): boolean {
    return now - lock.acquiredAt > lock.ttl;
  }
  
  private startCleanupTimer() {
    setInterval(() => {
      const now = Date.now();
      for (const [lockId, lock] of this.locks) {
        if (this.isExpired(lock, now)) {
          this.locks.delete(lockId);
        }
      }
    }, 5000);
  }
}
```

## Dynamic Membership Changes

### Adding Nodes to Running Cluster

```typescript
class DynamicMembership {
  private engine: RaftEngine;
  private membershipManager: MembershipManager;
  
  async addNode(nodeId: string, address: string): Promise<void> {
    // Phase 1: Create new node in non-voting mode
    const config = this.createNonVotingConfig(nodeId);
    const newNode = await this.engine.createNode(config);
    
    // Phase 2: Catch up with existing log
    await this.syncNewNode(newNode);
    
    // Phase 3: Add as voting member
    await this.promoteToVotingMember(nodeId);
    
    // Phase 4: Start the node
    await this.engine.startNode(nodeId);
  }
  
  private createNonVotingConfig(nodeId: string): RaftConfiguration {
    return {
      ...RaftEngine.createDefaultConfiguration(nodeId, 'cluster'),
      voting: {
        enableWeighting: false,
        defaultWeight: 0, // Non-voting initially
        weightMetrics: [],
      },
    };
  }
  
  private async syncNewNode(node: RaftNode): Promise<void> {
    // Get current leader
    const leader = this.findLeader();
    if (!leader) {
      throw new Error('No leader available');
    }
    
    // Request snapshot from leader
    const snapshot = await this.requestSnapshot(leader);
    await this.installSnapshot(node, snapshot);
  }
  
  private async promoteToVotingMember(nodeId: string): Promise<void> {
    const leader = this.findLeader();
    if (!leader) {
      throw new Error('No leader available');
    }
    
    // Use configuration change entry
    await leader.appendLog({
      type: 'CONFIG_CHANGE',
      action: 'ADD_VOTER',
      nodeId,
      weight: 1,
    });
  }
}
```

### Removing Nodes Safely

```typescript
class SafeNodeRemoval {
  async removeNode(engine: RaftEngine, nodeId: string): Promise<void> {
    const node = engine.getNode(nodeId);
    if (!node) {
      throw new Error('Node not found');
    }
    
    // Step 1: Transfer leadership if needed
    if (node.getState() === RaftState.LEADER) {
      await this.transferLeadership(node);
    }
    
    // Step 2: Remove from configuration
    await this.removeFromConfiguration(engine, nodeId);
    
    // Step 3: Wait for configuration to propagate
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Step 4: Stop the node
    await engine.stopNode(nodeId);
  }
  
  private async transferLeadership(leader: RaftNode): Promise<void> {
    const peers = leader.getPeers();
    if (peers.length === 0) {
      throw new Error('No peers available for leadership transfer');
    }
    
    // Find best candidate
    const candidate = await this.selectBestCandidate(leader, peers);
    
    // Initiate transfer
    await leader.transferLeadership(candidate);
  }
  
  private async selectBestCandidate(
    leader: RaftNode, 
    peers: string[]
  ): Promise<string> {
    let bestCandidate = peers[0];
    let bestScore = -1;
    
    for (const peerId of peers) {
      const peerInfo = leader.getPeerInfo(peerId);
      if (peerInfo && peerInfo.metrics) {
        const score = this.calculateCandidateScore(peerInfo.metrics);
        if (score > bestScore) {
          bestScore = score;
          bestCandidate = peerId;
        }
      }
    }
    
    return bestCandidate;
  }
  
  private calculateCandidateScore(metrics: SystemMetricsSnapshot): number {
    return (
      (100 - metrics.cpuUsage) * 0.3 +
      (100 - metrics.memoryUsage) * 0.3 +
      Math.min(metrics.uptime / 86400, 100) * 0.2 + // Days of uptime
      (100 - Math.min(metrics.networkLatency, 100)) * 0.2
    );
  }
}
```

## Performance Optimization

### Batching Operations

```typescript
class BatchedOperations {
  private pendingCommands: Command[] = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private node: RaftNode;
  
  constructor(
    node: RaftNode,
    private maxBatchSize: number = 100,
    private batchInterval: number = 10
  ) {
    this.node = node;
  }
  
  async execute(command: Command): Promise<void> {
    this.pendingCommands.push(command);
    
    if (this.pendingCommands.length >= this.maxBatchSize) {
      await this.flush();
    } else if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => this.flush(), this.batchInterval);
    }
  }
  
  private async flush(): Promise<void> {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    
    if (this.pendingCommands.length === 0) {
      return;
    }
    
    const batch = this.pendingCommands.splice(0);
    
    if (this.node.getState() === RaftState.LEADER) {
      // Send as single batched entry
      await this.node.appendLog({
        type: 'BATCH',
        commands: batch,
      });
    } else {
      throw new Error('Not leader');
    }
  }
}
```

### Parallel Log Application

```typescript
class ParallelStateMachine {
  private applyQueue: AsyncQueue<LogEntry>;
  private workers: number;
  
  constructor(workers: number = 4) {
    this.workers = workers;
    this.applyQueue = new AsyncQueue(this.applyEntry.bind(this), workers);
  }
  
  async onLogCommitted(entries: LogEntry[]): Promise<void> {
    // Determine which entries can be applied in parallel
    const groups = this.groupIndependentEntries(entries);
    
    for (const group of groups) {
      // Apply independent entries in parallel
      await Promise.all(
        group.map(entry => this.applyQueue.push(entry))
      );
    }
  }
  
  private groupIndependentEntries(entries: LogEntry[]): LogEntry[][] {
    const groups: LogEntry[][] = [];
    let currentGroup: LogEntry[] = [];
    const keysInGroup = new Set<string>();
    
    for (const entry of entries) {
      const keys = this.extractKeys(entry.command);
      const hasConflict = keys.some(key => keysInGroup.has(key));
      
      if (hasConflict && currentGroup.length > 0) {
        groups.push(currentGroup);
        currentGroup = [];
        keysInGroup.clear();
      }
      
      currentGroup.push(entry);
      keys.forEach(key => keysInGroup.add(key));
    }
    
    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }
    
    return groups;
  }
  
  private extractKeys(command: any): string[] {
    // Extract keys that this command affects
    if (command.type === 'BATCH') {
      return command.commands.flatMap((cmd: any) => this.extractKeys(cmd));
    }
    return [command.key];
  }
  
  private async applyEntry(entry: LogEntry): Promise<void> {
    // Apply to state machine
    await this.stateMachine.apply(entry.command);
  }
}
```

### Memory-Efficient Log Storage

```typescript
class CompactedLog {
  private segments: LogSegment[] = [];
  private activeSegment: LogSegment;
  private readonly segmentSize: number = 10000;
  
  constructor(private storage: Storage) {
    this.activeSegment = new LogSegment(0);
  }
  
  async append(term: number, command: any): Promise<number> {
    const index = this.getNextIndex();
    const entry = { index, term, command, timestamp: new Date() };
    
    this.activeSegment.append(entry);
    
    if (this.activeSegment.size() >= this.segmentSize) {
      await this.rotateSegment();
    }
    
    return index;
  }
  
  private async rotateSegment(): Promise<void> {
    // Compress and store current segment
    const compressed = await this.compressSegment(this.activeSegment);
    await this.storage.writeSegment(
      this.activeSegment.startIndex,
      compressed
    );
    
    this.segments.push(this.activeSegment);
    this.activeSegment = new LogSegment(this.getNextIndex());
    
    // Trigger background compaction if needed
    if (this.segments.length > 10) {
      this.scheduleCompaction();
    }
  }
  
  private async compressSegment(segment: LogSegment): Promise<Buffer> {
    // Implement compression (e.g., using zlib)
    const data = JSON.stringify(segment.entries);
    return zlib.gzipSync(Buffer.from(data));
  }
  
  private scheduleCompaction() {
    setImmediate(async () => {
      await this.compactOldSegments();
    });
  }
}
```

## Fault Tolerance Patterns

### Automatic Failover

```typescript
class FailoverManager {
  private healthChecks: Map<string, HealthStatus> = new Map();
  private failoverInProgress: boolean = false;
  
  constructor(private engine: RaftEngine) {
    this.startHealthMonitoring();
  }
  
  private startHealthMonitoring() {
    setInterval(() => this.checkClusterHealth(), 5000);
  }
  
  private async checkClusterHealth() {
    const nodes = this.engine.getAllNodes();
    
    for (const [nodeId, node] of nodes) {
      const health = await this.checkNodeHealth(node);
      this.healthChecks.set(nodeId, health);
      
      if (!health.healthy && node.getState() === RaftState.LEADER) {
        await this.initiateFailover(nodeId);
      }
    }
  }
  
  private async checkNodeHealth(node: RaftNode): Promise<HealthStatus> {
    try {
      const metrics = node.getMetrics();
      if (!metrics) {
        return { healthy: false, reason: 'No metrics available' };
      }
      
      // Check various health indicators
      if (metrics.systemMetrics) {
        const { cpuUsage, memoryUsage, diskUsage } = metrics.systemMetrics;
        
        if (cpuUsage > 90) {
          return { healthy: false, reason: 'High CPU usage' };
        }
        if (memoryUsage > 90) {
          return { healthy: false, reason: 'High memory usage' };
        }
        if (diskUsage > 95) {
          return { healthy: false, reason: 'Disk almost full' };
        }
      }
      
      // Check responsiveness
      const latency = await this.measureLatency(node);
      if (latency > 5000) {
        return { healthy: false, reason: 'High latency' };
      }
      
      return { healthy: true };
    } catch (error) {
      return { healthy: false, reason: error.message };
    }
  }
  
  private async initiateFailover(unhealthyLeader: string) {
    if (this.failoverInProgress) {
      return;
    }
    
    this.failoverInProgress = true;
    console.log(`Initiating failover from unhealthy leader: ${unhealthyLeader}`);
    
    try {
      // Find healthy candidate
      const candidate = await this.selectHealthyCandidate();
      if (!candidate) {
        throw new Error('No healthy candidates available');
      }
      
      // Force election by increasing term
      await this.forceElection(candidate);
      
      console.log(`Failover completed. New leader: ${candidate}`);
    } finally {
      this.failoverInProgress = false;
    }
  }
}
```

### Split Brain Prevention

```typescript
class SplitBrainPrevention {
  private partitionDetector: PartitionDetector;
  
  constructor(private engine: RaftEngine) {
    this.partitionDetector = new PartitionDetector();
  }
  
  async checkForSplitBrain(): Promise<boolean> {
    const nodes = this.engine.getAllNodes();
    const leaders: string[] = [];
    
    for (const [nodeId, node] of nodes) {
      if (node.getState() === RaftState.LEADER) {
        leaders.push(nodeId);
      }
    }
    
    if (leaders.length > 1) {
      console.error('Split brain detected! Multiple leaders:', leaders);
      await this.resolveSplitBrain(leaders);
      return true;
    }
    
    return false;
  }
  
  private async resolveSplitBrain(leaders: string[]): Promise<void> {
    // Find the leader with the highest term
    let highestTerm = -1;
    let legitimateLeader = '';
    
    for (const leaderId of leaders) {
      const node = this.engine.getNode(leaderId);
      if (node) {
        const term = node.getCurrentTerm();
        if (term > highestTerm) {
          highestTerm = term;
          legitimateLeader = leaderId;
        }
      }
    }
    
    // Force other leaders to step down
    for (const leaderId of leaders) {
      if (leaderId !== legitimateLeader) {
        const node = this.engine.getNode(leaderId);
        if (node) {
          await this.forceStepDown(node);
        }
      }
    }
  }
  
  private async forceStepDown(node: RaftNode): Promise<void> {
    // Send higher term message to force step down
    await node.receiveHigherTerm(node.getCurrentTerm() + 1);
  }
}
```

## Integration Patterns

### REST API Integration

```typescript
import express from 'express';
import { RaftEngine, RaftState } from '@usex/raft';

class RaftRestApi {
  private app: express.Application;
  private engine: RaftEngine;
  
  constructor(engine: RaftEngine) {
    this.engine = engine;
    this.app = express();
    this.setupRoutes();
  }
  
  private setupRoutes() {
    this.app.use(express.json());
    
    // Cluster status
    this.app.get('/cluster/status', (req, res) => {
      const nodes = this.engine.getAllNodes();
      const status = Array.from(nodes.entries()).map(([id, node]) => ({
        nodeId: id,
        state: node.getState(),
        term: node.getCurrentTerm(),
        metrics: node.getMetrics(),
      }));
      res.json({ nodes: status });
    });
    
    // Execute command (forward to leader)
    this.app.post('/command', async (req, res) => {
      try {
        const leader = this.findLeader();
        if (!leader) {
          return res.status(503).json({ error: 'No leader available' });
        }
        
        if (leader.node.getState() === RaftState.LEADER) {
          await leader.node.appendLog(req.body);
          res.json({ success: true });
        } else {
          // Forward to leader
          res.redirect(307, `http://${leader.address}/command`);
        }
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    
    // Health check
    this.app.get('/health', async (req, res) => {
      const nodeId = req.query.nodeId as string;
      const node = this.engine.getNode(nodeId);
      
      if (!node) {
        return res.status(404).json({ error: 'Node not found' });
      }
      
      const metrics = node.getMetrics();
      const healthy = metrics && metrics.systemMetrics.cpuUsage < 90;
      
      res.status(healthy ? 200 : 503).json({
        healthy,
        state: node.getState(),
        metrics,
      });
    });
  }
  
  private findLeader(): { node: RaftNode, address: string } | null {
    const nodes = this.engine.getAllNodes();
    
    for (const [nodeId, node] of nodes) {
      if (node.getState() === RaftState.LEADER) {
        const peerInfo = node.getPeerInfo(nodeId);
        return {
          node,
          address: `${peerInfo.httpHost}:${peerInfo.httpPort}`,
        };
      }
    }
    
    return null;
  }
  
  listen(port: number) {
    this.app.listen(port, () => {
      console.log(`RAFT REST API listening on port ${port}`);
    });
  }
}
```

### GraphQL Integration

```typescript
import { GraphQLSchema, GraphQLObjectType, GraphQLString } from 'graphql';
import { RaftEngine } from '@usex/raft';

class RaftGraphQLApi {
  private schema: GraphQLSchema;
  
  constructor(private engine: RaftEngine) {
    this.schema = this.createSchema();
  }
  
  private createSchema(): GraphQLSchema {
    const NodeType = new GraphQLObjectType({
      name: 'Node',
      fields: {
        id: { type: GraphQLString },
        state: { type: GraphQLString },
        term: { type: GraphQLInt },
        isLeader: {
          type: GraphQLBoolean,
          resolve: (node) => node.state === 'leader',
        },
      },
    });
    
    const QueryType = new GraphQLObjectType({
      name: 'Query',
      fields: {
        node: {
          type: NodeType,
          args: {
            id: { type: GraphQLString },
          },
          resolve: (_, { id }) => {
            const node = this.engine.getNode(id);
            if (!node) return null;
            
            return {
              id,
              state: node.getState(),
              term: node.getCurrentTerm(),
            };
          },
        },
        leader: {
          type: NodeType,
          resolve: () => {
            const nodes = this.engine.getAllNodes();
            for (const [id, node] of nodes) {
              if (node.getState() === RaftState.LEADER) {
                return {
                  id,
                  state: node.getState(),
                  term: node.getCurrentTerm(),
                };
              }
            }
            return null;
          },
        },
      },
    });
    
    const MutationType = new GraphQLObjectType({
      name: 'Mutation',
      fields: {
        appendLog: {
          type: GraphQLBoolean,
          args: {
            command: { type: GraphQLJSONType },
          },
          resolve: async (_, { command }) => {
            const leader = this.findLeader();
            if (!leader) {
              throw new Error('No leader available');
            }
            
            await leader.appendLog(command);
            return true;
          },
        },
      },
    });
    
    return new GraphQLSchema({
      query: QueryType,
      mutation: MutationType,
    });
  }
}
```

## Testing Strategies

### Chaos Testing

```typescript
class ChaosTest {
  private engine: RaftEngine;
  private chaosEnabled: boolean = false;
  
  async runChaosTest(duration: number = 60000) {
    this.chaosEnabled = true;
    const endTime = Date.now() + duration;
    
    while (Date.now() < endTime && this.chaosEnabled) {
      const chaosAction = this.selectRandomAction();
      await this.executeAction(chaosAction);
      
      // Random delay between actions
      await new Promise(resolve => 
        setTimeout(resolve, Math.random() * 5000)
      );
    }
  }
  
  private selectRandomAction(): ChaosAction {
    const actions: ChaosAction[] = [
      'killLeader',
      'killFollower',
      'networkPartition',
      'slowNetwork',
      'crashAndRecover',
      'corruptMessage',
    ];
    
    return actions[Math.floor(Math.random() * actions.length)];
  }
  
  private async executeAction(action: ChaosAction) {
    console.log(`Chaos: Executing ${action}`);
    
    switch (action) {
      case 'killLeader':
        await this.killLeader();
        break;
      case 'killFollower':
        await this.killRandomFollower();
        break;
      case 'networkPartition':
        await this.createNetworkPartition();
        break;
      case 'slowNetwork':
        await this.simulateSlowNetwork();
        break;
      case 'crashAndRecover':
        await this.crashAndRecover();
        break;
      case 'corruptMessage':
        await this.corruptRandomMessage();
        break;
    }
  }
  
  private async killLeader() {
    const nodes = this.engine.getAllNodes();
    for (const [nodeId, node] of nodes) {
      if (node.getState() === RaftState.LEADER) {
        await this.engine.stopNode(nodeId);
        console.log(`Chaos: Killed leader ${nodeId}`);
        break;
      }
    }
  }
  
  private async createNetworkPartition() {
    // Simulate network partition by blocking communication
    const nodes = Array.from(this.engine.getAllNodes().keys());
    const partition1 = nodes.slice(0, Math.floor(nodes.length / 2));
    const partition2 = nodes.slice(Math.floor(nodes.length / 2));
    
    console.log(`Chaos: Creating partition between ${partition1} and ${partition2}`);
    
    // Implementation would block network between partitions
  }
}
```

### Property-Based Testing

```typescript
import * as fc from 'fast-check';

class PropertyTests {
  testElectionSafety() {
    fc.assert(
      fc.property(
        fc.array(fc.nat({ max: 10 }), { minLength: 3, maxLength: 7 }),
        async (nodeCounts) => {
          const engine = new RaftEngine();
          const nodes: RaftNode[] = [];
          
          // Create cluster with given node count
          for (let i = 0; i < nodeCounts.length; i++) {
            const config = RaftEngine.createDefaultConfiguration(
              `node-${i}`, 
              'test-cluster'
            );
            const node = await engine.createNode(config);
            nodes.push(node);
            await engine.startNode(`node-${i}`);
          }
          
          // Wait for election
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          // Verify at most one leader per term
          const leadersByTerm = new Map<number, string[]>();
          
          for (const node of nodes) {
            if (node.getState() === RaftState.LEADER) {
              const term = node.getCurrentTerm();
              const leaders = leadersByTerm.get(term) || [];
              leaders.push(node.nodeId);
              leadersByTerm.set(term, leaders);
            }
          }
          
          // Property: At most one leader per term
          for (const [term, leaders] of leadersByTerm) {
            if (leaders.length > 1) {
              throw new Error(
                `Multiple leaders in term ${term}: ${leaders.join(', ')}`
              );
            }
          }
          
          await engine.stopAllNodes();
          return true;
        }
      )
    );
  }
}
```

## Production Patterns

### Blue-Green Deployments

```typescript
class BlueGreenDeployment {
  private blueCluster: RaftEngine;
  private greenCluster: RaftEngine;
  private activeCluster: 'blue' | 'green' = 'blue';
  
  async deployNewVersion(version: string) {
    const inactiveCluster = this.activeCluster === 'blue' ? 'green' : 'blue';
    const targetEngine = inactiveCluster === 'blue' ? this.blueCluster : this.greenCluster;
    
    // Step 1: Deploy new version to inactive cluster
    await this.deployToCluster(targetEngine, version);
    
    // Step 2: Sync data from active to inactive
    await this.syncData(
      this.activeCluster === 'blue' ? this.blueCluster : this.greenCluster,
      targetEngine
    );
    
    // Step 3: Run health checks
    const healthy = await this.runHealthChecks(targetEngine);
    if (!healthy) {
      throw new Error('Health checks failed on new version');
    }
    
    // Step 4: Switch traffic
    await this.switchTraffic(inactiveCluster);
    
    // Step 5: Update active cluster
    this.activeCluster = inactiveCluster;
  }
  
  private async syncData(source: RaftEngine, target: RaftEngine) {
    // Get snapshot from source
    const sourceLeader = this.findLeader(source);
    if (!sourceLeader) {
      throw new Error('No leader in source cluster');
    }
    
    const snapshot = await sourceLeader.createSnapshot();
    
    // Apply to target
    const targetNodes = target.getAllNodes();
    for (const [_, node] of targetNodes) {
      await node.installSnapshot(snapshot);
    }
  }
}
```

### Canary Deployments

```typescript
class CanaryDeployment {
  private canaryPercentage: number = 10;
  
  async deployCanary(engine: RaftEngine, version: string) {
    const nodes = Array.from(engine.getAllNodes().keys());
    const canaryCount = Math.ceil(nodes.length * (this.canaryPercentage / 100));
    const canaryNodes = nodes.slice(0, canaryCount);
    
    // Step 1: Deploy to canary nodes
    for (const nodeId of canaryNodes) {
      await this.upgradeNode(engine, nodeId, version);
    }
    
    // Step 2: Monitor canary nodes
    const monitor = new CanaryMonitor(engine, canaryNodes);
    const success = await monitor.monitor(30000); // Monitor for 30s
    
    if (!success) {
      // Rollback canary nodes
      for (const nodeId of canaryNodes) {
        await this.rollbackNode(engine, nodeId);
      }
      throw new Error('Canary deployment failed');
    }
    
    // Step 3: Roll out to remaining nodes
    const remainingNodes = nodes.filter(n => !canaryNodes.includes(n));
    for (const nodeId of remainingNodes) {
      await this.upgradeNode(engine, nodeId, version);
    }
  }
  
  private async upgradeNode(
    engine: RaftEngine, 
    nodeId: string, 
    version: string
  ): Promise<void> {
    // Remove from cluster
    await engine.stopNode(nodeId);
    
    // Upgrade node (implementation specific)
    await this.performUpgrade(nodeId, version);
    
    // Add back to cluster
    const config = this.getNodeConfig(nodeId);
    const node = await engine.createNode(config);
    await engine.startNode(nodeId);
  }
}
```

## Best Practices Summary

1. **Timing Configuration**
   - Adjust timeouts based on network latency
   - Use longer timeouts for WAN deployments
   - Keep heartbeat interval < election timeout / 3

2. **Resource Management**
   - Monitor CPU, memory, and disk usage
   - Implement log compaction and snapshots
   - Use connection pooling for Redis

3. **Fault Tolerance**
   - Implement automatic failover
   - Use circuit breakers for network calls
   - Monitor and prevent split-brain scenarios

4. **Performance**
   - Batch operations when possible
   - Use parallel log application for independent commands
   - Implement efficient log storage with compression

5. **Testing**
   - Use chaos testing to verify resilience
   - Implement property-based tests for invariants
   - Test network partitions and node failures

6. **Deployment**
   - Use blue-green deployments for zero-downtime updates
   - Implement canary deployments for gradual rollouts
   - Always maintain quorum during updates

## Next Steps

- [Architecture](./architecture.md) - Understand internal implementation
- [Monitoring](./monitoring.md) - Set up comprehensive monitoring
- [Deployment](./deployment.md) - Production deployment strategies
- [Examples](./examples.md) - Complete working examples