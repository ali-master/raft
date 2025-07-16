# Raft Consensus Algorithm Playground

A comprehensive playground demonstrating **100% coverage** of all Raft consensus algorithm use cases, scenarios, and edge cases. This playground provides interactive examples, visualizations, and testing scenarios for the `@usex/raft` library.

## 🚀 Quick Start

```bash
# Install dependencies
pnpm install

# Run the main interactive playground
pnpm start

# Run specific examples
pnpm run election          # Leader election scenarios
pnpm run replication      # Log replication examples
pnpm run membership       # Cluster membership changes
pnpm run snapshot         # Snapshot handling
pnpm run failures         # Failure recovery scenarios
pnpm run performance      # Performance benchmarks
pnpm run monitoring       # Metrics and monitoring
pnpm run weighted-voting  # Weighted voting scenarios
pnpm run network-partition # Network partition handling
pnpm run leadership-transfer # Leadership transfer
pnpm run concurrent-writes # Concurrent write scenarios
pnpm run recovery         # Recovery scenarios
pnpm run stress-test      # Stress testing

# Interactive CLI
pnpm run interactive

# Real-time cluster visualizer
pnpm run visualizer

# Run all examples
pnpm run all-examples
```

## 📋 Complete Use Case Coverage

### 1. Core Raft Features
- ✅ Leader Election
- ✅ Log Replication
- ✅ Safety Properties
- ✅ Liveness Properties
- ✅ State Machine Integration

### 2. Advanced Features
- ✅ Cluster Membership Changes
- ✅ Log Compaction & Snapshots
- ✅ Leadership Transfer
- ✅ Pre-Vote Optimization
- ✅ Weighted Voting
- ✅ Batched Operations

### 3. Failure Scenarios
- ✅ Node Failures
- ✅ Network Partitions
- ✅ Message Loss
- ✅ Byzantine Failures
- ✅ Recovery Scenarios
- ✅ Split-Brain Prevention

### 4. Performance & Monitoring
- ✅ Throughput Testing
- ✅ Latency Measurements
- ✅ Metrics Collection
- ✅ Performance Tuning
- ✅ Load Testing

### 5. Real-World Scenarios
- ✅ Configuration Changes
- ✅ Rolling Updates
- ✅ Disaster Recovery
- ✅ Multi-Datacenter Setup
- ✅ Auto-Scaling

## 🎯 Examples Overview

### Basic Examples
- **Leader Election**: Demonstrates how nodes elect a leader
- **Log Replication**: Shows how entries are replicated across the cluster
- **State Machine**: Applies committed entries to the state machine

### Advanced Examples
- **Membership Changes**: Add/remove nodes from the cluster
- **Snapshots**: Log compaction and snapshot installation
- **Leadership Transfer**: Graceful leadership handover

### Failure Testing
- **Network Partitions**: Simulate network splits and recovery
- **Node Failures**: Handle node crashes and restarts
- **Message Loss**: Test with unreliable networks

### Performance Testing
- **Throughput**: Measure operations per second
- **Latency**: Track request-response times
- **Stress Testing**: High-load scenarios

## 🖥️ Interactive Features

### CLI Interface
- Real-time cluster status
- Manual operations (append, vote, etc.)
- Configuration changes
- Failure injection

### Visualizer
- Real-time cluster state visualization
- Network topology display
- Log replication tracking
- Performance metrics

## 🔧 Configuration

All examples use configurable parameters:
- Cluster size
- Network latency
- Failure rates
- Performance targets
- Logging levels

## 📊 Metrics & Monitoring

- Election timing
- Replication throughput
- Network utilization
- Resource usage
- Error rates

## 🧪 Testing Scenarios

### Correctness Testing
- Safety violations detection
- Linearizability verification
- Consistency checking

### Chaos Engineering
- Random failures
- Network jitter
- Clock skew
- Resource constraints

## 📖 Educational Value

Each example includes:
- Detailed explanations
- Step-by-step walkthroughs
- Expected outcomes
- Troubleshooting guides
- Best practices

## 🏗️ Architecture

```
playground/
├── src/
│   ├── showcases/         # All use case showcases
│   ├── interactive/       # CLI interface
│   ├── visualization/     # Real-time visualizers
│   ├── utils/            # Common utilities
│   ├── state-machines/   # Example state machines
│   └── scenarios/        # Test scenarios
```

Start exploring with `pnpm start` to see the full capabilities of the Raft consensus algorithm!