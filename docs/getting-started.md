# Getting Started with RAFT

This guide will help you get up and running with RAFT quickly. We'll create a simple distributed system with multiple nodes that can elect a leader and replicate data.

## Basic Concepts

Before diving into code, let's understand the key concepts:

- **Node**: A single instance in your distributed system
- **Cluster**: A collection of nodes working together
- **Leader**: The node responsible for handling client requests and replicating data
- **Follower**: Nodes that replicate data from the leader
- **Candidate**: A node attempting to become the leader
- **Term**: A logical clock used for leader election
- **Log**: The replicated sequence of commands

## Your First RAFT Node

Let's create a simple single-node cluster:

```typescript
import { RaftEngine, RaftState } from '@usex/raft';

async function createSingleNode() {
  // Create the RAFT engine
  const engine = new RaftEngine();
  
  // Generate default configuration
  const config = RaftEngine.createDefaultConfiguration(
    'node-1',     // Unique node ID
    'my-cluster'  // Cluster name
  );
  
  // Create and start the node
  const node = await engine.createNode(config);
  await engine.startNode('node-1');
  
  console.log('Node started!');
  console.log('Current state:', node.getState());
  console.log('Current term:', node.getCurrentTerm());
  
  // Listen for state changes
  node.on('stateChange', ({ state, term }) => {
    console.log(`State changed to ${state} in term ${term}`);
  });
  
  // Keep the process running
  process.on('SIGINT', async () => {
    console.log('Shutting down...');
    await engine.stopNode('node-1');
    process.exit(0);
  });
}

createSingleNode().catch(console.error);
```

## Creating a Multi-Node Cluster

For a real distributed system, you'll want multiple nodes. Here's how to create a 3-node cluster:

```typescript
import { RaftEngine, RaftState, RaftConfiguration } from '@usex/raft';

class RaftCluster {
  private engine: RaftEngine;
  private nodes: Map<string, any> = new Map();
  
  constructor() {
    this.engine = new RaftEngine();
  }
  
  async createCluster() {
    // Create three nodes with different configurations
    const nodeConfigs: RaftConfiguration[] = [
      this.createNodeConfig('node-1', 3001),
      this.createNodeConfig('node-2', 3002),
      this.createNodeConfig('node-3', 3003),
    ];
    
    // Create and start all nodes
    for (const config of nodeConfigs) {
      const node = await this.engine.createNode(config);
      this.nodes.set(config.nodeId, node);
      
      // Set up event listeners
      this.setupNodeListeners(node, config.nodeId);
      
      // Start the node
      await this.engine.startNode(config.nodeId);
      console.log(`Started ${config.nodeId}`);
    }
    
    console.log('Cluster created with 3 nodes');
  }
  
  private createNodeConfig(nodeId: string, port: number): RaftConfiguration {
    return {
      ...RaftEngine.createDefaultConfiguration(nodeId, 'demo-cluster'),
      httpPort: port,
      electionTimeout: [150, 300], // Random timeout between 150-300ms
      heartbeatInterval: 50,       // Send heartbeats every 50ms
    };
  }
  
  private setupNodeListeners(node: any, nodeId: string) {
    node.on('stateChange', ({ state, term }) => {
      console.log(`[${nodeId}] State: ${state}, Term: ${term}`);
    });
    
    node.on('leaderElected', ({ leaderId }) => {
      console.log(`[${nodeId}] Leader elected: ${leaderId}`);
    });
  }
  
  async shutdown() {
    console.log('Shutting down cluster...');
    await this.engine.stopAllNodes();
  }
}

// Run the cluster
async function main() {
  const cluster = new RaftCluster();
  await cluster.createCluster();
  
  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    await cluster.shutdown();
    process.exit(0);
  });
}

main().catch(console.error);
```

## Working with the Leader

Only the leader node can accept new log entries. Here's how to work with leader operations:

```typescript
import { RaftEngine, RaftState } from '@usex/raft';

async function leaderOperations() {
  const engine = new RaftEngine();
  const config = RaftEngine.createDefaultConfiguration('node-1', 'my-cluster');
  const node = await engine.createNode(config);
  await engine.startNode('node-1');
  
  // Wait for leader election (in a single-node cluster, it becomes leader quickly)
  await new Promise(resolve => {
    node.once('leaderElected', resolve);
  });
  
  // Now we can append logs
  if (node.getState() === RaftState.LEADER) {
    try {
      // Append a command to the log
      await node.appendLog({
        type: 'SET',
        key: 'user:1',
        value: { name: 'John Doe', email: 'john@example.com' }
      });
      
      console.log('Log entry appended successfully');
      
      // Append multiple entries
      const commands = [
        { type: 'SET', key: 'user:2', value: { name: 'Jane Doe' } },
        { type: 'DELETE', key: 'temp:1' },
        { type: 'INCREMENT', key: 'counter', value: 1 }
      ];
      
      for (const command of commands) {
        await node.appendLog(command);
      }
      
      console.log('Multiple log entries appended');
    } catch (error) {
      console.error('Failed to append log:', error);
    }
  }
}

leaderOperations().catch(console.error);
```

## Monitoring Node Health

RAFT provides comprehensive metrics and monitoring capabilities:

