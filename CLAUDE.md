# Notes for Claude Code sessions on this repository

## crowmade.app (the shared website)

Before making any change to crowmade.app, including building or publishing `crowmade/` with `tools/deploy-crowmade.sh`, first check
what the owner's other sessions have changed in the content the site describes, and confirm the site matches it:

1. **Read the other sessions.** List the owner's Claude sessions and read the latest results of each one working on an app the site
   covers: Vdex (this repository), Little Journee (Children-Schedule-App, once Little Log) and Valheim Easy Server
   (Valheim-Easy-Server-), plus any new app.
2. **Read the repositories.** Fetch each app's latest default branch and compare its README, store texts, screenshots, prices, names
   and addresses with what the site says.
3. **Read the live site** (https://crowmade.app and https://crowmade.pages.dev) and the Cloudflare account (Pages projects, Workers
   and their deployments), in case another session published something since.
4. **Tell the owner what changed** (each session's changes and how the site would change) before editing or publishing, and update the
   site to match. If something can't be confirmed (a session is mid-change, or a repository can't be read), say so instead of guessing.

Who publishes what on crowmade.app:

- The home page, `/vdex/` and `/valheim/`: this repository, `crowmade/`, published by `tools/deploy-crowmade.sh` to the Cloudflare
  Pages project `crowmade`. A Pages deployment replaces the whole site; `tools/crowmade-guard.mjs` refuses a deploy that would remove
  a live page, and it is not to be bypassed.
- `/journee/` (and the old `/littlelog/` addresses): Little Journee's own Worker, published from the Children-Schedule-App repository.
  Never publish Little Journee's pages from here.
- Vdex itself: https://vdex.crowmade.app, a Worker of its own, published from this repository's main branch by CI.
