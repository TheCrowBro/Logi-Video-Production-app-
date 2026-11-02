# Putting Vdex on vdex.crowmade.app (Cloudflare)

Vdex's own address is **https://vdex.crowmade.app**. crowmade.app already runs through your Cloudflare account, so the website is hosted there too: it is free, Cloudflare allows commercial use, and it will keep working after the code on GitHub is made private later. GitHub publishes each new version to it by itself.

Everything on the GitHub side is ready. These are the steps only the owner of the Cloudflare account can do, about 15 minutes in all. Do them on a computer.

Until these steps are done, nothing changes: Vdex keeps working at its current address, and GitHub's runs show a note saying Cloudflare is not set up yet.

## Step 1. Copy your Cloudflare account ID

1. Sign in at https://dash.cloudflare.com with the account that holds crowmade.app.
2. Open **Workers & Pages**. On the right, under **Account Details**, press the copy button next to **Account ID**. (Or press Ctrl+K, or Cmd+K on a Mac, type `Copy account ID` and pick it.)
3. Paste it somewhere for a moment.

## Step 2. Make a key that lets GitHub publish

1. In Cloudflare: **Manage account** → **Account API tokens** → **Create Token**.
2. Name it `GitHub deploys vdex`.
3. Under **Permission policies**, add one permission: **Account** → **Workers Scripts** → **Edit**. Limit it to your own account.
4. **Continue to summary** → **Create Token**, and copy the token straight away: Cloudflare shows it only once.

If the first publish in step 4 fails with a permission or authentication error, delete this token and make a new one on the same page: open the **Custom** list under Permission policies, pick **Edit Cloudflare Workers**, and limit it to your account and the crowmade.app zone. That is the template Cloudflare's own GitHub guide uses.

## Step 3. Give both to GitHub

1. Open https://github.com/TheCrowBro/Logi-Video-Production-app-/settings/secrets/actions
2. Under **Repository secrets**, press **New repository secret** twice:
   - Name `CLOUDFLARE_API_TOKEN`, secret: the token from step 2.
   - Name `CLOUDFLARE_ACCOUNT_ID`, secret: the account ID from step 1.

Use repository secrets, not environment secrets.

## Step 4. Publish once

1. Open https://github.com/TheCrowBro/Logi-Video-Production-app-/actions/workflows/pages.yml
2. Press **Run workflow**, keep **main**, and press the green **Run workflow**.
3. In a few minutes the **cloudflare** part turns green, and a Worker called **vdex** appears in Cloudflare under **Workers & Pages**. It is not reachable yet: that is the next step.

## Step 5. Attach the address

Before you do: in Cloudflare open **crowmade.app** → **DNS** → **Records** and check there is no record named `vdex` and no record named `*`. Leave everything else alone, including the crowmade.app record and the email (MX and TXT) records.

1. **Workers & Pages** → pick the Worker **vdex**. Not the Pages project called crowmade: that is your crowmade.app site, and it stays as it is.
2. **Settings** → **Domains & Routes** → **Add** → **Custom Domain**.
3. Type `vdex.crowmade.app` and press **Add Custom Domain**.

Cloudflare creates the address record and the security certificate by itself. Don't add a DNS record by hand. Wait a few minutes.

## Step 6. Check two settings that cover the whole crowmade.app domain

1. **Email Address Obfuscation** rewrites email addresses on pages, which clashes with Vdex's strict security settings. **Rules** → **Overview** → **Create rule** → **Configuration Rule**: name it `vdex`, when **Hostname** equals `vdex.crowmade.app`, set **Email Obfuscation** to **Off**, and deploy.
2. **Bot Fight Mode** (under **Security** → **Settings**) challenges GitHub's check after each publish and can block the Android app's checks. On the free plan no rule can make an exception for one address, so turn it off.

Also look under **Rules** → **Overview** for any rule that does not name a hostname: it applies to vdex.crowmade.app too.

## Step 7. Check that it works

- https://vdex.crowmade.app opens Vdex, and https://crowmade.app still opens your own site.
- https://vdex.crowmade.app/.well-known/assetlinks.json shows a short text file that names `app.crowmade.vdex`.
- Google's own check of that file lists `app.crowmade.vdex`: https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://vdex.crowmade.app&relation=delegate_permission/common.handle_all_urls

Then tell me, and I switch Vdex over to its new address: the links it makes for clients and crew, and a "Vdex has moved" notice with a **Move my data** button for everyone using the old address.

**Don't make the GitHub repository private yet.** On GitHub's free plan that switches off the old address straight away, so clients' invoice and crew links, the desktop app's updates and everyone's data still at the old address would be cut off. I'll tell you when it is safe.

## What it costs

Nothing on Cloudflare: static websites are free with no traffic limit. Later, once the GitHub repository is private, GitHub's free plan includes a monthly allowance for the automatic builds (about $12 of computer time); add a payment method on GitHub, or keep an eye on usage, so builds don't stop when it runs out.

## How it works (for the maintainer)

- `.github/workflows/pages.yml`, job `cloudflare`: after the tests pass on `main`, it runs `tools/stamp-build.mjs` and `tools/stage-site.mjs cloudflare/site --cloudflare`, then deploys with Wrangler (pinned in `cloudflare/package-lock.json`) through `cloudflare/wrangler-action`, pinned by commit. It does nothing until both secrets exist.
- `tools/stage-site.mjs` copies only the website's files (pages, `styles.css`, the manifest, `sw.js`, `js/`, `vendor/`, `icons/`, `.well-known/`), never the Android, desktop, docs, store or test sources. With `--cloudflare` it also writes `_headers` (each page's Content-Security-Policy from its own meta tag plus `frame-ancestors 'none'`, no-cache for pages, `sw.js` and the manifest, the right content types) and `_redirects` (`/` serves `index.html`).
- `cloudflare/wrangler.jsonc`: a Worker that only serves static files, `html_handling: "none"` so `/index.html`, `/invoice.html` and the rest are served as named instead of redirected, and no `routes`, because the custom domain is attached in the dashboard (a deploy with routes would replace it). `workers_dev` and preview URLs are off.
- The GitHub Pages copy at the old address is published from the same staged files until everyone has moved.
