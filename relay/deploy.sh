#!/bin/bash
# Deploys the relay to Yandex Cloud (needs `yc init` done once). Prints the public address.
set -euo pipefail
cd "$(dirname "$0")"
yc serverless function get plan-relay >/dev/null 2>&1 || yc serverless function create --name plan-relay
yc serverless function allow-unauthenticated-invoke plan-relay >/dev/null
rm -f /tmp/plan-relay.zip && zip -qj /tmp/plan-relay.zip index.js
yc serverless function version create --function-name plan-relay --runtime nodejs18 --entrypoint index.handler \
  --memory 256m --execution-timeout 30s --source-path /tmp/plan-relay.zip >/dev/null
FID=$(yc serverless function get plan-relay --format json | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")
sed "s/FUNCTION_ID/$FID/" gateway.yaml > /tmp/plan-gateway.yaml
if yc serverless api-gateway get plan-relay >/dev/null 2>&1; then
  yc serverless api-gateway update plan-relay --spec /tmp/plan-gateway.yaml >/dev/null
else
  yc serverless api-gateway create --name plan-relay --spec /tmp/plan-gateway.yaml >/dev/null
fi
echo "https://$(yc serverless api-gateway get plan-relay --format json | python3 -c "import json,sys;print(json.load(sys.stdin)['domain'])")"
