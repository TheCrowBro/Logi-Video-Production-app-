# Selling Vdex

Vdex is ready to sell: a **30-day free trial**, then **20 US dollars once** (plus the tax where the buyer lives) for up to **3 devices**, bought through Stripe, plus **free codes you make yourself**. The licence covers the desktop app for Windows, Mac and Linux (each computer takes one of the 3 places), the Android app from Google Play (each phone takes a place too), and the website, where people sign in with the email address they bought with. This guide is everything only the owner can do. Do the parts in order; each says roughly how long it takes.

## What happens until you finish

Nothing changes for anyone yet. The app checks codes with licence keys that are built into it, and there are none until part 1 is done, so until then the desktop app works fully for everyone, as now. **Every computer that runs Vdex before then keeps it free for good**, which is how existing desktop users get their free licence. People only see a trial once you have sent me your public keys (part 1) and a new version has gone out.

## How it works, in short

- **Buying:** the **Buy** buttons (in the app and on the download page) open `vdex.crowmade.app/buy`, which goes to your Stripe payment page. After paying, Stripe sends the buyer to a thank-you page that shows their code, and the code is emailed to them too.
- **The code** is a long line starting `VDEX-` with the buyer's name and email inside, signed so it can't be made up or changed.
- **3 computers:** the first time a code is used on a computer, the app activates it at vdex.crowmade.app, which keeps a list of the computers on each code (a random number for that install and "Mac", "Windows" or "Linux"; nothing about the person or the hardware). A fourth computer is offered to move the code from one of the others, up to 3 times a month. The app checks about once a week, and needs the internet at least once every 90 days.
- **Refunds:** refund in Stripe as usual. The code is cancelled automatically, and the app becomes read-only on its computers within about a week.
- **Free codes:** you make them on your own computer with the licence generator page, and email them yourself.
- **After the trial, without a code:** the app is read-only. Everything opens and prints; nothing can be changed.
- **From the start, without a licence (trial included):** cloud storage, backup files and spreadsheet (CSV) files are locked: pressing them explains and offers a licence. A storage someone linked before is paused (nothing read or written) and starts syncing again by itself once they have a licence. PDFs, printing and client and crew links always work. Desktop installs that ran before selling started, and licences switched off, are not affected.
- **The website and the Android app** (once you switch them on in part 9): a 30-day trial in each browser, then read-only until the person presses **Sign in** and types the 6-digit code Vdex emails to their licence's address.

## What it costs

| | Cost |
|---|---|
| Stripe with Managed Payments (Link is the seller, and handles sales tax and VAT) | about 1.58 USD of each 20 USD US card sale (2.9% + 30¢ + 3.5%), about 1.88 USD on a non-US card. No monthly fee. |
| Resend (emails the codes) | free up to 3,000 emails a month (100 a day) |
| Cloudflare (the shop, the activation list and the downloads) | free within the allowances (100,000 shop requests a day, 10 GB of downloads storage) |
| Apple Developer Program (signs the Mac app) | 99 USD a year |
| Azure Artifact Signing (signs the Windows app) | 9.99 USD a month |

Signing both is about 219 USD a year, so roughly 12 sales a year pay for it.

---

## Part 1. Make your licence keys (15 minutes, on your own computer)

1. Get the file **licence-generator.html** (I send it to you; it is also in the repository at `tools/licence-generator.html`). Save it on your computer and double-click it: it opens in your web browser, works with no internet, and sends nothing anywhere while making keys and codes.
2. Under **First time only: make your keys**, type a passphrase of 12 or more characters twice and press **Make my keys**. Use a passphrase you will not forget, and keep it in your password manager: without it the key files are useless, to you as well.
3. Three files land in your Downloads:
   - `vdex-licence-key-1.json`: your key, for making free codes.
   - `vdex-licence-key-2-shop.json`: the shop's key (Cloudflare uses it; you need the file only if you ever have to set the shop up again).
   - `vdex-licence-key-9-spare.json`: a spare that replaces your key if it is ever lost or leaked.

   Copy all three to two safe places, for example a USB stick and your password manager or cloud drive. Keep the spare apart from the others.
