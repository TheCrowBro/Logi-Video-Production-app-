// Desktop licences: the code format (desktop/licence-codes.js), the desktop app's trial, activation and read-only rules
// (desktop/licence.js, with a fake clock and a fake licence server), and the owner's generator page
// (tools/licence-generator.html), driven in a real browser from a file, as the owner uses it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
const ROOT = process.env.VDEX_ROOT || path.resolve(__dirname, '../..');
const codes = require(path.join(ROOT, 'desktop/licence-codes.js'));
const { createLicence } = require(path.join(ROOT, 'desktop/licence.js'));
const DAY = 86400e3;
const throws = async fn => { try { await fn(); return null; } catch (e) { return e; } };

(async () => {
  try {
    /* ------------------------------- the codes ------------------------------- */
    const owner = await codes.newKeyPair(), shop = await codes.newKeyPair(), spare = await codes.newKeyPair();
    const ownerKey = await codes.importPrivate(codes.b64u.enc(owner.pkcs8)), shopKey = await codes.importPrivate(codes.b64u.enc(shop.pkcs8));
    const KEYS = { 1: owner.publicKey, 2: shop.publicKey, 9: spare.publicKey };
    const fields = { name: 'Jane Smith', email: 'Jane@Example.com', serial: 4242, issued: '2026-11-02' };
    const paid = await codes.signCode(shopKey, 2, fields);
    ok('a code is VDEX- and groups of five, and signing the same order again gives the same code', /^VDEX-([0-9A-HJKMNP-TV-Z]{5}-)+[0-9A-HJKMNP-TV-Z]{1,5}$/.test(paid) && paid === (await codes.signCode(shopKey, 2, fields)), paid.length + ' characters');
    const r = await codes.verifyCode(paid, { keys: KEYS });
    ok('it checks out with the name, email (lower case), 3 computers and its ref', r.status === 'valid' && r.licence.name === 'Jane Smith' && r.licence.email === 'jane@example.com' && r.licence.seats === 3 && r.licence.ref === '2:4242' && !r.licence.comp && r.licence.issued === '2026-11-02');
    const pasted = `Hi Jane,\nYour code: ${paid.toLowerCase().replace(/-(?=.*-)/g, (m, i) => (i < 6 ? m : ' -\n  '))}\nThanks!`;
    ok('a code pasted from an email (lower case, groups split over lines, words around it) still works', (await codes.verifyCode(pasted, { keys: KEYS })).licence.ref === '2:4242');
    const i = 40, flipped = paid.slice(0, i) + (paid[i] === '0' ? '1' : '0') + paid.slice(i + 1);
    ok('changing one character makes it invalid', (await throws(() => codes.verifyCode(flipped, { keys: KEYS })))?.status === 'invalid');
    ok('a code signed by a key the app does not know is refused as unknown', (await throws(() => codes.verifyCode(paid, { keys: { 1: owner.publicKey } })))?.status === 'unknown-key');
    ok('a code signed with another key under the same number is invalid', (await throws(async () => codes.verifyCode(await codes.signCode(ownerKey, 2, fields), { keys: KEYS })))?.status === 'invalid');
    const free = await codes.signCode(ownerKey, 1, { name: 'Sam', comp: true, expires: '2026-12-31', issued: '2026-11-02', seats: 5 });
    const fr = await codes.verifyCode(free, { keys: KEYS, now: Date.parse('2026-12-31T23:00:00Z') });
    ok('a free code carries its flag, its computers and its end date, and works on its last day', fr.status === 'valid' && fr.licence.comp && fr.licence.seats === 5 && fr.licence.expires === '2026-12-31');
    ok('the day after its end date it has expired', (await codes.verifyCode(free, { keys: KEYS, now: Date.parse('2027-01-01T01:00:00Z') })).status === 'expired');
    const raw = codes.extract(paid); raw[0] = 2;
    ok('a code from a newer format asks for an update instead of calling it invalid', (await throws(() => codes.verifyCode(codes.formatCode(raw), { keys: KEYS })))?.status === 'newer');
    ok('a licence needs a name or an email, and long names are refused rather than cut', !!(await throws(() => codes.signCode(ownerKey, 1, { issued: '2026-11-02' }))) && !!(await throws(() => codes.signCode(ownerKey, 1, { name: 'x'.repeat(65) }))));
    ok('the shop shortens long names safely (whole characters, 64 bytes)', new TextEncoder().encode(codes.fitText('é'.repeat(50))).length <= 64 && !codes.fitText('é'.repeat(50)).includes('�'));
    const note = await codes.signNote('active', shopKey, 2, { ref: '2:4242', install: 'x', at: 1 });
    ok('a signed note reads back only as its own kind, and only from the keys allowed to sign it', (await codes.readNote('active', note, { keys: KEYS }))?.ref === '2:4242' && !(await codes.readNote('admin', note, { keys: KEYS })) && !(await codes.readNote('active', note, { keys: KEYS, signers: codes.OWNER_KIDS })));
    ok('a code cannot be passed off as a note, or a note edited', !(await codes.readNote('active', { kid: 2, data: JSON.stringify({ ref: '2:4242' }), sig: codes.b64u.enc(codes.extract(paid).slice(-64)) }, { keys: KEYS })) && !(await codes.readNote('active', { ...note, data: note.data.replace('4242', '4243') }, { keys: KEYS })));
    const kf = await codes.createKeyFile({ kid: 1, passphrase: 'a long passphrase here', iterations: 2000 });
    ok('a key file holds the private key only encrypted', !JSON.stringify(kf).includes(codes.b64u.enc(owner.pkcs8)) && kf.type === 'vdex-licence-signing-key' && !!kf.encryptedPrivateKey);
    ok('the wrong passphrase does not open it', /Wrong passphrase/.test((await throws(() => codes.openKeyFile(kf, 'not the passphrase!')))?.message || ''));
    const opened = await codes.openKeyFile(kf, 'a long passphrase here');
    const paper = await codes.paperBackup(kf, 'a long passphrase here'), back = await codes.keyFileFromPaper(paper, 'another long passphrase');
    ok('the paper backup (52 characters) rebuilds the same key', /^key 1: [0-9A-Z ]+$/.test(paper) && back.publicKey === kf.publicKey && back.kid === 1);
    const secret = await codes.shopSecret(kf, 'a long passphrase here');
    ok('the shop secret made from a key file signs codes its public key accepts', (await codes.verifyCode(await codes.signCode(await codes.importPrivate(secret), 1, fields), { keys: { 1: kf.publicKey } })).status === 'valid' && opened.publicKey === kf.publicKey);

    /* ------------------------- the desktop app's rules ------------------------- */
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vdex-lic-'));
    let n = 0; const dirOf = () => path.join(tmp, String(++n));
    // A fake licence server that signs real receipts, keeps a list per code, and can be told to fail.
    const server = { mode: 'ok', calls: [], lists: new Map(), cancelled: new Set(),
      async post(url, body) {
        this.calls.push({ url, body });
        if (this.mode === 'down') throw new Error('offline');
        if (this.mode === '503') return { status: 503, body: { error: 'not-ready' } };
        const v = await codes.verifyCode(body.code, { keys: KEYS }).catch(() => null); if (!v) return { status: 400, body: { error: 'invalid' } };
        const ref = v.licence.ref, list = this.lists.get(ref) || [];
        if (url.endsWith('/licence/release')) { if (!list.includes(body.install)) return { status: 404, body: { error: 'not-listed' } }; this.lists.set(ref, list.filter(x => x !== body.install)); return { status: 200, body: { ok: true } }; }
        if (this.cancelled.has(ref)) return { status: 403, body: { error: 'cancelled' } };
        if (!list.includes(body.install)) {
          if (list.length >= v.licence.seats) {
            const at = list.findIndex(x => 'T' + x === body.release);
            if (at < 0) return { status: 409, body: { error: 'full', computers: list.map(x => ({ tag: 'T' + x, os: 'Mac', added: '2026-11-01', seen: '2026-11-02' })), swapsLeft: 3 } };
            list.splice(at, 1);
          }
          list.push(body.install); this.lists.set(ref, list);
        }
        return { status: 200, body: { ok: true, receipt: await codes.signNote('active', shopKey, 2, { ref, install: this.forge || body.install, at: Date.now() }) } };
      } };
    const T0 = Date.parse('2026-11-02T10:00:00Z');
    const make = (opts = {}) => { const c = { t: opts.t || T0 }; const lic = createLicence({ dir: opts.dir || dirOf(), keys: 'keys' in opts ? opts.keys : KEYS, now: () => c.t, post: (u, b) => server.post(u, b), priorData: () => !!opts.prior, mirror: opts.mirror, site: 'http://licence.test' }); return { lic, c }; };

    const off = make({ keys: {} });
    const s0 = await off.lic.state();
    ok('with no keys built in, nobody is asked for anything', s0.mode === 'off' && s0.canEdit === true && !s0.enabled);
    const later = createLicence({ dir: path.dirname(off.lic.file), keys: KEYS, now: () => T0 + 400 * DAY, post: () => { throw new Error('x'); } });
    ok('an install that ran before selling started stays free once it does (an early user)', (await later.state()).mode === 'founder' && (await later.state()).canEdit);
    ok('an install with Vdex data from an earlier version is an early user too', (await make({ prior: true }).lic.state()).mode === 'founder');

    const tr = make();
    let s = await tr.lic.state();
    ok('a new install gets a 30-day trial', s.mode === 'trial' && s.trialLeft === 30 && s.canEdit && s.trialEnds === '2026-12-02', JSON.stringify(s));
    tr.c.t = T0 + 29.5 * DAY; s = await tr.lic.state();
    ok('on day 30 the trial is still on, with 1 day left', s.mode === 'trial' && s.trialLeft === 1 && s.canEdit);
    tr.c.t = T0 + 30 * DAY + 1000; s = await tr.lic.state();
    ok('after 30 days the trial has ended and Vdex is read-only', s.mode === 'ended' && s.canEdit === false && s.trialLeft === 0);
    tr.c.t = T0 + 2 * DAY; s = await tr.lic.state();
    ok('winding the clock back does not bring the trial back', s.mode === 'ended' && s.canEdit === false);

    const bad = await tr.lic.enter('VDEX-NOT-A-CODE');
    ok('a mistyped code is refused with a message, and nothing is saved', !!bad.error && !(await tr.lic.code()));
    tr.c.t = T0 + 31 * DAY; server.calls = [];
    s = await tr.lic.enter(pasted);
    const sent = server.calls[0];
    ok('a good code is activated online with this install\'s random ID and only "Mac/Windows/Linux"', s.mode === 'licensed' && s.canEdit && sent && sent.url === 'http://licence.test/licence/activate' && /^[A-Za-z0-9_-]{22}$/.test(sent.body.install) && Object.keys(sent.body).sort().join() === 'code,install,os' && sent.body.code === paid, JSON.stringify(sent && sent.body));
    ok('the licence shows whom it is for and how many computers', s.licence.name === 'Jane Smith' && s.licence.email === 'jane@example.com' && s.licence.seats === 3 && s.licence.ref === '2:4242');
    ok('the code is kept tidy for "Copy the code"', (await tr.lic.code()) === paid);

    // Two more computers, then a fourth finds the code full.
    const pc2 = make(), pc3 = make(), pc4 = make();
    await pc2.lic.state(); await pc3.lic.state(); await pc4.lic.state();
    ok('the same code activates on a second and third computer', (await pc2.lic.enter(paid)).mode === 'licensed' && (await pc3.lic.enter(paid)).mode === 'licensed');
    const full = await pc4.lic.enter(paid);
    ok('on a fourth computer it says the code is full and lists the others, saving nothing', full.error === 'full' && full.computers.length === 3 && full.seats === 3 && !(await pc4.lic.code()) && (await pc4.lic.state()).mode === 'trial');
    s = await pc4.lic.enter(paid, { release: full.computers[0].tag });
    ok('choosing one to move it from activates it here', s.mode === 'licensed' && server.calls.at(-1).body.release === full.computers[0].tag);
    tr.c.t += 8 * DAY; s = await tr.lic.recheck();
    ok('the computer it was moved from finds out at its weekly check and becomes read-only (trial over)', s.mode === 'released' && s.canEdit === false, s.mode);
    server.lists.set('2:4242', server.lists.get('2:4242').slice(0, 2));
    tr.c.t += 2 * DAY; s = await tr.lic.recheck();
    ok('when a place frees up, it gets back on by itself', s.mode === 'licensed' && s.canEdit);

    server.mode = 'down'; tr.c.t += 8 * DAY; s = await tr.lic.recheck();
    ok('a weekly check with no internet changes nothing', s.mode === 'licensed' && s.canEdit);
    tr.c.t += 85 * DAY; s = await tr.lic.state();
    ok('opened after a long break, it is not read-only while it is still checking', s.mode === 'licensed' && s.canEdit);
    s = await tr.lic.recheck();
    ok('after 90 days without reaching the server (and a check that fails) it is read-only until it can check', s.mode === 'offline' && s.canEdit === false);
    server.mode = 'ok'; s = await tr.lic.recheck(true);
    ok('"Try again" with the internet back puts it right', s.mode === 'licensed' && s.canEdit);
    server.cancelled.add('2:4242'); tr.c.t += 8 * DAY; s = await tr.lic.recheck();
    ok('a cancelled code (refund) makes it read-only at the next check', s.mode === 'cancelled' && s.canEdit === false);
    server.cancelled.delete('2:4242'); s = await tr.lic.recheck(true);
    ok('a restored code works again', s.mode === 'licensed');

    // Activation tampering.
    const raw2 = JSON.parse(fs.readFileSync(tr.lic.file, 'utf8')); raw2.act.receipt.data = raw2.act.receipt.data.replace(/"install":"[^"]+"/, '"install":"someone-else-entirely"'); fs.writeFileSync(tr.lic.file, JSON.stringify(raw2));
    ok('an edited activation in licence.json is not believed', (await tr.lic.state()).mode !== 'licensed');
    const pc5 = make({ t: T0 + 40 * DAY }); await pc5.lic.state(); server.forge = 'another-install-id-000'; server.lists.delete('2:4242');
    s = await pc5.lic.enter(paid); server.forge = '';
    ok('a server answer for a different computer is not taken as activation', s.mode === 'pending' && s.offline === true);

    // Offline when entering, and a server that is not set up yet.
    const pc6 = make(); await pc6.lic.state(); pc6.c.t = T0 + 40 * DAY; server.mode = 'down';
    s = await pc6.lic.enter(free.replace(/.*/, await codes.signCode(ownerKey, 1, { name: 'Offline Olly', comp: true, issued: '2026-11-02' })));
    ok('entering a code with no internet keeps it and lets Vdex be used for 14 days', s.mode === 'pending' && s.canEdit && s.daysLeft === 14 && s.offline);
    pc6.c.t += 15 * DAY; s = await pc6.lic.state();
    ok('after 14 days it stays usable until a check made after then fails', s.mode === 'pending' && s.canEdit);
    s = await pc6.lic.recheck();
    ok('after 14 days unactivated and a failed check (and the trial over) it is read-only', s.mode === 'pending' && s.canEdit === false);
    server.mode = '503'; s = await pc6.lic.recheck(true);
    ok('a licence server that is not set up yet counts as no answer', s.mode === 'pending');
    server.mode = 'ok'; pc6.c.t += 2 * 3600e3; let calls = server.calls.length; s = await pc6.lic.recheck();
    ok('after an error answer, it waits a day before asking again (not every hour)', s.mode === 'pending' && server.calls.length === calls);
    pc6.c.t += 23 * 3600e3; s = await pc6.lic.recheck();
    ok('it activates by itself once the server answers', s.mode === 'licensed' && s.licence.comp);

    // A free code with an end date is not checked online once it has ended.
    const pc7 = make(); await pc7.lic.state();
    const short = await codes.signCode(ownerKey, 1, { name: 'Short Term', comp: true, issued: '2026-11-02', expires: '2026-11-10' });
    ok('a free code with an end date activates', (await pc7.lic.enter(short)).mode === 'licensed');
    pc7.c.t = Date.parse('2026-11-20T10:00:00Z'); calls = server.calls.length;
    for (let h = 0; h < 48; h++) { pc7.c.t += 3600e3; await pc7.lic.recheck(); }
    s = await pc7.lic.state();
    ok('once it has ended, Vdex stops contacting the server for it', s.mode === 'expired' && server.calls.length === calls, `${server.calls.length - calls} calls`);

    // Deleting licence.json: the desktop app keeps a copy of the trial start in its own window-state file.
    const box = { v: null }, mirror = { get: () => box.v, set: v => { box.v = v; } };
    const pc8 = make({ mirror, prior: true }); await pc8.lic.state(); // prior: an earlier version's window-state file
    ok('an early user is recorded in the copy too', box.v && box.v.founder === true);
    const box2 = { v: null }, mirror2 = { get: () => box2.v, set: v => { box2.v = v; } };
    const dir9 = dirOf(), pc9 = make({ mirror: mirror2, dir: dir9 }); await pc9.lic.state();
    pc9.c.t = T0 + 40 * DAY; s = await pc9.lic.state();
    ok('a new install\'s trial ends as usual', s.mode === 'ended');
    fs.rmSync(path.join(dir9, 'licence.json'));
    const again = createLicence({ dir: dir9, keys: KEYS, now: () => T0 + 41 * DAY, post: (u, b) => server.post(u, b), priorData: () => true, mirror: mirror2, site: 'http://licence.test' });
    s = await again.state();
    ok('deleting licence.json neither starts a new trial nor makes it an early user', s.mode === 'ended' && s.canEdit === false, s.mode);

    // Releasing.
    server.mode = 'down'; s = await pc2.lic.release();
    ok('releasing needs the internet, so the place is really freed', !!s.error && !!(await pc2.lic.code()));
    server.mode = 'ok'; const before = (server.lists.get('2:4242') || []).length; s = await pc2.lic.release();
    ok('releasing takes this computer off the code and goes back to the trial', s.mode === 'trial' && !(await pc2.lic.code()) && server.calls.at(-1).url.endsWith('/licence/release'), `${before} → ${(server.lists.get('2:4242') || []).length}`);
    const cancelled = make(); await cancelled.lic.state(); server.cancelled.add('1:77');
    const cc = await codes.signCode(ownerKey, 1, { name: 'C', serial: 77, issued: '2026-11-02' });
    ok('a cancelled code is refused when entered', /cancelled/.test((await cancelled.lic.enter(cc)).error || '') && !(await cancelled.lic.code()));
    fs.rmSync(tmp, { recursive: true, force: true });

    /* ----------------------------- the generator ----------------------------- */
    const { buildGenerator } = await import(path.join(ROOT, 'tools/build-generator.mjs'));
    const built = fs.readFileSync(path.join(ROOT, 'tools/licence-generator.html'), 'utf8');
    ok('tools/licence-generator.html is built from the current template and code (node tools/build-generator.mjs)', built === buildGenerator());
    const csp = built.match(/Content-Security-Policy" content="([^"]+)"/)[1];
    ok('the generator can reach nothing but vdex.crowmade.app', /default-src 'none'/.test(csp) && /connect-src https:\/\/vdex\.crowmade\.app;/.test(csp) && !/https?:\/\/(?!vdex\.crowmade\.app)/.test(csp));

    const browser = await chromium.launch();
    const ctx = await browser.newContext({ acceptDownloads: true });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    const requests = []; page.on('request', q => { if (!q.url().startsWith('file:') && !q.url().startsWith('blob:') && !q.url().startsWith('data:')) requests.push(q.url()); });
    const genFile = path.join(os.tmpdir(), 'vdex-generator-' + process.pid + '.html'); fs.writeFileSync(genFile, built);
    await page.goto('file://' + genFile);
    ok('the page opens from a file with no errors and says the browser can sign', (await page.locator('#support').isHidden()) && !errors.length, errors.join(' | '));
    const downloads = [];
    page.on('download', d => downloads.push(d));
    await page.fill('#np1', 'correct horse battery staple'); await page.fill('#np2', 'correct horse battery staple');
    await page.click('#makekey');
    await page.waitForFunction(() => !document.getElementById('newkeyout').hidden, null, { timeout: 60000 });
    await page.waitForTimeout(500);
    const names = downloads.map(d => d.suggestedFilename()).sort();
    ok('making keys saves the three key files', JSON.stringify(names) === JSON.stringify(['vdex-licence-key-1.json', 'vdex-licence-key-2-shop.json', 'vdex-licence-key-9-spare.json']), names.join(', '));
    const pub = JSON.parse(await page.inputValue('#publine'));
    ok('it shows the public keys to build into Vdex', Object.keys(pub).join() === '1,2,9' && Object.values(pub).every(v => /^[A-Za-z0-9_-]{43}$/.test(v)));
    const shopText = await page.inputValue('#newshop');
    const genKeys = { 1: pub[1], 2: pub[2], 9: pub[9] };
    ok('the shop key it shows is key 2, ready for Cloudflare', (await codes.verifyCode(await codes.signCode(await codes.importPrivate(shopText), 2, fields), { keys: genKeys })).status === 'valid');
    ok('it shows paper backups of the owner key and the spare', /^key 1: .+\nkey 9: .+$/.test(await page.inputValue('#paper')));
    const k1 = await downloads.find(d => d.suggestedFilename() === 'vdex-licence-key-1.json').path();
    await page.setInputFiles('#keyfile', k1); await page.fill('#pass', 'correct horse battery staple'); await page.click('#open');
    await page.waitForFunction(() => !document.getElementById('make').hidden, null, { timeout: 30000 });
    await page.fill('#name', 'Riley Free'); await page.fill('#email', 'riley@example.com'); await page.fill('#note', '=HYPERLINK("x")');
    await page.click('#issue'); await page.waitForFunction(() => !document.getElementById('result').hidden);
    const made = await page.inputValue('#code');
    const mr = await codes.verifyCode(made, { keys: genKeys });
    ok('a free code made in the page is accepted by the app\'s own check', mr.status === 'valid' && mr.licence.comp && mr.licence.name === 'Riley Free' && mr.licence.seats === 3 && mr.licence.ref.startsWith('1:'));
    ok('the email it writes carries the code and the steps', decodeURIComponent(await page.getAttribute('#mail', 'href')).includes(made) && /Enter licence code/.test(decodeURIComponent(await page.getAttribute('#mail', 'href'))));
    const dl = page.waitForEvent('download'); await page.click('#saveledger'); const ledger = fs.readFileSync(await (await dl).path(), 'utf8');
    ok('the ledger lists the code, and a note that looks like a formula is kept as text', ledger.startsWith('issued,ref,type,name,email,expires,seats,note,code') && ledger.includes(made) && ledger.includes(`'=HYPERLINK`));
    ok('the page made no network requests while making keys and codes', requests.length === 0, requests.join(', '));
    await browser.close(); fs.rmSync(genFile, { force: true });
  } catch (e) {
    console.log('FAIL spec crashed — ' + (e && e.stack || e));
    process.exit(1);
  }
})();
