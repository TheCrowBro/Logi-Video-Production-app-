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