4. The page then shows three boxes:
   - **Public keys**: copy the whole line and send it to me. It is not secret. I build it into the app, and from that version on, new installs get the trial.
   - **The shop key**: you paste this into Cloudflare in part 2. **Never email it or share it.**
   - **Paper backups**: write both down on paper and keep them like cash. Anyone holding one can make codes.

## Part 2. Give the shop its key (5 minutes)

1. Sign in at https://dash.cloudflare.com → **Workers & Pages** → the Worker **vdex** → **Settings** → **Variables and Secrets** → **Add**.
2. Type: **Secret**. Variable name: `LICENCE_SHOP_KEY`. Value: the shop key from part 1, step 4. Press **Deploy** (or **Save**).

Every setting in this guide that goes into Cloudflare goes in the same place, as a **Secret**. Publishing a new version of the website keeps them.

## Part 3. Stripe (about 40 minutes, plus Stripe's checks)

1. **Account.** Sign up at https://dashboard.stripe.com/register (skip if you have one). Under **Settings → Business**, fill in: United States; Individual / Sole proprietor; your legal name, date of birth, SSN, home address and phone; industry Software; website `https://vdex.crowmade.app`; product description "One-time licence for the Vdex desktop app (downloadable software)"; statement descriptor **VDEX APP** (it must be 5 to 22 characters); and your bank account for payouts.
2. **Support email.** **Settings → Business details**: set a customer support email you read. Stripe sends buyers' questions there and may refund a buyer itself if nobody answers within 48 hours.
3. **Managed Payments.** Open https://dashboard.stripe.com/settings/managed-payments, switch it on and accept its terms. Stripe checks you are eligible (the US is supported). This makes Link, Stripe's checkout, the seller of record, so it works out, collects and pays sales tax and VAT for you, including California's new tax on downloaded software from 1 January 2027. If Stripe refuses, tell me: there are other ways.
4. **Checkout links.** **Settings → Checkout**: add the terms (`https://vdex.crowmade.app/terms.html`) and privacy policy (`https://vdex.crowmade.app/privacy.html`).
5. **Product.** **Product catalog → Create product**: name "Vdex desktop licence", description "One-time licence for Vdex on your computer, for up to 3 computers", product tax code **Downloadable Software - business use**, price **One-off, 20.00 USD**, with **Include tax in price** set to **No**: the checkout adds the tax where the buyer lives (VAT, GST or sales tax, worked out on the 20 USD). UK, EU and Australian law ask that consumers see the whole price before they buy, so Vdex shows it there: the download page lists the total with tax for the UK, Australia and each EU country, and the Buy button in Vdex shows the buyer's own (24.00 USD with VAT in the UK, for example). **Add product**.
6. **Payment link** (on the website, not the Stripe phone app). **Payment Links → New**, choose the product, quantity 1. Check **Enable Managed Payments** is ticked (it can't be changed later). In **After the payment**, choose to redirect customers to your website, with this address, exactly as written, braces included:

   `https://vdex.crowmade.app/licence/thanks?session_id={CHECKOUT_SESSION_ID}`

   Under **Advanced options → Add custom text → Near the Pay button**, paste: `You are buying a licence to use Vdex, not ownership of a copy. It can be cancelled in the cases the terms describe: vdex.crowmade.app/terms.html` (California's law on digital goods asks for this before anyone pays; the app's Buy buttons say it too). If the link already exists, edit it to add the text.

   Optionally tick **Allow promotion codes**. **Create link**.

   **Tax rates, currencies and changing the price.** The totals with tax come from `js/tax.js` (the standard rates as at November 2026); if a country changes its rate, ask me to update it, and the download page changes with it. Stripe shows buyers the price in their own currency at its exchange rate, which adds 2 to 4% (they can choose US dollars instead); Vdex says so next to Buy. A Stripe price can't be edited, so to change the price later: in the product, **Add another price**, make a new payment link with it exactly as in this step (Managed Payments ticked, the same address after payment, the same custom text), then in Cloudflare (step 7) set `BUY_URL` to the new link's address and `STRIPE_PAYMENT_LINK` to both IDs, new first, separated by a comma (`plink_new…,plink_old…`), so earlier purchases keep their codes and their sign-ins. Archive the old price so nobody buys it by mistake, and ask me to change the price in Vdex, on the download page and in the terms.
7. In Cloudflare (as in part 2), add two secrets:
   - `BUY_URL`: the link's address, starting `https://buy.stripe.com/`.
   - `STRIPE_PAYMENT_LINK`: the link's ID, starting `plink_`. It is at the end of the address bar when you open the link in the Stripe Dashboard. Only payments through this link get a code.
8. **Restricted key.** https://dashboard.stripe.com/apikeys → **Create restricted key** → start from zero permissions → name "Vdex licence Worker" → **Checkout Sessions: Read**, everything else None → **Create key**. Copy the value starting `rk_` straight away (Stripe never shows it again) and add it in Cloudflare as `STRIPE_SECRET_KEY`.
9. **Webhook.** **Workbench → Webhooks → Create an event destination** → Your account → events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded` and `charge.dispute.created` → **Webhook endpoint** → address `https://vdex.crowmade.app/licence/stripe-webhook` → **Create**. On its page press **Reveal** under the signing secret and add the value starting `whsec_` in Cloudflare as `STRIPE_WEBHOOK_SECRET`.

Stripe has a test mode ("Sandbox") with its own link, keys and webhook. You can do steps 5 to 9 there first and try a test card, then do them again in live mode and replace the four Cloudflare secrets with the live ones.

## Part 4. Emailing the codes (10 minutes)

1. Sign up at https://resend.com/signup.
2. **Domains → Add domain** → `vdex.crowmade.app` → press **Sign in to Cloudflare** and allow it, so Resend adds its records itself. Wait for **Verified**.
3. **API Keys → Create API key** → name "Vdex licences", permission **Sending access**, domain `vdex.crowmade.app`. Copy the value starting `re_` and add it in Cloudflare as `RESEND_API_KEY`.
4. Add `REPLY_TO` in Cloudflare: the email address where buyers' replies should go (your support address). The emails come from `Vdex <licences@vdex.crowmade.app>`; to change that, add `MAIL_FROM` too.

Without Resend the shop still works: buyers see their code on the thank-you page, which tells them to keep a copy.

## Part 5. The download address (15 minutes)

The installers are too big for the website, so they go in Cloudflare's file storage, R2, at `https://download.crowmade.app/vdex/`.

1. https://dash.cloudflare.com → **Storage & databases → R2** → complete the sign-up for R2 (it asks for a payment method; the free allowance still applies). Add a billing notification while you are there.
2. **Create bucket** → name `vdex-downloads`, location Automatic, storage class Standard → **Create bucket**.
3. In the bucket: **Settings → Custom Domains → Add** → `download.crowmade.app` → **Continue** → **Connect Domain**. Wait until it says **Active**. Leave the r2.dev address off.
4. The key GitHub already uses for the website can upload here too. To check: profile icon → **My Profile → API Tokens** → the token you made for GitHub → **Edit**, and look for a row "Account · Workers R2 Storage · Edit". If it is missing: **+ Add more** → Account → Workers R2 Storage → Edit → **Update token**. Nothing changes in GitHub.

## Part 6. Signing the apps (about 1½ hours over a few days)

Without signing, Windows shows "Windows protected your PC" and a Mac needs a trip to System Settings before Vdex opens, and an unsigned Mac app can't update itself. Buyers can still get past both (the download page explains how), but expect support emails. If you can do only one, do the Mac first.

**Mac (Apple Developer Program, 99 USD a year)**

1. https://developer.apple.com/programs/enroll → enroll as an Individual / Sole Proprietor with an Apple Account that has two-factor authentication and your legal name. Your legal name is shown as the developer.
2. **Certificates, IDs & Profiles → Certificates → +** → **Developer ID Application** → upload a certificate signing request (made on a Mac in Keychain Access → Certificate Assistant → Request a Certificate From a Certificate Authority; or ask me and I make one) → download the certificate. Export it with its private key from Keychain Access as a `.p12` file with a password, then turn it into text: on a Mac, `base64 -i cert.p12 | pbcopy`.
3. https://account.apple.com → **Sign-In and Security → App-Specific Passwords** → generate one named "Vdex notarize". Your Team ID is under **Membership details** on developer.apple.com.
4. In GitHub (https://github.com/TheCrowBro/Logi-Video-Production-app-/settings/secrets/actions → **New repository secret**), add `MAC_CERT_P12` (the base64 text), `MAC_CERT_PASSWORD`, `APPLE_ID` (your Apple Account email), `APPLE_APP_PASSWORD` and `APPLE_TEAM_ID`.

**Windows (Azure Artifact Signing, 9.99 USD a month)**

1. https://portal.azure.com → create a **Pay-As-You-Go** subscription with a card (free and trial subscriptions are refused). Your billing account must be an Individual one with your legal name and address exactly as on your driving licence or passport.
2. **Subscriptions → your subscription → Resource providers → Microsoft.CodeSigning → Register**. Then search **Artifact Signing Accounts → Create**: resource group `vdex-signing`, account name e.g. `vdexsigning`, region West US 2, pricing Basic.
3. In that account: **Access control (IAM) → Add role assignment → Artifact Signing Identity Verifier** → yourself. Then **Objects → Identity validations → Individual → New identity → Public**, and finish the ID check on your phone (photo ID and selfie, then the Verified ID in Microsoft Authenticator).
4. **Objects → Certificate profiles → Create → Public Trust** → name `vdexpublic` → your completed validation, street address and postal code unticked. Note the CN exactly as shown: it is your legal name.
5. **Microsoft Entra ID → App registrations → New registration** → `vdex-github-signing` → copy the Application (client) ID and Directory (tenant) ID → **Certificates & secrets → New client secret** (24 months) → copy its value. Back in the signing account: **Access control (IAM) → Add role assignment → Artifact Signing Certificate Profile Signer** → `vdex-github-signing`.
6. In GitHub, add the secrets `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET`, and on the **Variables** tab the variables `AZURE_SIGNING_ENDPOINT` = `https://wus2.codesigning.azure.net`, `AZURE_SIGNING_ACCOUNT` = `vdexsigning`, `AZURE_SIGNING_PROFILE` = `vdexpublic` and `AZURE_SIGNING_PUBLISHER` = the CN.
7. Put two reminders in your calendar: renew the client secret after 23 months, and renew the identity check when Microsoft's emails start.

Even signed, a new Windows app shows a milder "not commonly downloaded" prompt naming you, until enough people have installed it.

## Part 7. Release and try it (30 minutes)

1. Tell me you are ready (or, in GitHub: **Actions → Build desktop installers → Run workflow**, tick **Publish**, **Run workflow**). When it is green, `https://download.crowmade.app/vdex/latest.yml` shows the new version and https://vdex.crowmade.app/download.html downloads work.
2. Install Vdex on a computer that has never had it. Settings → General → About & Licence should show the free trial.
3. Buy a licence yourself through **Buy a licence**. Check the thank-you page shows a code, the email arrives, and **Enter licence code** activates it.
4. Refund yourself in Stripe. Within about a week, Vdex says the code was cancelled. To see it at once: **Release this computer**, then **Enter licence code** with the same code, and Vdex says it has been cancelled. Stripe keeps its fee on a refund.
5. Make a free code in the generator page (part 8) and try it on a second computer.

## Part 8. Everyday

**A free licence for someone.** Open the generator page → unlock `vdex-licence-key-1.json` with your passphrase → open your ledger (`ledger.csv`, after the first time) → fill in their name and email (leave **Free licence** ticked; set an end date if it is for a limited time) → **Make code** → **Write the email** opens your email program with the code and the steps → **Save ledger**. Keep the ledger with your key files: it is the only list of the free codes you have made.

**Someone lost a computer or phone, or their licence is full.** In the app they can move it themselves 3 times a month. Beyond that: generator page → **Look up, clear or cancel a code** → paste their code (or the ref from your ledger; the email they bought with is in Stripe) → **Look up** shows its devices → **Clear its computers** lets them activate afresh.

**Someone can't sign in on the website.** They must use the email address their licence belongs to (for a purchase, the one they paid with). If you made them a free code before part 9, paste it in the generator page and press **Link for website sign-in**.

**A code posted online, or a chargeback.** Chargebacks and refunds cancel the code automatically. To cancel any other code: generator page → paste it → **Cancel the code**. **Restore a cancelled code** undoes it.

**Your key is lost.** Unlock the spare (`vdex-licence-key-9-spare.json`) and carry on; tell me, and I make you a new key in the next version. Codes already made keep working. If a key file and its passphrase leaked, tell me straight away.

## Part 9. The website and the Android app (5 minutes, when you are ready)

Until you do this, the website stays free for everyone. Once you do it, every browser (including people who already use the website) gets a 30-day trial from their next visit, and is then read-only until they sign in with a licence. The Android app works the same way, and each phone also takes one of the licence's 3 places.

1. Make sure part 4 (Resend) is done: signing in works by emailing a code. Resend's free plan sends at most 100 emails a day (3,000 a month), shared with purchase emails, so Vdex sends at most 60 sign-in codes a day in all (and at most 4 a day to any one address) and keeps the rest for purchases; when the 60 are used up, sign-in says to try again tomorrow. Once many people use the website, take a paid Resend plan (from about 20 USD a month for 50,000 emails) and add the Cloudflare setting `SIGN_IN_EMAILS_PER_DAY` with a higher number, such as `1000`.
2. Update the Google Play Data safety answers (docs/google-play.md) if the Android app is already listed: signing in collects an email address.
3. In Cloudflare (as in part 2), add a **Text** variable (or a Secret) named `WEB_SIGN_IN` with the value `on`. Within about 6 hours every open copy of Vdex picks it up. To switch it off again, delete it: trials then pause, and carry on where they were if you switch it on again.
4. Try it: in a private browser window open https://vdex.crowmade.app, Settings → General → About & Licence → **Sign in**, with a licence that is live: for example a free code you made for your own email address in part 7 (the generator links it). A refunded test purchase, or one made in Stripe's test mode, cannot sign in.

Who can sign in: anyone who bought through the shop (with the email they paid with, found in Stripe if needed), anyone you made a free code for with an email address (the generator page links it when you make the code, or press **Link for website sign-in** later), and anyone who has entered their code in the desktop app. Someone with a code can also use **Have a licence code? Use it instead**: the sign-in code then goes to the email address inside it.

The Android app on Google Play should be a **free** download (docs/google-play.md): people pay for the licence on the website. Google Play does not allow a Play app to link to another way to pay, so inside the Android app Vdex shows no price and no Buy button, only **Sign in**.

Cloudflare's free plan allows 1,000 changes a day to the licence storage; each sign-in uses about three, so it is enough for about 300 sign-ins a day. Beyond that, Cloudflare's Workers Paid plan (5 USD a month) raises it to a million.

**Don't** stop the vdex Worker or delete the `vdex-licences` storage in Cloudflare: buyers' apps need it to activate and to keep working. If Vdex ever stops being sold, tell me first, and I publish a version that no longer needs it, as the terms promise.

## The Cloudflare settings, at a glance

| Name (Secret) | From | Needed for |
|---|---|---|
| `LICENCE_SHOP_KEY` | the generator page, part 1 | everything: activation and paid codes |
| `BUY_URL` | Stripe payment link, part 3 | the Buy buttons |
| `STRIPE_PAYMENT_LINK` | Stripe payment link ID, part 3 | paid codes |
| `STRIPE_SECRET_KEY` | Stripe restricted key, part 3 | paid codes |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook, part 3 | emails and refunds |
| `RESEND_API_KEY` | Resend, part 4 | emails |
| `REPLY_TO` | your support email, part 4 | emails |
| `MAIL_FROM` (optional) | | emails |
| `WEB_SIGN_IN` | `on`, part 9 | the website and the Android app asking for a licence |
| `SIGN_IN_EMAILS_PER_DAY` (optional) | a number, part 9 | more than 60 sign-in emails a day, on a paid Resend plan |

The list of devices for each licence, which email addresses belong to which licences, and the cancelled codes are kept in the KV namespace `vdex-licences`, which Cloudflare made by itself the first time the new version was published.
