// Shared by the browser specs. The specs test the app, not its terms gate or its PIN set-up (specs 85 and 109 do
// that), so they accept the current terms and skip the PIN set-up before the page loads, the way a returning user
// already has. The skip flag never affects a PIN that exists: the lock screen is tested by specs 10 and 11.
const fs = require('fs'), path = require('path');
const TERMS_VERSION = /TERMS_VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(__dirname, '..', 'js', 'terms.js'), 'utf8'))[1];
const record = JSON.stringify({ v: TERMS_VERSION, at: '2026-11-01T12:00:00.000Z' });
exports.TERMS_VERSION = TERMS_VERSION;
exports.TERMS_RECORD = record;
exports.acceptTerms = () => ({ content: `try { localStorage.setItem('logi-terms', ${JSON.stringify(record)}); localStorage.setItem('logi-lock-setup', 'skip'); } catch (e) {}` });
// Picks a crew role in the open form (Crew, or hiring someone for a booking) the way a person does: the Role button
// opens the menu of roles, the search box finds the role by its name, and a tap chooses it.
exports.chooseRole = async (page, name) => {
  await page.locator('.sheet form button[data-key="role"]').click();
  await page.locator('.role-menu .search').fill(name);
  await page.locator('.role-results .role-opt').filter({ has: page.locator('.role-name', { hasText: new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }) }).first().click();
  await page.locator('.role-menu').waitFor({ state: 'detached' });
};
// Opens a Settings section by its exact title, together with the group it sits in (General, Work & billing), the way
// a link into Settings does, and scrolls to it. The page must already be on Settings.
exports.openSetting = (page, title) => page.evaluate(t => { const d = [...document.querySelectorAll('details.settings-section, details.settings-group')].find(x => x.querySelector(':scope > summary .ss-title')?.textContent === t); if (!d) throw new Error('no Settings section ' + t); for (let p = d; p; p = p.parentElement && p.parentElement.closest('details')) p.open = true; d.scrollIntoView(); }, title);
