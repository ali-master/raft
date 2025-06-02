#!/bin/bash

echo "📈 Scaling Raft Playground Cluster to 5 nodes..."

# Start additional nodes
docker-compose --profile scale up -d

echo "✅ Cluster scaled successfully!"
echo ""
echo "🌐 Additional nodes:"
echo "   - Node 4: http://localhost:3004"
echo "   - Node 5: http://localhost:3005"