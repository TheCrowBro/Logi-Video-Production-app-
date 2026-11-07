#!/usr/bin/env bash
# Publishes the shared pages of crowmade.app (the Cloudflare Pages project "crowmade"): the home page listing every app, and the
# Vdex and Valheim Easy Server pages, all in crowmade/ (tools/build-crowmade.mjs).
#   tools/deploy-crowmade.sh
# Little Journee's pages (/journee/) are a Worker of their own, published from the Children-Schedule-App repository, and are not
# touched. A Pages deployment replaces the whole site, so tools/crowmade-guard.mjs first checks nothing live would be removed.
# In a Claude cloud session the Cloudflare token is added by the proxy; elsewhere set CLOUDFLARE_API_TOKEN.
set -euo pipefail
cd "$(dirname "$0")/.."
node tools/build-crowmade.mjs
node tools/crowmade-guard.mjs
export CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN:-placeholder-the-proxy-adds-the-token}"
if [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  CLOUDFLARE_ACCOUNT_ID=$(curl -fsS https://api.cloudflare.com/client/v4/accounts | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).result[0].id))")
fi
export CLOUDFLARE_ACCOUNT_ID
WRANGLER=wrangler; command -v wrangler >/dev/null 2>&1 || WRANGLER="npx --yes wrangler@4.156.0"
$WRANGLER pages deploy crowmade --project-name crowmade --branch main --commit-dirty=true
