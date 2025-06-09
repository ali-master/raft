# Deployment Guide

## Overview

This guide covers the deployment of the Raft KV Server in various environments, from development to production. It includes Docker deployment, Kubernetes configuration, and best practices for different deployment scenarios.

## Prerequisites

- Node.js >= 18.12.0
- pnpm >= 10.11.1
- Docker (for containerized deployment)
- Kubernetes (for orchestrated deployment)

## Environment Variables

### Required Variables

```env
# Server Configuration
PORT=3000
NODE_ENV=production

# Encryption
ENCRYPTION_KEY=your-secure-encryption-key

# Raft Configuration
RAFT_NODE_ID=node-1
RAFT_CLUSTER_ID=my-cluster
RAFT_PEERS=node-1:3001,node-2:3001,node-3:3001
```

### Optional Variables

```env
# CORS
CORS_ORIGIN=*

# Rate Limiting
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW_MS=60000

# Logging
LOG_LEVEL=info
```

## Docker Deployment

### Building the Image

```bash
# Build the image
docker build -t raft-kv-server .

# Tag the image
docker tag raft-kv-server your-registry/raft-kv-server:latest
```

### Running the Container

```bash
# Run a single node
docker run -d \
  --name raft-kv-server \
  -p 3000:3000 \
  -e PORT=3000 \
  -e NODE_ENV=production \
  -e ENCRYPTION_KEY=your-key \
  -e RAFT_NODE_ID=node-1 \
  -e RAFT_CLUSTER_ID=my-cluster \
  raft-kv-server
```

### Docker Compose

```yaml
version: '3.8'

services:
  node1:
    image: raft-kv-server
    environment:
      - PORT=3000
      - NODE_ENV=production
      - ENCRYPTION_KEY=your-key
      - RAFT_NODE_ID=node-1
      - RAFT_CLUSTER_ID=my-cluster
      - RAFT_PEERS=node-1:3001,node-2:3001,node-3:3001
    ports:
      - "3000:3000"
    networks:
      - raft-network

  node2:
    image: raft-kv-server
    environment:
      - PORT=3000
      - NODE_ENV=production
      - ENCRYPTION_KEY=your-key
      - RAFT_NODE_ID=node-2
      - RAFT_CLUSTER_ID=my-cluster
      - RAFT_PEERS=node-1:3001,node-2:3001,node-3:3001
    ports:
      - "3001:3000"
    networks:
      - raft-network

  node3:
    image: raft-kv-server
    environment:
      - PORT=3000
      - NODE_ENV=production
      - ENCRYPTION_KEY=your-key
      - RAFT_NODE_ID=node-3
      - RAFT_CLUSTER_ID=my-cluster
      - RAFT_PEERS=node-1:3001,node-2:3001,node-3:3001
    ports:
      - "3002:3000"
    networks:
      - raft-network

networks:
  raft-network:
    driver: bridge
```

## Kubernetes Deployment

### Deployment Configuration

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: raft-kv-server
spec:
  replicas: 3
  selector:
    matchLabels:
      app: raft-kv-server
  template:
    metadata:
      labels:
        app: raft-kv-server
    spec:
      containers:
      - name: raft-kv-server
        image: your-registry/raft-kv-server:latest
        ports:
        - containerPort: 3000
        env:
        - name: PORT
          value: "3000"
        - name: NODE_ENV
          value: "production"
        - name: ENCRYPTION_KEY
          valueFrom:
            secretKeyRef:
              name: raft-secrets
              key: encryption-key
        - name: RAFT_NODE_ID
          valueFrom:
            fieldRef:
              fieldPath: metadata.name
        - name: RAFT_CLUSTER_ID
          value: "my-cluster"
        - name: RAFT_PEERS
          value: "raft-kv-server-0:3000,raft-kv-server-1:3000,raft-kv-server-2:3000"
        livenessProbe:
          httpGet:
            path: /health/liveness
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health/readiness
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
        resources:
          requests:
            memory: "256Mi"
            cpu: "200m"
          limits:
            memory: "512Mi"
            cpu: "500m"
```

### Service Configuration

```yaml
apiVersion: v1
kind: Service
metadata:
  name: raft-kv-server
spec:
  selector:
    app: raft-kv-server
  ports:
  - port: 3000
    targetPort: 3000
  type: ClusterIP
```

### StatefulSet Configuration

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: raft-kv-server
spec:
  serviceName: raft-kv-server
  replicas: 3
  selector:
    matchLabels:
      app: raft-kv-server
  template:
    metadata:
      labels:
        app: raft-kv-server
    spec:
      containers:
      - name: raft-kv-server
        image: your-registry/raft-kv-server:latest
        ports:
        - containerPort: 3000
        volumeMounts:
        - name: data
          mountPath: /data
  volumeClaimTemplates:
  - metadata:
      name: data
    spec:
      accessModes: [ "ReadWriteOnce" ]
      resources:
        requests:
          storage: 1Gi
```

## Production Best Practices

### 1. Security

- Use secrets management for sensitive data
- Enable TLS/SSL
- Implement network policies
- Regular security audits

### 2. Monitoring

- Set up Prometheus metrics
- Configure Grafana dashboards
- Enable distributed tracing
- Log aggregation

### 3. Backup and Recovery

- Regular data backups
- Disaster recovery plan
- Backup verification
- Recovery testing

### 4. Scaling

- Horizontal scaling with multiple nodes
- Load balancing
- Resource monitoring
- Auto-scaling configuration

### 5. Maintenance

- Regular updates
- Health check monitoring
- Performance optimization
- Capacity planning

## Troubleshooting

### Common Issues

1. **Node Not Joining Cluster**
   - Check network connectivity
   - Verify peer configuration
   - Check node IDs

2. **High Latency**
   - Monitor network performance
   - Check resource usage
   - Verify configuration

3. **Data Inconsistency**
   - Check replication status
   - Verify leader election
   - Monitor log replication

### Debugging Tools

1. **Logs**
   ```bash
   kubectl logs -f deployment/raft-kv-server
   ```

2. **Health Checks**
   ```bash
   curl http://localhost:3000/health
   ```

3. **Metrics**
   ```bash
   curl http://localhost:3000/metrics
   ```

## Performance Tuning

### 1. Memory Configuration

```bash
# Node.js memory settings
NODE_OPTIONS="--max-old-space-size=512"
```

### 2. Network Settings

```bash
# TCP settings
net.ipv4.tcp_keepalive_time = 60
net.ipv4.tcp_keepalive_intvl = 10
net.ipv4.tcp_keepalive_probes = 6
```

### 3. File System

```bash
# File system settings
fs.file-max = 100000
```

## Backup and Restore

### Backup Procedure

```bash
# Create backup
kubectl exec -it raft-kv-server-0 -- /bin/sh -c "tar -czf /backup/data.tar.gz /data"

# Copy backup
kubectl cp raft-kv-server-0:/backup/data.tar.gz ./backup.tar.gz
```

### Restore Procedure

```bash
# Copy backup to pod
kubectl cp ./backup.tar.gz raft-kv-server-0:/backup/

# Restore data
kubectl exec -it raft-kv-server-0 -- /bin/sh -c "tar -xzf /backup/backup.tar.gz -C /"
```
