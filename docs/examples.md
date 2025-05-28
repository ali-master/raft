# Examples

This section provides complete, working examples of using the RAFT library in various scenarios.

## Table of Contents

- [Basic Examples](#basic-examples)
  - [Single Node Cluster](#single-node-cluster)
  - [Three Node Cluster](#three-node-cluster)
  - [Five Node Cluster](#five-node-cluster)
- [Real-World Applications](#real-world-applications)
  - [Distributed Key-Value Store](#distributed-key-value-store)
  - [Configuration Management System](#configuration-management-system)
  - [Distributed Task Queue](#distributed-task-queue)
  - [Service Registry](#service-registry)
- [Advanced Examples](#advanced-examples)
  - [Multi-Region Setup](#multi-region-setup)
  - [Auto-Scaling Cluster](#auto-scaling-cluster)
  - [Hybrid Cloud Deployment](#hybrid-cloud-deployment)

## Basic Examples

### Single Node Cluster

A minimal example for development and testing:

```typescript
// single-node.ts
import { RaftEngine, RaftState } from '@usex/raft';

async function createSingleNodeCluster() {
  const engine = new RaftEngine();
  
  // Create configuration
  const config = RaftEngine.createDefaultConfiguration(
    'single-node',
    'dev-cluster'
  );
  
  // Override for single node
  config.electionTimeout = [50, 100]; // Faster election
  
  // Create and start node
  const node = await engine.createNode(config);
  await engine.startNode('single-node');
  
  // Wait for leader election
  await new Promise<void>((resolve) => {
    node.once('leaderElected', () => {
      console.log('Node became leader');
      resolve();
    });
  });
  
  // Now we can use it
  await node.appendLog({ 
    action: 'initialize', 
    timestamp: new Date() 
  });
  
  console.log('Single node cluster ready');
  
  // Keep running
  process.on('SIGINT', async () => {
    await engine.stopAllNodes();
    process.exit(0);
  });
}

createSingleNodeCluster().catch(console.error);
```

### Three Node Cluster

Standard production setup with fault tolerance:

```typescript
// three-node-cluster.ts
import { RaftEngine, RaftConfiguration, RaftState, RaftNode } from '@usex/raft';

class ThreeNodeCluster {
  private engine: RaftEngine;
  private nodes: Map<string, RaftNode> = new Map();
  
  constructor() {
    this.engine = new RaftEngine();
  }
  
  async initialize() {
    // Node configurations
    const configs: RaftConfiguration[] = [
      this.createNodeConfig('node-1', 3001),
      this.createNodeConfig('node-2', 3002),
      this.createNodeConfig('node-3', 3003),
    ];
    
    // Create all nodes
    for (const config of configs) {
      const node = await this.engine.createNode(config);
      this.nodes.set(config.nodeId, node);
      this.setupEventHandlers(node, config.nodeId);
    }
    
    // Start all nodes
    for (const nodeId of this.nodes.keys()) {
      await this.engine.startNode(nodeId);
      console.log(`Started ${nodeId}`);
    }
    
    // Wait for cluster formation
    await this.waitForLeader();
  }
  
  private createNodeConfig(nodeId: string, port: number): RaftConfiguration {
    return {
      ...RaftEngine.createDefaultConfiguration(nodeId, 'prod-cluster'),
      httpPort: port,
      electionTimeout: [150, 300],
      heartbeatInterval: 50,
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
        keyPrefix: `raft:${nodeId}`,
      },
    };
  }
  
  private setupEventHandlers(node: RaftNode, nodeId: string) {
    node.on('stateChange', ({ state, term }) => {
      console.log(`[${nodeId}] State: ${state}, Term: ${term}`);
    });
    
    node.on('leaderElected', ({ leaderId }) => {
      console.log(`[${nodeId}] New leader: ${leaderId}`);
    });
    
    node.on('error', (error) => {
      console.error(`[${nodeId}] Error:`, error);
    });
  }
  
  private async waitForLeader(): Promise<string> {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        for (const [nodeId, node] of this.nodes) {
          if (node.getState() === RaftState.LEADER) {
            clearInterval(checkInterval);
            resolve(nodeId);
            return;
          }
        }
      }, 100);
    });
  }
  
  async appendCommand(command: any): Promise<void> {
    const leader = this.findLeader();
    if (!leader) {
      throw new Error('No leader available');
    }
    
    await leader.appendLog(command);
  }
  
  private findLeader(): RaftNode | null {
    for (const node of this.nodes.values()) {
      if (node.getState() === RaftState.LEADER) {
        return node;
      }
    }
    return null;
  }
  
  async shutdown() {
    await this.engine.stopAllNodes();
  }
}

// Usage
async function main() {
  const cluster = new ThreeNodeCluster();
  await cluster.initialize();
  
  // Example operations
  await cluster.appendCommand({
    type: 'SET',
    key: 'config:app',
    value: { version: '1.0.0', features: ['auth', 'api'] }
  });
  
  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down cluster...');
    await cluster.shutdown();
    process.exit(0);
  });
}

main().catch(console.error);
```

### Five Node Cluster

Large cluster for high availability:

```typescript
// five-node-cluster.ts
import { RaftEngine, RaftConfiguration } from '@usex/raft';

interface NodeSpec {
  id: string;
  port: number;
  weight: number;
  datacenter: string;
}

class FiveNodeCluster {
  private engine: RaftEngine;
  private nodeSpecs: NodeSpec[] = [
    { id: 'node-1', port: 3001, weight: 2, datacenter: 'dc1' },
    { id: 'node-2', port: 3002, weight: 2, datacenter: 'dc1' },
    { id: 'node-3', port: 3003, weight: 1, datacenter: 'dc2' },
    { id: 'node-4', port: 3004, weight: 1, datacenter: 'dc2' },
    { id: 'node-5', port: 3005, weight: 1, datacenter: 'dc3' },
  ];
  
  constructor() {
    this.engine = new RaftEngine();
  }
  
  async initialize() {
    // Create nodes with weighted voting
    for (const spec of this.nodeSpecs) {
      const config = this.createWeightedConfig(spec);
      await this.engine.createNode(config);
    }
    
    // Start all nodes
    const startPromises = this.nodeSpecs.map(spec => 
      this.engine.startNode(spec.id)
    );
    await Promise.all(startPromises);
    
    console.log('Five node cluster initialized');
    this.logClusterStatus();
  }
  
  private createWeightedConfig(spec: NodeSpec): RaftConfiguration {
    return {
      ...RaftEngine.createDefaultConfiguration(spec.id, 'ha-cluster'),
      httpPort: spec.port,
      electionTimeout: [200, 400], // Slightly longer for 5 nodes
      voting: {
        enableWeighting: true,
        weightMetrics: ['networkLatency', 'cpuUsage', 'uptime'],
        defaultWeight: spec.weight,
      },
      // Tag with datacenter for monitoring
      logging: {
        level: LogLevel.INFO,
        redactedFields: ['password'],
        enableStructured: true,
        // Add datacenter to all logs
        metadata: { datacenter: spec.datacenter },
      },
    };
  }
  
  private async logClusterStatus() {
    setInterval(() => {
      const nodes = this.engine.getAllNodes();
      const status = {
        total: nodes.size,
        leaders: 0,
        followers: 0,
        candidates: 0,
      };
      
      nodes.forEach((node) => {
        switch (node.getState()) {
          case RaftState.LEADER:
            status.leaders++;
            break;
          case RaftState.FOLLOWER:
            status.followers++;
            break;
          case RaftState.CANDIDATE:
            status.candidates++;
            break;
        }
      });
      
      console.log('Cluster status:', status);
    }, 5000);
  }
}
```

## Real-World Applications

### Distributed Key-Value Store

Complete implementation of a distributed KV store:

```typescript
// distributed-kv-store.ts
import { RaftEngine, RaftNode, RaftState } from '@usex/raft';
import express from 'express';

interface KVCommand {
  type: 'SET' | 'DELETE' | 'EXPIRE';
  key: string;
  value?: any;
  ttl?: number;
}

interface KVEntry {
  value: any;
  version: number;
  expiresAt?: number;
}

class DistributedKVStore {
  private engine: RaftEngine;
  private store: Map<string, KVEntry> = new Map();
  private node: RaftNode;
  private app: express.Application;
  private version: Map<string, number> = new Map();
  
  constructor(private nodeId: string, private port: number) {
    this.engine = new RaftEngine();
    this.app = express();
    this.setupAPI();
  }
  
  async start() {
    // Create RAFT node
    const config = RaftEngine.createDefaultConfiguration(
      this.nodeId,
      'kv-cluster'
    );
    config.httpPort = this.port + 1000; // RAFT port
    
    this.node = await this.engine.createNode(config);
    this.setupRaftHandlers();
    
    await this.engine.startNode(this.nodeId);
    
    // Start API server
    this.app.listen(this.port, () => {
      console.log(`KV Store ${this.nodeId} API running on port ${this.port}`);
    });
    
    // Start expiration checker
    this.startExpirationChecker();
  }
  
  private setupRaftHandlers() {
    // Apply committed commands to state machine
    this.node.on('logCommitted', ({ command }) => {
      this.applyCommand(command as KVCommand);
    });
    
    this.node.on('snapshotInstalled', ({ snapshot }) => {
      this.restoreFromSnapshot(snapshot);
    });
  }
  
  private applyCommand(command: KVCommand) {
    switch (command.type) {
      case 'SET':
        const currentVersion = this.version.get(command.key) || 0;
        this.store.set(command.key, {
          value: command.value,
          version: currentVersion + 1,
          expiresAt: command.ttl 
            ? Date.now() + command.ttl 
            : undefined,
        });
        this.version.set(command.key, currentVersion + 1);
        break;
        
      case 'DELETE':
        this.store.delete(command.key);
        this.version.delete(command.key);
        break;
        
      case 'EXPIRE':
        const entry = this.store.get(command.key);
        if (entry) {
          entry.expiresAt = Date.now() + (command.ttl || 0);
        }
        break;
    }
  }
  
  private setupAPI() {
    this.app.use(express.json());
    
    // Get value
    this.app.get('/kv/:key', (req, res) => {
      const entry = this.store.get(req.params.key);
      
      if (!entry) {
        return res.status(404).json({ error: 'Key not found' });
      }
      
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        this.store.delete(req.params.key);
        return res.status(404).json({ error: 'Key expired' });
      }
      
      res.json({
        value: entry.value,
        version: entry.version,
        ttl: entry.expiresAt 
          ? Math.max(0, entry.expiresAt - Date.now()) 
          : null,
      });
    });
    
    // Set value
    this.app.put('/kv/:key', async (req, res) => {
      if (this.node.getState() !== RaftState.LEADER) {
        const leader = this.findLeader();
        if (leader) {
          return res.redirect(307, `http://${leader}/kv/${req.params.key}`);
        }
        return res.status(503).json({ error: 'No leader available' });
      }
      
      try {
        const command: KVCommand = {
          type: 'SET',
          key: req.params.key,
          value: req.body.value,
          ttl: req.body.ttl,
        };
        
        await this.node.appendLog(command);
        res.json({ success: true });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    
    // Delete value
    this.app.delete('/kv/:key', async (req, res) => {
      if (this.node.getState() !== RaftState.LEADER) {
        const leader = this.findLeader();
        if (leader) {
          return res.redirect(307, `http://${leader}/kv/${req.params.key}`);
        }
        return res.status(503).json({ error: 'No leader available' });
      }
      
      try {
        const command: KVCommand = {
          type: 'DELETE',
          key: req.params.key,
        };
        
        await this.node.appendLog(command);
        res.json({ success: true });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
    
    // Cluster status
    this.app.get('/status', (req, res) => {
      res.json({
        nodeId: this.nodeId,
        state: this.node.getState(),
        term: this.node.getCurrentTerm(),
        peers: this.node.getPeers(),
        storeSize: this.store.size,
      });
    });
  }
  
  private findLeader(): string | null {
    const peers = this.node.getPeers();
    for (const peerId of peers) {
      const peerInfo = this.node.getPeerInfo(peerId);
      if (peerInfo && peerInfo.state === RaftState.LEADER) {
        return `${peerInfo.httpHost}:${peerInfo.httpPort - 1000}`;
      }
    }
    return null;
  }
  
  private startExpirationChecker() {
    setInterval(() => {
      const now = Date.now();
      const expiredKeys: string[] = [];
      
      for (const [key, entry] of this.store) {
        if (entry.expiresAt && now > entry.expiresAt) {
          expiredKeys.push(key);
        }
      }
      
      // Remove expired keys locally
      expiredKeys.forEach(key => this.store.delete(key));
    }, 1000);
  }
  
  private restoreFromSnapshot(snapshot: any) {
    this.store.clear();
    this.version.clear();
    
    for (const [key, entry] of Object.entries(snapshot.store)) {
      this.store.set(key, entry as KVEntry);
      this.version.set(key, (entry as KVEntry).version);
    }
  }
  
  async createSnapshot(): Promise<any> {
    return {
      store: Object.fromEntries(this.store),
      version: Object.fromEntries(this.version),
      timestamp: Date.now(),
    };
  }
}

// Run three instances
async function main() {
  const stores = [
    new DistributedKVStore('kv-1', 4001),
    new DistributedKVStore('kv-2', 4002),
    new DistributedKVStore('kv-3', 4003),
  ];
  
  for (const store of stores) {
    await store.start();
  }
  
  console.log('Distributed KV store cluster started');
  console.log('API endpoints:');
  console.log('  PUT    http://localhost:4001/kv/:key');
  console.log('  GET    http://localhost:4001/kv/:key');
  console.log('  DELETE http://localhost:4001/kv/:key');
  console.log('  GET    http://localhost:4001/status');
}

main().catch(console.error);
```

### Configuration Management System

Distributed configuration with version control:

```typescript
// config-management.ts
import { RaftEngine, RaftNode, RaftState } from '@usex/raft';
import { EventEmitter } from 'events';

interface ConfigCommand {
  type: 'SET' | 'DELETE' | 'ROLLBACK';
  namespace: string;
  key: string;
  value?: any;
  version?: number;
  author?: string;
  comment?: string;
}

interface ConfigEntry {
  value: any;
  version: number;
  author: string;
  timestamp: Date;
  comment?: string;
  history: ConfigVersion[];
}

interface ConfigVersion {
  version: number;
  value: any;
  author: string;
  timestamp: Date;
  comment?: string;
}

class ConfigurationManager extends EventEmitter {
  private engine: RaftEngine;
  private node: RaftNode;
  private configs: Map<string, Map<string, ConfigEntry>> = new Map();
  private watchers: Map<string, Set<(value: any) => void>> = new Map();
  
  constructor(private nodeId: string) {
    super();
    this.engine = new RaftEngine();
  }
  
  async initialize() {
    const config = RaftEngine.createDefaultConfiguration(
      this.nodeId,
      'config-cluster'
    );
    
    this.node = await this.engine.createNode(config);
    this.setupHandlers();
    await this.engine.startNode(this.nodeId);
  }
  
  private setupHandlers() {
    this.node.on('logCommitted', ({ command }) => {
      this.applyConfigChange(command as ConfigCommand);
    });
  }
  
  private applyConfigChange(command: ConfigCommand) {
    const namespaceConfigs = this.configs.get(command.namespace) || new Map();
    
    switch (command.type) {
      case 'SET':
        const existing = namespaceConfigs.get(command.key);
        const newVersion = (existing?.version || 0) + 1;
        
        const entry: ConfigEntry = {
          value: command.value,
          version: newVersion,
          author: command.author || 'system',
          timestamp: new Date(),
          comment: command.comment,
          history: existing?.history || [],
        };
        
        // Add current version to history
        if (existing) {
          entry.history.push({
            version: existing.version,
            value: existing.value,
            author: existing.author,
            timestamp: existing.timestamp,
            comment: existing.comment,
          });
          
          // Keep last 10 versions
          if (entry.history.length > 10) {
            entry.history.shift();
          }
        }
        
        namespaceConfigs.set(command.key, entry);
        this.configs.set(command.namespace, namespaceConfigs);
        
        // Notify watchers
        this.notifyWatchers(`${command.namespace}:${command.key}`, command.value);
        break;
        
      case 'DELETE':
        namespaceConfigs.delete(command.key);
        if (namespaceConfigs.size === 0) {
          this.configs.delete(command.namespace);
        }
        this.notifyWatchers(`${command.namespace}:${command.key}`, null);
        break;
        
      case 'ROLLBACK':
        const configToRollback = namespaceConfigs.get(command.key);
        if (configToRollback && command.version !== undefined) {
          const historicalVersion = configToRollback.history.find(
            h => h.version === command.version
          );
          
          if (historicalVersion) {
            // Create new version with historical value
            const rollbackEntry: ConfigEntry = {
              value: historicalVersion.value,
              version: configToRollback.version + 1,
              author: command.author || 'system',
              timestamp: new Date(),
              comment: `Rollback to version ${command.version}`,
              history: [...configToRollback.history, {
                version: configToRollback.version,
                value: configToRollback.value,
                author: configToRollback.author,
                timestamp: configToRollback.timestamp,
                comment: configToRollback.comment,
              }],
            };
            
            namespaceConfigs.set(command.key, rollbackEntry);
            this.notifyWatchers(
              `${command.namespace}:${command.key}`, 
              historicalVersion.value
            );
          }
        }
        break;
    }
  }
  
  async setConfig(
    namespace: string,
    key: string,
    value: any,
    author: string = 'system',
    comment?: string
  ): Promise<void> {
    if (this.node.getState() !== RaftState.LEADER) {
      throw new Error('Not leader');
    }
    
    const command: ConfigCommand = {
      type: 'SET',
      namespace,
      key,
      value,
      author,
      comment,
    };
    
    await this.node.appendLog(command);
  }
  
  getConfig(namespace: string, key: string): any {
    const namespaceConfigs = this.configs.get(namespace);
    if (!namespaceConfigs) {
      return null;
    }
    
    const entry = namespaceConfigs.get(key);
    return entry?.value || null;
  }
  
  getConfigWithMetadata(namespace: string, key: string): ConfigEntry | null {
    const namespaceConfigs = this.configs.get(namespace);
    if (!namespaceConfigs) {
      return null;
    }
    
    return namespaceConfigs.get(key) || null;
  }
  
  getAllConfigs(namespace: string): Record<string, any> {
    const namespaceConfigs = this.configs.get(namespace);
    if (!namespaceConfigs) {
      return {};
    }
    
    const result: Record<string, any> = {};
    for (const [key, entry] of namespaceConfigs) {
      result[key] = entry.value;
    }
    return result;
  }
  
  watch(namespace: string, key: string, callback: (value: any) => void): () => void {
    const watchKey = `${namespace}:${key}`;
    
    if (!this.watchers.has(watchKey)) {
      this.watchers.set(watchKey, new Set());
    }
    
    this.watchers.get(watchKey)!.add(callback);
    
    // Return unwatch function
    return () => {
      const callbacks = this.watchers.get(watchKey);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          this.watchers.delete(watchKey);
        }
      }
    };
  }
  
  private notifyWatchers(watchKey: string, value: any) {
    const callbacks = this.watchers.get(watchKey);
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(value);
        } catch (error) {
          console.error('Watcher callback error:', error);
        }
      });
    }
  }
  
  async rollbackConfig(
    namespace: string,
    key: string,
    version: number,
    author: string = 'system'
  ): Promise<void> {
    if (this.node.getState() !== RaftState.LEADER) {
      throw new Error('Not leader');
    }
    
    const command: ConfigCommand = {
      type: 'ROLLBACK',
      namespace,
      key,
      version,
      author,
    };
    
    await this.node.appendLog(command);
  }
}

// Example usage
async function configExample() {
  // Create cluster
  const managers = [
    new ConfigurationManager('config-1'),
    new ConfigurationManager('config-2'),
    new ConfigurationManager('config-3'),
  ];
  
  // Initialize all nodes
  for (const manager of managers) {
    await manager.initialize();
  }
  
  // Wait for leader
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Find leader node
  const leader = managers.find(m => m.node.getState() === RaftState.LEADER);
  if (!leader) {
    throw new Error('No leader elected');
  }
  
  // Set configurations
  await leader.setConfig(
    'app',
    'database.host',
    'db.example.com',
    'admin',
    'Initial database configuration'
  );
  
  await leader.setConfig(
    'app',
    'database.pool_size',
    10,
    'admin',
    'Set connection pool size'
  );
  
  // Watch for changes
  const unwatch = leader.watch('app', 'database.host', (value) => {
    console.log('Database host changed to:', value);
  });
  
  // Update configuration
  await leader.setConfig(
    'app',
    'database.host',
    'new-db.example.com',
    'developer',
    'Migrated to new database server'
  );
  
  // Get configuration with history
  const configWithHistory = leader.getConfigWithMetadata('app', 'database.host');
  console.log('Current config:', configWithHistory);
  
  // Rollback to version 1
  await leader.rollbackConfig('app', 'database.host', 1, 'admin');
  
  // Cleanup
  unwatch();
}
```

### Distributed Task Queue

Fault-tolerant task processing:

```typescript
// distributed-task-queue.ts
import { RaftEngine, RaftNode, RaftState } from '@usex/raft';
import { EventEmitter } from 'events';

interface Task {
  id: string;
  type: string;
  payload: any;
  priority: number;
  createdAt: Date;
  scheduledFor?: Date;
  retries: number;
  maxRetries: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  assignedTo?: string;
  result?: any;
  error?: string;
}

interface QueueCommand {
  type: 'ENQUEUE' | 'ASSIGN' | 'COMPLETE' | 'FAIL' | 'RETRY';
  task?: Task;
  taskId?: string;
  workerId?: string;
  result?: any;
  error?: string;
}

class DistributedTaskQueue extends EventEmitter {
  private engine: RaftEngine;
  private node: RaftNode;
  private tasks: Map<string, Task> = new Map();
  private pendingQueue: Task[] = [];
  private workerHeartbeats: Map<string, number> = new Map();
  
  constructor(private nodeId: string) {
    super();
    this.engine = new RaftEngine();
  }
  
  async initialize() {
    const config = RaftEngine.createDefaultConfiguration(
      this.nodeId,
      'queue-cluster'
    );
    
    this.node = await this.engine.createNode(config);
    this.setupHandlers();
    await this.engine.startNode(this.nodeId);
    
    // Start maintenance tasks
    this.startMaintenanceTasks();
  }
  
  private setupHandlers() {
    this.node.on('logCommitted', ({ command }) => {
      this.applyQueueCommand(command as QueueCommand);
    });
  }
  
  private applyQueueCommand(command: QueueCommand) {
    switch (command.type) {
      case 'ENQUEUE':
        if (command.task) {
          this.tasks.set(command.task.id, command.task);
          this.pendingQueue.push(command.task);
          this.sortPendingQueue();
          this.emit('taskEnqueued', command.task);
        }
        break;
        
      case 'ASSIGN':
        if (command.taskId && command.workerId) {
          const task = this.tasks.get(command.taskId);
          if (task && task.status === 'pending') {
            task.status = 'processing';
            task.assignedTo = command.workerId;
            this.removeFromPendingQueue(command.taskId);
            this.emit('taskAssigned', task, command.workerId);
          }
        }
        break;
        
      case 'COMPLETE':
        if (command.taskId) {
          const task = this.tasks.get(command.taskId);
          if (task) {
            task.status = 'completed';
            task.result = command.result;
            this.emit('taskCompleted', task);
          }
        }
        break;
        
      case 'FAIL':
        if (command.taskId) {
          const task = this.tasks.get(command.taskId);
          if (task) {
            task.status = 'failed';
            task.error = command.error;
            task.retries++;
            
            if (task.retries < task.maxRetries) {
              // Re-enqueue for retry
              task.status = 'pending';
              task.assignedTo = undefined;
              this.pendingQueue.push(task);
              this.sortPendingQueue();
              this.emit('taskRetrying', task);
            } else {
              this.emit('taskFailed', task);
            }
          }
        }
        break;
    }
  }
  
  async enqueueTask(
    type: string,
    payload: any,
    options: {
      priority?: number;
      scheduledFor?: Date;
      maxRetries?: number;
    } = {}
  ): Promise<string> {
    if (this.node.getState() !== RaftState.LEADER) {
      throw new Error('Not leader');
    }
    
    const task: Task = {
      id: this.generateTaskId(),
      type,
      payload,
      priority: options.priority || 0,
      createdAt: new Date(),
      scheduledFor: options.scheduledFor,
      retries: 0,
      maxRetries: options.maxRetries || 3,
      status: 'pending',
    };
    
    const command: QueueCommand = {
      type: 'ENQUEUE',
      task,
    };
    
    await this.node.appendLog(command);
    return task.id;
  }
  
  async assignTask(workerId: string): Promise<Task | null> {
    if (this.node.getState() !== RaftState.LEADER) {
      throw new Error('Not leader');
    }
    
    // Update worker heartbeat
    this.workerHeartbeats.set(workerId, Date.now());
    
    // Find next available task
    const now = new Date();
    const availableTask = this.pendingQueue.find(task => 
      !task.scheduledFor || task.scheduledFor <= now
    );
    
    if (!availableTask) {
      return null;
    }
    
    const command: QueueCommand = {
      type: 'ASSIGN',
      taskId: availableTask.id,
      workerId,
    };
    
    await this.node.appendLog(command);
    
    // Return the task (it will be updated via event)
    return availableTask;
  }
  
  async completeTask(
    taskId: string,
    workerId: string,
    result: any
  ): Promise<void> {
    if (this.node.getState() !== RaftState.LEADER) {
      throw new Error('Not leader');
    }
    
    const task = this.tasks.get(taskId);
    if (!task || task.assignedTo !== workerId) {
      throw new Error('Task not assigned to this worker');
    }
    
    const command: QueueCommand = {
      type: 'COMPLETE',
      taskId,
      result,
    };
    
    await this.node.appendLog(command);
  }
  
  async failTask(
    taskId: string,
    workerId: string,
    error: string
  ): Promise<void> {
    if (this.node.getState() !== RaftState.LEADER) {
      throw new Error('Not leader');
    }
    
    const task = this.tasks.get(taskId);
    if (!task || task.assignedTo !== workerId) {
      throw new Error('Task not assigned to this worker');
    }
    
    const command: QueueCommand = {
      type: 'FAIL',
      taskId,
      error,
    };
    
    await this.node.appendLog(command);
  }
  
  private sortPendingQueue() {
    this.pendingQueue.sort((a, b) => {
      // Higher priority first
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      // Earlier scheduled tasks first
      if (a.scheduledFor && b.scheduledFor) {
        return a.scheduledFor.getTime() - b.scheduledFor.getTime();
      }
      // Older tasks first
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
  }
  
  private removeFromPendingQueue(taskId: string) {
    const index = this.pendingQueue.findIndex(t => t.id === taskId);
    if (index !== -1) {
      this.pendingQueue.splice(index, 1);
    }
  }
  
  private startMaintenanceTasks() {
    // Check for stale workers
    setInterval(() => {
      const staleTimeout = 30000; // 30 seconds
      const now = Date.now();
      
      for (const [workerId, lastHeartbeat] of this.workerHeartbeats) {
        if (now - lastHeartbeat > staleTimeout) {
          this.handleStaleWorker(workerId);
          this.workerHeartbeats.delete(workerId);
        }
      }
    }, 10000);
    
    // Clean up completed tasks
    setInterval(() => {
      const retentionTime = 3600000; // 1 hour
      const cutoff = Date.now() - retentionTime;
      
      for (const [taskId, task] of this.tasks) {
        if (
          (task.status === 'completed' || task.status === 'failed') &&
          task.createdAt.getTime() < cutoff
        ) {
          this.tasks.delete(taskId);
        }
      }
    }, 60000);
  }
  
  private async handleStaleWorker(workerId: string) {
    // Re-enqueue tasks assigned to stale worker
    for (const [taskId, task] of this.tasks) {
      if (task.assignedTo === workerId && task.status === 'processing') {
        if (this.node.getState() === RaftState.LEADER) {
          await this.node.appendLog({
            type: 'FAIL',
            taskId,
            error: 'Worker timeout',
          } as QueueCommand);
        }
      }
    }
  }
  
  private generateTaskId(): string {
    return `${this.nodeId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
  
  getQueueStats() {
    const stats = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      workers: this.workerHeartbeats.size,
    };
    
    for (const task of this.tasks.values()) {
      stats[task.status]++;
    }
    
    return stats;
  }
}

// Worker implementation
class TaskWorker {
  private queue: DistributedTaskQueue;
  private workerId: string;
  private processing: boolean = false;
  
  constructor(queue: DistributedTaskQueue) {
    this.queue = queue;
    this.workerId = `worker-${Math.random().toString(36).substr(2, 9)}`;
  }
  
  async start() {
    console.log(`Worker ${this.workerId} started`);
    
    while (true) {
      try {
        if (!this.processing) {
          const task = await this.queue.assignTask(this.workerId);
          
          if (task) {
            this.processing = true;
            await this.processTask(task);
            this.processing = false;
          } else {
            // No tasks available, wait
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      } catch (error) {
        console.error(`Worker ${this.workerId} error:`, error);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }
  
  private async processTask(task: Task) {
    console.log(`Worker ${this.workerId} processing task ${task.id}`);
    
    try {
      // Simulate task processing
      const result = await this.executeTask(task);
      await this.queue.completeTask(task.id, this.workerId, result);
      console.log(`Worker ${this.workerId} completed task ${task.id}`);
    } catch (error) {
      await this.queue.failTask(task.id, this.workerId, error.message);
      console.error(`Worker ${this.workerId} failed task ${task.id}:`, error);
    }
  }
  
  private async executeTask(task: Task): Promise<any> {
    // Task-specific processing logic
    switch (task.type) {
      case 'email':
        return this.sendEmail(task.payload);
      case 'image_resize':
        return this.resizeImage(task.payload);
      case 'data_export':
        return this.exportData(task.payload);
      default:
        throw new Error(`Unknown task type: ${task.type}`);
    }
  }
  
  private async sendEmail(payload: any): Promise<any> {
    // Simulate email sending
    await new Promise(resolve => setTimeout(resolve, 1000));
    return { messageId: Math.random().toString(36) };
  }
  
  private async resizeImage(payload: any): Promise<any> {
    // Simulate image processing
    await new Promise(resolve => setTimeout(resolve, 2000));
    return { 
      url: `https://cdn.example.com/resized/${payload.imageId}`,
      size: { width: 800, height: 600 }
    };
  }
  
  private async exportData(payload: any): Promise<any> {
    // Simulate data export
    await new Promise(resolve => setTimeout(resolve, 5000));
    return { 
      exportId: Math.random().toString(36),
      rowCount: Math.floor(Math.random() * 10000)
    };
  }
}

// Example usage
async function taskQueueExample() {
  // Create queue cluster
  const queues = [
    new DistributedTaskQueue('queue-1'),
    new DistributedTaskQueue('queue-2'),
    new DistributedTaskQueue('queue-3'),
  ];
  
  // Initialize all nodes
  for (const queue of queues) {
    await queue.initialize();
  }
  
  // Wait for leader
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Find leader
  const leader = queues.find(q => q.node.getState() === RaftState.LEADER);
  if (!leader) {
    throw new Error('No leader elected');
  }
  
  // Enqueue some tasks
  await leader.enqueueTask('email', {
    to: 'user@example.com',
    subject: 'Welcome!',
    template: 'welcome',
  }, { priority: 10 });
  
  await leader.enqueueTask('image_resize', {
    imageId: 'img123',
    sizes: ['thumbnail', 'medium', 'large'],
  }, { priority: 5 });
  
  await leader.enqueueTask('data_export', {
    format: 'csv',
    filters: { status: 'active' },
  }, { 
    priority: 1,
    scheduledFor: new Date(Date.now() + 60000), // 1 minute from now
  });
  
  // Start workers
  const workers = [
    new TaskWorker(leader),
    new TaskWorker(leader),
    new TaskWorker(leader),
  ];
  
  // Start all workers
  workers.forEach(worker => worker.start());
  
  // Monitor queue stats
  setInterval(() => {
    console.log('Queue stats:', leader.getQueueStats());
  }, 5000);
}
```

### Service Registry

Service discovery and health monitoring:

```typescript
// service-registry.ts
import { RaftEngine, RaftNode, RaftState } from '@usex/raft';

interface Service {
  id: string;
  name: string;
  version: string;
  endpoint: string;
  metadata: Record<string, any>;
  healthCheck?: HealthCheck;
  registeredAt: Date;
  lastHealthCheck?: Date;
  status: 'healthy' | 'unhealthy' | 'unknown';
}

interface HealthCheck {
  type: 'http' | 'tcp' | 'grpc';
  endpoint?: string;
  interval: number;
  timeout: number;
  retries: number;
}

interface RegistryCommand {
  type: 'REGISTER' | 'DEREGISTER' | 'UPDATE_HEALTH';
  service?: Service;
  serviceId?: string;
  status?: 'healthy' | 'unhealthy';
}

class ServiceRegistry {
  private engine: RaftEngine;
  private node: RaftNode;
  private services: Map<string, Service> = new Map();
  private healthCheckTimers: Map<string, NodeJS.Timeout> = new Map();
  
  constructor(private nodeId: string) {
    this.engine = new RaftEngine();
  }
  
  async initialize() {
    const config = RaftEngine.createDefaultConfiguration(
      this.nodeId,
      'registry-cluster'
    );
    
    this.node = await this.engine.createNode(config);
    this.setupHandlers();
    await this.engine.startNode(this.nodeId);
  }
  
  private setupHandlers() {
    this.node.on('logCommitted', ({ command }) => {
      this.applyRegistryCommand(command as RegistryCommand);
    });
    
    this.node.on('stateChange', ({ state }) => {
      if (state === RaftState.LEADER) {
        this.startHealthChecks();
      } else {
        this.stopHealthChecks();
      }
    });
  }
  
  private applyRegistryCommand(command: RegistryCommand) {
    switch (command.type) {
      case 'REGISTER':
        if (command.service) {
          this.services.set(command.service.id, command.service);
          console.log(`Service registered: ${command.service.name} (${command.service.id})`);
        }
        break;
        
      case 'DEREGISTER':
        if (command.serviceId) {
          this.services.delete(command.serviceId);
          console.log(`Service deregistered: ${command.serviceId}`);
        }
        break;
        
      case 'UPDATE_HEALTH':
        if (command.serviceId && command.status) {
          const service = this.services.get(command.serviceId);
          if (service) {
            service.status = command.status;
            service.lastHealthCheck = new Date();
          }
        }
        break;
    }
  }
  
  async registerService(
    name: string,
    version: string,
    endpoint: string,
    metadata: Record<string, any> = {},
    healthCheck?: HealthCheck
  ): Promise<string> {
    if (this.node.getState() !== RaftState.LEADER) {
      throw new Error('Not leader');
    }
    
    const service: Service = {
      id: this.generateServiceId(name),
      name,
      version,
      endpoint,
      metadata,
      healthCheck,
      registeredAt: new Date(),
      status: 'unknown',
    };
    
    const command: RegistryCommand = {
      type: 'REGISTER',
      service,
    };
    
    await this.node.appendLog(command);
    return service.id;
  }
  
  async deregisterService(serviceId: string): Promise<void> {
    if (this.node.getState() !== RaftState.LEADER) {
      throw new Error('Not leader');
    }
    
    const command: RegistryCommand = {
      type: 'DEREGISTER',
      serviceId,
    };
    
    await this.node.appendLog(command);
  }
  
  discoverServices(
    name?: string,
    version?: string,
    metadata?: Record<string, any>
  ): Service[] {
    let services = Array.from(this.services.values());
    
    if (name) {
      services = services.filter(s => s.name === name);
    }
    
    if (version) {
      services = services.filter(s => s.version === version);
    }
    
    if (metadata) {
      services = services.filter(s => {
        for (const [key, value] of Object.entries(metadata)) {
          if (s.metadata[key] !== value) {
            return false;
          }
        }
        return true;
      });
    }
    
    // Return only healthy services
    return services.filter(s => s.status === 'healthy');
  }
  
  getService(serviceId: string): Service | null {
    return this.services.get(serviceId) || null;
  }
  
  private startHealthChecks() {
    for (const [serviceId, service] of this.services) {
      if (service.healthCheck) {
        this.scheduleHealthCheck(serviceId, service);
      }
    }
  }
  
  private stopHealthChecks() {
    for (const timer of this.healthCheckTimers.values()) {
      clearTimeout(timer);
    }
    this.healthCheckTimers.clear();
  }
  
  private scheduleHealthCheck(serviceId: string, service: Service) {
    if (!service.healthCheck) return;
    
    const check = async () => {
      try {
        const isHealthy = await this.performHealthCheck(service);
        const status = isHealthy ? 'healthy' : 'unhealthy';
        
        if (service.status !== status) {
          await this.node.appendLog({
            type: 'UPDATE_HEALTH',
            serviceId,
            status,
          } as RegistryCommand);
        }
      } catch (error) {
        console.error(`Health check failed for ${serviceId}:`, error);
      }
      
      // Schedule next check
      const timer = setTimeout(check, service.healthCheck.interval);
      this.healthCheckTimers.set(serviceId, timer);
    };
    
    // Initial check
    check();
  }
  
  private async performHealthCheck(service: Service): Promise<boolean> {
    if (!service.healthCheck) return true;
    
    const { type, endpoint, timeout, retries } = service.healthCheck;
    const checkEndpoint = endpoint || service.endpoint;
    
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        switch (type) {
          case 'http':
            return await this.httpHealthCheck(checkEndpoint, timeout);
          case 'tcp':
            return await this.tcpHealthCheck(checkEndpoint, timeout);
          case 'grpc':
            return await this.grpcHealthCheck(checkEndpoint, timeout);
          default:
            return true;
        }
      } catch (error) {
        if (attempt === retries) {
          throw error;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    return false;
  }
  
  private async httpHealthCheck(endpoint: string, timeout: number): Promise<boolean> {
    // Implement HTTP health check
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
      const response = await fetch(`${endpoint}/health`, {
        signal: controller.signal,
      });
      return response.ok;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  
  private async tcpHealthCheck(endpoint: string, timeout: number): Promise<boolean> {
    // Implement TCP health check
    return new Promise((resolve) => {
      const [host, port] = endpoint.split(':');
      const socket = new net.Socket();
      
      socket.setTimeout(timeout);
      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('error', () => resolve(false));
      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });
      
      socket.connect(parseInt(port), host);
    });
  }
  
  private async grpcHealthCheck(endpoint: string, timeout: number): Promise<boolean> {
    // Implement gRPC health check
    // Would use @grpc/grpc-js in real implementation
    return true;
  }
  
  private generateServiceId(name: string): string {
    return `${name}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Service client
class ServiceClient {
  constructor(private registry: ServiceRegistry) {}
  
  async callService(
    serviceName: string,
    method: string,
    data: any
  ): Promise<any> {
    const services = this.registry.discoverServices(serviceName);
    
    if (services.length === 0) {
      throw new Error(`No healthy instances of ${serviceName} found`);
    }
    
    // Simple round-robin load balancing
    const service = services[Math.floor(Math.random() * services.length)];
    
    try {
      const response = await fetch(`${service.endpoint}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      
      if (!response.ok) {
        throw new Error(`Service call failed: ${response.statusText}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error(`Failed to call ${serviceName}:`, error);
      throw error;
    }
  }
}
```

## Advanced Examples

### Multi-Region Setup

Complete multi-region deployment:

```typescript
// multi-region.ts
import { RaftEngine, RaftConfiguration, RaftNode } from '@usex/raft';

interface Region {
  name: string;
  nodes: string[];
  primaryDatacenter: string;
  backupDatacenters: string[];
  latencyMap: Map<string, number>;
}

class MultiRegionCluster {
  private regions: Map<string, Region> = new Map();
  private engines: Map<string, RaftEngine> = new Map();
  private globalEngine: RaftEngine;
  
  constructor() {
    this.globalEngine = new RaftEngine();
    this.initializeRegions();
  }
  
  private initializeRegions() {
    // US East Region
    this.regions.set('us-east', {
      name: 'us-east',
      nodes: ['use1-1', 'use1-2', 'use1-3'],
      primaryDatacenter: 'us-east-1a',
      backupDatacenters: ['us-east-1b', 'us-east-1c'],
      latencyMap: new Map([
        ['us-east', 1],
        ['us-west', 70],
        ['eu-west', 90],
        ['ap-south', 220],
      ]),
    });
    
    // US West Region
    this.regions.set('us-west', {
      name: 'us-west',
      nodes: ['usw2-1', 'usw2-2', 'usw2-3'],
      primaryDatacenter: 'us-west-2a',
      backupDatacenters: ['us-west-2b', 'us-west-2c'],
      latencyMap: new Map([
        ['us-east', 70],
        ['us-west', 1],
        ['eu-west', 150],
        ['ap-south', 180],
      ]),
    });
    
    // EU West Region
    this.regions.set('eu-west', {
      name: 'eu-west',
      nodes: ['euw1-1', 'euw1-2', 'euw1-3'],
      primaryDatacenter: 'eu-west-1a',
      backupDatacenters: ['eu-west-1b', 'eu-west-1c'],
      latencyMap: new Map([
        ['us-east', 90],
        ['us-west', 150],
        ['eu-west', 1],
        ['ap-south', 130],
      ]),
    });
    
    // AP South Region
    this.regions.set('ap-south', {
      name: 'ap-south',
      nodes: ['aps1-1', 'aps1-2', 'aps1-3'],
      primaryDatacenter: 'ap-south-1a',
      backupDatacenters: ['ap-south-1b', 'ap-south-1c'],
      latencyMap: new Map([
        ['us-east', 220],
        ['us-west', 180],
        ['eu-west', 130],
        ['ap-south', 1],
      ]),
    });
  }
  
  async deployGlobalCluster() {
    // Deploy regional clusters
    for (const [regionName, region] of this.regions) {
      await this.deployRegionalCluster(regionName, region);
    }
    
    // Create inter-region connections
    await this.setupInterRegionConnections();
    
    // Start global coordinator
    await this.startGlobalCoordinator();
  }
  
  private async deployRegionalCluster(regionName: string, region: Region) {
    const engine = new RaftEngine();
    this.engines.set(regionName, engine);
    
    for (let i = 0; i < region.nodes.length; i++) {
      const nodeId = region.nodes[i];
      const datacenter = i === 0 
        ? region.primaryDatacenter 
        : region.backupDatacenters[i - 1];
      
      const config = this.createRegionalNodeConfig(
        nodeId,
        regionName,
        datacenter,
        region.latencyMap
      );
      
      await engine.createNode(config);
      await engine.startNode(nodeId);
      
      console.log(`Deployed ${nodeId} in ${datacenter}`);
    }
  }
  
  private createRegionalNodeConfig(
    nodeId: string,
    region: string,
    datacenter: string,
    latencyMap: Map<string, number>
  ): RaftConfiguration {
    // Calculate average latency to other regions
    let totalLatency = 0;
    let count = 0;
    for (const [otherRegion, latency] of latencyMap) {
      if (otherRegion !== region) {
        totalLatency += latency;
        count++;
      }
    }
    const avgLatency = count > 0 ? totalLatency / count : 50;
    
    return {
      ...RaftEngine.createDefaultConfiguration(nodeId, `${region}-cluster`),
      // Adjust timeouts based on inter-region latency
      electionTimeout: [
        300 + avgLatency,
        600 + avgLatency * 2
      ],
      heartbeatInterval: 100 + Math.floor(avgLatency / 3),
      
      // Network configuration for cross-region
      network: {
        requestTimeout: 5000 + avgLatency * 5,
        maxRetries: 5,
        retryDelay: 200,
        circuitBreakerThreshold: 10,
        circuitBreakerTimeout: 60000,
      },
      
      // Metadata for routing decisions
      metadata: {
        region,
        datacenter,
        tier: 'regional',
      },
      
      // Prefer regional leaders
      voting: {
        enableWeighting: true,
        weightMetrics: ['regionAffinity', 'networkLatency', 'cpuUsage'],
        defaultWeight: 1,
        customWeights: {
          regionAffinity: region === 'us-east' ? 2 : 1, // Prefer us-east as primary
        },
      },
    };
  }
  
  private async setupInterRegionConnections() {
    // Create a global coordination layer
    const globalNodes: string[] = [];
    
    // Select one node from each region for global coordination
    for (const [regionName, region] of this.regions) {
      const representativeNode = region.nodes[0];
      globalNodes.push(`global-${regionName}`);
      
      const config = this.createGlobalNodeConfig(
        `global-${regionName}`,
        regionName,
        region.latencyMap
      );
      
      await this.globalEngine.createNode(config);
    }
    
    // Start global nodes
    for (const nodeId of globalNodes) {
      await this.globalEngine.startNode(nodeId);
    }
  }
  
  private createGlobalNodeConfig(
    nodeId: string,
    region: string,
    latencyMap: Map<string, number>
  ): RaftConfiguration {
    // Calculate max latency for worst-case scenario
    let maxLatency = 0;
    for (const latency of latencyMap.values()) {
      if (latency > maxLatency) {
        maxLatency = latency;
      }
    }
    
    return {
      ...RaftEngine.createDefaultConfiguration(nodeId, 'global-cluster'),
      // Very conservative timeouts for global coordination
      electionTimeout: [1000 + maxLatency * 2, 2000 + maxLatency * 3],
      heartbeatInterval: 500 + maxLatency,
      
      // Long timeouts for cross-region operations
      network: {
        requestTimeout: 10000 + maxLatency * 10,
        maxRetries: 10,
        retryDelay: 500,
        circuitBreakerThreshold: 20,
        circuitBreakerTimeout: 120000,
      },
      
      metadata: {
        tier: 'global',
        region,
      },
    };
  }
  
  private async startGlobalCoordinator() {
    // Monitor regional clusters and coordinate cross-region operations
    setInterval(async () => {
      const regionalStatuses = new Map<string, any>();
      
      for (const [regionName, engine] of this.engines) {
        const nodes = engine.getAllNodes();
        const status = {
          totalNodes: nodes.size,
          healthyNodes: 0,
          leader: null,
          averageLatency: 0,
        };
        
        for (const [nodeId, node] of nodes) {
          if (node.getState() === RaftState.LEADER) {
            status.leader = nodeId;
          }
          
          const metrics = node.getMetrics();
          if (metrics && metrics.systemMetrics) {
            status.healthyNodes++;
            status.averageLatency += metrics.systemMetrics.networkLatency;
          }
        }
        
        if (status.healthyNodes > 0) {
          status.averageLatency /= status.healthyNodes;
        }
        
        regionalStatuses.set(regionName, status);
      }
      
      // Log global cluster health
      console.log('Global Cluster Status:');
      for (const [region, status] of regionalStatuses) {
        console.log(`  ${region}:`, status);
      }
      
      // Check for split-brain across regions
      await this.checkGlobalConsistency(regionalStatuses);
      
    }, 30000); // Every 30 seconds
  }
  
  private async checkGlobalConsistency(
    regionalStatuses: Map<string, any>
  ): Promise<void> {
    // Implement global consistency checks
    // This could include:
    // - Verifying no conflicting leaders across regions
    // - Checking data consistency between regions
    // - Monitoring inter-region replication lag
  }
  
  async performGlobalOperation(operation: any): Promise<void> {
    // Route operation through global consensus first
    const globalLeader = this.findGlobalLeader();
    if (!globalLeader) {
      throw new Error('No global leader available');
    }
    
    // Get global consensus
    await globalLeader.appendLog({
      type: 'GLOBAL_OPERATION',
      operation,
      timestamp: Date.now(),
    });
    
    // Then apply to regional clusters
    const regionalPromises = [];
    for (const [regionName, engine] of this.engines) {
      const regionalLeader = this.findRegionalLeader(engine);
      if (regionalLeader) {
        regionalPromises.push(
          regionalLeader.appendLog({
            type: 'REGIONAL_OPERATION',
            operation,
            globalApproved: true,
          })
        );
      }
    }
    
    await Promise.all(regionalPromises);
  }
  
  private findGlobalLeader(): RaftNode | null {
    const nodes = this.globalEngine.getAllNodes();
    for (const [_, node] of nodes) {
      if (node.getState() === RaftState.LEADER) {
        return node;
      }
    }
    return null;
  }
  
  private findRegionalLeader(engine: RaftEngine): RaftNode | null {
    const nodes = engine.getAllNodes();
    for (const [_, node] of nodes) {
      if (node.getState() === RaftState.LEADER) {
        return node;
      }
    }
    return null;
  }
}

// Usage
async function multiRegionExample() {
  const cluster = new MultiRegionCluster();
  await cluster.deployGlobalCluster();
  
  console.log('Multi-region cluster deployed successfully');
  
  // Perform global operation
  await cluster.performGlobalOperation({
    type: 'SCHEMA_MIGRATION',
    version: '2.0.0',
    sql: 'ALTER TABLE users ADD COLUMN last_login TIMESTAMP',
  });
}
```

## Next Steps

- [Architecture](./architecture.md) - Understanding RAFT internals
- [Monitoring](./monitoring.md) - Setting up monitoring and observability
- [Deployment](./deployment.md) - Production deployment strategies
- [Troubleshooting](./troubleshooting.md) - Common issues and solutions