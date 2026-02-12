#!/bin/bash
# Test script for the Paper Download Service

echo "Testing Paper Download Service API"
echo "==================================="
echo ""

# Test 1: Health check
echo "1. Testing health endpoint..."
curl -s http://localhost:8000/health | python3 -m json.tool
echo ""
echo ""

# Test 2: Root endpoint
echo "2. Testing root endpoint..."
curl -s http://localhost:8000/ | python3 -m json.tool
echo ""
echo ""

# Test 3: Request a download
echo "3. Testing download request (DOI)..."
RESPONSE=$(curl -s -X POST http://localhost:8000/api/download \
  -H "Content-Type: application/json" \
  -d '{"keyword": "10.1038/nature12373", "paper_type": "doi"}')
echo "$RESPONSE" | python3 -m json.tool
TASK_ID=$(echo "$RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin)['task_id'])")
echo ""
echo "Task ID: $TASK_ID"
echo ""
echo ""

# Test 4: Check task status
echo "4. Testing task status endpoint..."
sleep 2
curl -s "http://localhost:8000/api/status/$TASK_ID" | python3 -m json.tool
echo ""
echo ""

# Test 5: List all tasks
echo "5. Testing task list endpoint..."
curl -s http://localhost:8000/api/tasks | python3 -m json.tool
echo ""
echo ""

# Test 6: Invalid paper_type
echo "6. Testing validation (invalid paper_type)..."
curl -s -X POST http://localhost:8000/api/download \
  -H "Content-Type: application/json" \
  -d '{"keyword": "test", "paper_type": "invalid"}' | python3 -m json.tool
echo ""
echo ""

echo "All tests completed!"
