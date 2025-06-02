# Raft-NestJS Playground 🎮

> Interactive playground demonstrating the power of distributed consensus with Raft and NestJS

## 🚀 Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Start Redis
docker-compose up -d redis

# 3. Start the playground (single node)
npm run start:dev

# 4. Or start a full cluster
./scripts/start-cluster.sh
```

## 🎯 Available Scenarios

1. **Distributed Cache** - Redis-like cache with TTL support
2. **Task Queue** - Priority-based distributed task processing
3. **Lock Service** - Distributed locking for coordination
4. **Game Server** - Real-time multiplayer game state
5. **Monitoring** - Cluster health and metrics dashboard

## 📡 API Documentation

Interactive API documentation available at http://localhost:3000/api

## 📊 Monitoring

- Prometheus: http://localhost:9090
- Grafana: http://localhost:3001 (admin/admin)
- Built-in Dashboard: http://localhost:3000/monitoring/dashboard

## 🧪 Testing

Run automated scenario tests:
```bash
./scripts/test-scenarios.sh
```

## 📚 Full Documentation

See the complete documentation in the main README.
EOF < /dev/null