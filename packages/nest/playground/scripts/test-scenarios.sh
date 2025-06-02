#!/bin/bash

API_URL="http://localhost:3000"

echo "🧪 Testing Raft Playground Scenarios..."
echo ""

# Test cluster health
echo "1. Testing cluster health..."
curl -s "$API_URL/cluster/health" | jq .
echo ""

# Test distributed cache
echo "2. Testing distributed cache..."
echo "   - Setting value..."
curl -s -X POST "$API_URL/cache/test-key" \
  -H "Content-Type: application/json" \
  -d '{"value": "Hello, Raft!", "ttl": 60}' | jq .

echo "   - Getting value..."
curl -s "$API_URL/cache/test-key" | jq .
echo ""

# Test task queue
echo "3. Testing task queue..."
echo "   - Creating task..."
TASK_RESPONSE=$(curl -s -X POST "$API_URL/tasks" \
  -H "Content-Type: application/json" \
  -d '{"type": "process_data", "payload": {"data": "test"}, "priority": 1}')
echo "$TASK_RESPONSE" | jq .

TASK_ID=$(echo "$TASK_RESPONSE" | jq -r .id)

echo "   - Assigning task to worker..."
curl -s -X POST "$API_URL/tasks/assign/worker-1" | jq .
echo ""

# Test lock service
echo "4. Testing lock service..."
echo "   - Acquiring lock..."
curl -s -X POST "$API_URL/locks/resource-1" \
  -H "Content-Type: application/json" \
  -d '{"owner": "client-1", "ttl": 30}' | jq .

echo "   - Checking lock..."
curl -s "$API_URL/locks/resource-1" | jq .
echo ""

# Test game server
echo "5. Testing game server..."
echo "   - Creating game..."
GAME_RESPONSE=$(curl -s -X POST "$API_URL/games" \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Game", "maxPlayers": 4}')
echo "$GAME_RESPONSE" | jq .

GAME_ID=$(echo "$GAME_RESPONSE" | jq -r .id)

echo "   - Joining game..."
curl -s -X POST "$API_URL/games/$GAME_ID/join" \
  -H "Content-Type: application/json" \
  -d '{"playerId": "player-1", "playerName": "Alice"}' | jq .
echo ""

# Check monitoring
echo "6. Checking monitoring dashboard..."
curl -s "$API_URL/monitoring/dashboard" | jq .
echo ""

echo "✅ All scenarios tested!"