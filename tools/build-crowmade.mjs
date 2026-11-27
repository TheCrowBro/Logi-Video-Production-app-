// Pages for crowmade.app (the Cloudflare Pages project "crowmade"): the home page listing every app, plus the Vdex and
// Valheim Easy Server pages. Writes crowmade/index.html, crowmade/vdex/index.html and crowmade/valheim/index.html; the
// images beside them, and crowmade/_redirects, are plain files in crowmade/.
//   node tools/build-crowmade.mjs
// Little Journee's pages (/journee/) are not here: they are a Worker of their own on crowmade.app/journee, published from the
// Children-Schedule-App repository. Vdex itself lives at vdex.crowmade.app (this repository's own website).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRICE, RATES, withTax } from '../js/tax.js';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'crowmade');
const SUPPORT = 'support@crowmade.app';
const VDEX = 'https://vdex.crowmade.app/';
const TOURBOOK = 'https://tourbook.crowmade.app/'; // its own Worker, from TheCrowBro/Gdex
const VES = 'https://github.com/TheCrowBro/Valheim-Easy-Server-'; // public: the app updates itself from its releases
const VES_DL = `${VES}/releases/latest/download/`;
// The Vdex licence's price with tax where the law asks for the whole price (js/tax.js, as on vdex.crowmade.app/download.html).
const EU = Object.keys(RATES).filter(c => c !== 'GB' && c !== 'AU').map(c => Number(withTax(c).total));
const TAXED = `${withTax('GB').total} US dollars in the UK, ${withTax('AU').total} in Australia, and ${Math.min(...EU).toFixed(2)} to ${Math.max(...EU).toFixed(2)} in the EU, depending on the country`;
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// The look: the same warm paper, serif headings and colours as Little Journee's pages (served by their own Worker), so the
// site reads as one place. Design decisions for these pages are the "Cloudflare Website Maintenance" session's (CLAUDE.md).
const CSS = `:root{--bg:#f6f2ec;--card:#fffdf9;--ink:#4a4337;--mute:#6b6354;--brand:#64759f;--brand-ink:#fff;--line:#e8e1d5;--soft:#efe9df;--ok:#3f7d55;--wait:#9a6a1f}
@media (prefers-color-scheme:dark){:root{--bg:#1e1b17;--card:#2a2621;--ink:#f1ebe2;--mute:#b8ad9d;--brand:#9fb0d8;--brand-ink:#1e1b17;--line:#3b352d;--soft:#24211c;--ok:#8cc7a0;--wait:#e0b56e}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.6 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
a{color:var(--brand)}a:focus-visible,.btn:focus-visible{outline:3px solid var(--brand);outline-offset:3px;border-radius:6px}
h1,h2,h3{font-family:Georgia,"Iowan Old Style","Palatino Linotype",serif;font-weight:normal;line-height:1.2;margin:1.6em 0 .5em}
h1{font-size:2.4em;margin:0}h2{font-size:1.55em}h3{font-size:1.15em;margin:0 0 .3em}p{margin:.6em 0}
.wrap{max-width:880px;margin:0 auto;padding:28px 16px 40px}
header.top{border-bottom:1px solid var(--line);background:var(--bg)}
header.top .in{max-width:880px;margin:0 auto;display:flex;align-items:center;gap:8px 20px;padding:12px 16px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:9px;text-decoration:none;color:var(--ink);font-family:Georgia,serif;font-size:1.2em}.brand svg{width:26px;height:26px;color:var(--ink)}
header.top nav{margin-left:auto;display:flex;gap:4px;overflow-x:auto;scrollbar-width:none}header.top nav::-webkit-scrollbar{display:none}
header.top nav a{white-space:nowrap;font-size:.93em;color:var(--mute);text-decoration:none;padding:6px 10px;border-radius:999px}
header.top nav a:hover{color:var(--ink);background:var(--soft)}header.top nav a[aria-current]{color:var(--ink);background:var(--soft);font-weight:600}
@media (max-width:600px){header.top nav{margin-left:-10px;width:calc(100% + 10px)}}
.lead{font-size:1.2em;color:var(--mute);max-width:36em}
.hero{display:flex;gap:22px;align-items:center;margin:4px 0 18px}.hero>img{width:112px;height:112px;border-radius:26px;box-shadow:0 10px 28px rgba(0,0,0,.13);flex:none}
.hero p{margin:6px 0 0;color:var(--mute);font-size:1.12em}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0 0}.chip{font-size:.8em;padding:3px 10px;border-radius:999px;border:1px solid var(--line);color:var(--mute);background:var(--card)}
.chip.ok{color:var(--ok);border-color:currentColor}.chip.wait{color:var(--wait);border-color:currentColor}
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:20px 22px;margin:14px 0}
.apps{display:grid;gap:14px;margin:26px 0}
.app{display:grid;grid-template-columns:88px 1fr;gap:18px;align-items:start;text-decoration:none;color:inherit;margin:0;transition:border-color .15s,transform .15s}
.app:hover{border-color:var(--brand);transform:translateY(-1px)}.app img{width:88px;height:88px;border-radius:21px;box-shadow:0 6px 18px rgba(0,0,0,.12)}
.app h2{margin:0;font-size:1.45em;color:var(--ink)}.app p{color:var(--mute);margin:6px 0 0}.app .more{color:var(--brand);font-weight:600;font-size:.95em;margin-top:10px;display:inline-block}
.app .chips{margin-top:8px}
.values{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:8px 0 18px}.values div{padding:4px 2px}.values b{display:block;font-family:Georgia,serif;font-weight:normal;font-size:1.12em;margin-bottom:2px}
.values p{margin:0;color:var(--mute);font-size:.95em}
.btns{display:flex;gap:12px;flex-wrap:wrap;margin:20px 0}
.btn{display:inline-block;padding:11px 22px;border-radius:999px;background:var(--brand);color:var(--brand-ink);text-decoration:none;font-weight:600;border:1.5px solid var(--brand)}
.btn:hover{filter:brightness(1.07)}.btn.alt{background:transparent;color:var(--brand)}
.price{display:grid;grid-template-columns:1fr auto;gap:6px 24px;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:22px 24px;margin:22px 0}
.price .big{font-family:Georgia,serif;font-size:1.5em;line-height:1.25;margin:0}.price .note{grid-column:1/-1;margin:6px 0 0}
.features{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin:12px 0 8px}.features .card{margin:0;padding:16px 18px}.features .card:last-child:nth-child(odd){grid-column:1/-1}.features p{margin:0;color:var(--mute);font-size:.96em}
.steps{counter-reset:s;list-style:none;padding:0;display:grid;gap:10px;margin:12px 0}
.steps li{counter-increment:s;position:relative;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px 18px 14px 58px;margin:0}
.steps li::before{content:counter(s);position:absolute;left:16px;top:13px;width:28px;height:28px;border-radius:50%;background:var(--brand);color:var(--brand-ink);font-weight:700;font-size:.9em;display:flex;align-items:center;justify-content:center}
.shots{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:22px 0}.shots img{width:100%;border-radius:18px;box-shadow:0 10px 28px rgba(0,0,0,.14);display:block}
.wide{width:100%;border-radius:14px;margin:18px 0;box-shadow:0 10px 28px rgba(0,0,0,.14);display:block}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:12px 0 18px}.grid3 figure{margin:0}.grid3 img{width:100%;border-radius:10px;box-shadow:0 6px 18px rgba(0,0,0,.12);display:block}
.grid3 figcaption{font-size:.85em;color:var(--mute);text-align:center;margin-top:6px}
.notice{border-left:4px solid var(--wait)}
.note{color:var(--mute);font-size:.94em}
code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.9em;background:rgba(127,127,127,.13);padding:1px 5px;border-radius:5px}
footer.site{border-top:1px solid var(--line);margin-top:40px;color:var(--mute);font-size:.92em}
footer.site .in{max-width:880px;margin:0 auto;padding:24px 16px 36px;display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:18px}
footer.site b{display:block;color:var(--ink);font-weight:600;margin-bottom:6px}footer.site a{color:var(--mute);display:block;margin:3px 0;text-decoration:none}footer.site a:hover{color:var(--brand);text-decoration:underline}
@media (max-width:700px){.features,.values{grid-template-columns:1fr}.shots{grid-template-columns:repeat(2,1fr)}footer.site .in{grid-template-columns:repeat(2,1fr)}}
@media (max-width:560px){h1{font-size:2em}.hero{flex-direction:column;align-items:flex-start}.hero>img{width:96px;height:96px;border-radius:22px}
.app{grid-template-columns:64px 1fr;gap:14px}.app img{width:64px;height:64px;border-radius:16px}.grid3{grid-template-columns:1fr}.price{grid-template-columns:1fr}}
@media (prefers-reduced-motion:reduce){.app{transition:none}.app:hover{transform:none}}`;

