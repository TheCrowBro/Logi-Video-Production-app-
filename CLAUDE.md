# Notes for Claude Code sessions on this repository

## Other sessions work here too

The owner runs several Claude sessions. Some work on this repository, each on its own branch, and some publish to the same
places: vdex.crowmade.app, the shared site crowmade.app, and download.crowmade.app. A session sees another's work only if it
looks, so before changing or publishing anything:

1. **Look at every branch, not only yours.** `git fetch origin`, then `git branch -r --sort=-committerdate`, and for the files
   you will touch, `git log origin/<branch> --since="2 weeks ago" --stat -- <paths>` on each recently updated branch. Bring in
   what touches your files (merge it, or check those files out from it) and say so in your commit message.
2. **Look at the other sessions.** Where the `list_sessions` tool is available, it lists the owner's sessions with a summary of
   what each did last; read one with `list_events` when its summary mentions the files or the site you are about to change. A
   session that is still running can be asked with `send_message`.
3. **Publish only committed and pushed work**, so the next session can fetch exactly what is live. vdex.crowmade.app publishes
   itself from `main`, which follows `claude/videographer-gear-app-xlg8eb` once the tests pass (`.github/workflows/pages.yml`):
   base your work on that branch, and merge it again just before you push.
4. **crowmade.app** (the home page and the Vdex and Valheim Easy Server pages, in `crowmade/`) is published only with
   `tools/deploy-crowmade.sh`. It refuses uncommitted or unpushed work, a deploy that would remove a live page, and one that
   would undo what another session published since this branch last did (`tools/crowmade-published.json` records what went
   live: commit and push it after publishing). If it refuses, bring that work in; never get round it. Little Journee's pages
   (`/journee/`) are a Worker of their own, published from the Children-Schedule-App repository.

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

**Design:** the owner gave the "Cloudflare Website Maintenance" session (session_013RbmKx6XL267rrFPgHBgAf) the final say on
crowmade.app's design: the look, layout and structure of the home page and the Vdex and Valheim Easy Server pages. Other sessions keep
their app's facts on those pages right (prices, features, links, screenshots), and should ask that session (`send_message`) before
changing the design.

Who publishes what on crowmade.app:

- The home page, `/vdex/` and `/valheim/`: this repository, `crowmade/`, published only by `tools/deploy-crowmade.sh` (point 4
  above) to the Cloudflare Pages project `crowmade`.
- `/journee/` (and the old `/littlelog/` addresses): Little Journee's own Worker, published from the Children-Schedule-App repository.
  Never publish Little Journee's pages from here.
- Vdex itself: https://vdex.crowmade.app, a Worker of its own, published from this repository's main branch by CI (point 3 above).
