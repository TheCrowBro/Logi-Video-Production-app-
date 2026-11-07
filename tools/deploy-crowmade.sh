#!/usr/bin/env bash
# Publishes the shared pages of crowmade.app (the Cloudflare Pages project "crowmade"): the home page listing every app, and the
# Vdex and Valheim Easy Server pages, all in crowmade/ (tools/build-crowmade.mjs).
#   tools/deploy-crowmade.sh
# Little Journee's pages (/journee/) are a Worker of their own, published from the Children-Schedule-App repository, and are not
# touched. Other sessions publish this site too, and a Pages deployment replaces the whole of it, so this publishes only work
# that is committed and pushed (so the next session can fetch exactly what is live), and tools/crowmade-guard.mjs first checks
# that nothing live would be removed or undone. Afterwards tools/crowmade-published.json records what went live: commit and
# push it.
# In a Claude cloud session the Cloudflare token is added by the proxy; elsewhere set CLOUDFLARE_API_TOKEN.
set -euo pipefail
cd "$(dirname "$0")/.."
node tools/build-crowmade.mjs
SOURCES=(crowmade tools/build-crowmade.mjs tools/crowmade-guard.mjs tools/deploy-crowmade.sh js/tax.js)
if [ -n "$(git status --porcelain -- "${SOURCES[@]}")" ]; then
  echo "Not published: commit these first (after the build above), so what goes live is in the repository for other sessions:" >&2
  git status --short -- "${SOURCES[@]}" >&2
  exit 1
fi
git fetch -q origin || { echo "Not published: GitHub could not be reached to check that this commit is pushed." >&2; exit 1; }
if [ -z "$(git branch -r --contains HEAD 2>/dev/null)" ]; then
  echo "Not published: push this commit first, so other sessions can fetch what is live." >&2
  exit 1
fi
node tools/crowmade-guard.mjs
export CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN:-placeholder-the-proxy-adds-the-token}"
if [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  CLOUDFLARE_ACCOUNT_ID=$(curl -fsS https://api.cloudflare.com/client/v4/accounts | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.parse(s).result[0].id))")
fi
export CLOUDFLARE_ACCOUNT_ID
WRANGLER=wrangler; command -v wrangler >/dev/null 2>&1 || WRANGLER="npx --yes wrangler@4.156.0"
$WRANGLER pages deploy crowmade --project-name crowmade --branch main --commit-dirty=true
node tools/crowmade-guard.mjs --record
