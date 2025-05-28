# Installation Guide

This guide walks you through installing and setting up the RAFT library in your Node.js or NestJS project.

## Prerequisites

Before installing RAFT, ensure you have the following:

- **Node.js**: Version 18.12.0 or higher
- **Redis**: Version 6.0 or higher (for state persistence and peer discovery)
- **Package Manager**: npm, yarn, or pnpm

### Verifying Prerequisites

```bash
# Check Node.js version
node --version  # Should output v18.12.0 or higher

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

### Using pnpm

```bash
pnpm add @usex/raft
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
    "module": "commonjs",
    "lib": ["ES2020"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "moduleResolution": "node"
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
npx ts-node test-raft.ts

# Or compile and run
npx tsc test-raft.ts
node test-raft.js
```

## Docker Setup (Optional)

For containerized environments, here's a sample `Dockerfile`:

```dockerfile
FROM node:18-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy application
COPY . .

# Build TypeScript (if needed)
RUN npm run build

# Expose ports
EXPOSE 3000

# Start the application
CMD ["node", "dist/index.js"]
```

And a `docker-compose.yml` for local development:

```yaml
version: '3.8'

services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    command: redis-server --appendonly yes

  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - NODE_ENV=development
    depends_on:
      - redis
    volumes:
      - .:/app
      - /app/node_modules

volumes:
  redis-data:
```

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
Ensure you have the correct TypeScript version:
```bash
npm install --save-dev typescript@^5.0.0
```

### Issue: Module resolution errors

**Solution:**
Clear your node_modules and reinstall:
```bash
rm -rf node_modules package-lock.json
npm install
```

## Next Steps

Now that you have RAFT installed, proceed to:
- [Getting Started Guide](./getting-started.md) - Learn the basics
- [Configuration Guide](./configuration.md) - Configure RAFT for your needs
- [Examples](./examples.md) - See practical examples

## System Requirements Summary

| Component | Minimum Version | Recommended Version |
|-----------|----------------|-------------------|
| Node.js   | 18.12.0       | 20.x or latest LTS |
| Redis     | 6.0           | 7.x              |
| TypeScript| 5.0           | 5.8+             |
| Memory    | 512MB         | 2GB+             |
| CPU       | 1 core        | 2+ cores         |

## Support

If you encounter any issues during installation:
1. Check the [Troubleshooting Guide](./troubleshooting.md)
2. Search [existing issues](https://github.com/ali-master/raft/issues)
3. Create a new issue with detailed information about your environment