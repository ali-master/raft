# Deployment Guide

This guide covers deploying RAFT clusters in production environments, including infrastructure setup, deployment strategies, and operational best practices.

## Table of Contents

- [Infrastructure Requirements](#infrastructure-requirements)
- [Deployment Architectures](#deployment-architectures)
- [Container Deployment](#container-deployment)
- [Kubernetes Deployment](#kubernetes-deployment)
- [Cloud Deployments](#cloud-deployments)
- [Configuration Management](#configuration-management)
- [Load Balancing](#load-balancing)
- [Backup and Recovery](#backup-and-recovery)
- [Monitoring Setup](#monitoring-setup)
- [Security Hardening](#security-hardening)
- [Operational Procedures](#operational-procedures)

## Infrastructure Requirements

### Hardware Requirements

#### Minimum Requirements (3-node cluster)

| Component | Minimum | Recommended | Notes |
|-----------|---------|-------------|-------|
| CPU | 2 cores | 4+ cores | More cores improve consensus performance |
| Memory | 2 GB | 8+ GB | Depends on log size and state machine |
| Storage | 20 GB SSD | 100+ GB NVMe | Fast storage critical for WAL |
| Network | 1 Gbps | 10 Gbps | Low latency more important than bandwidth |

#### Production Recommendations

```yaml
# Example production sizing
small_cluster:
  nodes: 3
  cpu: 4 cores
  memory: 8 GB
  storage: 100 GB NVMe
  network: 10 Gbps
  use_case: "Development, small workloads"

medium_cluster:
  nodes: 5
  cpu: 8 cores
  memory: 16 GB
  storage: 500 GB NVMe
  network: 10 Gbps
  use_case: "Production, moderate workloads"

large_cluster:
  nodes: 7
  cpu: 16 cores
  memory: 32 GB
  storage: 1 TB NVMe
  network: 25 Gbps
  use_case: "High-throughput production"
```

### Network Requirements

#### Latency Requirements

```typescript
// Network latency impacts configuration
function calculateTimeouts(avgLatency: number): RaftConfiguration {
  return {
    // Election timeout should be >> network RTT
    electionTimeout: [
      Math.max(150, avgLatency * 10),
      Math.max(300, avgLatency * 20)
    ],
    // Heartbeat should be > network RTT
    heartbeatInterval: Math.max(50, avgLatency * 3),
    // Request timeout
    network: {
      requestTimeout: Math.max(5000, avgLatency * 50)
    }
  };
}
```

#### Bandwidth Estimation

```typescript
class BandwidthCalculator {
  calculate(config: {
    logEntriesPerSecond: number;
    avgEntrySize: number;
    nodeCount: number;
    replicationFactor: number;
  }): BandwidthRequirements {
    // Replication bandwidth
    const replicationBandwidth = 
      config.logEntriesPerSecond * 
      config.avgEntrySize * 
      (config.nodeCount - 1);
    
    // Heartbeat bandwidth (small but frequent)
    const heartbeatBandwidth = 
      (1000 / config.heartbeatInterval) * 
      100 * // bytes per heartbeat
      (config.nodeCount - 1);
    
    // Add 50% overhead for protocol overhead
    const totalBandwidth = (replicationBandwidth + heartbeatBandwidth) * 1.5;
    
    return {
      perNode: totalBandwidth,
      total: totalBandwidth * config.nodeCount,
      breakdown: {
        replication: replicationBandwidth,
        heartbeat: heartbeatBandwidth,
        overhead: totalBandwidth * 0.5
      }
    };
  }
}
```

## Deployment Architectures

### Single Region Deployment

```yaml
# Standard 3-node deployment
topology:
  region: us-east-1
  availability_zones:
    - us-east-1a: node-1
    - us-east-1b: node-2
    - us-east-1c: node-3
  
configuration:
  electionTimeout: [150, 300]
  heartbeatInterval: 50
  network:
    requestTimeout: 5000
```

### Multi-Region Deployment

```yaml
# 5-node cross-region deployment
topology:
  primary_region: us-east-1
  regions:
    us-east-1:
      nodes: [node-1, node-2]
      weight: 2
    us-west-2:
      nodes: [node-3, node-4]
      weight: 1
    eu-west-1:
      nodes: [node-5]
      weight: 1

configuration:
  # Adjust for cross-region latency
  electionTimeout: [500, 1000]
  heartbeatInterval: 200
  network:
    requestTimeout: 15000
  voting:
    enableWeighting: true
    preferredRegion: us-east-1
```

### Hybrid Cloud Deployment

```typescript
class HybridDeployment {
  deploy(): DeploymentConfig {
    return {
      onPremise: {
        nodes: ['node-1', 'node-2'],
        network: 'private',
        weight: 2 // Prefer on-premise for compliance
      },
      cloud: {
        provider: 'aws',
        nodes: ['node-3', 'node-4', 'node-5'],
        network: 'vpc',
        weight: 1
      },
      connectivity: {
        type: 'vpn',
        encryption: 'ipsec',
        bandwidth: '1Gbps'
      }
    };
  }
}
```

## Container Deployment

### Docker Deployment

#### Dockerfile

```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy application
COPY . .

# Build TypeScript
RUN npm run build

# Production image
FROM node:20-alpine

RUN apk add --no-cache tini

WORKDIR /app

# Copy built application
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

# Create non-root user
RUN addgroup -g 1001 -S raft && \
    adduser -S raft -u 1001

# Set ownership
RUN chown -R raft:raft /app

USER raft

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node healthcheck.js || exit 1

# Use tini for proper signal handling
ENTRYPOINT ["/sbin/tini", "--"]

CMD ["node", "dist/index.js"]
```

#### Docker Compose

```yaml
version: '3.8'

services:
  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    volumes:
      - redis-data:/data
    networks:
      - raft-network
    deploy:
      resources:
        limits:
          memory: 2G

  node-1:
    build: .
    environment:
      NODE_ID: node-1
      CLUSTER_ID: prod-cluster
      REDIS_HOST: redis
      HTTP_PORT: 3001
    ports:
      - "3001:3001"
      - "9001:9090" # Metrics
    volumes:
      - node1-data:/var/lib/raft
    networks:
      - raft-network
    depends_on:
      - redis
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 4G
        reservations:
          cpus: '1'
          memory: 2G

  node-2:
    build: .
    environment:
      NODE_ID: node-2
      CLUSTER_ID: prod-cluster
      REDIS_HOST: redis
      HTTP_PORT: 3002
    ports:
      - "3002:3002"
      - "9002:9090"
    volumes:
      - node2-data:/var/lib/raft
    networks:
      - raft-network
    depends_on:
      - redis

  node-3:
    build: .
    environment:
      NODE_ID: node-3
      CLUSTER_ID: prod-cluster
      REDIS_HOST: redis
      HTTP_PORT: 3003
    ports:
      - "3003:3003"
      - "9003:9090"
    volumes:
      - node3-data:/var/lib/raft
    networks:
      - raft-network
    depends_on:
      - redis

volumes:
  redis-data:
  node1-data:
  node2-data:
  node3-data:

networks:
  raft-network:
    driver: bridge
```

### Container Best Practices

```typescript
class ContainerConfig {
  getProductionConfig(): DockerConfig {
    return {
      // Resource limits
      resources: {
        limits: {
          cpus: '4',
          memory: '8G'
        },
        reservations: {
          cpus: '2',
          memory: '4G'
        }
      },
      
      // Security
      security: {
        readOnlyRootFilesystem: true,
        noNewPrivileges: true,
        user: '1001:1001',
        capabilities: {
          drop: ['ALL'],
          add: ['NET_BIND_SERVICE']
        }
      },
      
      // Health checks
      healthcheck: {
        test: ['CMD', 'wget', '--spider', 'http://localhost:3000/health'],
        interval: '30s',
        timeout: '3s',
        retries: 3,
        startPeriod: '40s'
      },
      
      // Logging
      logging: {
        driver: 'json-file',
        options: {
          'max-size': '10m',
          'max-file': '3',
          'compress': 'true'
        }
      }
    };
  }
}
```

## Kubernetes Deployment

### StatefulSet Configuration

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: raft-cluster
  namespace: raft-system
spec:
  serviceName: raft-cluster
  replicas: 3
  selector:
    matchLabels:
      app: raft
  template:
    metadata:
      labels:
        app: raft
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "9090"
    spec:
      affinity:
        podAntiAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
          - labelSelector:
              matchExpressions:
              - key: app
                operator: In
                values:
                - raft
            topologyKey: kubernetes.io/hostname
      containers:
      - name: raft
        image: myregistry/raft:v1.0.0
        ports:
        - containerPort: 3000
          name: http
        - containerPort: 9090
          name: metrics
        env:
        - name: NODE_ID
          valueFrom:
            fieldRef:
              fieldPath: metadata.name
        - name: CLUSTER_ID
          value: "prod-cluster"
        - name: REDIS_HOST
          value: "redis-service"
        resources:
          requests:
            cpu: "1"
            memory: "2Gi"
          limits:
            cpu: "4"
            memory: "8Gi"
        volumeMounts:
        - name: data
          mountPath: /var/lib/raft
        livenessProbe:
          httpGet:
            path: /health
            port: http
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: http
          initialDelaySeconds: 5
          periodSeconds: 5
  volumeClaimTemplates:
  - metadata:
      name: data
    spec:
      accessModes: ["ReadWriteOnce"]
      storageClassName: "fast-ssd"
      resources:
        requests:
          storage: 100Gi
```

### Service Configuration

```yaml
apiVersion: v1
kind: Service
metadata:
  name: raft-cluster
  namespace: raft-system
spec:
  clusterIP: None
  selector:
    app: raft
  ports:
  - name: http
    port: 3000
    targetPort: 3000
  - name: metrics
    port: 9090
    targetPort: 9090

---
apiVersion: v1
kind: Service
metadata:
  name: raft-lb
  namespace: raft-system
spec:
  type: LoadBalancer
  selector:
    app: raft
  ports:
  - name: http
    port: 80
    targetPort: 3000
```

### ConfigMap for Configuration

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: raft-config
  namespace: raft-system
data:
  config.json: |
    {
      "clusterId": "prod-cluster",
      "electionTimeout": [150, 300],
      "heartbeatInterval": 50,
      "redis": {
        "host": "redis-service",
        "port": 6379
      },
      "persistence": {
        "dataDir": "/var/lib/raft",
        "walEnabled": true
      },
      "metrics": {
        "enablePrometheus": true,
        "port": 9090
      }
    }
```

### Horizontal Pod Autoscaling

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: raft-hpa
  namespace: raft-system
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: StatefulSet
    name: raft-cluster
  minReplicas: 3
  maxReplicas: 7
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 300
      policies:
      - type: Pods
        value: 2
        periodSeconds: 300
    scaleDown:
      stabilizationWindowSeconds: 600
      policies:
      - type: Pods
        value: 1
        periodSeconds: 600
```

## Cloud Deployments

### AWS Deployment

#### Terraform Configuration

```hcl
# Network configuration
resource "aws_vpc" "raft_vpc" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "raft-cluster-vpc"
  }
}

# Create subnets in different AZs
resource "aws_subnet" "raft_subnets" {
  count             = 3
  vpc_id            = aws_vpc.raft_vpc.id
  cidr_block        = "10.0.${count.index + 1}.0/24"
  availability_zone = data.aws_availability_zones.available.names[count.index]

  tags = {
    Name = "raft-subnet-${count.index + 1}"
  }
}

# Security group
resource "aws_security_group" "raft_sg" {
  name_prefix = "raft-cluster-"
  vpc_id      = aws_vpc.raft_vpc.id

  # RAFT communication
  ingress {
    from_port   = 3000
    to_port     = 3010
    protocol    = "tcp"
    cidr_blocks = [aws_vpc.raft_vpc.cidr_block]
  }

  # Metrics
  ingress {
    from_port   = 9090
    to_port     = 9090
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# Launch template
resource "aws_launch_template" "raft_node" {
  name_prefix   = "raft-node-"
  image_id      = data.aws_ami.amazon_linux_2.id
  instance_type = "m5.xlarge"

  vpc_security_group_ids = [aws_security_group.raft_sg.id]

  block_device_mappings {
    device_name = "/dev/xvda"
    ebs {
      volume_size = 100
      volume_type = "gp3"
      iops        = 3000
      encrypted   = true
    }
  }

  user_data = base64encode(templatefile("${path.module}/userdata.sh", {
    cluster_id = "prod-cluster"
    redis_host = aws_elasticache_cluster.redis.cache_nodes[0].address
  }))

  tag_specifications {
    resource_type = "instance"
    tags = {
      Name = "raft-node"
    }
  }
}

# Auto Scaling Group
resource "aws_autoscaling_group" "raft_asg" {
  name                = "raft-cluster-asg"
  vpc_zone_identifier = aws_subnet.raft_subnets[*].id
  min_size            = 3
  max_size            = 7
  desired_capacity    = 3

  launch_template {
    id      = aws_launch_template.raft_node.id
    version = "$Latest"
  }

  tag {
    key                 = "Name"
    value               = "raft-node"
    propagate_at_launch = true
  }
}

# Redis cluster
resource "aws_elasticache_cluster" "redis" {
  cluster_id           = "raft-redis"
  engine              = "redis"
  node_type           = "cache.m5.large"
  num_cache_nodes     = 1
  parameter_group_name = "default.redis7"
  subnet_group_name   = aws_elasticache_subnet_group.redis.name

  snapshot_retention_limit = 7
  snapshot_window         = "03:00-05:00"
}
```

#### User Data Script

```bash
#!/bin/bash
# userdata.sh

# Install dependencies
yum update -y
yum install -y docker

# Start Docker
systemctl start docker
systemctl enable docker

# Get instance metadata
INSTANCE_ID=$(ec2-metadata --instance-id | cut -d " " -f 2)
AZ=$(ec2-metadata --availability-zone | cut -d " " -f 2)

# Run RAFT node
docker run -d \
  --name raft-node \
  --restart always \
  -p 3000:3000 \
  -p 9090:9090 \
  -v /var/lib/raft:/var/lib/raft \
  -e NODE_ID=$INSTANCE_ID \
  -e CLUSTER_ID=${cluster_id} \
  -e REDIS_HOST=${redis_host} \
  -e AWS_REGION=$AWS_REGION \
  -e AWS_AZ=$AZ \
  myregistry/raft:latest
```

### GCP Deployment

```yaml
# Instance template
resource "google_compute_instance_template" "raft_node" {
  name_prefix  = "raft-node-"
  machine_type = "n2-standard-4"
  region       = "us-central1"

  disk {
    source_image = "debian-cloud/debian-11"
    auto_delete  = true
    boot         = true
    disk_size_gb = 100
    disk_type    = "pd-ssd"
  }

  network_interface {
    network = "default"
    access_config {} # External IP
  }

  metadata_startup_script = file("${path.module}/startup.sh")

  tags = ["raft-node"]
}

# Managed instance group
resource "google_compute_instance_group_manager" "raft_mig" {
  name               = "raft-cluster-mig"
  base_instance_name = "raft-node"
  zone               = "us-central1-a"
  target_size        = 3

  version {
    instance_template = google_compute_instance_template.raft_node.id
  }

  update_policy {
    type                  = "PROACTIVE"
    minimal_action        = "REPLACE"
    max_surge_fixed       = 1
    max_unavailable_fixed = 0
  }
}
```

### Azure Deployment

```json
{
  "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
  "contentVersion": "1.0.0.0",
  "parameters": {
    "vmSize": {
      "type": "string",
      "defaultValue": "Standard_D4s_v3"
    },
    "nodeCount": {
      "type": "int",
      "defaultValue": 3
    }
  },
  "resources": [
    {
      "type": "Microsoft.Compute/virtualMachineScaleSets",
      "apiVersion": "2021-04-01",
      "name": "raft-vmss",
      "location": "[resourceGroup().location]",
      "sku": {
        "name": "[parameters('vmSize')]",
        "capacity": "[parameters('nodeCount')]"
      },
      "properties": {
        "overprovision": false,
        "upgradePolicy": {
          "mode": "Rolling",
          "rollingUpgradePolicy": {
            "maxBatchInstancePercent": 20,
            "maxUnhealthyInstancePercent": 20
          }
        },
        "virtualMachineProfile": {
          "storageProfile": {
            "imageReference": {
              "publisher": "Canonical",
              "offer": "UbuntuServer",
              "sku": "20.04-LTS",
              "version": "latest"
            },
            "osDisk": {
              "createOption": "FromImage",
              "diskSizeGB": 100,
              "managedDisk": {
                "storageAccountType": "Premium_LRS"
              }
            }
          },
          "osProfile": {
            "computerNamePrefix": "raft-node-",
            "adminUsername": "raftadmin",
            "customData": "[base64(variables('cloudInit'))]"
          },
          "networkProfile": {
            "networkInterfaceConfigurations": [
              {
                "name": "nic",
                "properties": {
                  "primary": true,
                  "ipConfigurations": [
                    {
                      "name": "ipconfig",
                      "properties": {
                        "subnet": {
                          "id": "[variables('subnetId')]"
                        }
                      }
                    }
                  ]
                }
              }
            ]
          }
        }
      }
    }
  ]
}
```

## Configuration Management

### Environment-Based Configuration

```typescript
class ConfigurationManager {
  loadConfig(): RaftConfiguration {
    const env = process.env.NODE_ENV || 'development';
    const baseConfig = this.loadBaseConfig();
    const envConfig = this.loadEnvConfig(env);
    
    return this.mergeConfigs(baseConfig, envConfig);
  }
  
  private loadEnvConfig(env: string): Partial<RaftConfiguration> {
    switch (env) {
      case 'production':
        return {
          logging: { level: LogLevel.WARN },
          metrics: { enablePrometheus: true },
          persistence: { walEnabled: true }
        };
      case 'staging':
        return {
          logging: { level: LogLevel.INFO },
          metrics: { enablePrometheus: true }
        };
      default:
        return {
          logging: { level: LogLevel.DEBUG },
          electionTimeout: [500, 1000] // Slower for debugging
        };
    }
  }
}
```

### Secret Management

```typescript
class SecretManager {
  async loadSecrets(): Promise<Secrets> {
    const provider = process.env.SECRET_PROVIDER || 'env';
    
    switch (provider) {
      case 'aws':
        return this.loadFromAWSSecretsManager();
      case 'vault':
        return this.loadFromHashiCorp();
      case 'k8s':
        return this.loadFromK8sSecrets();
      default:
        return this.loadFromEnv();
    }
  }
  
  private async loadFromAWSSecretsManager(): Promise<Secrets> {
    const client = new AWS.SecretsManager();
    const secret = await client.getSecretValue({
      SecretId: 'raft-cluster-secrets'
    }).promise();
    
    return JSON.parse(secret.SecretString);
  }
}
```

## Load Balancing

### Client-Side Load Balancing

```typescript
class RaftClient {
  private nodes: string[];
  private currentIndex: number = 0;
  
  async execute(command: any): Promise<any> {
    // Try to find leader first
    const leader = await this.findLeader();
    if (leader) {
      return this.sendToNode(leader, command);
    }
    
    // Round-robin through nodes
    const maxAttempts = this.nodes.length;
    for (let i = 0; i < maxAttempts; i++) {
      const node = this.getNextNode();
      try {
        return await this.sendToNode(node, command);
      } catch (error) {
        if (error.status === 307) {
          // Follow redirect to leader
          return this.sendToNode(error.location, command);
        }
      }
    }
    
    throw new Error('No available nodes');
  }
  
  private getNextNode(): string {
    const node = this.nodes[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.nodes.length;
    return node;
  }
}
```

### HAProxy Configuration

```
global
    maxconn 4096
    log stdout local0
    
defaults
    mode http
    timeout connect 5s
    timeout client 30s
    timeout server 30s
    option httplog
    
frontend raft_frontend
    bind *:80
    default_backend raft_backend
    
backend raft_backend
    balance roundrobin
    option httpchk GET /health
    
    # Retry on connection failure
    retries 3
    
    # Prefer leader for writes
    http-request set-header X-Raft-Preferred-Role leader
    
    server node1 raft-node-1:3000 check
    server node2 raft-node-2:3000 check
    server node3 raft-node-3:3000 check
```

## Backup and Recovery

### Backup Strategy

```typescript
class BackupManager {
  async performBackup(): Promise<BackupMetadata> {
    const backup: BackupMetadata = {
      id: generateId(),
      timestamp: new Date(),
      nodes: []
    };
    
    // 1. Create snapshots on each node
    for (const node of this.cluster.getAllNodes()) {
      const snapshot = await node.createSnapshot();
      const s3Key = await this.uploadToS3(snapshot);
      
      backup.nodes.push({
        nodeId: node.id,
        snapshotKey: s3Key,
        lastIndex: snapshot.lastIncludedIndex
      });
    }
    
    // 2. Backup Redis state
    backup.redisBackup = await this.backupRedis();
    
    // 3. Store metadata
    await this.storeBackupMetadata(backup);
    
    return backup;
  }
  
  private async uploadToS3(snapshot: Buffer): Promise<string> {
    const s3 = new AWS.S3();
    const key = `backups/${Date.now()}/snapshot.gz`;
    
    await s3.putObject({
      Bucket: 'raft-backups',
      Key: key,
      Body: snapshot,
      ServerSideEncryption: 'AES256'
    }).promise();
    
    return key;
  }
}
```

### Disaster Recovery

```typescript
class DisasterRecovery {
  async restoreCluster(backupId: string): Promise<void> {
    // 1. Retrieve backup metadata
    const backup = await this.getBackupMetadata(backupId);
    
    // 2. Provision new infrastructure
    const infrastructure = await this.provisionInfrastructure();
    
    // 3. Restore Redis
    await this.restoreRedis(backup.redisBackup);
    
    // 4. Deploy nodes with restored data
    for (const nodeBackup of backup.nodes) {
      await this.restoreNode(nodeBackup, infrastructure);
    }
    
    // 5. Verify cluster health
    await this.verifyClusterHealth();
  }
}
```

## Monitoring Setup

### Prometheus Configuration

```yaml
# prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'raft-cluster'
    kubernetes_sd_configs:
      - role: pod
    relabel_configs:
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
        action: keep
        regex: true
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_port]
        action: replace
        target_label: __address__
        regex: ([^:]+)(?::\d+)?;(\d+)
        replacement: $1:$2

rule_files:
  - 'raft-alerts.yml'

alerting:
  alertmanagers:
    - static_configs:
        - targets: ['alertmanager:9093']
```

### Alert Rules

```yaml
# raft-alerts.yml
groups:
  - name: raft
    rules:
      - alert: NoLeader
        expr: sum(raft_node_state == 2) == 0
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "No leader in RAFT cluster"
          
      - alert: MultipleLeaders
        expr: sum(raft_node_state == 2) > 1
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Multiple leaders detected"
          
      - alert: HighElectionRate
        expr: rate(raft_elections_total[5m]) > 0.1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High election rate"
```

## Security Hardening

### Network Security

```yaml
# Network policies for Kubernetes
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: raft-network-policy
spec:
  podSelector:
    matchLabels:
      app: raft
  policyTypes:
  - Ingress
  - Egress
  ingress:
  - from:
    - podSelector:
        matchLabels:
          app: raft
    ports:
    - protocol: TCP
      port: 3000
  - from:
    - namespaceSelector:
        matchLabels:
          name: monitoring
    ports:
    - protocol: TCP
      port: 9090
  egress:
  - to:
    - podSelector:
        matchLabels:
          app: raft
  - to:
    - podSelector:
        matchLabels:
          app: redis
```

### TLS Configuration

```typescript
class TLSConfig {
  createSecureServer(): https.Server {
    const options = {
      key: fs.readFileSync('/certs/server.key'),
      cert: fs.readFileSync('/certs/server.crt'),
      ca: fs.readFileSync('/certs/ca.crt'),
      requestCert: true,
      rejectUnauthorized: true,
      ciphers: 'ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES128-GCM-SHA256',
      honorCipherOrder: true,
      minVersion: 'TLSv1.2'
    };
    
    return https.createServer(options, app);
  }
}
```

## Operational Procedures

### Deployment Checklist

- [ ] Infrastructure provisioned
- [ ] Network connectivity verified
- [ ] Redis cluster deployed
- [ ] TLS certificates installed
- [ ] Monitoring configured
- [ ] Alerting configured
- [ ] Backups scheduled
- [ ] Load balancers configured
- [ ] Health checks passing
- [ ] Documentation updated

### Maintenance Procedures

```typescript
class MaintenanceManager {
  async performMaintenance(nodeId: string): Promise<void> {
    // 1. Notify monitoring systems
    await this.notifyMonitoring('maintenance_start', nodeId);
    
    // 2. Drain node
    await this.drainNode(nodeId);
    
    // 3. Perform maintenance
    await this.executeMaintenance(nodeId);
    
    // 4. Rejoin cluster
    await this.rejoinCluster(nodeId);
    
    // 5. Verify health
    await this.verifyNodeHealth(nodeId);
    
    // 6. Notify completion
    await this.notifyMonitoring('maintenance_complete', nodeId);
  }
}
```

### Capacity Planning

```typescript
class CapacityPlanner {
  analyzeGrowth(): GrowthProjection {
    const metrics = this.collectHistoricalMetrics();
    
    return {
      currentUsage: {
        cpu: metrics.avgCpu,
        memory: metrics.avgMemory,
        storage: metrics.totalStorage,
        throughput: metrics.avgThroughput
      },
      projection: {
        sixMonths: this.projectGrowth(metrics, 180),
        oneYear: this.projectGrowth(metrics, 365)
      },
      recommendations: this.generateRecommendations(metrics)
    };
  }
}
```

## Best Practices Summary

1. **Infrastructure**
   - Use dedicated nodes for RAFT
   - Ensure low-latency networking
   - Use SSD/NVMe storage
   - Distribute across availability zones

2. **Configuration**
   - Adjust timeouts for network latency
   - Use appropriate cluster size (3, 5, or 7)
   - Enable monitoring and metrics
   - Configure proper resource limits

3. **Operations**
   - Automate deployments
   - Monitor cluster health continuously
   - Perform regular backups
   - Test disaster recovery procedures
   - Keep documentation updated

4. **Security**
   - Use TLS for all communications
   - Implement network policies
   - Rotate credentials regularly
   - Audit access logs
   - Keep software updated

Following these deployment guidelines ensures a reliable, secure, and performant RAFT cluster in production.