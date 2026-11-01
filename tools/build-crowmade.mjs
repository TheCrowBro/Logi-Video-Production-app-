// Pages for crowmade.app (the Cloudflare Pages project "crowmade"): the home page listing every app, plus the Vdex and
// Valheim Easy Server pages. Writes crowmade/index.html, crowmade/vdex/index.html and crowmade/valheim/index.html; the
// images and the Vdex privacy page beside them are plain files in crowmade/.
//   node tools/build-crowmade.mjs
// Little Log's pages come from the Children-Schedule-App repository; tools/deploy-crowmade.sh puts both together.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'crowmade');
const SUPPORT = 'support@crowmade.app';
const VDEX_APP = 'https://thecrowbro.github.io/Logi-Video-Production-app-/';
const VDEX_REPO = 'https://github.com/TheCrowBro/Logi-Video-Production-app-';
const VES_REPO = 'https://github.com/TheCrowBro/Valheim-Easy-Server-';
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// The same look as the Little Log pages, plus buttons and a three-up screenshot row for the wide Valheim shots.
const CSS = `:root{--bg:#f6f2ec;--card:#fffdf9;--ink:#4a4337;--mute:#6b6354;--brand:#64759f;--line:#e8e1d5}
@media (prefers-color-scheme:dark){:root{--bg:#1e1b17;--card:#2a2621;--ink:#f1ebe2;--mute:#b8ad9d;--brand:#9fb0d8;--line:#3b352d}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.55 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
a{color:var(--brand)}h1,h2,h3{font-family:Georgia,"Iowan Old Style","Palatino Linotype",serif;font-weight:normal;line-height:1.2;margin:1.4em 0 .4em}
h1{font-size:2.3em;margin-top:.4em}h2{font-size:1.5em}.wrap{max-width:760px;margin:0 auto;padding:24px 16px 48px}
header.top{display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid var(--line);flex-wrap:wrap}header.top a{text-decoration:none;color:var(--ink);font-family:Georgia,serif;font-size:1.15em}
header.top nav{margin-left:auto;display:flex;gap:16px;flex-wrap:wrap}header.top nav a{font-size:.95em;color:var(--mute)}
.hero{display:flex;gap:20px;align-items:center;margin:8px 0 20px}.hero img{width:112px;height:112px;border-radius:26px;box-shadow:0 10px 28px rgba(0,0,0,.12);flex:none}
.hero p{margin:4px 0 0;color:var(--mute);font-size:1.1em}.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px 20px;margin:14px 0}
a.card{display:block;text-decoration:none;color:inherit}a.card:hover{border-color:var(--brand)}a.card h2{color:var(--brand)}
.shots{display:flex;gap:14px;flex-wrap:wrap;justify-content:center;margin:18px 0}.shots img{width:min(46%,250px);border-radius:18px;box-shadow:0 10px 28px rgba(0,0,0,.14)}
.wide{width:100%;border-radius:14px;margin:8px 0 18px;box-shadow:0 10px 28px rgba(0,0,0,.14)}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:8px 0 18px}.grid3 figure{margin:0}.grid3 img{width:100%;border-radius:10px;box-shadow:0 6px 18px rgba(0,0,0,.12)}
.grid3 figcaption{font-size:.85em;color:var(--mute);text-align:center;margin-top:4px}@media (max-width:560px){.grid3{grid-template-columns:1fr}.hero{flex-direction:column;align-items:flex-start}}
.btns{display:flex;gap:12px;flex-wrap:wrap;margin:18px 0}.btn{display:inline-block;padding:11px 20px;border-radius:999px;background:var(--brand);color:#fff;text-decoration:none;font-weight:600}
@media (prefers-color-scheme:dark){.btn{color:#1e1b17}}.btn.alt{background:transparent;color:var(--brand);border:1.5px solid var(--brand)}
.note{color:var(--mute);font-size:.95em}footer{border-top:1px solid var(--line);margin-top:36px;padding-top:16px;color:var(--mute);font-size:.92em}
code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.92em;background:rgba(127,127,127,.12);padding:1px 5px;border-radius:5px}ul{padding-left:1.3em}li{margin:.3em 0}`;

