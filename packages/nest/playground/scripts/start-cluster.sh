#!/bin/bash

echo "🚀 Starting Raft Playground Cluster..."

# Check if Redis is running
if ! docker ps | grep -q redis; then
    echo "📦 Starting Redis..."
    docker-compose up -d redis
    sleep 5
fi

# Start 3-node cluster
echo "🔧 Starting 3-node Raft cluster..."
docker-compose up -d node1 node2 node3

# Wait for nodes to start
echo "⏳ Waiting for nodes to initialize..."
sleep 10

# Start monitoring services
echo "📊 Starting monitoring services..."
docker-compose up -d prometheus grafana

echo "✅ Cluster started successfully!"
echo ""
echo "🌐 Access points:"
echo "   - Node 1:    http://localhost:3000"
echo "   - Node 2:    http://localhost:3002"  
echo "   - Node 3:    http://localhost:3003"
echo "   - Prometheus: http://localhost:9090"
echo "   - Grafana:    http://localhost:3001 (admin/admin)"
echo ""
echo "📚 API Documentation available at:"
echo "   - http://localhost:3000/api"
echo ""
echo "🔍 To view logs: docker-compose logs -f"
echo "🛑 To stop: ./scripts/stop-cluster.sh"