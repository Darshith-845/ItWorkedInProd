#!/usr/bin/env bash
# Trigger the missing-config reproduction scenario.
#
# Usage: bash trigger.sh
#
# Waits for the service to be healthy, then sends the request
# that triggers the failure.

set -euo pipefail

API_URL="${API_URL:-http://localhost:3050}"
MAX_RETRIES=15
RETRY_DELAY=1

echo "=== Missing Config Scenario ==="
echo "Waiting for checkout-api to be ready..."

for i in $(seq 1 $MAX_RETRIES); do
  if curl -sf "$API_URL/health" > /dev/null 2>&1; then
    echo "checkout-api is ready."
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
echo "Payload: {\"items\": [{\"id\": \"prod_001\", \"qty\": 1}]}"
echo ""

RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "$API_URL/checkout" \
  -H "Content-Type: application/json" \
  -d '{"items": [{"id": "prod_001", "qty": 1}]}')

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

echo "HTTP Status: $HTTP_CODE"
echo "Response Body:"
echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"

echo ""
if [ "$HTTP_CODE" = "500" ]; then
  echo "✓ FAILURE REPRODUCED — 500 Internal Server Error"
  echo "  Error code: ERR_CONFIG_MISSING"
  echo "  Cause: DATABASE_URL is not defined"
else
  echo "✗ UNEXPECTED RESULT — Expected 500, got $HTTP_CODE"
  exit 1
fi
