// Report a problem or send feedback: its own button at the top of Settings, apart from the fold-downs. It writes an
// email to the publisher's support address in the person's own email app, with what helps to answer filled in: the
// version and build, where Vdex runs (the website, the installed web app, the Google Play or iPhone app, the desktop
// app), the browser and the window, the display settings, the language, the kind of storage linked, and the errors met
// since Vdex opened (js/app.js keeps the last few, in memory only). Nothing from the person's records goes in it, and
// Vdex sends nothing: they see the whole email and send it themselves. Where no email app opens (a computer with none
// set up), Copy puts the address and the details on the clipboard to paste into an email written elsewhere.
// Fetched on the button's first tap. It takes from the start-up modules only names that 1.4.0 has too, so a page still
// running 1.4.0 that fetches it after an update can open it as well.
import { h, sheet, toast } from './util.js';
import { VERSION, BUILD, BUILT } from './version.js';
import { isApp } from './native.js';
import { prefsSummary } from './a11y.js';
import * as store from './store.js';

export const SUPPORT = 'support@crowmade.app';

// Where this Vdex runs, in words (as js/install.js tells them apart).
function where() {
  const ua = navigator.userAgent;
  if (/\bElectron\//.test(ua)) return `the desktop app on ${/Windows/.test(ua) ? 'Windows' : /Macintosh|Mac OS X/.test(ua) ? 'a Mac' : 'Linux'}`;
  if (isApp) return 'the iPhone app';
  let play = false;
  try { play = /[?&]src=play(&|$)/.test(location.search) || /^android-app:\/\/app\.crowmade\.vdex/.test(document.referrer) || !!JSON.parse(localStorage.getItem('vdex-licence') || '{}').play; } catch { /* ignore */ }
  if (play) return 'the Google Play app';
  const installed = ['standalone', 'window-controls-overlay', 'minimal-ui', 'fullscreen'].some(m => matchMedia(`(display-mode: ${m})`).matches) || navigator.standalone === true;
  return installed ? 'the web app, installed from the browser' : 'the website, in a browser';
}

// The details, one per line: nothing a person typed into Vdex, nothing that names them.
export function details() {
  const c = store.cloud || {};
  let zone = '', display = '';
  try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { /* ignore */ }
  try { display = prefsSummary(); } catch { /* ignore */ }
  const errors = (Array.isArray(window.__vdexErrors) ? window.__vdexErrors : []).slice(-3);
  return [
    `Vdex ${VERSION}${BUILD && BUILD !== 'dev' ? `, build ${BUILD}${BUILT ? ` (${BUILT})` : ''}` : ''}`,
    `Running as: ${where()}`,
    `Browser: ${navigator.userAgent}`,
    `Window: ${innerWidth} × ${innerHeight}, pixel ratio ${Math.round((devicePixelRatio || 1) * 100) / 100}`,
    `Display: ${display || 'standard'}`,
    `Language: ${navigator.language || 'not known'}${zone ? `, time zone ${zone}` : ''}`,
    `Storage: ${c.adapter ? `${c.adapter.label || 'linked'}${c.paused ? ', paused' : c.status ? `, ${c.status}` : ''}` : 'this device only'}`,
    `Connection: ${navigator.onLine === false ? 'offline' : 'online'}`,
    errors.length ? `Errors since Vdex opened:\n${errors.map(e => `- ${e}`).join('\n')}` : 'Errors since Vdex opened: none',
  ].join('\n');
}

const NOTE = '-- The details below help us find the problem. Vdex filled them in; nothing from your bookings, crew, kit or notes is in them. --';
// The email, for the person's own email app (an email with a long body can be cut short by some, so the details come last).
export const mailtoFor = (subject, ask, info = details()) => `mailto:${SUPPORT}?` + new URLSearchParams({ subject, body: `${ask}\n\n\n${NOTE}\n${info}\n` }).toString().replace(/\+/g, '%20');

export function openFeedback() {
  const info = details();
  const problem = mailtoFor(`Vdex ${VERSION}: a problem`, 'What happened:\n\n\nWhat you expected instead:\n\n\nWhat you did just before (the steps, if you can):');
  const idea = mailtoFor(`Vdex ${VERSION}: feedback`, 'Your idea or feedback:');
  const copy = async () => {
    const text = `To: ${SUPPORT}\n\n${NOTE}\n${info}\n`;
    try { await navigator.clipboard.writeText(text); toast(`Copied. Paste it into an email to ${SUPPORT}`); }
    catch { const r = document.createRange(); r.selectNodeContents(pre); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('Select the details and copy them'); }
  };
  const pre = h('pre', { class: 'feedback-details small', tabindex: '0', 'aria-label': 'The details the email includes' }, info);
  sheet('Report a problem or send feedback', h('div', { class: 'stack feedback' },
    h('p', null, 'Something not working, or an idea for Vdex? Your email app opens with a message to ', h('b', null, SUPPORT), '. Say what happened in your own words: Vdex adds the details below. Nothing is sent until you send it.'),
    h('div', { class: 'actions' },
      h('a', { class: 'btn primary feedback-problem', href: problem }, '🐞 Report a problem'),
      h('a', { class: 'btn ghost feedback-idea', href: idea }, '💡 Send an idea or feedback')),
    h('div', { class: 'pref-label' }, 'What the email includes'),
    pre,
    h('p', { class: 'small muted' }, 'Nothing from your bookings, crew, kit or notes. A screenshot helps too: add it to the email.'),
    h('p', { class: 'small muted' }, 'No email app opens? Copy the details and paste them into an email to ', h('b', null, SUPPORT), ' from wherever you write email.'),
    h('div', { class: 'actions' }, h('button', { class: 'btn ghost feedback-copy', type: 'button', onclick: copy }, '📋 Copy the details')),
    h('p', { class: 'small muted' }, 'What we keep of an email you send, and for how long: ', h('a', { href: 'privacy.html', target: '_blank', rel: 'noopener' }, 'privacy policy'), '.')));
}
