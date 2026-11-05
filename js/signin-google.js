// Google's sign-in for the iPhone app (js/providers.js googleToken): Google refuses to sign in inside an app's web
// view, so the app opens this page of the website in the phone's own sign-in window. The page asks Google for the
// token the way the website does (its sign-in window), and hands the answer to the app on the vdex:// address, where
// the sign-in window ends. If Google's window cannot open here, the other way sends the page to Google and back, with
// the answer after the # (that way needs this page's address registered with Google: docs/turn-on-sign-in.md).
(function () {
  var q = new URLSearchParams(location.search), client = q.get('client') || '', scope = q.get('scope') || '';
  var h0 = new URLSearchParams(location.hash.slice(1)), hint = h0.has('state') ? '' : h0.get('hint') || ''; // the account's address comes after the #
  if (hint) history.replaceState(null, '', location.pathname + location.search);
  var t = document.getElementById('t'), go = document.getElementById('go'), alt = document.getElementById('alt'), other = document.getElementById('other');
  var back = function (r) { (window.__vdexSignin || function (u) { location.replace(u); })('vdex://signin?' + new URLSearchParams(Object.assign({ google: '1' }, r))); };
  var rand = function () { var a = new Uint8Array(16); crypto.getRandomValues(a); return Array.prototype.map.call(a, function (b) { return b.toString(16).padStart(2, '0'); }).join(''); };
  // Back from Google the other way: the answer is after the #, for the sign-in this page started.
  if (location.hash.length > 1 && h0.has('state')) {
    var h = h0, want = sessionStorage.getItem('vdex-google-state');
    sessionStorage.removeItem('vdex-google-state');
    history.replaceState(null, '', location.pathname + location.search);
    if (want && h.get('state') === want) { back(h.get('access_token') ? { access_token: h.get('access_token'), expires_in: h.get('expires_in') || '3600', scope: h.get('scope') || scope } : { error: h.get('error') || 'failed' }); return; }
  }
  if (!client || !scope) { t.textContent = 'The Vdex app opens this page when you connect Google Drive or Google Calendar; on its own it does nothing.'; go.hidden = true; return; }
  var failed = function (why) { alt.hidden = false; t.textContent = why; go.disabled = false; };
  go.onclick = function () {
    go.disabled = true;
    if (!(window.google && google.accounts && google.accounts.oauth2)) return failed('Google’s sign-in did not load. Check the connection and try again, or sign in the other way.');
    google.accounts.oauth2.initTokenClient({
      client_id: client, scope: scope,
      callback: function (r) { r.error ? back({ error: r.error }) : back({ access_token: r.access_token, expires_in: String(r.expires_in || 3600), scope: r.scope || scope }); },
      error_callback: function (e) { var why = e && e.type; if (why === 'popup_failed_to_open' || why === 'popup_closed') failed(why === 'popup_closed' ? 'The Google window was closed before signing in. Try again, or sign in the other way.' : 'Google’s window could not open here. Sign in the other way.'); else back({ error: why || 'failed' }); },
    }).requestAccessToken(hint ? { prompt: '', login_hint: hint } : { prompt: '' });
  };
  other.onclick = function () {
    var state = 'vdexg-' + rand();
    sessionStorage.setItem('vdex-google-state', state);
    var p = new URLSearchParams({ client_id: client, redirect_uri: location.origin + location.pathname, response_type: 'token', scope: scope, include_granted_scopes: 'true', state: state, prompt: '' });
    if (hint) p.set('login_hint', hint);
    location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + p;
  };
  go.disabled = false;
})();
