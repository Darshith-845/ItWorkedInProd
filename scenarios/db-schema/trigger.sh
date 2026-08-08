#!/usr/bin/env bash
# Trigger the DB schema mismatch reproduction scenario.
#
# Usage: bash trigger.sh

set -euo pipefail

API_URL="${API_URL:-http://localhost:3051}"
MAX_RETRIES=30
RETRY_DELAY=1

echo "=== DB Schema Mismatch Scenario ==="
echo "Waiting for checkout-api to be ready..."

for i in $(seq 1 $MAX_RETRIES); do
  if curl -sf "$API_URL/health" > /dev/null 2>&1; then
    echo "checkout-api is ready (with DB connection)."
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
echo "Payload: {\"user_id\": \"usr_001\"}"
echo ""

RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "$API_URL/checkout" \
  -H "Content-Type: application/json" \
  -d '{"user_id": "usr_001"}')

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

echo "HTTP Status: $HTTP_CODE"
echo "Response Body:"
echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"

echo ""
if [ "$HTTP_CODE" = "500" ] && echo "$BODY" | grep -q "subscription"; then
  echo "✓ FAILURE REPRODUCED — 500 Internal Server Error"
  echo "  Error: column \"subscription\" does not exist"
  echo "  Cause: Database schema v16 is missing the column added in v17"
else
  echo "✗ UNEXPECTED RESULT — Expected 500 with subscription column error, got $HTTP_CODE"
  echo "  Body: $BODY"
  exit 1
fi