const page = (title, body, { desc = '', icon = '/littlelog/icon.png' } = {}) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>${desc ? `<meta name="description" content="${esc(desc)}">` : ''}<link rel="icon" href="${icon}">
<style>${CSS}</style></head><body>
<header class="top"><a href="/">Crowmade</a><nav><a href="/littlelog/">Little Log</a><a href="/vdex/">Vdex</a><a href="/valheim/">Valheim Easy Server</a><a href="mailto:${SUPPORT}">Support</a></nav></header>
<main class="wrap">${body}
<footer><p>Crowmade · <a href="mailto:${SUPPORT}">${SUPPORT}</a> · Privacy: <a href="/littlelog/privacy/">Little Log</a>, <a href="/vdex/privacy/">Vdex</a></p></footer></main></body></html>
`;

const appCard = (href, icon, name, line) => `<a class="card hero" href="${href}"><img src="${icon}" alt=""><div><h2 style="margin:0">${name}</h2><p>${line}</p></div></a>`;

const home = page('Crowmade', `
<h1>Crowmade</h1>
<p class="note">Small, careful apps and tools, made by one person. Nothing here collects your data.</p>
${appCard('/littlelog/', '/littlelog/icon.png', 'Little Log', "Your child's days, logged by the whole family. Encrypted, in your own cloud.")}
${appCard('/vdex/', '/vdex/icon.png', 'Vdex', 'For people who film things for a living: shoots, crew, kit, call sheets, timecode notes, quotes and invoices, in one place.')}
${appCard('/valheim/', '/valheim/icon.png', 'Valheim Easy Server', 'Run a Valheim dedicated server on a spare Windows PC or Mac, and look after it with one simple app. No command line.')}
<p class="note">Questions, problems, or something that reads wrong in your language: <a href="mailto:${SUPPORT}">${SUPPORT}</a>.</p>`,
{ desc: 'Crowmade: small, careful apps. Little Log, Vdex for videographers, and Valheim Easy Server.' });

const vdex = page('Vdex', `
<div class="hero"><img src="icon.png" alt=""><div><h1 style="margin:0">Vdex</h1><p>The production deck for people who film things for a living.</p></div></div>
<p>Vdex keeps your shoots, your crew, your camera gear, the places you film and your insurance in one place. On the day of a shoot it clocks your hours, prints your call sheet and tells you when the sun sets. Afterwards it makes the quote and the invoice.</p>
<div class="btns"><a class="btn" href="${VDEX_APP}">Open Vdex</a><a class="btn alt" href="${VDEX_REPO}/releases/latest">Download for Windows, Mac or Linux</a></div>
<p class="note">Works on iPhone, Android and computers. No account to make, nothing to pay. Your information stays on your own device unless you choose to copy it somewhere.</p>
<div class="shots"><img src="shot-01-bookings.jpg" alt="Bookings: the calendar of shoots"><img src="shot-03-call-sheet.jpg" alt="A call sheet filled in from the booking"></div>
<h2>What it does</h2>
<ul>
<li><b>Bookings.</b> A calendar of shoots. Tap a day, then a shoot, to see everything about it: the client, the address, the crew and the kit you're taking.</li>
<li><b>Crew, equipment, venues and insurance.</b> The people you work with, everything you own with serial numbers and where each item is, the places you film with their rules and parking, and when your policies run out.</li>
<li><b>The shoot-day clock.</b> Tap Start work, Break and Stop work, and the hours are counted for you.</li>
<li><b>Call sheets.</b> Already filled in from the booking. Add the schedule, then email it to the crew or print it.</li>
<li><b>Quotes, invoices and getting paid.</b> Vdex suggests the lines from the shoot. Send the client a link that opens the invoice with Pay buttons, and record payments when the money arrives.</li>
<li><b>Field tools.</b> Sunrise and sunset, a white balance reader, a noise meter and a range finder.</li>
<li><b>Timecode notes.</b> Shoot notes stamped with the camera's timecode, with a start-to-finish guide on a practice log.</li>
<li><b>Safe and in sync.</b> Lock it with a PIN, fingerprint or face. Link Dropbox, Google Drive or OneDrive to share your information between your phone and your computer, with a daily backup.</li>
</ul>
<div class="shots"><img src="shot-06-field.jpg" alt="Field tools: sunrise, sunset and meters"><img src="shot-08-money.jpg" alt="Money: quotes, invoices and payments"></div>
<h2>Get started</h2>
<ol>
<li><b>Open Vdex</b> at <a href="${VDEX_APP}">${VDEX_APP.replace('https://', '')}</a>.</li>
<li><b>Put it on your home screen</b> so it works like a normal app, even with no signal. iPhone: Safari's Share button, then <i>Add to Home Screen</i>. Android and computers: tap <i>Install</i> at the top of the page.</li>
<li><b>Tap ?</b> at the top of any page for a walkthrough of that page, box by box.</li>
</ol>
<p class="note"><a href="privacy/">Privacy policy</a> · <a href="${VDEX_REPO}">Source and full guide on GitHub</a></p>`,
{ desc: 'Vdex: bookings, crew, kit, venues, insurance, call sheets, timecode notes, quotes and invoices for freelance videographers.', icon: '/vdex/icon.svg' });

const valheim = page('Valheim Easy Server', `
<div class="hero"><img src="icon.png" alt=""><div><h1 style="margin:0">Valheim Easy Server</h1><p>Your own Valheim server on a spare PC or Mac. One button to start it, nobody touches a command line.</p></div></div>
<div class="btns"><a class="btn" href="${VES_REPO}/releases/latest">Download for Windows or Mac</a><a class="btn alt" href="${VES_REPO}#readme">Read the full guide</a></div>
<img class="wide" src="shot-home.jpg" alt="The control panel's home page">
<h2>What it does</h2>
<ul>
<li><b>Start and stop with one button.</b> Stopping always saves the world first.</li>
<li><b>How to join, always visible.</b> The crossplay join code, the address and the password, with copy buttons. Crossplay codes work for Steam, Xbox, PlayStation, Switch and Game Pass players, with no router setup.</li>
<li><b>Several worlds.</b> Switch with one click, create new ones with Valheim's presets and modifiers, or drop an existing world onto the app to add it.</li>
<li><b>Mods per world.</b> Riverheim, More World Locations, Seasonality, Plant Everything and more, downloaded from Thunderstore and kept up to date. Players get a pop-up telling them what they need.</li>
<li><b>Discord.</b> Posts the join code in your channel when the server comes online, and friends can type <code>/valheim</code> to wake the computer and start it.</li>
<li><b>Backups.</b> Valheim's own and the app's, listed together. Restore or download any of them.</li>
<li><b>Hibernate and wake.</b> Saves, stops and hibernates (or sleeps) the computer; Wake-on-LAN brings it back and the server starts again.</li>
<li><b>Stats, players and records.</b> CPU, memory, GPU and network use; who's online and for how long; who died the most and who lasted longest.</li>
<li><b>Looks after itself.</b> Updates the server through Steam before each start, restarts it after a crash, and updates the app itself from its GitHub releases.</li>
</ul>
<div class="grid3">
<figure><img src="shot-worlds.jpg" alt="Worlds"><figcaption>Worlds</figcaption></figure>
<figure><img src="shot-stats.jpg" alt="Stats"><figcaption>Stats</figcaption></figure>
<figure><img src="shot-players.jpg" alt="Players"><figcaption>Players</figcaption></figure>
</div>
<h2>Get started</h2>
<ol>
<li>Download <b>ValheimEasyServer-windows.zip</b> (or <b>-mac.zip</b>) from the <a href="${VES_REPO}/releases/latest">newest release</a> and unzip it.</li>
<li>Put it in a folder such as <code>C:\\Valheim Server</code> and double-click it. On a Mac, drag it into Applications and open it.</li>
<li>Click <b>Install the server</b>, set a name and password in <b>Settings</b>, then <b>Start server</b>. When it says <b>Online</b>, friends can join.</li>
</ol>
<p class="note">Works on Windows, and on macOS 12 Monterey or newer (Intel or Apple silicon). The control panel only answers on the server computer itself, so there's nothing for strangers to reach. Valheim is a trademark of Iron Gate AB; this is an independent tool.</p>`,
{ desc: 'Valheim Easy Server: run a Valheim dedicated server on a spare Windows PC or Mac with a simple control panel. Worlds, mods, Discord, backups.', icon: '/valheim/icon.png' });

fs.writeFileSync(path.join(out, 'index.html'), home);
fs.writeFileSync(path.join(out, 'vdex', 'index.html'), vdex);
fs.writeFileSync(path.join(out, 'valheim', 'index.html'), valheim);
console.log('crowmade/ written: /, /vdex/, /valheim/');
