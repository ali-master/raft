# Troubleshooting Guide

This guide helps you diagnose and resolve common issues with RAFT clusters.

## Table of Contents

- [Common Issues](#common-issues)
  - [Cluster Formation Issues](#cluster-formation-issues)
  - [Leader Election Problems](#leader-election-problems)
  - [Replication Issues](#replication-issues)
  - [Network Problems](#network-problems)
  - [Storage Issues](#storage-issues)
  - [Performance Problems](#performance-problems)
- [Diagnostic Tools](#diagnostic-tools)
- [Error Messages](#error-messages)
- [Recovery Procedures](#recovery-procedures)
- [FAQ](#faq)

## Common Issues

### Cluster Formation Issues

#### Problem: Nodes Can't Discover Each Other

**Symptoms:**
- `getPeers()` returns empty array
- No leader election occurs
- Logs show "No peers discovered"

**Causes & Solutions:**

1. **Redis Connection Issues**
   ```typescript
   // Check Redis connectivity
   const redis = new Redis({
     host: config.redis.host,
     port: config.redis.port
   });
   
   try {
     await redis.ping();
     console.log('Redis connection OK');
   } catch (error) {
     console.error('Redis connection failed:', error);
   }
   ```

2. **Incorrect Cluster ID**
   ```typescript
   // Ensure all nodes use the same cluster ID
   const config = {
     nodeId: 'unique-node-id',
     clusterId: 'my-cluster', // Must match across all nodes
     // ...
   };
   ```

3. **Network Isolation**
   ```bash
   # Check if nodes can reach each other
   telnet node2-host 3001
   curl http://node2-host:3001/health
   ```

4. **Firewall Rules**
   ```bash
   # Check firewall rules
   sudo iptables -L -n | grep 3001
   
   # Allow RAFT ports
   sudo ufw allow 3001/tcp
   ```

#### Problem: Cluster Forms But Nodes Drop Out

**Symptoms:**
- Nodes alternate between connected/disconnected
- Peer timeout errors in logs

**Solution:**
```typescript
// Increase peer timeout for unstable networks
const config = {
  peerDiscovery: {
    registrationInterval: 5000,
    healthCheckInterval: 10000,
    peerTimeout: 60000, // Increase from default 30000
  }
};
```

### Leader Election Problems

#### Problem: No Leader Elected

**Symptoms:**
- All nodes remain in FOLLOWER state
- Election timeout logs but no leader

**Causes & Solutions:**

1. **Split Vote**
   ```typescript
   // Randomize election timeout more
   const config = {
     electionTimeout: [150, 500], // Wider range
   };
   ```

2. **Even Number of Nodes**
   ```text
   Always use odd number of nodes (3, 5, 7) to avoid split votes
   ```

3. **Clock Skew**
   ```bash
   # Sync system clocks
   sudo ntpdate -s time.nist.gov
   # Or use chronyd
   sudo chrony sources
   ```

#### Problem: Frequent Leader Changes

**Symptoms:**
- Leader changes every few seconds
- High election count in metrics

**Solutions:**

1. **Increase Election Timeout**
   ```typescript
   const config = {
     electionTimeout: [300, 600], // Increase from default
     heartbeatInterval: 100,       // Keep ratio 1:3
   };
   ```

2. **Check Network Latency**
   ```typescript
   // Monitor network latency
   node.on('metricsUpdated', (metrics) => {
     if (metrics.averageRPCLatency > 100) {
       console.warn('High network latency detected');
     }
   });
   ```

3. **Resource Constraints**
   ```typescript
   // Check system resources
   const metrics = node.getMetrics();
   if (metrics?.systemMetrics) {
     const { cpuUsage, memoryUsage } = metrics.systemMetrics;
     if (cpuUsage > 80 || memoryUsage > 80) {
       console.warn('High resource usage affecting elections');
     }
   }
   ```

### Replication Issues

#### Problem: Log Entries Not Replicating

**Symptoms:**
- Leader's log grows but followers don't update
- `commitIndex` not advancing

**Debugging Steps:**

1. **Check Leader State**
   ```typescript
   const state = node.getState();
   const term = node.getCurrentTerm();
   console.log(`Node state: ${state}, Term: ${term}`);
   ```

2. **Verify Network Connectivity**
   ```typescript
   // Add network debugging
   node.on('messageSent', ({ to, type, success }) => {
     if (!success) {
       console.error(`Failed to send ${type} to ${to}`);
     }
   });
   ```

3. **Check Follower Logs**
   ```typescript
   // Enable debug logging on followers
   const config = {
     logging: {
       level: LogLevel.DEBUG,
     }
   };
   ```

#### Problem: Replication Lag

**Symptoms:**
- Followers behind leader by many entries
- High latency in log application

**Solutions:**

1. **Batch Replication**
   ```typescript
   // Already implemented, but ensure proper config
   const config = {
     maxLogEntries: 10000,     // Don't let log grow too large
     snapshotThreshold: 1000,  // Create snapshots regularly
   };
   ```

2. **Optimize Network**
   ```typescript
   const config = {
     network: {
       requestTimeout: 10000,    // Increase for slow networks
       maxRetries: 5,
       retryDelay: 200,
     }
   };
   ```

### Network Problems

#### Problem: Connection Timeouts

**Symptoms:**
- "Request timeout" errors
- Circuit breaker opening frequently

**Solutions:**

1. **Adjust Timeouts**
   ```typescript
   const config = {
     network: {
       requestTimeout: 10000,    // Increase from 5000
       circuitBreakerTimeout: 120000, // Increase from 30000
     }
   };
   ```

2. **Check MTU Issues**
   ```bash
   # Test with different packet sizes
   ping -M do -s 1472 target-host
   
   # Reduce MTU if needed
   sudo ip link set dev eth0 mtu 1400
   ```

#### Problem: Circuit Breaker Always Open

**Symptoms:**
- "Circuit breaker is OPEN" errors
- Node isolated from cluster

**Solutions:**

1. **Reset Circuit Breaker**
   ```typescript
   // Manually reset if needed (in debug mode)
   node.network.resetCircuitBreaker('peer-node-id');
   ```

2. **Adjust Thresholds**
   ```typescript
   const config = {
     circuitBreaker: {
       errorThresholdPercentage: 70, // Increase from 50
       resetTimeout: 60000,          // Give more time
     }
   };
   ```

### Storage Issues

#### Problem: Redis Connection Lost

**Symptoms:**
- "Redis connection refused" errors
- State not persisting

**Solutions:**

1. **Implement Reconnection**
   ```typescript
   const redis = new Redis({
     host: config.redis.host,
     port: config.redis.port,
     retryStrategy: (times) => {
       const delay = Math.min(times * 50, 2000);
       return delay;
     },
   });
   ```

2. **Use Redis Sentinel**
   ```typescript
   const redis = new Redis({
     sentinels: [
       { host: 'sentinel1', port: 26379 },
       { host: 'sentinel2', port: 26379 },
     ],
     name: 'mymaster',
   });
   ```

#### Problem: WAL Corruption

**Symptoms:**
- Node fails to start
- "Invalid checksum" errors

**Recovery:**

1. **Try Recovery**
   ```typescript
   // The library attempts automatic recovery
   // Check logs for recovery status
   ```

2. **Manual Recovery**
   ```bash
   # Backup corrupted WAL
   mv /var/lib/raft/wal /var/lib/raft/wal.corrupt
   
   # Start fresh (will sync from peers)
   ```

3. **Restore from Snapshot**
   ```typescript
   // If available, restore from latest snapshot
   const snapshot = await storage.loadLatestSnapshot();
   await node.restoreFromSnapshot(snapshot);
   ```

### Performance Problems

#### Problem: High CPU Usage

**Symptoms:**
- CPU consistently above 80%
- Slow response times

**Solutions:**

1. **Profile the Application**
   ```bash
   # Use Node.js profiler
   node --prof app.js
   node --prof-process isolate-*.log > profile.txt
   ```

2. **Optimize Hot Paths**
   ```typescript
   // Enable batching
   const batcher = new BatchProcessor(node);
   
   // Use batched operations
   await batcher.execute(command);
   ```

3. **Reduce Log Verbosity**
   ```typescript
   const config = {
     logging: {
       level: LogLevel.WARN, // Reduce from INFO/DEBUG
     }
   };
   ```

#### Problem: Memory Leaks

**Symptoms:**
- Memory usage growing over time
- Eventually OOM errors

**Debugging:**

1. **Take Heap Snapshots**
   ```javascript
   // In development
   const v8 = require('v8');
   const fs = require('fs');
   
   // Take snapshot
   const snapshot = v8.writeHeapSnapshot();
   console.log(`Heap snapshot: ${snapshot}`);
   ```

2. **Monitor Memory**
   ```typescript
   setInterval(() => {
     const usage = process.memoryUsage();
     console.log({
       rss: (usage.rss / 1024 / 1024).toFixed(2) + ' MB',
       heap: (usage.heapUsed / 1024 / 1024).toFixed(2) + ' MB',
     });
   }, 10000);
   ```

3. **Common Leak Sources**
   - Event listeners not removed
   - Timers not cleared
   - Large objects in closures

## Diagnostic Tools

### Built-in Diagnostics

```typescript
class RaftDiagnostics {
  async runDiagnostics(node: RaftNode): Promise<DiagnosticReport> {
    const report: DiagnosticReport = {
      timestamp: new Date(),
      nodeId: node.nodeId,
      checks: {},
    };
    
    // Check node state
    report.checks.nodeState = {
      state: node.getState(),
      term: node.getCurrentTerm(),
      status: node.getState() !== 'unknown' ? 'OK' : 'ERROR',
    };
    
    // Check peers
    const peers = node.getPeers();
    report.checks.peers = {
      count: peers.length,
      list: peers,
      status: peers.length >= 2 ? 'OK' : 'WARNING',
    };
    
    // Check storage
    try {
      await node.storage.ping();
      report.checks.storage = { status: 'OK' };
    } catch (error) {
      report.checks.storage = { 
        status: 'ERROR', 
        error: error.message 
      };
    }
    
    // Check metrics
    const metrics = node.getMetrics();
    if (metrics) {
      report.checks.metrics = {
        logLength: metrics.logLength,
        commitIndex: metrics.commitIndex,
        lastApplied: metrics.lastApplied,
        lag: metrics.commitIndex - metrics.lastApplied,
        status: metrics.commitIndex - metrics.lastApplied < 100 ? 'OK' : 'WARNING',
      };
    }
    
    return report;
  }
}
```

### Debug Mode

Enable comprehensive debugging:

```typescript
const config = {
  debug: {
    enabled: true,
    verboseLogging: true,
    traceMessages: true,
    slowLogThreshold: 100,
  },
  logging: {
    level: LogLevel.DEBUG,
  },
};
```

### Log Analysis

```bash
# Common log patterns to search for

# Election issues
grep -i "election" raft.log | tail -20

# Network errors
grep -E "(timeout|refused|error)" raft.log | tail -50

# State changes
grep "state.*change" raft.log

# Slow operations
grep "slow.*operation" raft.log
```

## Error Messages

### Common Errors and Solutions

#### "Only leader can append logs"

**Meaning:** Trying to write to a non-leader node

**Solution:**
```typescript
// Find and use the leader
const leader = findLeader(engine);
if (leader) {
  await leader.appendLog(command);
} else {
  // No leader available, retry later
}
```

#### "Node not found"

**Meaning:** Trying to operate on non-existent node

**Solution:**
```typescript
// Check node exists before operations
if (engine.getNode(nodeId)) {
  await engine.startNode(nodeId);
} else {
  console.error(`Node ${nodeId} does not exist`);
}
```

#### "Circuit breaker is OPEN"

**Meaning:** Too many failures to a peer

**Solution:**
```typescript
// Wait for circuit breaker to reset
// Or adjust configuration
const config = {
  circuitBreaker: {
    resetTimeout: 60000, // Increase reset time
    errorThresholdPercentage: 70, // Increase threshold
  }
};
```

#### "Log entry not found"

**Meaning:** Attempting to access non-existent log entry

**Solution:**
```typescript
// This usually indicates corruption or sync issues
// 1. Check if node is syncing
// 2. Wait for replication to catch up
// 3. If persistent, trigger snapshot recovery
```

## Recovery Procedures

### Single Node Recovery

When a single node fails:

```typescript
async function recoverNode(engine: RaftEngine, nodeId: string) {
  try {
    // 1. Stop the failed node if running
    try {
      await engine.stopNode(nodeId);
    } catch (e) {
      // Node might already be stopped
    }
    
    // 2. Clear local state if corrupted
    // This depends on your persistence setup
    
    // 3. Recreate and start node
    const config = createNodeConfig(nodeId);
    await engine.createNode(config);
    await engine.startNode(nodeId);
    
    // 4. Wait for sync
    await waitForSync(engine.getNode(nodeId));
    
    console.log(`Node ${nodeId} recovered`);
  } catch (error) {
    console.error(`Failed to recover ${nodeId}:`, error);
  }
}

async function waitForSync(node: RaftNode, timeout = 30000) {
  const start = Date.now();
  
  while (Date.now() - start < timeout) {
    const metrics = node.getMetrics();
    if (metrics && metrics.commitIndex > 0) {
      return; // Node is syncing
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  throw new Error('Sync timeout');
}
```

### Cluster Recovery

When majority of nodes fail:

```typescript
async function recoverCluster(configs: RaftConfiguration[]) {
  const engine = new RaftEngine();
  
  // 1. Start nodes one by one
  for (const config of configs) {
    try {
      const node = await engine.createNode(config);
      await engine.startNode(config.nodeId);
      console.log(`Started ${config.nodeId}`);
      
      // Wait a bit between nodes
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (error) {
      console.error(`Failed to start ${config.nodeId}:`, error);
    }
  }
  
  // 2. Wait for leader election
  await waitForLeader(engine, 60000);
  
  // 3. Verify cluster health
  const health = await checkClusterHealth(engine);
  console.log('Cluster health:', health);
}

async function waitForLeader(engine: RaftEngine, timeout: number) {
  const start = Date.now();
  
  while (Date.now() - start < timeout) {
    const nodes = engine.getAllNodes();
    for (const [_, node] of nodes) {
      if (node.getState() === RaftState.LEADER) {
        console.log('Leader elected');
        return;
      }
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  throw new Error('No leader elected');
}
```

### Data Recovery

When data is lost or corrupted:

```typescript
class DataRecovery {
  async recoverFromSnapshot(
    node: RaftNode, 
    snapshotPath: string
  ): Promise<void> {
    // 1. Load snapshot
    const snapshot = await this.loadSnapshot(snapshotPath);
    
    // 2. Validate snapshot
    if (!this.validateSnapshot(snapshot)) {
      throw new Error('Invalid snapshot');
    }
    
    // 3. Stop node
    await node.stop();
    
    // 4. Clear current state
    await this.clearNodeState(node);
    
    // 5. Restore snapshot
    await node.restoreFromSnapshot(snapshot);
    
    // 6. Restart node
    await node.start();
  }
  
  async recoverFromPeer(
    failedNode: RaftNode,
    healthyPeer: RaftNode
  ): Promise<void> {
    // 1. Get snapshot from healthy peer
    const snapshot = await healthyPeer.createSnapshot();
    
    // 2. Transfer to failed node
    await failedNode.installSnapshot(snapshot);
    
    // 3. Catch up remaining logs
    await this.syncLogs(failedNode, healthyPeer);
  }
}
```

## FAQ

### Q: How many nodes should I run?

**A:** Use odd numbers (3, 5, 7) to avoid split-brain:
- 3 nodes: Tolerates 1 failure
- 5 nodes: Tolerates 2 failures
- 7 nodes: Tolerates 3 failures

### Q: What happens during network partition?

**A:** RAFT ensures safety:
- Minority partition: Nodes become followers, can't accept writes
- Majority partition: Can elect leader and continue operating
- After partition heals: Minority nodes sync with majority

### Q: How do I scale reads?

**A:** Several options:
1. Read from followers (eventually consistent)
2. Use learner nodes (non-voting replicas)
3. Implement read leases on leader
4. Use consistent reads through leader

### Q: Can I change node configuration at runtime?

**A:** Some configurations can be updated:
```typescript
// Update log level
node.updateLogLevel(LogLevel.DEBUG);

// Other configs require restart
```

### Q: How do I monitor cluster health?

**A:** Use built-in health checks:
```typescript
app.get('/health/cluster', async (req, res) => {
  const nodes = engine.getAllNodes();
  let leaders = 0;
  let healthy = 0;
  
  for (const [id, node] of nodes) {
    if (node.getState() === RaftState.LEADER) leaders++;
    if (node.getMetrics()) healthy++;
  }
  
  const status = leaders === 1 && healthy === nodes.size 
    ? 'healthy' 
    : 'degraded';
    
  res.json({ status, leaders, healthy, total: nodes.size });
});
```

### Q: What's the maximum cluster size?

**A:** Practical limits:
- 3-7 nodes: Optimal for most use cases
- 9-11 nodes: Possible but slower consensus
- >11 nodes: Not recommended, consider sharding

### Q: How do I debug message flow?

**A:** Enable message tracing:
```typescript
node.on('messageSent', (msg) => {
  console.log(`→ ${msg.to}: ${msg.type}`);
});

node.on('messageReceived', (msg) => {
  console.log(`← ${msg.from}: ${msg.type}`);
});
```

### Q: What causes "split brain"?

**A:** Split brain (multiple leaders) is prevented by:
- Majority requirement for elections
- Term numbers for ordering
- Persistent voted-for state

If you see multiple leaders, check:
1. Clock synchronization
2. Network connectivity
3. Persistent storage consistency

## Best Practices for Troubleshooting

1. **Enable Appropriate Logging**
   - Use INFO in production
   - Use DEBUG for troubleshooting
   - Structure logs for easy parsing

2. **Monitor Key Metrics**
   - Leader changes
   - Election frequency
   - Replication lag
   - Network errors

3. **Test Failure Scenarios**
   - Kill nodes randomly
   - Simulate network partitions
   - Test recovery procedures

4. **Document Issues**
   - Keep runbooks for common issues
   - Document cluster-specific configurations
   - Track recurring problems

5. **Preventive Measures**
   - Regular health checks
   - Automated alerting
   - Capacity planning
   - Regular backups

## Getting Help

If you can't resolve an issue:

1. Check the [GitHub Issues](https://github.com/ali-master/raft/issues)
2. Enable debug logging and collect logs
3. Run diagnostics and include output
4. Provide cluster configuration
5. Describe steps to reproduce

Include this information when reporting issues:
- RAFT library version
- Node.js version
- Cluster size and topology
- Error messages and stack traces
- Relevant configuration
- Steps to reproduce