// A small crow, drawn for the wordmark (inherits the text colour, so it follows light and dark).
const CROW = '<svg viewBox="0 0 32 32" aria-hidden="true" fill="currentColor"><path d="M4 21c3.5-.4 6.3-1.6 8.6-3.9 1.9-1.9 3.1-4.4 5.4-6.1 2-1.5 4.6-2 6.7-1.1l3.3-1.4-1.6 2.9c.6 1.4.6 3.1-.1 4.6-1.3 2.9-4.2 4.6-7.2 5.6l1.5 4.4h-1.7l-1.6-4c-1 .2-2 .3-3 .3l.6 3.7h-1.6l-.9-3.8C9.7 22.3 6.6 21.9 4 21z"/><circle cx="23.4" cy="11.6" r="1" fill="var(--bg)"/></svg>';

// Every app the owner makes gets a card on the home page, a page of its own here, a place in this menu and a footer column (CLAUDE.md).
const NAV = [['/journee/', 'Little Journee'], ['/vdex/', 'Vdex'], ['/tourbook/', 'Tourbook'], ['/valheim/', 'Valheim Easy Server']];
const page = (title, body, { desc = '', icon = '/journee/icon.png', here = '/', image = '' } = {}) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>${desc ? `<meta name="description" content="${esc(desc)}">` : ''}<link rel="icon" href="${icon}">
<meta name="theme-color" content="#f6f2ec" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#1e1b17" media="(prefers-color-scheme: dark)">
<link rel="canonical" href="https://crowmade.app${here}"><meta property="og:type" content="website"><meta property="og:site_name" content="Crowmade">
<meta property="og:title" content="${esc(title)}">${desc ? `<meta property="og:description" content="${esc(desc)}">` : ''}<meta property="og:url" content="https://crowmade.app${here}">${image ? `<meta property="og:image" content="https://crowmade.app${image}">` : ''}
<style>${CSS}</style></head><body>
<header class="top"><div class="in"><a class="brand" href="/">${CROW}Crowmade</a><nav aria-label="Apps">${NAV.map(([h, n]) => `<a href="${h}"${h === here ? ' aria-current="page"' : ''}>${n}</a>`).join('')}<a href="mailto:${SUPPORT}">Support</a></nav></div></header>
<main class="wrap">${body}
</main>
<footer class="site"><div class="in">
<div><b>Crowmade</b>Small, careful apps, made by one person.<a href="mailto:${SUPPORT}">${SUPPORT}</a></div>
<div><b>Little Journee</b><a href="/journee/">About</a><a href="/journee/privacy/">Privacy policy</a><a href="/journee/terms/">Terms of use</a></div>
<div><b>Vdex</b><a href="/vdex/">About</a><a href="${VDEX}">Open Vdex</a><a href="${VDEX}privacy.html">Privacy policy</a><a href="${VDEX}terms.html">Terms of service</a></div>
<div><b>Tourbook</b><a href="/tourbook/">About</a><a href="${TOURBOOK}">Open Tourbook</a><a href="${TOURBOOK}privacy.html">Privacy policy</a><a href="${TOURBOOK}terms.html">Terms of service</a></div>
<div><b>Valheim Easy Server</b><a href="/valheim/">About</a></div>
</div></footer></body></html>
`;

const chips = list => `<div class="chips">${list.map(c => Array.isArray(c) ? `<span class="chip ${c[1]}">${c[0]}</span>` : `<span class="chip">${c}</span>`).join('')}</div>`;
const appCard = (href, icon, name, line, tags, more) => `<a class="card app" href="${href}"><img src="${icon}" alt=""><div><h2>${name}</h2>${chips(tags)}<p>${line}</p><span class="more">${more} →</span></div></a>`;
const feature = (title, text) => `<div class="card"><h3>${title}</h3><p>${text}</p></div>`;

const home = page('Crowmade', `
<h1>Crowmade</h1>
<p class="lead">Small, careful apps and tools, made by one person. Nothing here collects your data.</p>
<div class="apps">
${appCard('/journee/', '/journee/icon.png', 'Little Journee', "Your child's days, logged by the whole family. Encrypted, in your own cloud.", [['Coming soon', 'wait'], 'Android', 'iPhone'], 'See Little Journee')}
${appCard('/vdex/', '/vdex/icon.png', 'Vdex', 'For people who film things for a living: shoots, crew, kit, call sheets, stripboards, quotes and invoices, in one place.', [['Available now', 'ok'], 'iPhone', 'Android', 'Windows', 'Mac', 'Linux'], 'See Vdex')}
${appCard('/tourbook/', '/tourbook/icon.png', 'Tourbook', 'For music producers and bands: shows, studio sessions and rehearsals, songs and setlists, backline, day sheets, settlements and invoices, in one place.', [['Early access', 'wait'], 'iPhone', 'Android', 'Computer'], 'See Tourbook')}
${appCard('/valheim/', '/valheim/icon.png', 'Valheim Easy Server', 'Run a Valheim dedicated server on a spare Windows PC or Mac, and look after it with one simple app. No command line.', [['Available now', 'ok'], 'Windows', 'Mac'], 'See Valheim Easy Server')}
</div>
<div class="values">
<div><b>Your data stays yours</b><p>No tracking and no ads. What you make stays on your devices, or in your own cloud if you choose.</p></div>
<div><b>Made to be used</b><p>Plain words, clear buttons and help built in, for people who'd rather get on with the job.</p></div>
<div><b>A real person</b><p>Questions, problems, or something that reads wrong in your language: <a href="mailto:${SUPPORT}">${SUPPORT}</a>.</p></div>
</div>`,
{ desc: 'Crowmade: small, careful apps. Little Journee, Vdex for videographers, Tourbook for music producers and bands, and Valheim Easy Server.', image: '/vdex/icon.png' });

const vdex = page('Vdex', `
<div class="hero"><img src="icon.png" alt=""><div><h1>Vdex</h1><p>The production deck for people who film things for a living.</p>${chips([['Available now', 'ok'], 'iPhone', 'Android', 'Windows', 'Mac', 'Linux'])}</div></div>
<p>Vdex keeps your shoots, your crew, your camera gear, the places you film and your insurance in one place. On the day of a shoot it clocks your hours, prints your call sheet and tells you when the sun sets. Afterwards it makes the quote and the invoice.</p>
<div class="btns"><a class="btn" href="${VDEX}">Open Vdex</a><a class="btn alt" href="${VDEX}download.html">Download for Windows, Mac or Linux</a></div>
<div class="price"><p class="big">Free for 30 days, then ${PRICE} US dollars once.</p><a class="btn" href="${VDEX}buy">Buy a licence</a>
<p class="note">Works on iPhone, Android and computers. Free to try for 30 days, then ${PRICE} US dollars once plus any tax where you live, for one person on up to 3 of their devices. After the trial, Vdex stays open to read until there is a licence. With tax that is ${TAXED} (<a href="${VDEX}download.html#price">every country's price</a>). No subscription, and no account for your work: your information stays on your own device unless you choose to copy it somewhere.</p>
<p class="note">You are buying a licence to use Vdex, not ownership of a copy. It can be cancelled in the cases the <a href="${VDEX}terms.html#paid">terms</a> describe. At checkout you can pay in US dollars, or in your own currency at Stripe's exchange rate (2 to 4% more).</p></div>
<div class="shots"><img src="shot-booking.jpg" alt="A booking: the shoot, the client and the address, with its call sheet, stripboard and crew link"><img src="shot-call-sheet.jpg" alt="A call sheet filled in from the booking: call and wrap times, sunrise and sunset, the venue"><img src="shot-equipment.jpg" alt="Equipment: your kit with serial numbers and values, imported from a list you already keep, or shared by link"><img src="shot-money.jpg" alt="Money: what is invoiced, overdue, quoted and paid, shoot by shoot"></div>
<h2>What it does</h2>
<div class="features">
${feature('Bookings', 'A calendar of shoots. Tap a day, then a shoot, to see everything about it: the client, the address, the crew and the kit you\'re taking.')}
${feature('Crew, equipment, venues and insurance', 'The people you work with, grouped by 315 film and video roles; everything you own with serial numbers and where each item is, imported from the list you already keep (CSV, Excel, pasted text or an asset register); the places you film with their rules and parking; and when your policies run out.')}
${feature('Search everything', 'One search at the top finds bookings, crew, kit, quotes, invoices, call sheets and notes.')}
${feature('Pass it on by link or QR code', 'Send someone a booking, your contact card or an equipment list. They add it to their own Vdex, and a newer link updates it.')}
${feature('The shoot-day clock', 'Tap Start work, Break and Stop work, and the hours are counted for you.')}
${feature('Call sheets and a crew link', 'The call sheet is already filled in from the booking: add the schedule, then email it or print it. Or send your cast and crew a link to the schedule, location and shot list, with no prices in it.')}
${feature('Stripboard', 'Pick the script and every scene becomes a colour-coded strip with its cast and page count. Drag the strips into shooting days.')}
${feature('Budget, quotes and invoices', 'A private budget for each shoot, a price list that starts from typical freelance rates where you work, and quotes and invoices with Pay buttons for the client.')}
${feature('Field tools', 'Sunrise and sunset, a white balance reader, a noise meter and a range finder.')}
${feature('Timecode notes and a teleprompter', 'Shoot notes stamped with the camera\'s timecode, with a start-to-finish guide on a practice log. Bring in the script from Word, PDF or Final Draft to mark lines on, and run it on the teleprompter, which reads it to the talent and logs each take.')}
${feature('Safe and in sync', 'Lock it with a PIN, fingerprint or face. With a licence, connect your own Google Drive to share your information between your phone and computer, with a daily backup. iCloud, Dropbox and OneDrive are on the way.')}
</div>
<h2>Get started</h2>
<ol class="steps">
<li><b>Open Vdex</b> at <a href="${VDEX}">vdex.crowmade.app</a>, or download the desktop app from the <a href="${VDEX}download.html">download page</a>.</li>
<li><b>Put it on your home screen</b> so it works like a normal app, even with no signal. iPhone: Safari's Share button, then <i>Add to Home Screen</i>. Android and computers: open the menu <b>☰</b> at the top right and tap <i>Install Vdex</i>.</li>
<li><b>Open the menu ☰</b> and tap <i>Tutorial for this page</i> for a walkthrough of that page, box by box.</li>
</ol>
<p class="note">Something not right, or an idea? In Vdex, open <b>Settings</b> and tap <i>Report a problem or send feedback</i>.</p>
<p class="note"><a href="${VDEX}privacy.html">Privacy policy</a> · <a href="${VDEX}terms.html">Terms of service</a></p>`,
{ desc: 'Vdex: bookings, crew, kit, venues, insurance, call sheets, stripboards, budgets, quotes and invoices for freelance videographers.', icon: '/vdex/icon.svg', here: '/vdex/', image: '/vdex/icon.png' });


const tourbook = page('Tourbook', `
<div class="hero"><img src="icon.png" alt=""><div><h1>Tourbook</h1><p>The booking deck for music producers and the bands they play in, manage or produce.</p>${chips([['Early access', 'wait'], 'iPhone', 'Android', 'Computer'])}</div></div>
<p>Tourbook keeps your shows, studio sessions and rehearsals in one calendar, with your acts, the people you work with, your backline, the venues and studios you play, and your songs and setlists. On the day it gives the band a day sheet, tunes your guitar, counts you in and times your set. Afterwards it settles the night, splits the money and makes the invoice.</p>
<div class="btns"><a class="btn" href="${TOURBOOK}">Open Tourbook</a></div>
<div class="price"><p class="big">Free to use while it's new.</p>
<p class="note">Tourbook is in early access: every part of it is free for now, with nothing to sign up for. Later, the Audiophile role (for going to shows and keeping track of the bands you like) stays free for good, for your own personal use. The working roles get 30 days free on each device, then a licence of 20 US dollars once, for up to 3 of your devices. No subscription. A desktop app for Windows, Mac and Linux is on the way; until then, Tourbook installs from the browser on a phone or a computer.</p></div>
<div class="shots"><img src="shot-bookings.jpg" alt="Bookings: shows, sessions and rehearsals on one calendar, with the record player that moves between sections"><img src="shot-money.jpg" alt="Money: earned, booked ahead, unpaid and overdue, with deposits due"><img src="shot-tools.jpg" alt="Tools: a tuner, metronome, tap tempo, sound meter and set timer"><img src="shot-backline.jpg" alt="Backline: instruments with serial numbers and values, and stage packs"></div>
<h2>Made for the way you work</h2>
<p>The first time it opens, Tourbook asks who's using it: <b>Jack of Trades</b> for a bit of all of it, or <b>producer, manager, band, solo artist, scout or audiophile</b>. Each gets its own menu and pages, and you can change any time.</p>
<h2>What it does</h2>
<div class="features">
${feature('Bookings', 'Shows, studio sessions and rehearsals on one calendar, by month, week or day. Open one for everything about it.')}
${feature('Acts and people', 'The bands and artists you work with, grouped by genre, with press kits and riders; band members, session players, crew, promoters and agents.')}
${feature('Songs and setlists', 'Keys, tempos and lengths; split sheets for the writers; setlists that add up to your slot.')}
${feature('Studio log', 'A take log for recording: add a take, mark the keepers, note what to fix.')}
${feature('Backline', 'Instruments, amps, mics and cables with serial numbers and values; stage packs for the gigs you do often.')}
${feature('Venues', 'Capacity, stage, PA, curfew, load-in and the house rules, on every show there, with a map.')}
${feature('Day sheets', 'Everything the band needs on the day, shared as a link, with no money on it.')}
${feature('Money', 'What you\'ve earned and what\'s unpaid, deposits due, settlements, each person\'s share, and quotes and invoices in your own currency.')}
${feature('Tools', 'A tuner, a metronome, tap tempo with delay times, a sound level meter and a set timer.')}
${feature('Yours, and in sync', 'No account: your information stays on your own phone or computer. Connect your own Google Drive (free, for everyone) and Tourbook keeps your phone and computer the same, with a dated copy each day.')}
</div>
<h2>Get started</h2>
<ol class="steps">
<li><b>Open Tourbook</b> at <a href="${TOURBOOK}">tourbook.crowmade.app</a> on your phone or computer.</li>
<li><b>Put it on your home screen</b> so it opens like a normal app, even with no signal. iPhone: Safari's Share button, then <i>Add to Home Screen</i>. Android and computers: tap <i>Install</i> at the top of the page.</li>
<li><b>Pick your role</b>, then tap <b>?</b> at the top of any page for a walkthrough of it, box by box.</li>
</ol>
<p class="note">Tourbook is a sibling of <a href="/vdex/">Vdex</a>, the app for videographers. <a href="${TOURBOOK}privacy.html">Privacy policy</a> · <a href="${TOURBOOK}terms.html">Terms of service</a></p>`,
{ desc: 'Tourbook: shows, studio sessions and rehearsals; acts, people, backline and venues; songs, setlists and split sheets; day sheets, settlements and invoices. For music producers and bands.', icon: '/tourbook/icon.svg', here: '/tourbook/', image: '/tourbook/icon.png' });

const valheim = page('Valheim Easy Server', `
<div class="hero"><img src="icon.png" alt=""><div><h1>Valheim Easy Server</h1><p>Your own Valheim server on a spare PC or Mac. One button to start it, nobody touches a command line.</p>${chips([['Available now', 'ok'], 'Free', 'Windows', 'macOS 12 or newer'])}</div></div>
<div class="btns"><a class="btn" href="${VES_DL}ValheimEasyServer-windows.zip">Download for Windows</a><a class="btn" href="${VES_DL}ValheimEasyServer-mac.zip">Download for Mac</a><a class="btn alt" href="${VES}#readme">Read the full guide</a></div>
<p class="note">Free. The newest build, straight from <a href="${VES}/releases/latest">the project's releases</a>; after that, the app keeps itself up to date.</p>
<img class="wide" src="shot-home.jpg" alt="The control panel's home page">
<h2>What it does</h2>
<div class="features">
${feature('Start and stop with one button', 'Stopping always saves the world first.')}
${feature('How to join, always visible', 'The crossplay join code, the address and the password, with copy buttons. Crossplay codes work for Steam, Xbox, PlayStation, Switch and Game Pass players, with no router setup.')}
${feature('Several worlds', 'Switch with one click, create new ones with Valheim\'s presets and modifiers, or drop an existing world onto the app to add it.')}
${feature('Mods per world, with one code', 'Riverheim, More World Locations, Seasonality, Plant Everything and more, downloaded from Thunderstore and kept up to date. Each world gets a mods code: friends import it in r2modman or Gale and get every mod they need at once.')}
${feature('Discord', 'Posts the join code and the mods code in your channel when the server comes online, and friends can type <code>/valheim</code> to wake the computer and start it.')}
${feature('Backups', 'Valheim\'s own and the app\'s, listed together. Restore or download any of them.')}
${feature('Sleep and wake', 'Saves, stops and puts the computer to sleep, by itself when nobody has played for a while; Wake-on-LAN, <code>/valheim</code> or the power button brings it back and the server starts again.')}
${feature('Stats, players and records', 'CPU, memory, GPU and network use; who\'s online and for how long; who died the most and who lasted longest.')}
${feature('Looks after itself', 'Updates the server through Steam before each start, restarts it after a crash, and keeps the app itself up to date.')}
</div>
<div class="grid3">
<figure><img src="shot-worlds.jpg" alt="Worlds"><figcaption>Worlds</figcaption></figure>
<figure><img src="shot-stats.jpg" alt="Stats"><figcaption>Stats</figcaption></figure>
<figure><img src="shot-players.jpg" alt="Players"><figcaption>Players</figcaption></figure>
</div>
<h2>Get started</h2>
<ol class="steps">
<li>Download and unzip <b>ValheimEasyServer-windows.zip</b> (or <b>-mac.zip</b>).</li>
<li>Put it in a folder such as <code>C:\\Valheim Server</code> and double-click it. The app isn't code-signed yet, so Windows may say "Windows protected your PC": click <b>More info → Run anyway</b>. On a Mac, drag it into Applications, then right-click it and choose <b>Open</b> (on macOS 15 and newer: <b>System Settings → Privacy &amp; Security → Open Anyway</b>).</li>
<li>Click <b>Install the server</b>, set a name and password in <b>Settings</b>, then <b>Start server</b>. When it says <b>Online</b>, friends can join.</li>
</ol>
<p class="note">Works on Windows, and on macOS 12 Monterey or newer (Intel or Apple silicon). The control panel only answers on the server computer itself, so there's nothing for strangers to reach. Valheim is a trademark of Iron Gate AB; this is an independent tool.</p>`,
{ desc: 'Valheim Easy Server: run a Valheim dedicated server on a spare Windows PC or Mac with a simple control panel. Worlds, mods, Discord, backups.', icon: '/valheim/icon.png', here: '/valheim/', image: '/valheim/icon.png' });

// The old copy of Vdex's privacy policy lived at /vdex/privacy/; Vdex's own site has the current one.
const redirects = `/vdex/privacy/ ${VDEX}privacy.html 301
/vdex/privacy ${VDEX}privacy.html 301
`;

fs.writeFileSync(path.join(out, 'index.html'), home);
fs.writeFileSync(path.join(out, 'vdex', 'index.html'), vdex);
fs.writeFileSync(path.join(out, 'tourbook', 'index.html'), tourbook);
fs.writeFileSync(path.join(out, 'valheim', 'index.html'), valheim);
fs.writeFileSync(path.join(out, '_redirects'), redirects);
console.log('crowmade/ written: /, /vdex/, /tourbook/, /valheim/, _redirects');
