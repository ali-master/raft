# Monitoring and Observability

This guide covers monitoring, metrics collection, debugging, and observability features of the RAFT library.

## Table of Contents

- [Overview](#overview)
- [Built-in Metrics](#built-in-metrics)
- [Prometheus Integration](#prometheus-integration)
- [Logging](#logging)
- [Event Monitoring](#event-monitoring)
- [Health Checks](#health-checks)
- [Debugging Tools](#debugging-tools)
- [Performance Monitoring](#performance-monitoring)
- [Alerting](#alerting)
- [Dashboards](#dashboards)
- [Distributed Tracing](#distributed-tracing)

## Overview

RAFT provides comprehensive monitoring capabilities:

- **Metrics**: Internal and Prometheus-compatible metrics
- **Logging**: Structured logging with multiple levels
- **Events**: Rich event system for cluster state changes
- **Health Checks**: Built-in health endpoints
- **Tracing**: Distributed tracing support

## Built-in Metrics

### Internal Metrics

The library collects various metrics automatically:

```typescript
interface RaftMetrics {
  // Node State
  nodeId: string
  state: RaftState
  term: number
  
  // Log Metrics
  commitIndex: number
  lastApplied: number
  logLength: number
  
  // Network Metrics
  peers: number
  messagesReceived: number
  messagesSent: number
  averageRPCLatency: number
  
  // Election Metrics
  electionsStarted: number
  votesGranted: number
  lastElectionTime: Date
  
  // System Metrics
  systemMetrics: SystemMetricsSnapshot
}
```

### Accessing Metrics

```typescript
// Get metrics for a specific node
const metrics = node.getMetrics();
if (metrics) {
  console.log('Current state:', metrics.state);
  console.log('Log length:', metrics.logLength);
  console.log('Commit index:', metrics.commitIndex);
}

// Monitor metrics continuously
setInterval(() => {
  const metrics = node.getMetrics();
  console.log(JSON.stringify(metrics, null, 2));
}, 5000);
```

### System Metrics

System resource metrics are also collected:

```typescript
interface SystemMetricsSnapshot {
  timestamp: Date
  cpuUsage: number         // Percentage (0-100)
  memoryUsage: number      // Percentage (0-100)
  diskUsage: number        // Percentage (0-100)
  networkLatency: number   // Milliseconds
  loadAverage: [number, number, number]
  uptime: number          // Seconds
}
```

## Prometheus Integration

### Enabling Prometheus Metrics

```typescript
const config: RaftConfiguration = {
  // ... other config
  metrics: {
    enablePrometheus: true,
    enableInternal: true,
    collectionInterval: 5000,
  }
};
```

### Available Prometheus Metrics

```prometheus
# Node state (0=follower, 1=candidate, 2=leader)
raft_node_state{node_id="node-1", cluster_id="my-cluster"} 2

# Current term
raft_term_total{node_id="node-1", cluster_id="my-cluster"} 42

# Log metrics
raft_log_size{node_id="node-1", cluster_id="my-cluster"} 1523
raft_commit_index{node_id="node-1", cluster_id="my-cluster"} 1520
raft_last_applied{node_id="node-1", cluster_id="my-cluster"} 1519

# Network metrics
raft_messages_sent_total{node_id="node-1", type="append_entries"} 4532
raft_messages_received_total{node_id="node-1", type="vote_request"} 23
raft_rpc_latency_seconds{node_id="node-1", peer="node-2", quantile="0.5"} 0.012

# Election metrics
raft_elections_total{node_id="node-1", cluster_id="my-cluster"} 5
raft_election_timeout_seconds{node_id="node-1"} 0.250

# Error metrics
raft_errors_total{node_id="node-1", type="network"} 12
raft_errors_total{node_id="node-1", type="storage"} 0
```

### Exposing Metrics Endpoint

```typescript
import express from 'express';
import { RaftEngine } from '@usex/raft';

const app = express();
const engine = new RaftEngine();

// Prometheus metrics endpoint
app.get('/metrics', async (req, res) => {
  try {
    const nodeId = req.query.nodeId as string;
    const node = engine.getNode(nodeId);
    
    if (!node) {
      return res.status(404).send('Node not found');
    }
    
    const metrics = await node.getPrometheusMetrics();
    res.set('Content-Type', 'text/plain');
    res.send(metrics);
  } catch (error) {
    res.status(500).send('Error collecting metrics');
  }
});

app.listen(9090);
```

### Prometheus Configuration

```yaml
# prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'raft-cluster'
    static_configs:
      - targets:
        - 'node1:9090'
        - 'node2:9090'
        - 'node3:9090'
    params:
      nodeId: ['node-1', 'node-2', 'node-3']
```

## Logging

### Log Levels

Configure logging levels:

```typescript
enum LogLevel {
  DEBUG = "debug",   // Detailed debugging information
  INFO = "info",     // General informational messages
  WARN = "warn",     // Warning messages
  ERROR = "error",   // Error messages
  FATAL = "fatal"    // Fatal errors that cause shutdown
}

const config: RaftConfiguration = {
  // ... other config
  logging: {
    level: LogLevel.INFO,
    enableStructured: true,
    redactedFields: ['password', 'token', 'secret'],
    enableConsole: true,
    enableFile: true,
    filePath: '/var/log/raft/node.log'
  }
};
```

### Structured Logging

The library uses structured logging for easy parsing:

```json
{
  "timestamp": "2024-01-15T10:30:45.123Z",
  "level": "info",
  "nodeId": "node-1",
  "clusterId": "my-cluster",
  "message": "State changed",
  "data": {
    "previousState": "follower",
    "newState": "candidate",
    "term": 42
  }
}
```

### Custom Logging

Implement custom logging handlers:

```typescript
class CustomLogger extends RaftLogger {
  log(level: LogLevel, message: string, data?: any): void {
    // Send to external logging service
    this.sendToElasticsearch({
      '@timestamp': new Date(),
      level,
      message,
      ...data,
      environment: process.env.NODE_ENV,
      service: 'raft-cluster'
    });
  }
}
```

### Log Categories

Different categories of logs:

1. **Consensus Logs**
   ```
   [INFO] Election started for term 42
   [INFO] Received vote from node-2 (granted: true)
   [INFO] Elected as leader for term 42
   ```

2. **Replication Logs**
   ```
   [DEBUG] Appending entry at index 1523
   [DEBUG] Replicating to 2 followers
   [INFO] Entry 1523 committed
   ```

3. **Network Logs**
   ```
   [DEBUG] Sending AppendEntries to node-2
   [WARN] RPC timeout to node-3 (attempt 1/3)
   [ERROR] Failed to connect to node-3: Connection refused
   ```

4. **Storage Logs**
   ```
   [INFO] WAL segment rotated (size: 10MB)
   [INFO] Snapshot created at index 1000
   [DEBUG] Log compacted, removed 500 entries
   ```

## Event Monitoring

### Available Events

Monitor cluster events in real-time:

```typescript
// State changes
node.on('stateChange', ({ state, term, previousState }) => {
  console.log(`State transition: ${previousState} -> ${state} (term: ${term})`);
});

// Leader elections
node.on('leaderElected', ({ leaderId, term }) => {
  console.log(`New leader elected: ${leaderId} for term ${term}`);
});

// Log replication
node.on('logReplicated', ({ index, command, term }) => {
  console.log(`Log entry ${index} replicated successfully`);
});

// Peer events
node.on('peerDiscovered', ({ nodeId, address }) => {
  console.log(`New peer discovered: ${nodeId} at ${address}`);
});

node.on('peerLost', ({ nodeId, lastSeen }) => {
  console.log(`Lost connection to peer: ${nodeId}`);
});

// Error events
node.on('error', (error) => {
  console.error('Node error:', error);
});
```

### Event Aggregation

Aggregate events for analysis:

```typescript
class EventAggregator {
  private eventCounts: Map<string, number> = new Map();
  private eventTimings: Map<string, number[]> = new Map();
  
  constructor(node: RaftNode) {
    this.setupEventListeners(node);
  }
  
  private setupEventListeners(node: RaftNode) {
    // Count events
    node.on('stateChange', () => this.increment('stateChange'));
    node.on('leaderElected', () => this.increment('leaderElected'));
    node.on('logReplicated', () => this.increment('logReplicated'));
    
    // Track election timing
    let electionStart: number;
    node.on('electionStarted', () => {
      electionStart = Date.now();
    });
    
    node.on('leaderElected', () => {
      if (electionStart) {
        const duration = Date.now() - electionStart;
        this.recordTiming('electionDuration', duration);
      }
    });
  }
  
  private increment(event: string) {
    this.eventCounts.set(event, (this.eventCounts.get(event) || 0) + 1);
  }
  
  private recordTiming(event: string, duration: number) {
    const timings = this.eventTimings.get(event) || [];
    timings.push(duration);
    this.eventTimings.set(event, timings);
  }
  
  getStatistics() {
    const stats: any = {
      counts: Object.fromEntries(this.eventCounts),
      timings: {}
    };
    
    for (const [event, timings] of this.eventTimings) {
      stats.timings[event] = {
        avg: timings.reduce((a, b) => a + b, 0) / timings.length,
        min: Math.min(...timings),
        max: Math.max(...timings),
        p95: this.percentile(timings, 0.95)
      };
    }
    
    return stats;
  }
}
```

## Health Checks

### Basic Health Check

```typescript
app.get('/health', async (req, res) => {
  const node = engine.getNode(nodeId);
  
  if (!node) {
    return res.status(404).json({ status: 'error', message: 'Node not found' });
  }
  
  const metrics = node.getMetrics();
  const isHealthy = metrics && node.getState() !== 'unknown';
  
  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'healthy' : 'unhealthy',
    node: {
      id: nodeId,
      state: node.getState(),
      term: node.getCurrentTerm(),
      peers: node.getPeers().length
    }
  });
});
```

### Detailed Health Check

```typescript
interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy'
  checks: {
    consensus: HealthStatus
    storage: HealthStatus
    network: HealthStatus
    resources: HealthStatus
  }
  details: any
}

class HealthChecker {
  async performHealthCheck(node: RaftNode): Promise<HealthCheckResult> {
    const checks = await Promise.all([
      this.checkConsensus(node),
      this.checkStorage(node),
      this.checkNetwork(node),
      this.checkResources(node)
    ]);
    
    const [consensus, storage, network, resources] = checks;
    
    // Determine overall status
    const statuses = checks.map(c => c.status);
    let overallStatus: 'healthy' | 'degraded' | 'unhealthy';
    
    if (statuses.every(s => s === 'healthy')) {
      overallStatus = 'healthy';
    } else if (statuses.some(s => s === 'unhealthy')) {
      overallStatus = 'unhealthy';
    } else {
      overallStatus = 'degraded';
    }
    
    return {
      status: overallStatus,
      checks: { consensus, storage, network, resources },
      details: {
        timestamp: new Date(),
        nodeId: node.nodeId,
        uptime: process.uptime()
      }
    };
  }
  
  private async checkConsensus(node: RaftNode): Promise<HealthStatus> {
    const state = node.getState();
    const peers = node.getPeers();
    
    if (state === 'unknown') {
      return { status: 'unhealthy', message: 'Node in unknown state' };
    }
    
    if (peers.length === 0 && state !== 'leader') {
      return { status: 'unhealthy', message: 'No peers visible' };
    }
    
    return { status: 'healthy' };
  }
  
  private async checkStorage(node: RaftNode): Promise<HealthStatus> {
    try {
      // Check Redis connectivity
      await node.storage.ping();
      
      // Check disk space
      const diskUsage = await this.getDiskUsage();
      if (diskUsage > 90) {
        return { status: 'degraded', message: 'Low disk space' };
      }
      
      return { status: 'healthy' };
    } catch (error) {
      return { status: 'unhealthy', message: 'Storage unavailable' };
    }
  }
  
  private async checkNetwork(node: RaftNode): Promise<HealthStatus> {
    const metrics = node.getMetrics();
    if (!metrics) {
      return { status: 'unhealthy', message: 'No metrics available' };
    }
    
    // Check network errors
    const errorRate = metrics.networkErrors / metrics.messagesSent;
    if (errorRate > 0.1) {
      return { status: 'degraded', message: 'High network error rate' };
    }
    
    // Check latency
    if (metrics.averageRPCLatency > 1000) {
      return { status: 'degraded', message: 'High network latency' };
    }
    
    return { status: 'healthy' };
  }
  
  private async checkResources(node: RaftNode): Promise<HealthStatus> {
    const metrics = node.getMetrics();
    if (!metrics || !metrics.systemMetrics) {
      return { status: 'unhealthy', message: 'No system metrics' };
    }
    
    const { cpuUsage, memoryUsage } = metrics.systemMetrics;
    
    if (cpuUsage > 90 || memoryUsage > 90) {
      return { status: 'unhealthy', message: 'High resource usage' };
    }
    
    if (cpuUsage > 70 || memoryUsage > 70) {
      return { status: 'degraded', message: 'Elevated resource usage' };
    }
    
    return { status: 'healthy' };
  }
}
```

## Debugging Tools

### Debug Mode

Enable debug mode for detailed information:

```typescript
const config: RaftConfiguration = {
  // ... other config
  debug: {
    enabled: true,
    verboseLogging: true,
    traceMessages: true,
    slowLogThreshold: 100, // Log operations slower than 100ms
  }
};
```

### Message Tracing

Trace all messages between nodes:

```typescript
class MessageTracer {
  private traces: MessageTrace[] = [];
  
  traceMessage(
    from: string,
    to: string,
    type: MessageType,
    request: any,
    response?: any
  ) {
    const trace: MessageTrace = {
      id: generateId(),
      timestamp: new Date(),
      from,
      to,
      type,
      request,
      response,
      duration: 0
    };
    
    this.traces.push(trace);
    
    // Keep only last 1000 traces
    if (this.traces.length > 1000) {
      this.traces.shift();
    }
  }
  
  getTraces(filter?: {
    from?: string,
    to?: string,
    type?: MessageType,
    since?: Date
  }): MessageTrace[] {
    return this.traces.filter(trace => {
      if (filter?.from && trace.from !== filter.from) return false;
      if (filter?.to && trace.to !== filter.to) return false;
      if (filter?.type && trace.type !== filter.type) return false;
      if (filter?.since && trace.timestamp < filter.since) return false;
      return true;
    });
  }
}
```

### State History

Track state transitions:

```typescript
class StateHistory {
  private history: StateTransition[] = [];
  
  recordTransition(
    nodeId: string,
    from: RaftState,
    to: RaftState,
    term: number,
    reason: string
  ) {
    this.history.push({
      nodeId,
      from,
      to,
      term,
      reason,
      timestamp: new Date()
    });
  }
  
  getHistory(nodeId?: string): StateTransition[] {
    if (nodeId) {
      return this.history.filter(h => h.nodeId === nodeId);
    }
    return this.history;
  }
  
  analyzeStability(): StabilityAnalysis {
    const now = Date.now();
    const recentHistory = this.history.filter(
      h => now - h.timestamp.getTime() < 300000 // Last 5 minutes
    );
    
    return {
      totalTransitions: recentHistory.length,
      leaderChanges: recentHistory.filter(h => h.to === 'leader').length,
      averageTermDuration: this.calculateAverageTermDuration(),
      stability: recentHistory.length < 10 ? 'stable' : 'unstable'
    };
  }
}
```

## Performance Monitoring

### Operation Timing

Track operation performance:

```typescript
class PerformanceMonitor {
  private timings: Map<string, number[]> = new Map();
  
  async measureOperation<T>(
    name: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const start = process.hrtime.bigint();
    
    try {
      const result = await operation();
      const duration = Number(process.hrtime.bigint() - start) / 1e6; // ms
      
      this.recordTiming(name, duration);
      
      if (duration > this.slowLogThreshold) {
        console.warn(`Slow operation: ${name} took ${duration}ms`);
      }
      
      return result;
    } catch (error) {
      const duration = Number(process.hrtime.bigint() - start) / 1e6;
      this.recordTiming(`${name}_error`, duration);
      throw error;
    }
  }
  
  private recordTiming(operation: string, duration: number) {
    const timings = this.timings.get(operation) || [];
    timings.push(duration);
    
    // Keep last 1000 timings
    if (timings.length > 1000) {
      timings.shift();
    }
    
    this.timings.set(operation, timings);
  }
  
  getStatistics(operation: string): PerformanceStats {
    const timings = this.timings.get(operation) || [];
    
    if (timings.length === 0) {
      return { count: 0 };
    }
    
    const sorted = [...timings].sort((a, b) => a - b);
    
    return {
      count: timings.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: timings.reduce((a, b) => a + b, 0) / timings.length,
      p50: this.percentile(sorted, 0.5),
      p95: this.percentile(sorted, 0.95),
      p99: this.percentile(sorted, 0.99)
    };
  }
}
```

### Resource Monitoring

Monitor resource usage:

```typescript
class ResourceMonitor {
  private samples: ResourceSample[] = [];
  
  startMonitoring(interval: number = 5000) {
    setInterval(() => {
      this.collectSample();
    }, interval);
  }
  
  private collectSample() {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    this.samples.push({
      timestamp: new Date(),
      memory: {
        rss: memUsage.rss,
        heapTotal: memUsage.heapTotal,
        heapUsed: memUsage.heapUsed,
        external: memUsage.external
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system
      },
      eventLoop: this.measureEventLoopLag()
    });
    
    // Keep last hour of samples
    const cutoff = Date.now() - 3600000;
    this.samples = this.samples.filter(s => s.timestamp.getTime() > cutoff);
  }
  
  private measureEventLoopLag(): number {
    const start = process.hrtime();
    setImmediate(() => {
      const [seconds, nanoseconds] = process.hrtime(start);
      return seconds * 1000 + nanoseconds / 1e6;
    });
    return 0;
  }
  
  getResourceReport(): ResourceReport {
    if (this.samples.length === 0) {
      return { error: 'No samples collected' };
    }
    
    const latest = this.samples[this.samples.length - 1];
    const memoryTrend = this.calculateTrend(this.samples.map(s => s.memory.heapUsed));
    
    return {
      current: latest,
      trends: {
        memory: memoryTrend,
        cpu: this.calculateCPUTrend()
      },
      alerts: this.checkResourceAlerts(latest)
    };
  }
}
```

## Alerting

### Alert Rules

Define alert rules for monitoring:

```typescript
interface AlertRule {
  name: string
  condition: (metrics: RaftMetrics) => boolean
  severity: 'warning' | 'error' | 'critical'
  message: (metrics: RaftMetrics) => string
}

const alertRules: AlertRule[] = [
  {
    name: 'NoLeader',
    condition: (m) => m.state !== 'leader' && m.peers > 0,
    severity: 'critical',
    message: (m) => `Cluster has no leader for ${m.timeSinceLeader}s`
  },
  {
    name: 'HighCPU',
    condition: (m) => m.systemMetrics?.cpuUsage > 80,
    severity: 'warning',
    message: (m) => `CPU usage is ${m.systemMetrics.cpuUsage}%`
  },
  {
    name: 'LogLag',
    condition: (m) => m.commitIndex - m.lastApplied > 100,
    severity: 'warning',
    message: (m) => `Log apply lag: ${m.commitIndex - m.lastApplied} entries`
  },
  {
    name: 'NetworkErrors',
    condition: (m) => m.networkErrorRate > 0.05,
    severity: 'error',
    message: (m) => `High network error rate: ${(m.networkErrorRate * 100).toFixed(1)}%`
  }
];
```

### Alert Manager

```typescript
class AlertManager {
  private activeAlerts: Map<string, Alert> = new Map();
  private alertHandlers: AlertHandler[] = [];
  
  checkAlerts(metrics: RaftMetrics) {
    for (const rule of alertRules) {
      const alertKey = `${metrics.nodeId}:${rule.name}`;
      
      if (rule.condition(metrics)) {
        if (!this.activeAlerts.has(alertKey)) {
          // New alert
          const alert: Alert = {
            id: generateId(),
            rule: rule.name,
            nodeId: metrics.nodeId,
            severity: rule.severity,
            message: rule.message(metrics),
            startTime: new Date(),
            acknowledged: false
          };
          
          this.activeAlerts.set(alertKey, alert);
          this.notifyHandlers('alert_raised', alert);
        }
      } else if (this.activeAlerts.has(alertKey)) {
        // Alert resolved
        const alert = this.activeAlerts.get(alertKey)!;
        this.activeAlerts.delete(alertKey);
        this.notifyHandlers('alert_resolved', alert);
      }
    }
  }
  
  private notifyHandlers(event: string, alert: Alert) {
    for (const handler of this.alertHandlers) {
      handler.handle(event, alert);
    }
  }
  
  addHandler(handler: AlertHandler) {
    this.alertHandlers.push(handler);
  }
}

// Example handlers
class SlackAlertHandler implements AlertHandler {
  async handle(event: string, alert: Alert) {
    if (alert.severity === 'critical') {
      await this.sendSlackMessage({
        channel: '#alerts',
        text: `🚨 ${alert.rule}: ${alert.message}`,
        color: 'danger'
      });
    }
  }
}

class EmailAlertHandler implements AlertHandler {
  async handle(event: string, alert: Alert) {
    if (event === 'alert_raised' && alert.severity !== 'warning') {
      await this.sendEmail({
        to: 'ops@example.com',
        subject: `RAFT Alert: ${alert.rule}`,
        body: alert.message
      });
    }
  }
}
```

## Dashboards

### Grafana Dashboard

Example Grafana dashboard configuration:

```json
{
  "dashboard": {
    "title": "RAFT Cluster Monitoring",
    "panels": [
      {
        "title": "Node States",
        "targets": [{
          "expr": "raft_node_state",
          "legendFormat": "{{node_id}}"
        }]
      },
      {
        "title": "Log Growth Rate",
        "targets": [{
          "expr": "rate(raft_log_size[5m])",
          "legendFormat": "{{node_id}}"
        }]
      },
      {
        "title": "RPC Latency",
        "targets": [{
          "expr": "histogram_quantile(0.95, raft_rpc_latency_seconds)",
          "legendFormat": "p95 {{node_id}}"
        }]
      },
      {
        "title": "Election Frequency",
        "targets": [{
          "expr": "rate(raft_elections_total[5m]) * 60",
          "legendFormat": "{{node_id}}"
        }]
      }
    ]
  }
}
```

### Custom Dashboard

Build a custom monitoring dashboard:

```typescript
class MonitoringDashboard {
  private server: http.Server;
  private io: SocketIO.Server;
  private engine: RaftEngine;
  
  constructor(engine: RaftEngine) {
    this.engine = engine;
    this.setupServer();
    this.startMetricsCollection();
  }
  
  private setupServer() {
    const app = express();
    this.server = http.createServer(app);
    this.io = new SocketIO.Server(this.server);
    
    app.use(express.static('public'));
    
    // Real-time metrics endpoint
    this.io.on('connection', (socket) => {
      console.log('Dashboard client connected');
      
      // Send initial state
      this.sendClusterState(socket);
      
      // Subscribe to updates
      socket.on('subscribe', (nodeId: string) => {
        socket.join(`node:${nodeId}`);
      });
    });
  }
  
  private startMetricsCollection() {
    setInterval(() => {
      const nodes = this.engine.getAllNodes();
      
      for (const [nodeId, node] of nodes) {
        const metrics = node.getMetrics();
        if (metrics) {
          // Broadcast to subscribed clients
          this.io.to(`node:${nodeId}`).emit('metrics', metrics);
        }
      }
      
      // Send cluster-wide metrics
      this.io.emit('cluster_metrics', this.getClusterMetrics());
    }, 1000);
  }
  
  private getClusterMetrics() {
    const nodes = this.engine.getAllNodes();
    let leaders = 0;
    let followers = 0;
    let candidates = 0;
    
    for (const [_, node] of nodes) {
      switch (node.getState()) {
        case 'leader': leaders++; break;
        case 'follower': followers++; break;
        case 'candidate': candidates++; break;
      }
    }
    
    return {
      totalNodes: nodes.size,
      leaders,
      followers,
      candidates,
      healthy: leaders === 1
    };
  }
}
```

## Distributed Tracing

### OpenTelemetry Integration

```typescript
import { trace, context, SpanStatusCode } from '@opentelemetry/api';

class TracedRaftNode extends RaftNode {
  private tracer = trace.getTracer('raft-node');
  
  async appendLog(command: any): Promise<boolean> {
    const span = this.tracer.startSpan('appendLog');
    
    try {
      span.setAttributes({
        'raft.node_id': this.nodeId,
        'raft.state': this.getState(),
        'raft.term': this.getCurrentTerm()
      });
      
      const result = await context.with(
        trace.setSpan(context.active(), span),
        async () => {
          // Trace log append
          const appendSpan = this.tracer.startSpan('log.append');
          const index = await this.log.appendEntry(this.currentTerm, command);
          appendSpan.end();
          
          // Trace replication
          const replicationSpan = this.tracer.startSpan('log.replicate');
          await this.replicateLogToFollowers();
          replicationSpan.end();
          
          return true;
        }
      );
      
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  }
}
```

## Best Practices

### 1. Metrics Collection

- Collect metrics at regular intervals (5-10 seconds)
- Use histograms for latency measurements
- Track both success and error rates
- Monitor resource usage trends

### 2. Logging

- Use structured logging for easy parsing
- Include correlation IDs for request tracking
- Log at appropriate levels
- Implement log rotation

### 3. Alerting

- Define clear alert thresholds
- Avoid alert fatigue with proper severity levels
- Include context in alert messages
- Test alert rules regularly

### 4. Performance

- Monitor operation latencies
- Track resource usage patterns
- Identify bottlenecks early
- Use profiling for optimization

### 5. Debugging

- Enable debug mode in development
- Use distributed tracing for complex issues
- Maintain event history for analysis
- Implement comprehensive health checks

## Summary

Effective monitoring is crucial for operating RAFT clusters:

- Use built-in metrics and Prometheus integration
- Implement comprehensive health checks
- Set up alerting for critical conditions
- Use distributed tracing for debugging
- Create dashboards for visualization
- Monitor performance continuously

With proper monitoring, you can ensure your RAFT cluster operates reliably and efficiently.