// Crew roles: the Role box of the crew form and of "Hire someone for this job" is a button that opens a menu of every
// common film, television and video role in fold-down groups, one department each (js/roles.js, js/role-picker.js).
// A role is found by any of its names, a role typed by hand is kept under My roles (in the database: it survives a
// reload, a backup, a cloud sync and a merge), and the Crew page filters by group first, then by role. Roles already
// on crew cards are left exactly as they are, and rates price quotes as before.
const { chromium } = require('playwright');
const { acceptTerms, chooseRole } = require('../helpers.cjs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
const OUT = process.env.S || '.';
const FULL = 43.9; // a 44 px target, less the hair's breadth a measured box can lose to rounding
const URL = process.env.VDEX_URL || 'http://localhost:8123/';
const OLD = ['Director', 'Producer', 'DOP', 'Camera Operator', '1st AC', '2nd AC', 'Gaffer', 'Grip', 'Sound Recordist', 'Boom Operator', 'Drone Pilot', 'Editor', 'Colourist', 'Motion Designer', 'MUA', 'Stylist', 'Runner', 'Location Manager', 'Talent', 'Presenter', 'Other'];
const ASKED = ['Producing', 'Directing and ADs', 'Camera', 'Lighting', 'Grip', 'Sound', 'Art department', 'Costume', 'Hair and make-up', 'Locations', 'Script and continuity', 'Casting', 'Talent and on-screen', 'Stunts and safety', 'Production support', 'Data and DIT', 'Editing and colour', 'Sound post and music', 'VFX and motion graphics', 'Live, broadcast and events', 'Stills', 'Drone and specialist camera', 'Social and content'];
const setup = async ctx => {
  await ctx.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"daily":{"time":[]}}' }));
  await ctx.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); });
  await ctx.addInitScript(acceptTerms());
};
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await setup(ctx);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' || /Content Security Policy|Refused to/.test(m.text())) errors.push(m.text()); });
  page.on('dialog', d => d.accept());
  const scripts = []; page.on('request', r => { if (r.resourceType() === 'script') scripts.push(r.url()); });
  const rolesLoaded = () => scripts.filter(u => /\/js\/(roles|role-picker)\.js/.test(u)).map(u => u.split('/').pop());
  await page.goto(URL); await page.waitForSelector('#rolodex .drum-btn'); await sleep(800);
  ok('the roles are not part of the start-up: nothing of them is loaded with the Bookings page', rolesLoaded().length === 0, rolesLoaded().join(', '));
  await page.evaluate(() => import('./js/store.js').then(s => s.loadSample()));
  const store = fn => page.evaluate(fn);
  const card = name => page.locator('.crew-card', { hasText: name });
  const roleBtn = page.locator('.sheet form button[data-key="role"]');
  const menu = page.locator('.role-menu');
  const openMenu = async () => { await roleBtn.click(); await menu.waitFor(); await sleep(150); };
  const groupEl = name => page.locator(`.role-group[data-group="${name}"]`);
  const openGroup = async name => { await groupEl(name).locator('summary').click(); await sleep(150); };
  const save = async () => { await page.locator('.sheet form button[type=submit]').click(); await sleep(400); };
  const addCrew = async name => { await page.getByRole('button', { name: '+ Add' }).click(); await page.waitForSelector('.sheet form'); await page.locator('.sheet form input[data-key="name"]').fill(name); };
  const mine = () => store(() => import('./js/store.js').then(s => s.db.myRoles.map(r => r.name).sort()));
  const active = () => page.evaluate(() => { const a = document.activeElement; return { tag: a.tagName, cls: a.className, text: (a.querySelector('.role-name, .twirl-name') || a).textContent.trim(), key: a.dataset.key || '', current: a.getAttribute('aria-current') }; });

  // ---- the list itself ----
  const list = await store(() => import('./js/roles.js').then(m => ({
    groups: m.ROLE_GROUPS.map(g => [g.name, g.roles.length]), names: m.allRoles(), every: m.ROLE_GROUPS.flatMap(g => g.roles.flatMap(r => [r.name, ...r.aka])).map(m.fold),
    producing: m.ROLE_GROUPS.find(g => g.name === 'Producing').roles.map(r => r.name),
    same: ['Cinematographer', 'dp', 'Director of Photography', 'Focus Puller', 'make up artist', 'Colorist', 'Clapper Loader'].map(n => (m.findRole(n) || { role: {} }).role.name),
    groupOf: ['Talent', 'Camera Operator', 'Steadicam Operator', 'Vision Mixer', 'Streaming Engineer', 'Medic', 'Some job nobody listed', ''].map(m.groupOf),
    support: m.ROLE_GROUPS.find(g => g.name === 'Production support').roles.map(r => r.name),
    filed: ['Production Assistant', 'PA', 'Set PA', 'Office PA', '2nd 2nd AD', 'Crowd 2nd AD', 'Still Photographer', 'Floor Runner'].map(n => { const hit = m.findRole(n); return hit ? `${hit.role.name} (${hit.group})` : 'not listed'; }),
  })));
  const total = list.groups.reduce((n, g) => n + g[1], 0);
  ok(`the list is comprehensive: ${total} roles in ${list.groups.length} groups (at least 150)`, total >= 150 && total === list.names.length && list.groups.length >= 20);
  ok('no role, and no other name for a role, appears twice', new Set(list.every).size === list.every.length && new Set(list.names).size === list.names.length, list.every.filter((n, i) => list.every.indexOf(n) !== i).join(', '));
  ok('each of the 21 roles offered before is still a choice under the same name', OLD.every(o => list.names.includes(o)), OLD.filter(o => !list.names.includes(o)).join(', '));
  ok('the groups asked for are all there, and no group is empty', ASKED.every(g => list.groups.some(x => x[0] === g)) && list.groups.every(g => g[1] > 0), ASKED.filter(g => !list.groups.some(x => x[0] === g)).join(', '));
  ok('similar jobs sit together: Producing runs from Executive Producer to Production Coordinator', ['Executive Producer', 'Producer', 'Co-Producer', 'Line Producer', 'Associate Producer', 'Production Manager', 'Production Coordinator'].every(r => list.producing.includes(r)), list.producing.join(', '));
  ok('British names come first and the American and short forms lead to them (DOP, 1st AC, MUA, Colourist, 2nd AC)', JSON.stringify(list.same) === JSON.stringify(['DOP', 'DOP', 'DOP', '1st AC', 'MUA', 'Colourist', '2nd AC']), list.same.join(', '));
  ok('Production Assistant leads Production support, beside the runners, and is not among the producers; PA, Set PA and Office PA are its other names', list.support[0] === 'Production Assistant' && list.support.slice(1, 4).join() === 'Runner,Floor Runner,Production Runner' && !list.producing.includes('Production Assistant') && list.filed.slice(0, 4).every(f => f === 'Production Assistant (Production support)') && list.filed[7] === 'Floor Runner (Production support)', JSON.stringify([list.support.slice(0, 4), list.filed]));
  ok('“2nd 2nd AD” is the American name for the 3rd AD, not for the Crowd 2nd AD, and “Still Photographer” finds the Stills Photographer', list.filed[4] === '3rd AD (Directing and ADs)' && list.filed[5] === 'Crowd 2nd AD (Directing and ADs)' && list.filed[6] === 'Stills Photographer (Stills)', list.filed.slice(4, 7).join(' | '));
  const other = await store(() => import('./js/roles.js').then(m => ({ fold: ['Réalisateur', 'realisateur', 'Оператор-постановщик', '撮影助手', '🎬', '  '].map(m.fold), group: ['Оператор-постановщик', '撮影助手', '🎬'].map(m.groupOf), typed: [m.resolveRole('  撮影助手 '), m.resolveRole('x'.repeat(80)).length, m.resolveRole('COLORIST'), m.resolveRole('')] })));
  ok('roles in other alphabets, with accents or in signs are told apart and are roles of your own; a typed role is tidied, 60 letters at most', other.fold[0] === other.fold[1] && new Set(other.fold.slice(1, 5)).size === 4 && other.fold[5] === '' && other.group.every(g => g === 'My roles') && JSON.stringify(other.typed) === JSON.stringify(['撮影助手', 60, 'Colorist', '']), JSON.stringify(other));
  ok('every role knows its group, a role of your own is under My roles, and no role is no group', JSON.stringify(list.groupOf) === JSON.stringify(['Talent and on-screen', 'Camera', 'Drone and specialist camera', 'Live, broadcast and events', 'Live, broadcast and events', 'Production support', 'My roles', '']), list.groupOf.join(' | '));

  // ---- the menu, from the crew form ----
  await page.evaluate(() => window.logiGo('crew')); await sleep(400);
  // (without the time each record was last changed: the backup brought back further down stamps every record as changed then, so a restore outranks deletions made before it; spec 97)
  const before = await store(() => import('./js/store.js').then(s => JSON.stringify(s.db.crew.map(({ updatedAt, ...c }) => c))));
  await addCrew('Ana Grip');
  ok('the form\'s Role box is a button with its label, saying nothing is chosen yet (no free-text box, no datalist)', (await roleBtn.count()) === 1 && (await roleBtn.getAttribute('aria-label')) === 'Role: none chosen' && (await roleBtn.getAttribute('aria-haspopup')) === 'dialog' && (await roleBtn.getAttribute('type')) === 'button'
    && (await page.locator('.sheet form label', { hasText: 'Role' }).getAttribute('for')) === (await roleBtn.getAttribute('id')) && (await roleBtn.innerText()).includes('Choose a role') && (await page.locator('.sheet form input[data-key="role"], .sheet form datalist').count()) === 0);
  await openMenu();
  ok('the menu is loaded when the button is first tapped', rolesLoaded().includes('role-picker.js') && rolesLoaded().includes('roles.js'));
  const shown = await page.evaluate(() => [...document.querySelectorAll('.role-menu .role-group')].map(d => ({ name: d.querySelector('.twirl-name').textContent, n: d.querySelectorAll('.role-opt').length, pill: d.querySelector('summary .pill').textContent, open: d.open, summary: d.firstElementChild.tagName })));
  ok('it is a dialog called Choose a role, over the form', (await page.locator('.sheet[role=dialog][aria-label="Choose a role"]').count()) === 1 && (await page.locator('.sheet').count()) === 2);
  ok('it lists every group as a fold-down, in order, each saying how many roles it holds', JSON.stringify(shown.map(g => [g.name, g.n])) === JSON.stringify(list.groups) && shown.every(g => g.summary === 'SUMMARY' && g.pill === `${g.n} roles`), shown.map(g => `${g.name} ${g.pill}`).join(' | ').slice(0, 300));
  ok('every group starts folded when no role is chosen', shown.every(g => !g.open) && (await page.locator('.role-menu .role-opt:visible').count()) === 0);
  const hint = await page.evaluate(() => { const p = document.querySelector('.role-menu .role-hint'), s = document.querySelector('.role-menu .search').getBoundingClientRect(), g = document.querySelector('.role-menu .role-group').getBoundingClientRect(), r = p ? p.getBoundingClientRect() : null; return { text: p ? p.textContent : '', under: !!r && r.top >= s.bottom && r.bottom <= g.top, shown: !!r && r.height > 0, buttons: p ? p.querySelectorAll('button, a').length : -1, size: p ? parseFloat(getComputedStyle(p).fontSize) : 0 }; });
  ok('one line under the search box says another name for a role can be searched for and picked', hint.text === 'Prefer another name, such as DP or Sound Mixer? Search for it and pick it.' && hint.under && hint.shown && hint.buttons === 0 && hint.size >= 13, JSON.stringify(hint));
  await openGroup('Grip');
  const grip = await groupEl('Grip').locator('.role-opt:visible .role-name').allInnerTexts();
  ok('tapping a group opens its roles', (await groupEl('Grip').evaluate(d => d.open)) && grip.length === list.groups.find(g => g[0] === 'Grip')[1] && grip.includes('Key Grip') && grip.includes('Dolly Grip'), grip.join(', '));
  await openGroup('Sound');
  ok('opening another group folds the first, so the menu stays short', (await groupEl('Sound').evaluate(d => d.open)) && !(await groupEl('Grip').evaluate(d => d.open)) && (await page.locator('.role-menu details[open]').count()) === 1);
  ok('a role shows its other names under it', /Production Sound Mixer/.test(await groupEl('Sound').locator('.role-opt', { hasText: 'Sound Recordist' }).locator('.role-aka').innerText()));
  // What that line promises: the other names shown under a role are not buttons, and searching for one offers it.
  const akaTap = await groupEl('Sound').locator('.role-opt', { hasText: 'Sound Recordist' }).locator('.role-aka').evaluate(e => e.closest('button').querySelector('.role-name').textContent);
  await page.locator('.role-menu .search').fill('Sound Mixer'); await sleep(200);
  const offered = await page.locator('.role-results .role-opt').first().innerText();
  const hintGone = await page.locator('.role-menu .role-hint').isHidden();
  await page.locator('.role-menu .search').fill('DP'); await sleep(200);
  const offered2 = await page.locator('.role-results .role-opt').first().innerText();
  await page.locator('.role-menu .search').fill(''); await sleep(200);
  ok('…which is true: a tap on the small print under Sound Recordist would choose Sound Recordist, while searching “Sound Mixer” or “DP” offers that very name to pick (the line steps aside for the results)', akaTap === 'Sound Recordist' && /^Sound Mixer\s+Same as Sound Recordist · Sound$/.test(offered.trim()) && /^DP\s+Same as DOP · Camera$/.test(offered2.trim()) && hintGone && (await page.locator('.role-menu .role-hint').isVisible()), JSON.stringify([akaTap, offered, offered2, hintGone]));
  await openGroup('Grip');
  await groupEl('Grip').locator('.role-opt', { has: page.locator('.role-name', { hasText: /^Key Grip$/ }) }).click(); await sleep(250);
  ok('tapping a role chooses it: the menu closes, the button shows the role and takes the focus back', (await menu.count()) === 0 && (await page.locator('.sheet').count()) === 1 && (await roleBtn.innerText()).includes('Key Grip') && (await roleBtn.getAttribute('aria-label')) === 'Role: Key Grip' && (await active()).key === 'role');
  await save();
  ok('the role is saved on the card', (await store(() => import('./js/store.js').then(s => s.db.crew.find(c => c.name === 'Ana Grip').role))) === 'Key Grip' && /Key Grip/.test(await card('Ana Grip').innerText()));
  ok('a role from the list is not put under My roles', (await mine()).length === 0);

  // ---- by keyboard ----
  await addCrew('Kit Keys');
  await page.locator('.sheet form input[data-key="name"]').focus(); await page.keyboard.press('Tab');
  const onBtn = (await active()).key === 'role';
  await page.keyboard.press('Enter'); await menu.waitFor(); await sleep(200);
  const first = await active();
  ok('Tab reaches the Role button, Enter opens the menu, and the focus lands on the first group', onBtn && first.tag === 'SUMMARY' && first.text === 'Producing', JSON.stringify(first));
  for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowDown');
  const onCamera = await active();
  await page.keyboard.press('Enter'); await sleep(200);
  const opened = await groupEl('Camera').evaluate(d => d.open);
  await page.keyboard.press('ArrowDown');
  const onDop = await active();
  await page.keyboard.press('Enter'); await sleep(250);
  ok('the arrow keys walk the groups, Enter opens one, Down steps into its roles and Enter chooses', onCamera.tag === 'SUMMARY' && onCamera.text === 'Camera' && opened && onDop.cls.includes('role-opt') && onDop.text === 'DOP' && (await menu.count()) === 0 && (await roleBtn.innerText()).includes('DOP') && (await active()).key === 'role', JSON.stringify([onCamera, onDop]));
  await page.keyboard.press('Enter'); await menu.waitFor(); await sleep(200);
  const cur = await active();
  ok('opened again, the menu is on the current role: its group open, the role marked and focused, and named at the top', cur.current === 'true' && cur.text === 'DOP' && (await page.locator('.role-menu details[open] .twirl-name').allInnerTexts()).join() === 'Camera' && /Chosen:\s*DOP/.test(await page.locator('.role-now').innerText()) && (await page.locator('.role-menu .role-opt[aria-current="true"]').count()) === 1, JSON.stringify(cur));
  // What a screen reader is told while typing: every announcement made from here on is noted down.
  await page.evaluate(() => { window.__said = []; new MutationObserver(() => { const r = document.getElementById('sr-live'), t = r ? r.textContent : ''; if (t && /role/i.test(t)) window.__said.push(t); }).observe(document.body, { childList: true, subtree: true, characterData: true }); });
  await page.keyboard.type('gaf', { delay: 150 });
  const saidEarly = await page.evaluate(() => window.__said.slice()); // three letters in, and still typing as far as Vdex knows
  await sleep(200);
  const found = await page.locator('.role-results .role-opt .role-name').allInnerTexts();
  ok('typing anywhere in the menu searches it', (await page.locator('.role-menu .search').inputValue()) === 'gaf' && found[0] === 'Gaffer' && (await page.locator('.role-groups').isHidden()), found.join(', '));
  await sleep(900);
  const saidLate = await page.evaluate(() => window.__said.slice());
  ok('the number of roles found is said once, when typing has paused, not at every letter', saidEarly.length === 0 && saidLate.length === 1 && /^\d+ roles? found$/.test(saidLate[0]), JSON.stringify([saidEarly, saidLate]));
  await page.keyboard.press('Enter'); await sleep(250);
  ok('Enter in the search box takes the first role found', (await menu.count()) === 0 && (await roleBtn.innerText()).includes('Gaffer'));
  await page.keyboard.press('Enter'); await menu.waitFor(); await sleep(200);
  await page.keyboard.type('boom'); await sleep(200);
  await page.keyboard.press('Escape'); await sleep(250);
  ok('Escape in a search box with something typed empties it and shows the groups again, the menu staying open', (await menu.count()) === 1 && (await page.locator('.role-menu .search').inputValue()) === '' && (await page.locator('.role-groups').isVisible()) && (await page.locator('.role-results').isHidden()));
  await page.keyboard.press('Escape'); await sleep(250);
  ok('Escape closes the menu and nothing else: the form is still there, the role unchanged, the focus back on the button', (await menu.count()) === 0 && (await page.locator('.sheet form').count()) === 1 && (await roleBtn.innerText()).includes('Gaffer') && (await active()).key === 'role');
  await openMenu();
  await page.locator('.role-now button', { hasText: 'Clear the role' }).click(); await sleep(250);
  ok('the role can be cleared', (await menu.count()) === 0 && (await roleBtn.getAttribute('aria-label')) === 'Role: none chosen' && (await roleBtn.innerText()).includes('Choose a role'));
  await openMenu();
  await page.locator('.role-menu .search').fill('focus pull'); await sleep(200);
  const alias = await page.locator('.role-results .role-opt').first().innerText();
  ok('a role is found by its other name, which says what it is the same as', /^Focus Puller\s+Same as 1st AC · Camera$/.test(alias.trim()), alias);
  await page.locator('.role-results .role-opt').first().click(); await sleep(250);
  await save();
  ok('…and is saved under the name that was picked', (await store(() => import('./js/store.js').then(s => s.db.crew.find(c => c.name === 'Kit Keys').role))) === 'Focus Puller' && (await mine()).length === 0);

  // ---- a role of your own ----
  await addCrew('Zed Own');
  await page.evaluate(() => { const b = document.querySelector('.sheet form button[data-key="role"]'); b.click(); b.click(); }); await menu.first().waitFor(); await sleep(250);
  ok('two quick taps on the Role button open one menu, not two', (await menu.count()) === 1 && (await page.locator('.sheet').count()) === 2);
  await page.locator('.role-menu .search').fill('zzz'); await sleep(200);
  ok('a search that finds nothing says so and offers what was typed', /No role like “zzz” in the list/.test(await page.locator('.role-results').innerText()) && (await page.locator('.role-results button', { hasText: 'Use “zzz” as the role' }).count()) === 1);
  await page.locator('.role-menu .search').fill(''); await sleep(150);
  ok('the box for another role is at the end of the menu, with its label', (await page.evaluate(() => { const own = document.querySelector('.role-own'); return own === document.querySelector('.role-menu').lastElementChild && own.querySelector('label').htmlFor === own.querySelector('input').id; })) && /Type another role/.test(await page.locator('.role-own label').innerText()));
  await page.locator('.role-own input').fill('  Jib   assistant '); await page.locator('.role-own button', { hasText: 'Use this role' }).click(); await sleep(250);
  ok('a role typed by hand is taken as written, tidied', (await menu.count()) === 0 && (await roleBtn.getAttribute('aria-label')) === 'Role: Jib assistant');
  ok('…and nothing is kept until the form is saved', (await mine()).length === 0);
  await save();
  const kept = await store(() => import('./js/store.js').then(s => s.db.myRoles.map(r => ({ id: r.id, name: r.name, at: typeof r.updatedAt }))));
  ok('saving the form keeps it in the database, under My roles', JSON.stringify(kept) === JSON.stringify([{ id: 'myrole:jib assistant', name: 'Jib assistant', at: 'number' }]) && (await store(() => import('./js/store.js').then(s => s.db.crew.find(c => c.name === 'Zed Own').role))) === 'Jib assistant', JSON.stringify(kept));
  await addCrew('Tmp Person');
  await openMenu();
  const firstGroup = await page.locator('.role-menu .role-group').first().evaluate(d => ({ name: d.dataset.group, pill: d.querySelector('.pill').textContent, open: d.open }));
  ok('next time My roles is the first group', firstGroup.name === 'My roles' && firstGroup.pill === '1 role' && !firstGroup.open, JSON.stringify(firstGroup));
  await openGroup('My roles');
  ok('…holding the role, marked as in use and without a Forget button while someone has it', (await groupEl('My roles').locator('.role-opt .role-name').allInnerTexts()).join() === 'Jib assistant' && /In use/.test(await groupEl('My roles').locator('.role-opt').innerText()) && (await groupEl('My roles').locator('button[aria-label^="Forget"]').count()) === 0);
  await page.locator('.role-own input').fill('gaffer'); await page.keyboard.press('Enter'); await sleep(250);
  ok('typing a role that is in the list gives the listed role, not a second one of your own', (await roleBtn.getAttribute('aria-label')) === 'Role: Gaffer');
  await openMenu();
  await page.locator('.role-own input').fill('Clapper trainee'); await page.keyboard.press('Enter'); await sleep(250);
  await save();
  await store(() => import('./js/store.js').then(s => s.remove('crew', s.db.crew.find(c => c.name === 'Tmp Person').id))); await sleep(300);
  ok('a second role of your own is kept too, and stays when the person who had it is deleted', JSON.stringify(await mine()) === JSON.stringify(['Clapper trainee', 'Jib assistant']));
  await page.reload(); await page.waitForSelector('#rolodex .drum-btn');
  await page.evaluate(() => window.logiGo('crew')); await sleep(400);
  await addCrew('Tmp Two'); await openMenu(); await openGroup('My roles');
  const afterReload = await groupEl('My roles').locator('.role-opt .role-name').allInnerTexts();
  ok('after closing and opening Vdex again, My roles still lists them', afterReload.join() === 'Clapper trainee,Jib assistant' && (await groupEl('My roles').locator('button[aria-label="Forget Clapper trainee"]').count()) === 1, afterReload.join());
  await page.keyboard.press('Escape'); await sleep(200); await page.keyboard.press('Escape'); await sleep(200);

  // ---- a backup, the cloud and another device ----
  const backup = await store(() => import('./js/store.js').then(s => s.exportJSON()));
  await store(() => import('./js/store.js').then(s => s.replaceAll({ bookings: [], crew: [] }))); await sleep(200);
  const wiped = await mine();
  await page.evaluate(text => import('./js/backup.js').then(b => b.importData(new File([text], 'vdex-backup.json', { type: 'application/json' }))), backup); await sleep(400);
  ok('a backup carries My roles: gone with the data, back when the backup is imported', JSON.parse(backup).myRoles.length === 2 && wiped.length === 0 && JSON.stringify(await mine()) === JSON.stringify(['Clapper trainee', 'Jib assistant']) && (await store(() => import('./js/store.js').then(s => s.db.crew.some(c => c.name === 'Zed Own' && c.role === 'Jib assistant')))));
  await page.evaluate(() => window.logiGo('crew')); await sleep(300);
  await addCrew('Tmp Three'); await openMenu(); await openGroup('My roles');
  ok('…and the menu lists them again', (await groupEl('My roles').locator('.role-opt .role-name').allInnerTexts()).join() === 'Clapper trainee,Jib assistant');
  await groupEl('My roles').locator('button[aria-label="Forget Clapper trainee"]').click(); await sleep(300);
  const forgot = await store(() => import('./js/store.js').then(s => ({ names: s.db.myRoles.map(r => r.name), dead: s.db.deleted['myrole:clapper trainee'] > 0 })));
  ok('a role of your own that nobody has can be forgotten, there and then', JSON.stringify(forgot.names) === JSON.stringify(['Jib assistant']) && forgot.dead && (await groupEl('My roles').locator('.role-opt .role-name').allInnerTexts()).join() === 'Jib assistant' && (await groupEl('My roles').evaluate(d => d.open)) && (await active()).tag === 'SUMMARY', JSON.stringify(forgot));
  await page.keyboard.press('Escape'); await sleep(200); await page.keyboard.press('Escape'); await sleep(200);
  const synced = await page.evaluate(async () => {
    const s = await import('./js/store.js');
    const remote = JSON.parse(s.exportJSON()); remote.myRoles = [{ id: 'myrole:crane swinger', name: 'Crane swinger', updatedAt: Date.now() }]; remote.updatedAt = Date.now();
    let written = null;
    s.cloud.adapter = { id: 'fake', label: 'Fake', ready: async () => true, read: async () => remote, write: async t => { written = JSON.parse(t); } };
    await s.sync(); await new Promise(r => setTimeout(r, 300)); s.cloud.adapter = null;
    return { here: s.db.myRoles.map(r => r.name).sort(), there: written && written.myRoles.map(r => r.name).sort(), status: s.cloud.status };
  });
  ok('a cloud sync brings in the roles kept on another device and sends this device\'s: both end with both', JSON.stringify(synced.here) === JSON.stringify(['Crane swinger', 'Jib assistant']) && JSON.stringify(synced.there) === JSON.stringify(synced.here), JSON.stringify(synced));
  const merged = await page.evaluate(async () => {
    const s = await import('./js/store.js'), names = d => d.myRoles.map(r => r.name).sort().join();
    const mineHere = JSON.parse(s.exportJSON()), other = JSON.parse(s.exportJSON());
    other.deleted = { ...other.deleted, 'myrole:crane swinger': Date.now() + 1000 }; other.myRoles = other.myRoles.filter(r => r.id !== 'myrole:crane swinger'); // forgotten there, after it was kept here
    const forgotten = names(s.mergeDb(mineHere, other));
    mineHere.myRoles = mineHere.myRoles.map(r => (r.id === 'myrole:crane swinger' ? { ...r, updatedAt: Date.now() + 5000 } : r)); // typed again here, later still
    return { forgotten, again: names(s.mergeDb(mineHere, other)), untouched: names(s.mergeDb(mineHere, { ...other, myRoles: undefined })) };
  });
  ok('merging two devices: a role forgotten on one goes from both, and one typed again afterwards comes back', merged.forgotten === 'Jib assistant' && merged.again === 'Crane swinger,Jib assistant' && merged.untouched === 'Crane swinger,Jib assistant', JSON.stringify(merged));
  const refused = await page.evaluate(async () => {
    const s = await import('./js/store.js'), r = await import('./js/roles.js');
    s.setGate(() => false); const kept = r.rememberRole('Night nurse'), gone = r.forgetRole('Jib assistant'); s.setGate(null);
    return { kept, gone, names: s.db.myRoles.map(x => x.name).sort().join() };
  });
  ok('while Vdex is read-only nothing is kept or forgotten', refused.kept === false && refused.gone === false && refused.names === 'Crane swinger,Jib assistant', JSON.stringify(refused));

  // ---- existing crew keep the roles they have ----
  const sample = () => store(() => import('./js/store.js').then(s => JSON.stringify(s.db.crew.filter(c => ['Sam Rivera', 'Jo Chen', 'Mika Dahl', 'Priya Nair'].includes(c.name)).map(({ updatedAt, ...c }) => c))));
  ok('the crew that were there before are exactly as they were', (await sample()) === before && JSON.parse(before).map(c => c.role).join() === 'Sound Recordist,1st AC,Gaffer,Editor');
  await store(() => import('./js/store.js').then(s => { s.upsert('crew', { id: 'old-odd', name: 'Odd Role', role: 'Sound recordist / fixer', phone: '', email: '', link: '', rate: 300, rateUnit: 'day', notes: '' }); s.upsert('crew', { id: 'old-none', name: 'No Role Yet', role: '', phone: '', email: '', link: '', rate: '', notes: '' }); })); await sleep(400);
  await card('Odd Role').locator('button[aria-label="Edit Odd Role"]').click(); await page.waitForSelector('.sheet form');
  const oddShown = await roleBtn.getAttribute('aria-label');
  await page.locator('.sheet form textarea[data-key="notes"]').fill('Edited, role left alone'); await save();
  ok('a card whose role is not in the list shows it in the form and keeps it, letter for letter, when saved', oddShown === 'Role: Sound recordist / fixer' && (await store(() => import('./js/store.js').then(s => s.byId('crew', 'old-odd').role))) === 'Sound recordist / fixer');
  await card('Odd Role').locator('button[aria-label="Edit Odd Role"]').click(); await page.waitForSelector('.sheet form'); await openMenu();
  const odd = await page.evaluate(() => ({ open: [...document.querySelectorAll('.role-menu details[open] .twirl-name')].map(e => e.textContent).join(), current: [...document.querySelectorAll('.role-menu .role-opt[aria-current="true"] .role-name')].map(e => e.textContent).join(), mine: [...document.querySelectorAll('.role-group[data-group="My roles"] .role-name')].map(e => e.textContent).join() }));
  ok('…and the menu lists it under My roles, open on it, without it having been typed there', odd.open === 'My roles' && odd.current === 'Sound recordist / fixer' && odd.mine === 'Crane swinger,Jib assistant,Sound recordist / fixer' && !(await mine()).includes('Sound recordist / fixer'), JSON.stringify(odd));
  await page.keyboard.press('Escape'); await sleep(200); await page.keyboard.press('Escape'); await sleep(200);
  await card('Sam Rivera').locator('button[aria-label="Edit Sam Rivera"]').click(); await page.waitForSelector('.sheet form'); await openMenu();
  const sam = await page.evaluate(() => ({ open: [...document.querySelectorAll('.role-menu details[open] .twirl-name')].map(e => e.textContent).join(), current: [...document.querySelectorAll('.role-menu .role-opt[aria-current="true"] .role-name')].map(e => e.textContent).join() }));
  ok('a card with one of the old roles opens the menu on that role in its group', sam.open === 'Sound' && sam.current === 'Sound Recordist', JSON.stringify(sam));
  await page.keyboard.press('Escape'); await sleep(200); await page.keyboard.press('Escape'); await sleep(200);

  // ---- the Crew page's chips: group first, then role ----
  const chips = sel => page.locator(sel + ' .chip').allInnerTexts();
  const names = () => page.locator('.crew-card strong').allInnerTexts();
  const chip = (row, text) => page.locator(row + ' .chip', { hasText: new RegExp('^' + text + '$') });
  ok('the chips are All, then one for each group that has people in the menu\'s order, My roles for roles of your own, and No role', JSON.stringify(await chips('.chips:not(.by-role)')) === JSON.stringify(['All', 'Camera', 'Lighting', 'Grip', 'Sound', 'Editing and colour', 'My roles', 'No role']) && (await page.locator('.chips.by-role').count()) === 0, (await chips('.chips:not(.by-role)')).join(' | '));
  ok('the people are listed by group in that order', JSON.stringify(await names()) === JSON.stringify(['Jo Chen', 'Kit Keys', 'Mika Dahl', 'Ana Grip', 'Sam Rivera', 'Priya Nair', 'Zed Own', 'Odd Role', 'No Role Yet']), (await names()).join(', '));
  await chip('.chips:not(.by-role)', 'Camera').click(); await sleep(250);
  ok('choosing a group shows its people, and a second row with the roles in use in it', JSON.stringify(await names()) === JSON.stringify(['Jo Chen', 'Kit Keys']) && JSON.stringify(await chips('.chips.by-role')) === JSON.stringify(['Whole group', '1st AC', 'Focus Puller']) && (await chip('.chips:not(.by-role)', 'Camera').getAttribute('aria-pressed')) === 'true' && (await chip('.chips:not(.by-role)', 'All').getAttribute('aria-pressed')) === 'false' && (await chip('.chips.by-role', 'Whole group').getAttribute('aria-pressed')) === 'true');
  ok('the chip that was tapped keeps the focus, and both rows are named for a screen reader', (await page.evaluate(() => document.activeElement.textContent)) === 'Camera' && (await page.locator('.chips:not(.by-role)').getAttribute('role')) === 'group' && (await page.locator('.chips.by-role').getAttribute('aria-label')) === 'Show one role in Camera');
  await chip('.chips.by-role', '1st AC').click(); await sleep(250);
  ok('choosing a role in the second row narrows it to that role', JSON.stringify(await names()) === JSON.stringify(['Jo Chen']) && (await chip('.chips.by-role', '1st AC').getAttribute('aria-pressed')) === 'true' && (await chip('.chips.by-role', 'Whole group').getAttribute('aria-pressed')) === 'false');
  await page.locator('.search').fill('kit'); await sleep(250);
  const none = await page.locator('.empty').innerText().catch(() => '');
  await page.locator('.search').fill(''); await sleep(250);
  await chip('.chips.by-role', 'Whole group').click(); await sleep(250);
  await page.locator('.search').fill('kit'); await sleep(250);
  ok('the search box works with the chips: within the role, then within the group', /No matches/.test(none) && JSON.stringify(await names()) === JSON.stringify(['Kit Keys']) && (await page.evaluate(() => document.activeElement.classList.contains('search'))));
  await page.locator('.search').fill(''); await sleep(250);
  await chip('.chips:not(.by-role)', 'My roles').click(); await sleep(250);
  ok('a role of your own belongs to My roles', JSON.stringify(await names()) === JSON.stringify(['Zed Own', 'Odd Role']) && JSON.stringify(await chips('.chips.by-role')) === JSON.stringify(['Whole group', 'Jib assistant', 'Sound recordist / fixer']));
  await chip('.chips:not(.by-role)', 'No role').click(); await sleep(250);
  ok('people with no role have a chip of their own, with no second row', JSON.stringify(await names()) === JSON.stringify(['No Role Yet']) && (await page.locator('.chips.by-role').count()) === 0);
  await chip('.chips:not(.by-role)', 'Lighting').click(); await sleep(250);
  ok('a group with one role in use needs no second row', JSON.stringify(await names()) === JSON.stringify(['Mika Dahl']) && (await page.locator('.chips.by-role').count()) === 0);
  await chip('.chips:not(.by-role)', 'All').click(); await sleep(250);
  await page.locator('.search').fill('sam'); await sleep(250);
  const byName = await names();
  await page.locator('.search').fill('lighting'); await sleep(250);
  const byGroup = await names();
  await page.locator('.search').fill('production sound mixer'); await sleep(250);
  const byOther = await names();
  await page.locator('.search').fill(''); await sleep(250);
  ok('the search finds people by name as before, and now by their group or another name for their role', JSON.stringify(byName) === JSON.stringify(['Sam Rivera']) && JSON.stringify(byGroup) === JSON.stringify(['Mika Dahl']) && JSON.stringify(byOther) === JSON.stringify(['Sam Rivera']), JSON.stringify([byName, byGroup, byOther]));
  await chip('.chips:not(.by-role)', 'Grip').click(); await sleep(250);
  await store(() => import('./js/store.js').then(s => s.remove('crew', s.db.crew.find(c => c.name === 'Ana Grip').id))); await sleep(400);
  ok('when the last person of the chosen group goes, the filter lets go and everyone is shown', !(await chips('.chips:not(.by-role)')).includes('Grip') && (await names()).length === 8 && (await chip('.chips:not(.by-role)', 'All').getAttribute('aria-pressed')) === 'true', (await names()).join(', '));

  // ---- hiring someone for a job uses the same menu ----
  const harbour = await store(() => import('./js/store.js').then(s => { const b = s.db.bookings.find(x => /Harbour/.test(x.title)); s.update(d => { const x = d.bookings.find(y => y.id === b.id); delete x.endDate; x.hires = []; }); return b.id; }));
  await page.evaluate(() => window.logiGo('bookings')); await sleep(400);
  await page.evaluate(id => import('./js/pages/bookings.js').then(m => m.openBooking(id)), harbour); await page.waitForSelector('.bk-detail'); await sleep(300);
  await page.locator('#bk-hires button', { hasText: 'Hire someone' }).click(); await page.waitForSelector('.sheet form');
  ok('"Hire someone for this job" has the same Role button', (await page.locator('.sheet[aria-label="Hire someone for this job"]').count()) === 1 && (await roleBtn.count()) === 1 && (await roleBtn.getAttribute('aria-label')) === 'Role: none chosen' && (await page.locator('.sheet form input[data-key="role"], .sheet form datalist').count()) === 0);
  await openMenu();
  const hireMenu = await page.evaluate(() => [...document.querySelectorAll('.role-menu .role-group')].map(d => [d.dataset.group, d.querySelectorAll('.role-opt').length]));
  ok('…opening the same menu: My roles first, then the same groups and roles', JSON.stringify(hireMenu) === JSON.stringify([['My roles', 3], ...list.groups]), JSON.stringify(hireMenu.slice(0, 3)));
  await page.keyboard.press('Escape'); await sleep(200);
  await page.locator('.sheet form input[data-key="name"]').fill('Pat Pilot'); await chooseRole(page, 'Drone Pilot'); await page.locator('.sheet form input[data-key="rate"]').fill('600'); await save();
  await page.locator('#bk-hires button', { hasText: 'Hire someone' }).click(); await page.waitForSelector('.sheet form');
  await page.locator('.sheet form input[data-key="name"]').fill('Nia Nurse'); await openMenu();
  await page.locator('.role-own input').fill('Location nurse'); await page.keyboard.press('Enter'); await sleep(250);
  await page.locator('.sheet form input[data-key="rate"]').fill('35'); await page.locator('.sheet form select').selectOption('hour'); await save();
  const hires = await store(() => import('./js/store.js').then(s => (s.db.bookings.find(x => /Harbour/.test(x.title)).hires || []).map(x => [x.name, x.role, x.rate, x.rateUnit])));
  ok('a hired person gets a role from the list, or one typed by hand', JSON.stringify(hires) === JSON.stringify([['Pat Pilot', 'Drone Pilot', 600, 'day'], ['Nia Nurse', 'Location nurse', 35, 'hour']]) && /Drone Pilot · \$600\/day/.test(await page.locator('#bk-hires').innerText()), JSON.stringify(hires));
  ok('…and the typed one is kept under My roles as well', JSON.stringify(await mine()) === JSON.stringify(['Crane swinger', 'Jib assistant', 'Location nurse']));

  // ---- rates price quotes as before ----
  const lines = await page.evaluate(id => import('./js/money.js').then(m => import('./js/store.js').then(s => m.suggestLines(s.byId('bookings', id), 'quote', 'booking').filter(l => /^Crew:/.test(l.desc)).map(l => [l.desc, l.qty, l.unit, l.price]))), harbour);
  ok('the quote still prices each person at their rate, with the role beside the name', JSON.stringify(lines) === JSON.stringify([['Crew: Sam Rivera (Sound Recordist)', 1, 'day', 450], ['Crew: Jo Chen (1st AC)', 1, 'day', 400], ['Crew: Pat Pilot (Drone Pilot)', 1, 'day', 600], ['Crew: Nia Nurse (Location nurse)', 10, 'hour', 35]]), JSON.stringify(lines));
  const pl = await store(() => import('./js/price-list.js').then(m => m.startList('uk').filter(i => ['sound', 'gaffer', 'drone'].includes(i.key)).map(i => [i.key, i.price > 0])));
  ok('the price list\'s typical rates are untouched by the roles (they go by their own lines)', JSON.stringify(pl) === JSON.stringify([['sound', true], ['gaffer', true], ['drone', true]]), JSON.stringify(pl));
  ok('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();

  // ---- the layout on a phone 360 px wide, and on a wide screen ----
  for (const [w, hgt, scheme] of [[360, 740, 'dark'], [1200, 800, 'light']]) {
    const c2 = await browser.newContext({ viewport: { width: w, height: hgt }, deviceScaleFactor: 1, colorScheme: scheme });
    await setup(c2);
    const p = await c2.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(URL); await p.waitForSelector('#rolodex .drum-btn');
    await p.evaluate(() => import('./js/store.js').then(s => { s.loadSample(); s.upsert('crew', { id: 'w1', name: 'Dee Dop', role: 'DOP', phone: '', email: '', rate: 800, rateUnit: 'day', notes: '' }); s.upsert('crew', { id: 'w2', name: 'Uma Underwater', role: 'Underwater Camera Operator', phone: '', email: '', rate: '', notes: '' }); s.upsert('crew', { id: 'w3', name: 'Kai Custom', role: 'Assistant to the second unit’s travelling circus', phone: '', email: '', rate: '', notes: '' }); }));
    await p.evaluate(() => window.logiGo('crew')); await sleep(400);
    await p.locator('.chips:not(.by-role) .chip', { hasText: /^Camera$/ }).click(); await sleep(300);
    const crewPage = await p.evaluate(() => ({ wide: document.documentElement.scrollWidth - innerWidth, chips: Math.min(...[...document.querySelectorAll('.chip')].map(c => c.getBoundingClientRect().height)), rows: [...document.querySelectorAll('.chips')].map(r => r.getBoundingClientRect()).every(r => r.left >= 0 && r.right <= innerWidth) }));
    ok(`${w} px: the Crew page with both rows of chips fits the width, and every chip is at least 44 px tall`, crewPage.wide <= 0 && crewPage.chips >= FULL && crewPage.rows, JSON.stringify(crewPage));
    await p.screenshot({ path: `${OUT}/roles-${w}-crew.png` });
    await p.locator('.chips:not(.by-role) .chip', { hasText: /^All$/ }).click(); await sleep(250);
    await p.locator('.crew-card button[aria-label="Edit Kai Custom"]').click(); await p.waitForSelector('.sheet form');
    const btn = await p.locator('.sheet form button[data-key="role"]').evaluate(b => { const r = b.getBoundingClientRect(), f = b.closest('.field').getBoundingClientRect(); return { h: r.height, inField: r.left >= f.left - 1 && r.right <= f.right + 1, clipped: b.querySelector('.role-pick-text').scrollWidth > b.querySelector('.role-pick-text').clientWidth, oneLine: r.height < 60 }; });
    ok(`${w} px: the Role button is a full-size target inside its field, and a long role is cut short on one line instead of spilling`, btn.h >= FULL && btn.inField && btn.oneLine && (w > 400 || btn.clipped), JSON.stringify(btn));
    await p.keyboard.press('Escape'); await sleep(200);
    await p.getByRole('button', { name: '+ Add' }).click(); await p.waitForSelector('.sheet form');
    await p.locator('.sheet form button[data-key="role"]').click(); await p.waitForSelector('.role-menu'); await sleep(400);
    await p.screenshot({ path: `${OUT}/roles-${w}-menu.png` });
    const closed = await p.evaluate(() => { const sheet = document.querySelector('.role-menu').closest('.sheet'), body = sheet.querySelector('.sheet-body'), r = sheet.getBoundingClientRect(); return { in: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, scrolls: body.scrollHeight > body.clientHeight, sideways: body.scrollWidth - body.clientWidth, doc: document.documentElement.scrollWidth - innerWidth, summaries: Math.min(...[...document.querySelectorAll('.role-group summary')].map(s => s.getBoundingClientRect().height)), search: document.querySelector('.role-menu .search').getBoundingClientRect().height }; });
    ok(`${w} px: the menu sits inside the screen and scrolls inside its sheet, never sideways; groups and the search box are at least 44 px tall`, closed.in && closed.scrolls && closed.sideways <= 0 && closed.doc <= 0 && closed.summaries >= FULL && closed.search >= FULL, JSON.stringify(closed));
    await p.locator('.role-group[data-group="Live, broadcast and events"] summary').click(); await sleep(300);
    const big = await p.evaluate(() => { const g = document.querySelector('.role-group[open]'), body = g.closest('.sheet-body'), b = body.getBoundingClientRect(), opts = [...g.querySelectorAll('.role-opt')].map(o => o.getBoundingClientRect()), head = document.querySelector('.role-head').getBoundingClientRect(), sum = g.querySelector('summary').getBoundingClientRect(); return { n: opts.length, minH: Math.min(...opts.map(o => o.height)), inside: opts.every(o => o.left >= b.left && o.right <= b.right), sideways: body.scrollWidth - body.clientWidth, cols: getComputedStyle(g.querySelector('.role-list')).gridTemplateColumns.split(' ').length, summaryInView: sum.top >= head.bottom - 1 && sum.bottom <= b.bottom }; });
    ok(`${w} px: the biggest group (${big.n} roles) opens with its heading in view, every role a full-size target inside the sheet, in ${w < 560 ? 'one column' : 'two columns'}`, big.n >= 20 && big.minH >= FULL && big.inside && big.sideways <= 0 && big.cols === (w < 560 ? 1 : 2) && big.summaryInView, JSON.stringify(big));
    await p.screenshot({ path: `${OUT}/roles-${w}-group.png` });
    await p.locator('.role-own input').scrollIntoViewIfNeeded(); await sleep(200);
    const end = await p.evaluate(FULL => { const body = document.querySelector('.role-menu').closest('.sheet-body').getBoundingClientRect(), s = document.querySelector('.role-menu .search').getBoundingClientRect(), own = document.querySelector('.role-own'), row = [...own.querySelectorAll('input, button')].map(e => e.getBoundingClientRect()); return { searchStays: s.top >= body.top - 1 && s.bottom <= body.bottom, ownIn: row.every(r => r.left >= body.left && r.right <= body.right && r.height >= FULL) }; }, FULL);
    ok(`${w} px: scrolled to the end, the search box is still at the top and the box for another role fits beside its button`, end.searchStays && end.ownIn, JSON.stringify(end));
    await p.locator('.role-menu .search').fill('pro'); await sleep(300);
    const res = await p.evaluate(() => { const body = document.querySelector('.role-menu').closest('.sheet-body'); return { n: document.querySelectorAll('.role-results .role-opt').length, top: body.scrollTop, sideways: body.scrollWidth - body.clientWidth, note: !!document.querySelector('.role-results p') }; });
    ok(`${w} px: a search with many answers starts at the top, shows the first 40 and says to keep typing`, res.n === 40 && res.top === 0 && res.sideways <= 0 && res.note, JSON.stringify(res));
    await p.screenshot({ path: `${OUT}/roles-${w}-search.png` });
    ok(`${w} px: no page errors`, errs.length === 0, errs.join(' | '));
    await c2.close();
  }
  // ---- the Crew page: repairs after 1.4.0 ----
  {
    const c3 = await browser.newContext({ viewport: { width: 420, height: 900 } });
    await c3.addInitScript(() => { localStorage.setItem('logi-tour', 'done'); }); await c3.addInitScript(acceptTerms());
    const cp = await c3.newPage(); const errs3 = []; cp.on('pageerror', e => errs3.push(e.message)); cp.on('dialog', d => d.accept());
    await cp.goto(URL); await cp.waitForSelector('#rolodex .drum-btn');
    await cp.evaluate(() => import('./js/store.js').then(s => s.update(d => { for (const [id, name, role] of [['c1', 'Sam Rivera', 'Sound Recordist'], ['c2', 'Jo Chen', '1st AC'], ['c3', 'Mika Dahl', 'Gaffer'], ['c4', 'Priya Nair', 'Editor']]) d.crew.push({ id, name, role, notes: '' }); })));
    await cp.evaluate(() => window.logiGo('crew')); await sleep(350);
    const people = () => cp.locator('.crew-card strong').allInnerTexts();
    await cp.locator('.search').fill('priya'); await sleep(250);
    const found = await people();
    await cp.locator('.crew-card button[aria-label="Edit Priya Nair"]').click(); await cp.waitForSelector('.sheet form');
    await cp.locator('.sheet form .btn.danger').click(); await sleep(400);
    ok('deleting the one person a search found, in a list then too short for the search box, shows the people who are left', found.join() === 'Priya Nair' && (await people()).length === 3 && (await cp.locator('.empty', { hasText: 'No matches.' }).count()) === 0 && (await cp.locator('.search').count()) === 0, (await people()).join());
    await cp.locator('.page-head button.primary').click(); await cp.waitForSelector('.sheet form');
    await cp.locator('.sheet form input[data-key="name"]').fill('   '); await cp.locator('.sheet form button[type=submit]').click(); await sleep(300);
    ok('a name made of spaces is refused: the form stays, and nobody without a name is added', (await cp.locator('.sheet form').count()) === 1 && (await cp.evaluate(() => import('./js/store.js').then(s => s.db.crew.length))) === 3);
    await cp.locator('.sheet form input[data-key="name"]').fill('😀 Sam'); await cp.locator('.sheet form button[type=submit]').click(); await sleep(350);
    const initials = await cp.locator('.crew-card', { hasText: '😀 Sam' }).locator('.avatar').innerText();
    ok('the initials of a name that starts with an emoji are whole characters', initials === '😀S', JSON.stringify(initials));
    ok('the Crew page repairs: no page errors', errs3.length === 0, errs3.join(' | '));
    await c3.close();
  }
  await browser.close();
})().catch(e => { console.log('FAIL spec crashed — ' + (e.stack || e.message)); process.exit(1); });
