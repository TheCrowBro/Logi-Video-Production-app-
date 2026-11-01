#!/usr/bin/env bash
# Publishes crowmade.app (Cloudflare Pages project "crowmade") with all three apps: Little Log's pages, built from the
# Children-Schedule-App repository, plus the home page and the Vdex and Valheim Easy Server pages from crowmade/ here.
# A Pages deployment replaces the whole site, so both halves go up together.
#   tools/deploy-crowmade.sh [path to a Children-Schedule-App checkout]   (cloned into a temp folder if not given)
# In a Claude cloud session the Cloudflare token is added by the proxy; elsewhere set CLOUDFLARE_API_TOKEN.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
cs="${1:-}"
if [ -z "$cs" ]; then git clone -q --depth 1 https://github.com/TheCrowBro/Children-Schedule-App.git "$work/cs"; cs="$work/cs"; fi
node "$cs/scripts/build-site.js"
node "$here/tools/build-crowmade.mjs"
mkdir -p "$work/site"
cp -R "$cs/site/." "$work/site/"
cp -R "$here/crowmade/." "$work/site/"          # our index.html (lists every app) replaces Little Log's
export CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN:-placeholder-the-proxy-adds-the-token}"
if [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  CLOUDFLARE_ACCOUNT_ID=$(curl -fsS https://api.cloudflare.com/client/v4/accounts | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).result[0].id))")
fi
export CLOUDFLARE_ACCOUNT_ID
WRANGLER=wrangler; command -v wrangler >/dev/null 2>&1 || WRANGLER="npx --yes wrangler@4.156.0"
(cd "$work" && $WRANGLER pages deploy site --project-name crowmade --branch main --commit-dirty=true)
