# Installation Guide

This guide walks you through installing and setting up the RAFT library in your Bun, Node.js, or NestJS project.

## Prerequisites

Before installing RAFT, ensure you have the following:

- **Node.js**: Version 22.22.3 or higher (optional for Node.js consumers)
- **Redis**: Version 6.0 or higher (for state persistence and peer discovery)
- **Bun**: Version 1.4.3 or higher for this monorepo

### Verifying Prerequisites

```bash
# Check runtime versions
bun --version   # 1.4.3 or higher
node --version  # 22.22.3 or higher, when using Node.js

# Check Redis installation
redis-cli --version  # Should output redis-cli 6.0.0 or higher

# Verify Redis is running
redis-cli ping  # Should return PONG
```

## Installation

### Using npm

```bash
npm install @usex/raft
```

### Using yarn

```bash
yarn add @usex/raft
```

### Using Bun

```bash
bun add @usex/raft
```

## Redis Setup

RAFT uses Redis for:
- Persistent state storage
- Peer discovery
- Distributed coordination

### Basic Redis Installation

#### macOS
```bash
# Using Homebrew
brew install redis
brew services start redis
```

#### Ubuntu/Debian
```bash
sudo apt update
sudo apt install redis-server
sudo systemctl start redis-server
sudo systemctl enable redis-server
```

#### Docker
```bash
docker run -d --name redis -p 6379:6379 redis:7-alpine
```

### Redis Configuration for Production

For production environments, consider these Redis configurations:

```conf
# /etc/redis/redis.conf

# Enable persistence
save 900 1
save 300 10
save 60 10000

# Set maximum memory
maxmemory 2gb
maxmemory-policy allkeys-lru

# Enable AOF persistence
appendonly yes
appendfsync everysec

# Security
requirepass your-strong-password-here

# Networking
bind 0.0.0.0
protected-mode yes
```

## TypeScript Setup

RAFT is written in TypeScript and provides full type definitions. No additional type packages are required.

### TypeScript Configuration

Ensure your `tsconfig.json` includes:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "Node20",
    "lib": ["ES2020"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "moduleResolution": "node16"
  }
}
```

## Environment Setup

RAFT can be configured using environment variables. Create a `.env` file in your project root:

```env
# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your-password
REDIS_DB=0

# Node Configuration
NODE_ENV=development
LOG_LEVEL=info
```

## Verifying Installation

Create a simple test file to verify the installation:

```typescript
// test-raft.ts
import { RaftEngine } from '@usex/raft';

async function testInstallation() {
  try {
    const engine = new RaftEngine();
    console.log('✅ RAFT library imported successfully');
    
    const config = RaftEngine.createDefaultConfiguration('test-node', 'test-cluster');
    console.log('✅ Default configuration created');
    
    const node = await engine.createNode(config);
    console.log('✅ RAFT node created');
    
    await engine.startNode('test-node');
    console.log('✅ RAFT node started');
    
    console.log('Node state:', node.getState());
    console.log('Current term:', node.getCurrentTerm());
    
    await engine.stopNode('test-node');
    console.log('✅ RAFT node stopped');
    
    console.log('\n🎉 Installation verified successfully!');
  } catch (error) {
    console.error('❌ Installation verification failed:', error);
    process.exit(1);
  }
}

testInstallation();
```

Run the test:

```bash
# Using TypeScript directly
bun test-raft.ts

# Or compile and run
bun run tsc test-raft.ts
node test-raft.js
```

## Docker Setup (Optional)

Build the maintained Bun images from the repository root. Both Dockerfiles use a frozen lockfile, separate build and production dependencies, and run as the `bun` user.

```bash
docker build -f packages/kv-server/Dockerfile -t raft-kv-server .
docker build -f packages/nest/playground/Dockerfile -t raft-nest-playground .
```

The Compose examples include Redis and application configuration:

```bash
docker compose -f packages/kv-server/docker-compose.cluster.yml up --build
docker compose -f packages/nest/playground/docker-compose.yml up --build
```

Review the [migration validation and known limitations](./bun-migration.md) before deploying.

## Common Installation Issues

### Issue: Cannot connect to Redis

**Solution:**
```bash
# Check if Redis is running
redis-cli ping

# If not, start Redis
# macOS
brew services start redis

# Linux
sudo systemctl start redis-server

# Docker
docker start redis
```

### Issue: TypeScript compilation errors

**Solution:**
The monorepo uses TypeScript 7 for `tsc` and the TypeScript 6 compiler API for Nest CLI and build tools. Install the locked versions from the repository root:
```bash
bun install --frozen-lockfile
bun run test:types
```

### Issue: Module resolution errors

**Solution:**
Install the workspace dependencies and build local package exports from the repository root:
```bash
bun install --frozen-lockfile
bun run build
```

## Next Steps

Now that you have RAFT installed, proceed to:
- [Getting Started Guide](./getting-started.md) - Learn the basics
- [Configuration Guide](./configuration.md) - Configure RAFT for your needs
- [Examples](./examples.md) - See practical examples

## System Requirements Summary

| Component | Minimum Version | Recommended Version |
|-----------|----------------|-------------------|
| Bun       | 1.4.3         | 1.4.3 (pinned)    |
| Node.js (optional) | 22.22.3 | Supported Node.js release |
| Redis     | 6.0           | 7.x              |
| TypeScript (monorepo) | 7.0.2 | 7.0.2 with TypeScript 6 API compatibility |
| Memory    | 512MB         | 2GB+             |
| CPU       | 1 core        | 2+ cores         |

## Support

If you encounter any issues during installation:
1. Check the [Troubleshooting Guide](./troubleshooting.md)
2. Search [existing issues](https://github.com/ali-master/raft/issues)
3. Create a new issue with detailed information about your environment