```typescript
import { RaftEngine } from '@usex/raft';

async function monitorNode() {
  const engine = new RaftEngine();
  const config = RaftEngine.createDefaultConfiguration('monitor-node', 'my-cluster');
  
  // Enable metrics collection
  config.metrics = {
    enablePrometheus: true,
    enableInternal: true,
    collectionInterval: 5000, // Collect every 5 seconds
  };
  
  const node = await engine.createNode(config);
  await engine.startNode('monitor-node');
  
  // Get current metrics
  setInterval(() => {
    const metrics = node.getMetrics();
    if (metrics) {
      console.log('Node Metrics:', {
        state: node.getState(),
        term: node.getCurrentTerm(),
        logLength: metrics.logLength,
        commitIndex: metrics.commitIndex,
        lastApplied: metrics.lastApplied,
        messagesReceived: metrics.messagesReceived,
        messagesSent: metrics.messagesSent,
      });
    }
  }, 5000);
  
  // Get Prometheus metrics
  const prometheusMetrics = await node.getPrometheusMetrics();
  console.log('Prometheus metrics available at /metrics endpoint');
}

monitorNode().catch(console.error);
```

## Handling Events

RAFT emits various events that you can listen to:

```typescript
import { RaftEngine, RaftEventType } from '@usex/raft';

async function eventHandling() {
  const engine = new RaftEngine();
  const config = RaftEngine.createDefaultConfiguration('event-node', 'my-cluster');
  const node = await engine.createNode(config);
  
  // State changes
  node.on('stateChange', ({ state, term }) => {
    console.log(`State changed: ${state} (term: ${term})`);
  });
  
  // Leader election
  node.on('leaderElected', ({ leaderId, term }) => {
    console.log(`New leader: ${leaderId} (term: ${term})`);
  });
  
  // Log replication
  node.on('logReplicated', ({ index, command, term }) => {
    console.log(`Log replicated at index ${index}:`, command);
  });
  
  // Peer discovery
  node.on('peerDiscovered', ({ nodeId, address }) => {
    console.log(`Discovered peer: ${nodeId} at ${address}`);
  });
  
  // Errors
  node.on('error', (error) => {
    console.error('Node error:', error);
  });
  
  await engine.startNode('event-node');
}

eventHandling().catch(console.error);
```

## Error Handling

RAFT provides specific exception types for different error scenarios:

```typescript
import { 
  RaftEngine,
  RaftValidationException,
  RaftElectionException,
  RaftReplicationException 
} from '@usex/raft';

async function errorHandling() {
  const engine = new RaftEngine();
  
  try {
    // This will throw RaftValidationException if node already exists
    const config = RaftEngine.createDefaultConfiguration('node-1', 'cluster');
    await engine.createNode(config);
    await engine.createNode(config); // Duplicate!
  } catch (error) {
    if (error instanceof RaftValidationException) {
      console.error('Validation error:', error.message);
    }
  }
  
  try {
    const node = engine.getNode('node-1');
    if (node && node.getState() !== 'leader') {
      // This will throw if not leader
      await node.appendLog({ data: 'test' });
    }
  } catch (error) {
    if (error instanceof RaftValidationException) {
      console.error('Only leader can append logs');
    }
  }
}
```

## Configuration Options

Here's a quick overview of common configuration options:

```typescript
const config = {
  nodeId: 'node-1',
  clusterId: 'my-cluster',
  httpPort: 3000,
  
  // Election timing (milliseconds)
  electionTimeout: [150, 300],  // Random between min and max
  heartbeatInterval: 50,
  
  // Storage limits
  maxLogEntries: 10000,
  snapshotThreshold: 1000,
  
  // Redis connection
  redis: {
    host: 'localhost',
    port: 6379,
    password: process.env.REDIS_PASSWORD,
  },
  
  // Logging
  logging: {
    level: 'info',  // 'debug' | 'info' | 'warn' | 'error' | 'fatal'
    enableStructured: true,
  },
  
  // Metrics
  metrics: {
    enablePrometheus: true,
    enableInternal: true,
    collectionInterval: 5000,
  }
};
```

## Next Steps

Now that you understand the basics, explore:

- [Configuration Guide](./configuration.md) - Detailed configuration options
- [API Reference](./api-reference.md) - Complete API documentation
- [Examples](./examples.md) - More complex examples
- [Advanced Usage](./advanced-usage.md) - Production patterns

## Quick Reference

### Common Operations

```typescript
// Create and start a node
const engine = new RaftEngine();
const node = await engine.createNode(config);
await engine.startNode(nodeId);

// Check node state
const state = node.getState();
const term = node.getCurrentTerm();
const metrics = node.getMetrics();

// Append logs (leader only)
if (node.getState() === RaftState.LEADER) {
  await node.appendLog(command);
}

// Get peers
const peers = node.getPeers();
const peerInfo = node.getPeerInfo(peerId);

// Stop node
await engine.stopNode(nodeId);
```

### Event Types

- `stateChange` - Node state transitions
- `leaderElected` - New leader elected
- `logReplicated` - Log entry replicated
- `peerDiscovered` - New peer found
- `error` - Error occurred

### State Types

- `RaftState.FOLLOWER` - Following the leader
- `RaftState.CANDIDATE` - Running for leader
- `RaftState.LEADER` - Current leader

## Tips for Development

1. **Start Small**: Begin with a single node, then expand to multi-node
2. **Monitor Events**: Use event listeners to understand cluster behavior
3. **Handle Errors**: Always wrap operations in try-catch blocks
4. **Check State**: Verify node state before performing leader operations
5. **Use Metrics**: Monitor cluster health with built-in metrics