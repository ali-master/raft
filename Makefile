# Redis Docker Compose Management
.PHONY: help redis-single redis-sentinel redis-cluster redis-all redis-stop redis-clean redis-logs redis-status

# Default target
help:
	@echo "Redis Docker Compose Management"
	@echo "================================"
	@echo ""
	@echo "Available targets:"
	@echo "  redis-single     - Start single Redis instance (port 6379)"
	@echo "  redis-sentinel   - Start Redis Sentinel setup (master + replicas + sentinels)"
	@echo "  redis-cluster    - Start Redis Cluster (6 nodes)"
	@echo "  redis-all        - Start all Redis configurations"
	@echo ""
	@echo "  redis-stop       - Stop all Redis services"
	@echo "  redis-clean      - Stop and remove all Redis data"
	@echo "  redis-logs       - Show logs for all services"
	@echo "  redis-status     - Show status of all services"
	@echo ""
	@echo "Single Instance Commands:"
	@echo "  single-logs      - Show single instance logs"
	@echo "  single-stop      - Stop single instance"
	@echo "  single-clean     - Stop and clean single instance"
	@echo ""
	@echo "Sentinel Commands:"
	@echo "  sentinel-logs    - Show sentinel setup logs"
	@echo "  sentinel-stop    - Stop sentinel setup"
	@echo "  sentinel-clean   - Stop and clean sentinel setup"
	@echo "  sentinel-status  - Check sentinel status"
	@echo ""
	@echo "Cluster Commands:"
	@echo "  cluster-logs     - Show cluster logs"
	@echo "  cluster-stop     - Stop cluster"
	@echo "  cluster-clean    - Stop and clean cluster"
	@echo "  cluster-status   - Check cluster status"
	@echo "  cluster-init     - Reinitialize cluster"

# Start single Redis instance
redis-single:
	@echo "Starting single Redis instance..."
	docker-compose -f docker-compose.redis-single.yml up -d
	@echo "Single Redis instance started on port 6379"
	@echo "Test with: redis-cli -h localhost -p 6379 ping"

# Start Redis Sentinel setup
redis-sentinel:
	@echo "Starting Redis Sentinel setup..."
	docker-compose -f docker-compose.redis-sentinel.yml up -d
	@echo "Redis Sentinel setup started:"
	@echo "  Master:    port 6380"
	@echo "  Replica 1: port 6381"
	@echo "  Replica 2: port 6382"
	@echo "  Sentinels: ports 26379, 26380, 26381"
	@echo "Test with: redis-cli -h localhost -p 26379 sentinel masters"

# Start Redis Cluster
redis-cluster:
	@echo "Starting Redis Cluster..."
	docker-compose -f docker-compose.redis-cluster.yml up -d
	@echo "Redis Cluster started on ports 7000-7005"
	@echo "Waiting for cluster initialization..."
	@sleep 15
	@echo "Test with: redis-cli -c -h localhost -p 7000 cluster info"

# Start all Redis configurations
redis-all:
	@echo "Starting all Redis configurations..."
	make redis-single
	make redis-sentinel
	make redis-cluster
	@echo "All Redis configurations started!"

# Stop all Redis services
redis-stop:
	@echo "Stopping all Redis services..."
	-docker-compose -f docker-compose.redis-single.yml down
	-docker-compose -f docker-compose.redis-sentinel.yml down
	-docker-compose -f docker-compose.redis-cluster.yml down
	@echo "All Redis services stopped"

# Clean all Redis data
redis-clean:
	@echo "Stopping and cleaning all Redis data..."
	-docker-compose -f docker-compose.redis-single.yml down -v
	-docker-compose -f docker-compose.redis-sentinel.yml down -v
	-docker-compose -f docker-compose.redis-cluster.yml down -v
	@echo "All Redis data cleaned"

# Show logs for all services
redis-logs:
	@echo "=== Single Instance Logs ==="
	-docker-compose -f docker-compose.redis-single.yml logs --tail=20
	@echo ""
	@echo "=== Sentinel Setup Logs ==="
	-docker-compose -f docker-compose.redis-sentinel.yml logs --tail=20
	@echo ""
	@echo "=== Cluster Logs ==="
	-docker-compose -f docker-compose.redis-cluster.yml logs --tail=20

# Show status of all services
redis-status:
	@echo "=== Single Instance Status ==="
	-docker-compose -f docker-compose.redis-single.yml ps
	@echo ""
	@echo "=== Sentinel Setup Status ==="
	-docker-compose -f docker-compose.redis-sentinel.yml ps
	@echo ""
	@echo "=== Cluster Status ==="
	-docker-compose -f docker-compose.redis-cluster.yml ps

# Single Instance Commands
single-logs:
	docker-compose -f docker-compose.redis-single.yml logs -f

single-stop:
	docker-compose -f docker-compose.redis-single.yml down

single-clean:
	docker-compose -f docker-compose.redis-single.yml down -v

# Sentinel Commands
sentinel-logs:
	docker-compose -f docker-compose.redis-sentinel.yml logs -f

sentinel-stop:
	docker-compose -f docker-compose.redis-sentinel.yml down

sentinel-clean:
	docker-compose -f docker-compose.redis-sentinel.yml down -v

sentinel-status:
	@echo "Checking sentinel status..."
	@echo "Masters:"
	-docker exec redis-sentinel-1 redis-cli -p 26379 sentinel masters
	@echo ""
	@echo "Slaves:"
	-docker exec redis-sentinel-1 redis-cli -p 26379 sentinel slaves mymaster

# Cluster Commands
cluster-logs:
	docker-compose -f docker-compose.redis-cluster.yml logs -f

cluster-stop:
	docker-compose -f docker-compose.redis-cluster.yml down

cluster-clean:
	docker-compose -f docker-compose.redis-cluster.yml down -v

cluster-status:
	@echo "Checking cluster status..."
	@echo "Cluster Info:"
	-docker exec redis-cluster-1 redis-cli -c -p 7000 cluster info
	@echo ""
	@echo "Cluster Nodes:"
	-docker exec redis-cluster-1 redis-cli -c -p 7000 cluster nodes

cluster-init:
	@echo "Reinitializing cluster..."
	docker-compose -f docker-compose.redis-cluster.yml restart redis-cluster-init