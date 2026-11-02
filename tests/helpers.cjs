// Shared by the browser specs. The specs test the app, not its terms gate (spec 85 does that), so they accept the
// current terms before the page loads, the way a returning user already has.
const fs = require('fs'), path = require('path');
const TERMS_VERSION = /TERMS_VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(__dirname, '..', 'js', 'terms.js'), 'utf8'))[1];
const record = JSON.stringify({ v: TERMS_VERSION, at: '2026-11-01T12:00:00.000Z' });
exports.TERMS_VERSION = TERMS_VERSION;
exports.TERMS_RECORD = record;
exports.acceptTerms = () => ({ content: `try { localStorage.setItem('logi-terms', ${JSON.stringify(record)}); } catch (e) {}` });
