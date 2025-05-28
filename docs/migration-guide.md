# Migration Guide

This guide helps you upgrade between different versions of the RAFT library with minimal disruption.

## Table of Contents

- [Version History](#version-history)
- [Migration Strategies](#migration-strategies)
- [Version-Specific Guides](#version-specific-guides)
- [Breaking Changes](#breaking-changes)
- [Deprecation Timeline](#deprecation-timeline)
- [Rollback Procedures](#rollback-procedures)
- [Testing Migrations](#testing-migrations)

## Version History

### Version Compatibility Matrix

| Version | Node.js | TypeScript | Redis | Breaking Changes  |
|---------|---------|-----------|-------|-------------------|
| 0.1.x   | ≥18.12  | ≥5.0      | ≥6.0  | Initial release   |
| 0.2.x   | ≥18.12  | ≥5.0      | ≥6.0  | Config schema     |
| 0.3.x   | ≥18.12  | ≥5.0      | ≥6.0  | API changes       |
| 1.0.x   | ≥18.12  | ≥5.0      | ≥6.0  | Stable API        |

### Semantic Versioning

We follow semantic versioning:
- **Major**: Breaking changes requiring code updates
- **Minor**: New features, backward compatible
- **Patch**: Bug fixes, backward compatible

## Migration Strategies

### Rolling Upgrade

Recommended for production environments:

```typescript
class RollingUpgrade {
  async performUpgrade(
    cluster: RaftCluster,
    newVersion: string
  ): Promise<void> {
    const nodes = cluster.getAllNodes();

    for (const nodeId of nodes) {
      // 1. Remove node from cluster
      await this.drainNode(nodeId);

      // 2. Upgrade node
      await this.upgradeNode(nodeId, newVersion);

      // 3. Add node back to cluster
      await this.rejoinNode(nodeId);

      // 4. Wait for sync
      await this.waitForSync(nodeId);

      // 5. Verify health before continuing
      await this.verifyNodeHealth(nodeId);
    }
  }

  private async drainNode(nodeId: string): Promise<void> {
    // Transfer leadership if needed
    const node = cluster.getNode(nodeId);
    if (node.getState() === RaftState.LEADER) {
      await this.transferLeadership(node);
    }

    // Stop accepting new requests
    await node.enterMaintenanceMode();

    // Wait for in-flight requests
    await this.waitForQuiescence(node);
  }

  private async upgradeNode(
    nodeId: string,
    version: string
  ): Promise<void> {
    // Stop old version
    await cluster.stopNode(nodeId);

    // Backup data
    await this.backupNodeData(nodeId);

    // Install new version
    await this.installVersion(nodeId, version);

    // Update configuration if needed
    await this.updateConfiguration(nodeId, version);
  }
}
```

### Blue-Green Migration

For zero-downtime migrations:

```typescript
class BlueGreenMigration {
  async migrate(
    blueCluster: RaftCluster,
    greenVersion: string
  ): Promise<RaftCluster> {
    // 1. Create green cluster with new version
    const greenCluster = await this.createGreenCluster(
      blueCluster.size,
      greenVersion
    );

    // 2. Sync data from blue to green
    await this.syncData(blueCluster, greenCluster);

    // 3. Switch traffic gradually
    await this.switchTraffic(blueCluster, greenCluster);

    // 4. Decommission blue cluster
    await this.decommissionCluster(blueCluster);

    return greenCluster;
  }

  private async syncData(
    source: RaftCluster,
    target: RaftCluster
  ): Promise<void> {
    // Get snapshot from source
    const snapshot = await source.createSnapshot();

    // Apply to target
    await target.restoreFromSnapshot(snapshot);

    // Set up real-time sync
    const syncHandler = new DataSyncHandler(source, target);
    await syncHandler.startSync();
  }
}
```

## Version-Specific Guides

### Migrating from 0.1.x to 0.2.x

**Breaking Changes:**
- Configuration schema updated
- Redis key prefix changed

**Migration Steps:**

1. **Update Configuration**
   ```typescript
   // Old (0.1.x)
   const config = {
     nodeId: 'node-1',
     redis: {
       host: 'localhost',
       port: 6379
     }
   };

   // New (0.2.x)
   const config = {
     nodeId: 'node-1',
     clusterId: 'my-cluster', // Now required
     redis: {
       host: 'localhost',
       port: 6379,
       keyPrefix: 'raft' // New option
     }
   };
   ```

2. **Migrate Redis Keys**
   ```typescript
   async function migrateRedisKeys(redis: Redis) {
     // Old pattern: node:*
     // New pattern: raft:cluster:*:node:*

     const oldKeys = await redis.keys('node:*');

     for (const oldKey of oldKeys) {
       const nodeId = oldKey.split(':')[1];
       const newKey = `raft:cluster:${clusterId}:node:${nodeId}`;

       const value = await redis.get(oldKey);
       await redis.set(newKey, value);
       await redis.del(oldKey);
     }
   }
   ```

### Migrating from 0.2.x to 0.3.x

**Breaking Changes:**
- API method signatures changed
- Event names updated

**Migration Steps:**

1. **Update Method Calls**
   ```typescript
   // Old (0.2.x)
   node.appendToLog(command);

   // New (0.3.x)
   await node.appendLog(command); // Now async
   ```

2. **Update Event Listeners**
   ```typescript
   // Old (0.2.x)
   node.on('state-change', handler);

   // New (0.3.x)
   node.on('stateChange', handler); // camelCase
   ```

3. **Update Type Imports**
   ```typescript
   // Old (0.2.x)
   import { RaftNode } from '@usex/raft/node';

   // New (0.3.x)
   import { RaftNode } from '@usex/raft'; // Flat exports
   ```

### Migrating to 1.0.x

**Major Release Notes:**
- Stable API guarantee
- Performance improvements
- New features added

**Migration Steps:**

1. **Review Deprecated APIs**
   ```typescript
   // Deprecated in 1.0
   node.getLeader(); // Use node.getLeaderId()
   node.getFollowers(); // Use node.getPeers()
   ```

2. **Update Error Handling**
   ```typescript
   // Old
   try {
     await node.appendLog(cmd);
   } catch (error) {
     if (error.code === 'NOT_LEADER') {
       // Handle
     }
   }

   // New (1.0.x)
   try {
     await node.appendLog(cmd);
   } catch (error) {
     if (error instanceof RaftValidationException) {
       // More specific error types
     }
   }
   ```

## Breaking Changes

### Configuration Changes

Track configuration changes across versions:

```typescript
class ConfigurationMigrator {
  migrate(oldConfig: any, fromVersion: string, toVersion: string): RaftConfiguration {
    let config = { ...oldConfig };

    // Apply migrations in sequence
    const migrations = this.getMigrationPath(fromVersion, toVersion);

    for (const migration of migrations) {
      config = migration(config);
    }

    return config as RaftConfiguration;
  }

  private getMigrationPath(from: string, to: string): MigrationFn[] {
    const migrations: MigrationFn[] = [];

    if (this.needsMigration(from, '0.2.0', to)) {
      migrations.push(this.migrate_0_1_to_0_2);
    }

    if (this.needsMigration(from, '0.3.0', to)) {
      migrations.push(this.migrate_0_2_to_0_3);
    }

    if (this.needsMigration(from, '1.0.0', to)) {
      migrations.push(this.migrate_0_3_to_1_0);
    }

    return migrations;
  }

  private migrate_0_1_to_0_2(config: any): any {
    return {
      ...config,
      clusterId: config.clusterId || 'default-cluster',
      redis: {
        ...config.redis,
        keyPrefix: 'raft'
      }
    };
  }

  private migrate_0_2_to_0_3(config: any): any {
    // Rename fields
    if (config.election_timeout) {
      config.electionTimeout = config.election_timeout;
      delete config.election_timeout;
    }

    return config;
  }

  private migrate_0_3_to_1_0(config: any): any {
    // Add new required fields with defaults
    return {
      ...config,
      metrics: config.metrics || {
        enablePrometheus: false,
        enableInternal: true,
        collectionInterval: 5000
      }
    };
  }
}
```

### API Changes

Handle API changes gracefully:

```typescript
class APICompatibilityLayer {
  // Provide backward compatibility
  static createCompatibleNode(
    engine: RaftEngine,
    config: any,
    version: string
  ): CompatibleNode {
    const node = engine.createNode(config);

    if (version < '0.3.0') {
      // Add compatibility methods
      return new LegacyNodeWrapper(node);
    }

    return node;
  }
}

class LegacyNodeWrapper {
  constructor(private node: RaftNode) {}

  // Old synchronous API
  appendToLog(command: any): void {
    // Convert to new async API
    this.node.appendLog(command).catch(console.error);
  }

  // Old event names
  on(event: string, handler: Function): void {
    const eventMap = {
      'state-change': 'stateChange',
      'leader-elected': 'leaderElected',
      'peer-added': 'peerDiscovered'
    };

    const newEvent = eventMap[event] || event;
    this.node.on(newEvent, handler);
  }
}
```

## Deprecation Timeline

### Deprecation Policy

- Features are deprecated in minor versions
- Deprecated features removed in next major version
- Minimum 6 months deprecation notice

### Current Deprecations

```typescript
// Deprecated in 0.3.0, removed in 1.0.0
@deprecated('Use appendLog() instead')
appendToLog(command: any): void {
  console.warn('appendToLog is deprecated, use appendLog');
  return this.appendLog(command);
}

// Deprecated in 0.4.0, will be removed in 2.0.0
@deprecated('Use getLeaderId() instead')
getLeader(): string {
  console.warn('getLeader is deprecated, use getLeaderId');
  return this.getLeaderId();
}
```

### Future Deprecations

Track upcoming deprecations:

```typescript
interface Deprecation {
  feature: string;
  deprecatedIn: string;
  removeIn: string;
  alternative: string;
  description: string;
}

const deprecations: Deprecation[] = [
  {
    feature: 'node.getFollowers()',
    deprecatedIn: '1.1.0',
    removeIn: '2.0.0',
    alternative: 'node.getPeers()',
    description: 'Use getPeers for consistency'
  },
  {
    feature: 'config.redis_host',
    deprecatedIn: '1.2.0',
    removeIn: '2.0.0',
    alternative: 'config.redis.host',
    description: 'Use nested configuration'
  }
];
```

## Rollback Procedures

### Preparation

Before any migration:

```typescript
class MigrationPreparation {
  async prepare(cluster: RaftCluster): Promise<MigrationBackup> {
    const backup: MigrationBackup = {
      timestamp: new Date(),
      version: cluster.version,
      nodes: []
    };

    // 1. Create snapshots
    for (const [nodeId, node] of cluster.getAllNodes()) {
      const snapshot = await node.createSnapshot();
      backup.nodes.push({
        nodeId,
        snapshot,
        config: node.getConfiguration()
      });
    }

    // 2. Backup Redis data
    backup.redisBackup = await this.backupRedis(cluster);

    // 3. Document current state
    backup.clusterState = await this.documentClusterState(cluster);

    return backup;
  }
}
```

### Rollback Process

If migration fails:

```typescript
class RollbackManager {
  async rollback(
    cluster: RaftCluster,
    backup: MigrationBackup
  ): Promise<void> {
    console.log('Starting rollback to', backup.version);

    // 1. Stop all nodes
    await cluster.stopAllNodes();

    // 2. Restore Redis data
    await this.restoreRedis(backup.redisBackup);

    // 3. Downgrade binaries
    await this.downgradeVersion(backup.version);

    // 4. Restore node configurations
    for (const nodeBackup of backup.nodes) {
      await this.restoreNode(nodeBackup);
    }

    // 5. Start nodes
    for (const nodeBackup of backup.nodes) {
      await cluster.startNode(nodeBackup.nodeId);
    }

    // 6. Verify cluster health
    await this.verifyClusterHealth(cluster);
  }

  private async restoreNode(nodeBackup: NodeBackup): Promise<void> {
    // Restore configuration
    await this.writeConfig(nodeBackup.nodeId, nodeBackup.config);

    // Restore snapshot
    await this.restoreSnapshot(nodeBackup.nodeId, nodeBackup.snapshot);
  }
}
```

### Rollback Testing

Always test rollback procedures:

```typescript
class RollbackTest {
  async testRollback(): Promise<void> {
    // 1. Create test cluster with old version
    const oldCluster = await this.createTestCluster('0.2.0');

    // 2. Add test data
    await this.populateTestData(oldCluster);

    // 3. Create backup
    const backup = await this.createBackup(oldCluster);

    // 4. Migrate to new version
    const newCluster = await this.migrate(oldCluster, '0.3.0');

    // 5. Simulate failure
    await this.simulateFailure(newCluster);

    // 6. Perform rollback
    await this.rollback(newCluster, backup);

    // 7. Verify data integrity
    await this.verifyDataIntegrity(oldCluster);
  }
}
```

## Testing Migrations

### Migration Test Suite

Comprehensive testing for migrations:

```typescript
describe('Migration Tests', () => {
  let testCluster: TestCluster;

  beforeEach(async () => {
    testCluster = new TestCluster();
  });

  afterEach(async () => {
    await testCluster.cleanup();
  });

  describe('Configuration Migration', () => {
    it('should migrate 0.1.x config to 0.2.x', () => {
      const oldConfig = {
        nodeId: 'test-node',
        redis: { host: 'localhost', port: 6379 }
      };

      const migrator = new ConfigurationMigrator();
      const newConfig = migrator.migrate(oldConfig, '0.1.0', '0.2.0');

      expect(newConfig.clusterId).toBeDefined();
      expect(newConfig.redis.keyPrefix).toBe('raft');
    });
  });

  describe('API Compatibility', () => {
    it('should support old API with warnings', async () => {
      const warnSpy = jest.spyOn(console, 'warn');
      const node = new LegacyNodeWrapper(testNode);

      node.appendToLog({ test: 'data' });

      expect(warnSpy).toHaveBeenCalledWith(
        'appendToLog is deprecated, use appendLog'
      );
    });
  });

  describe('Data Migration', () => {
    it('should migrate Redis keys', async () => {
      // Setup old data
      await testCluster.redis.set('node:test', 'data');

      // Run migration
      await migrateRedisKeys(testCluster.redis);

      // Verify new structure
      const newKey = 'raft:cluster:test:node:test';
      const value = await testCluster.redis.get(newKey);
      expect(value).toBe('data');

      // Verify old key removed
      const oldValue = await testCluster.redis.get('node:test');
      expect(oldValue).toBeNull();
    });
  });

  describe('Rolling Upgrade', () => {
    it('should upgrade cluster without downtime', async () => {
      // Create cluster with old version
      const cluster = await testCluster.create('0.2.0', 3);

      // Track availability
      const availability = new AvailabilityTracker(cluster);
      availability.start();

      // Perform rolling upgrade
      const upgrader = new RollingUpgrade();
      await upgrader.performUpgrade(cluster, '0.3.0');

      // Check availability was maintained
      const report = availability.stop();
      expect(report.downtime).toBe(0);
      expect(report.availability).toBe(100);
    });
  });
});
```

### Performance Testing

Ensure migrations don't degrade performance:

```typescript
class MigrationPerformanceTest {
  async comparePerformance(
    oldVersion: string,
    newVersion: string
  ): Promise<PerformanceComparison> {
    // Test with old version
    const oldMetrics = await this.runBenchmark(oldVersion);

    // Test with new version
    const newMetrics = await this.runBenchmark(newVersion);

    return {
      oldVersion: { version: oldVersion, ...oldMetrics },
      newVersion: { version: newVersion, ...newMetrics },
      regression: this.detectRegression(oldMetrics, newMetrics)
    };
  }

  private async runBenchmark(version: string): Promise<Metrics> {
    const cluster = await this.createCluster(version);

    const metrics = {
      appendLatency: await this.measureAppendLatency(cluster),
      electionTime: await this.measureElectionTime(cluster),
      throughput: await this.measureThroughput(cluster),
      resourceUsage: await this.measureResourceUsage(cluster)
    };

    await cluster.destroy();
    return metrics;
  }
}
```

### Compatibility Matrix Testing

Test all supported version combinations:

```typescript
class CompatibilityTest {
  async testCompatibilityMatrix(): Promise<void> {
    const versions = ['0.1.0', '0.2.0', '0.3.0', '1.0.0'];

    for (const clientVersion of versions) {
      for (const serverVersion of versions) {
        if (this.shouldBeCompatible(clientVersion, serverVersion)) {
          await this.testCompatibility(clientVersion, serverVersion);
        }
      }
    }
  }

  private async testCompatibility(
    clientVersion: string,
    serverVersion: string
  ): Promise<void> {
    console.log(`Testing ${clientVersion} client with ${serverVersion} server`);

    const server = await this.createServer(serverVersion);
    const client = await this.createClient(clientVersion);

    try {
      await client.connect(server);
      await client.appendLog({ test: 'data' });
      console.log(`✓ ${clientVersion} ↔ ${serverVersion} compatible`);
    } catch (error) {
      console.error(`✗ ${clientVersion} ↔ ${serverVersion} incompatible:`, error);
      throw error;
    }
  }
}
```

## Best Practices

### Pre-Migration Checklist

- [ ] Read release notes and breaking changes
- [ ] Test migration in staging environment
- [ ] Create comprehensive backups
- [ ] Verify rollback procedures
- [ ] Schedule maintenance window
- [ ] Prepare monitoring and alerts
- [ ] Document migration steps
- [ ] Train operations team

### Migration Monitoring

Monitor key metrics during migration:

```typescript
class MigrationMonitor {
  private metrics: MigrationMetrics = {
    startTime: Date.now(),
    nodesUpgraded: 0,
    errors: [],
    warnings: []
  };

  monitor(cluster: RaftCluster): void {
    // Track progress
    cluster.on('nodeUpgraded', (nodeId) => {
      this.metrics.nodesUpgraded++;
      console.log(`Progress: ${this.metrics.nodesUpgraded}/${cluster.size}`);
    });

    // Track errors
    cluster.on('error', (error) => {
      this.metrics.errors.push({
        timestamp: Date.now(),
        error: error.message,
        stack: error.stack
      });
    });

    // Monitor cluster health
    setInterval(() => {
      const health = cluster.getHealth();
      if (health.status !== 'healthy') {
        this.metrics.warnings.push({
          timestamp: Date.now(),
          message: `Cluster unhealthy: ${health.reason}`
        });
      }
    }, 5000);
  }

  getReport(): MigrationReport {
    return {
      ...this.metrics,
      duration: Date.now() - this.metrics.startTime,
      success: this.metrics.errors.length === 0
    };
  }
}
```

### Post-Migration Validation

Verify successful migration:

```typescript
class PostMigrationValidator {
  async validate(cluster: RaftCluster): Promise<ValidationResult> {
    const checks = [
      this.checkClusterHealth(cluster),
      this.checkDataIntegrity(cluster),
      this.checkPerformance(cluster),
      this.checkBackwardCompatibility(cluster)
    ];

    const results = await Promise.all(checks);

    return {
      passed: results.every(r => r.passed),
      checks: results
    };
  }

  private async checkDataIntegrity(cluster: RaftCluster): Promise<Check> {
    // Verify data consistency across nodes
    const checksums = await Promise.all(
      cluster.getAllNodes().map(node => node.calculateChecksum())
    );

    const allMatch = checksums.every(cs => cs === checksums[0]);

    return {
      name: 'Data Integrity',
      passed: allMatch,
      details: allMatch ? 'All nodes have consistent data' : 'Data mismatch detected'
    };
  }
}
```

## Summary

Successful migrations require:
1. **Planning**: Understand changes and impacts
2. **Testing**: Validate in non-production first
3. **Monitoring**: Track progress and health
4. **Rollback**: Always have a way back
5. **Documentation**: Record lessons learned

Follow this guide to ensure smooth upgrades with minimal disruption to your RAFT clusters.
