// Inside the iPhone app's sign-in window (js/native.js, apple/ios/App/App/WebAuthPlugin.swift): a service that sends its
// answer back to this page with the app's marker on it (a state ending in ~app, or Apple's iCloud session when the page
// was asked for as ?app=icloud) hands it to the app on the vdex:// address, and this page goes no further. A plain
// script, run before anything else loads; on the website it does nothing, since no marker is ever set there.
(function () {
  if (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()) return; // inside the app itself: the answer has arrived, let the page take it
  var q = location.search;
  var ours = /[?&]state=vdex(ms)?-[^&#]*(~|%7E)app([&#]|$)/i.test(q) || (/[?&]app=icloud([&?#]|$)/.test(q) && /[?&](ckWebAuthToken|ckSession)=/.test(q));
  if (!ours) return;
  window.stop();
  (window.__vdexSignin || function (u) { location.replace(u); })('vdex://signin' + q);
})();
