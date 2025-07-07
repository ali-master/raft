# Redis Setup Guide

This repository provides multiple Docker Compose files for different Redis configurations, offering flexibility and modularity for testing and development:

## 🔧 Available Configurations

### 1. Single Redis Instance
A standalone Redis server for simple development and testing.

**Port:** 6379  
**Container:** `redis-single`

### 2. Redis Sentinel Mode
High availability setup with 1 master, 2 replicas, and 3 sentinels for automatic failover.

**Master:** Port 6380 (`redis-master`)  
**Replicas:** Ports 6381, 6382 (`redis-replica-1`, `redis-replica-2`)  
**Sentinels:** Ports 26379, 26380, 26381 (`redis-sentinel-1`, `redis-sentinel-2`, `redis-sentinel-3`)

### 3. Redis Cluster Mode
A 6-node Redis cluster (3 masters + 3 replicas) for horizontal scaling and partitioning.

**Nodes:** Ports 7000-7005  
**Cluster Bus Ports:** 17000-17005

## 📁 Available Files

- **`docker-compose.redis-single.yml`** - Single Redis instance
- **`docker-compose.redis-sentinel.yml`** - Redis Sentinel setup (HA)
- **`docker-compose.redis-cluster.yml`** - Redis Cluster (scaling)
- **`docker-compose.yml`** - All configurations with profiles
- **`Makefile`** - Convenient management commands
- **`config/sentinel.conf`** - Sentinel configuration

## 🚀 Usage

### Option 1: Using Individual Compose Files

#### Single Instance
```bash
docker-compose -f docker-compose.redis-single.yml up -d
```

#### Sentinel Mode
```bash
docker-compose -f docker-compose.redis-sentinel.yml up -d
```

#### Cluster Mode
```bash
docker-compose -f docker-compose.redis-cluster.yml up -d
```

### Option 2: Using Main Compose File with Profiles

#### Single Instance Only
```bash
docker-compose --profile single up -d
```

#### Sentinel Mode Only
```bash
docker-compose --profile sentinel up -d
```

#### Cluster Mode Only
```bash
docker-compose --profile cluster up -d
```

#### All Configurations
```bash
docker-compose --profile all up -d
```

### Option 3: Using Makefile (Recommended)

```bash
# See all available commands
make help

# Start specific configurations
make redis-single
make redis-sentinel
make redis-cluster
make redis-all

# Management commands
make redis-status
make redis-logs
make redis-stop
make redis-clean
```

## 🔍 Testing Connections

### Single Instance
```bash
redis-cli -h localhost -p 6379 ping
```

### Sentinel Mode
```bash
# Connect to master
redis-cli -h localhost -p 6380 ping

# Connect via sentinel (for application use)
redis-cli -h localhost -p 26379 sentinel masters
```

### Cluster Mode
```bash
# Test cluster connectivity
redis-cli -c -h localhost -p 7000 cluster nodes
redis-cli -c -h localhost -p 7000 cluster info
```

## 🔧 Configuration Details

### Memory Limits
- **Single/Sentinel:** 256MB per instance
- **Cluster:** 128MB per node

### Persistence
- All instances use AOF (Append Only File) persistence
- Data is persisted in Docker volumes

### Health Checks
- All Redis instances include health checks
- 5-second intervals with 3-second timeout
- 5 retries before marking as unhealthy

### Networking
- All services use the `redis-network` bridge network
- Inter-service communication uses container names as hostnames

## 🔌 Application Connection Examples

### Node.js with ioredis

#### Single Instance
```javascript
const Redis = require('ioredis');
const redis = new Redis({
  host: 'localhost',
  port: 6379
});
```

#### Sentinel Mode
```javascript
const Redis = require('ioredis');
const redis = new Redis({
  sentinels: [
    { host: 'localhost', port: 26379 },
    { host: 'localhost', port: 26380 },
    { host: 'localhost', port: 26381 }
  ],
  name: 'mymaster'
});
```

#### Cluster Mode
```javascript
const Redis = require('ioredis');
const cluster = new Redis.Cluster([
  { host: 'localhost', port: 7000 },
  { host: 'localhost', port: 7001 },
  { host: 'localhost', port: 7002 }
]);
```

## 🛑 Stop Services

```bash
# Stop all services
docker-compose down

# Stop and remove volumes (data will be lost)
docker-compose down -v
```

## 📊 Monitoring

### Check Service Status
```bash
docker-compose ps
```

### View Logs
```bash
# All services
docker-compose logs

# Specific service
docker-compose logs redis-master
docker-compose logs redis-sentinel-1
docker-compose logs redis-cluster-1
```

### Monitor Redis Stats
```bash
# Single/Sentinel
redis-cli -h localhost -p 6379 info

# Cluster
redis-cli -c -h localhost -p 7000 info
```

## 🚨 Troubleshooting

### Cluster Initialization Issues
If the cluster fails to initialize:
```bash
docker-compose restart redis-cluster-init
```

### Check Sentinel Status
```bash
redis-cli -h localhost -p 26379 sentinel masters
redis-cli -h localhost -p 26379 sentinel slaves mymaster
```

### Reset Everything
```bash
docker-compose down -v
docker-compose up -d
```

## 🔒 Security Notes

- These configurations are for **development/testing only**
- No authentication is configured
- All instances are accessible from localhost
- For production, add proper authentication and network security