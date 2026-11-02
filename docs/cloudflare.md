# Putting Vdex on vdex.crowmade.app (Cloudflare)

Vdex's address is **https://vdex.crowmade.app**. crowmade.app already runs through your Cloudflare account, so the website is hosted there too: it is free, Cloudflare allows commercial use, and it works while the code on GitHub is private. GitHub publishes each new version to it by itself, and on the first publish Cloudflare sets up the address (its DNS record and security certificate) on its own.

Everything on the GitHub side is ready. These are the steps only the owner of the Cloudflare account can do, about 10 minutes, on a computer.

## Step 1. Make a key that lets GitHub publish

1. Sign in at https://dash.cloudflare.com with the account that holds crowmade.app.
2. Top right, your profile icon → **My Profile** → **API Tokens** → **Create Token**. (Newer layouts: **Manage account** → **Account API tokens** → **Create Token**.)
3. Next to **Edit Cloudflare Workers**, press **Use template**.
4. Under **Account Resources** choose your account. Under **Zone Resources** choose **Specific zone** → **crowmade.app**.
5. **Continue to summary** → **Create Token**, and copy the token straight away: Cloudflare shows it only once.

## Step 2. Copy your account ID

Open **Workers & Pages** (left menu). On the right, under **Account Details**, press the copy button next to **Account ID**. (Or press Ctrl+K, or Cmd+K on a Mac, type `Copy account ID` and pick it.)

## Step 3. Give both to GitHub

1. Open https://github.com/TheCrowBro/Logi-Video-Production-app-/settings/secrets/actions
2. Under **Repository secrets**, press **New repository secret** twice:
   - Name `CLOUDFLARE_API_TOKEN`, secret: the token from step 1.
   - Name `CLOUDFLARE_ACCOUNT_ID`, secret: the account ID from step 2.

Use repository secrets, not environment secrets.

## Step 4. Publish

Tell me, or do it yourself: open https://github.com/TheCrowBro/Logi-Video-Production-app-/actions/workflows/pages.yml, press **Run workflow**, keep **main**, and press the green **Run workflow**. A few minutes after the **cloudflare** part turns green, https://vdex.crowmade.app opens Vdex, and https://crowmade.app is unchanged.

If the publish fails with a message about permissions or the domain: in Cloudflare open **Workers & Pages** → the Worker **vdex** (not the Pages project called crowmade) → **Settings** → **Domains & Routes** → **Add** → **Custom Domain**, type `vdex.crowmade.app` and press **Add Custom Domain**. Don't add a DNS record by hand.

## Before the Google Play launch

- **Bot Fight Mode** (Cloudflare → crowmade.app → **Security** → **Settings**) can challenge Google's check of the Android app. If it is on, turn it off.
- Check https://vdex.crowmade.app/.well-known/assetlinks.json shows a short text file naming `app.crowmade.vdex`.

## What it costs

Nothing on Cloudflare: static websites are free with no traffic limit. With the repository private, GitHub's free plan includes a monthly allowance of build time; each change is tested once to make it last. If builds ever stop for lack of minutes, add a payment method on GitHub or wait for the next month.

## How it works (for the maintainer)

- `.github/workflows/pages.yml` ("Publish the website"): a push to the working branch runs the browser tests; `mirror` moves `main` to the tested commit and starts the workflow on `main`, where `cloudflare-ready` checks the secrets and `cloudflare` runs `tools/stamp-build.mjs`, `tools/stage-site.mjs cloudflare/site --cloudflare`, then `wrangler deploy` (Wrangler pinned in `cloudflare/package-lock.json`, through `cloudflare/wrangler-action` pinned by commit), and checks the live site.
- `tools/stage-site.mjs` copies only the website's files (the pages in `tools/site-files.mjs`, `styles.css`, the manifest, `sw.js`, `js/`, `vendor/`, `icons/`, `.well-known/`) and writes `_headers` (each page's Content-Security-Policy from its own meta tag plus `frame-ancestors 'none'`, no-cache for pages, `sw.js` and the manifest, the right content types) and `_redirects` (`/` serves `index.html`).
- `cloudflare/wrangler.jsonc`: a Worker that only serves static files, `html_handling: "none"`, the Custom Domain `vdex.crowmade.app` as its only route, no workers.dev or preview addresses.
- The old address (thecrowbro.github.io/Logi-Video-Production-app-/) stopped when the repository went private on GitHub's free plan. People's data from it is still in their browsers, tied to that address; bringing it across needs a page served from that address again (see the move plan before reopening it).
