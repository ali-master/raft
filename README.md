# RAFT Library Documentation (Under development, not yet released)

Welcome to the comprehensive documentation for the RAFT distributed consensus library for Node.js and NestJS.

## What is RAFT?

RAFT is a production-ready implementation of the Raft consensus algorithm, designed to help you build reliable distributed systems in Node.js. It provides a robust foundation for creating fault-tolerant applications that require strong consistency guarantees across multiple nodes.

## Key Features

- **Complete Raft Implementation**: Full implementation of the Raft consensus algorithm including leader election, log replication, and membership changes
- **Production-Ready**: Built with reliability, performance, and observability in mind
- **Redis-Backed Storage**: Leverages Redis for persistent state management and peer discovery
- **Weighted Voting**: Advanced leader election with configurable weight-based voting
- **Circuit Breakers**: Built-in fault tolerance with circuit breaker patterns for network operations
- **Comprehensive Monitoring**: Prometheus metrics, internal metrics collection, and detailed logging
- **Write-Ahead Logging (WAL)**: Durable log storage with automatic recovery
- **Peer Discovery**: Automatic peer discovery and health checking
- **Event-Driven Architecture**: Rich event system for monitoring cluster state changes
- **TypeScript First**: Written in TypeScript with full type safety

## Documentation Overview

### Getting Started
- [Installation Guide](./docs/installation.md) - How to install and set up the library
- [Getting Started](./docs/getting-started.md) - Quick start guide and basic usage
- [Configuration](./docs/configuration.md) - Detailed configuration options

### Core Documentation
- [API Reference](./docs/api-reference.md) - Complete API documentation
- [Architecture](./docs/architecture.md) - Understanding RAFT internals
- [Examples](./docs/examples.md) - Code examples and use cases

### Advanced Topics
- [Advanced Usage](./docs/advanced-usage.md) - Advanced patterns and techniques
- [Monitoring](./docs/monitoring.md) - Metrics, observability, and debugging
- [Deployment](./docs/deployment.md) - Production deployment guidelines
- [Security](./docs/security.md) - Security best practices

### Reference
- [Troubleshooting](./docs/troubleshooting.md) - Common issues and solutions
- [Migration Guide](./docs/migration-guide.md) - Upgrading between versions

## Quick Example

```typescript
import { RaftEngine } from '@usex/raft';

// Create the engine
const engine = new RaftEngine();

// Create a node with default configuration
const config = RaftEngine.createDefaultConfiguration('node1', 'my-cluster');
const node = await engine.createNode(config);

// Start the node
await engine.startNode('node1');

// Subscribe to events
node.on('stateChange', ({ state, term }) => {
  console.log(`Node changed to ${state} in term ${term}`);
});

node.on('leaderElected', ({ leaderId }) => {
  console.log(`New leader elected: ${leaderId}`);
});

// Append logs (only on leader)
if (node.getState() === 'leader') {
  await node.appendLog({ command: 'SET', key: 'foo', value: 'bar' });
}
```

## System Requirements

- Node.js >= 18.12.0
- Redis >= 6.0
- TypeScript >= 5.0 (for TypeScript projects)

## Support

- **GitHub Issues**: [Report bugs or request features](https://github.com/ali-master/raft/issues)
- **Documentation**: You're reading it!
- **Examples**: Check the [examples directory](./docs/examples.md) for practical use cases

## License

This project is licensed under the MIT License. See the [LICENSE](./LICENSE) file for details.

## Contributing

We welcome contributions! Please see our [Contributing Guide](./CODE_OF_CONDUCT.md) for details.

---

Ready to get started? Head over to the [Installation Guide](./docs/installation.md) to begin building distributed systems with RAFT!
