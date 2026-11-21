#!/usr/bin/env bash
# Builds the route service and deploys it to Cloudflare (Worker + Container). Needs wrangler signed in (`npx wrangler
# login`, or CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID), Docker running to build the image, and Node 20+.
set -euo pipefail
cd "$(dirname "$0")"
(cd ../app && npm run build:service)
cp ../app/dist-service/server.mjs server.mjs
npm ci
npx wrangler deploy
