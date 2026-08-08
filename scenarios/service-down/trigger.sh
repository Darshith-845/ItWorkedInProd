#!/usr/bin/env bash
# Trigger the service dependency failure reproduction scenario.
#
# Usage: bash trigger.sh

set -euo pipefail

API_URL="${API_URL:-http://localhost:3052}"
MAX_RETRIES=15
RETRY_DELAY=1

echo "=== Service Dependency Failure Scenario ==="
echo "Waiting for checkout-api to be ready..."

for i in $(seq 1 $MAX_RETRIES); do
  if curl -sf "$API_URL/health" > /dev/null 2>&1; then
    echo "checkout-api is ready (but Redis is unavailable)."
    break
  fi
  if [ "$i" -eq "$MAX_RETRIES" ]; then
    echo "ERROR: checkout-api did not become ready after ${MAX_RETRIES}s"
    exit 1
  fi
  sleep $RETRY_DELAY
done

echo ""
echo "Sending: POST /checkout"
echo "Payload: {\"session_id\": \"sess_abc123\"}"
echo ""

RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "$API_URL/checkout" \
  -H "Content-Type: application/json" \
  -d '{"session_id": "sess_abc123"}')

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

echo "HTTP Status: $HTTP_CODE"
echo "Response Body:"
echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"

echo ""
if [ "$HTTP_CODE" = "500" ] && echo "$BODY" | grep -qi "redis\|ECONNREFUSED\|connection"; then
  echo "✓ FAILURE REPRODUCED — 500 Internal Server Error"
  echo "  Error: Redis connection refused"
  echo "  Cause: Redis service is unavailable"
else
  echo "✗ UNEXPECTED RESULT — Expected 500 with Redis connection error, got $HTTP_CODE"
  echo "  Body: $BODY"
  exit 1
fi
