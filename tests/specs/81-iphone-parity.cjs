// The iPhone app (apple/) agrees with the website, the licence Worker and the owner's steps: the version, the bundle id,
// the address it opens and the domain it is bound to, the vdex:// scheme, the App Store product id, the three Swift
// plugins, iPhone-only in the store, Vdex's own icon and splash (opaque, at the sizes Apple wants) on a launch screen
// that never flashes white, the store kit, and the Mac build check that runs only for changes under apple/. Plain file
// checks, no browser.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const ok = (name, cond, extra = '') => console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : ''));
const ROOT = process.env.VDEX_ROOT || path.resolve(__dirname, '../..');
const REPO = path.resolve(__dirname, '../..'); // the scratch copy leaves .github out
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const exists = f => fs.existsSync(path.join(ROOT, f));
const same = (a, b) => fs.readFileSync(path.join(ROOT, a)).equals(fs.readFileSync(path.join(ROOT, b)));
const all = (text, re) => [...text.matchAll(re)].map(m => m[1].trim().replace(/^"(.*)"$/, '$1'));
const plistArray = (plist, key) => all((plist.match(new RegExp(`<key>${key}</key>\\s*<array>([\\s\\S]*?)</array>`)) || ['', ''])[1], /<string>([^<]*)<\/string>/g);
// A PNG's header and, for the catalog's own files (8-bit RGB or RGBA, not interlaced), its pixels, with no library.
const png = f => {
  const b = fs.readFileSync(path.join(ROOT, f));
  if (!b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || b.toString('latin1', 12, 16) !== 'IHDR') return null;
  const width = b.readUInt32BE(16), height = b.readUInt32BE(20), depth = b[24], colour = b[25], interlace = b[28], idat = [];
  for (let pos = 8; pos < b.length;) { const len = b.readUInt32BE(pos); if (b.toString('latin1', pos + 4, pos + 8) === 'IDAT') idat.push(b.subarray(pos + 8, pos + 8 + len)); pos += 12 + len; }
  const bpp = depth === 8 && !interlace ? { 2: 3, 6: 4 }[colour] || 0 : 0;
  let pixels = null;
  if (bpp) {
    const raw = zlib.inflateSync(Buffer.concat(idat)), stride = width * bpp; pixels = Buffer.alloc(height * stride);
    for (let y = 0; y < height; y++) {
      const filter = raw[y * (stride + 1)], src = y * (stride + 1) + 1, row = y * stride, up = row - stride;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? pixels[row + i - bpp] : 0, u = y ? pixels[up + i] : 0, c = y && i >= bpp ? pixels[up + i - bpp] : 0;
        let p = 0;
        if (filter === 1) p = a; else if (filter === 2) p = u; else if (filter === 3) p = (a + u) >> 1;
        else if (filter === 4) { const q = a + u - c, pa = Math.abs(q - a), pb = Math.abs(q - u), pc = Math.abs(q - c); p = pa <= pb && pa <= pc ? a : pb <= pc ? u : c; }
        pixels[row + i] = (raw[src + i] + p) & 255;
      }
    }
  }
  const at = (x, y) => (pixels ? '#' + [...pixels.subarray((y * width + x) * bpp, (y * width + x) * bpp + 3)].map(v => v.toString(16).padStart(2, '0')).join('') : '');
  return { width, height, depth, colour, at, size: `${width}x${height} depth ${depth} colour ${colour}` };
};
const BG = '#14110f', BODY = '#f1e6cf', AMBER = '#e0a43a'; // icons/icon.svg: the background, the camera body and its top

try {
  const PROJECT = 'apple/ios/App/App.xcodeproj/project.pbxproj', ASSETS = 'apple/ios/App/App/Assets.xcassets';
  const version = /VERSION = '([^']+)'/.exec(read('js/version.js'))[1];
  const pbx = read(PROJECT), pkg = JSON.parse(read('apple/package.json')), cfg = JSON.parse(read('apple/capacitor.config.json'));
  const plist = read('apple/ios/App/App/Info.plist'), doc = read('docs/apple-app-store.md'), worker = read('cloudflare/worker.mjs');

  // ---- the version and the identity ----
  const marketing = all(pbx, /MARKETING_VERSION = ([^;]+);/g);
  ok(`the iPhone app carries the app version ${version}: apple/package.json and both MARKETING_VERSION lines`, pkg.version === version && marketing.length === 2 && marketing.every(v => v === version), `${pkg.version}; ${marketing.join(', ')}`);
  ok('the build number (CURRENT_PROJECT_VERSION, raised by hand for every upload) is a whole number in both configurations', all(pbx, /CURRENT_PROJECT_VERSION = ([^;]+);/g).length === 2 && all(pbx, /CURRENT_PROJECT_VERSION = ([^;]+);/g).every(v => /^\d+$/.test(v)));
  const sync = execFileSync(process.execPath, ['desktop/sync-version.js'], { cwd: ROOT, encoding: 'utf8' });
  ok('desktop/sync-version.js finds nothing to change: every copy of the version already agrees', sync.trim() === '', sync.trim());
  const bundleIds = all(pbx, /PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g);
  ok('the bundle id is app.crowmade.vdex in the Capacitor config and in both Xcode configurations', cfg.appId === 'app.crowmade.vdex' && bundleIds.length === 2 && bundleIds.every(b => b === cfg.appId), bundleIds.join(', '));
  ok('Info.plist takes the bundle id and both versions from the project, so they can never drift', /<key>CFBundleIdentifier<\/key>\s*<string>\$\(PRODUCT_BUNDLE_IDENTIFIER\)<\/string>/.test(plist) && /<string>\$\(MARKETING_VERSION\)<\/string>/.test(plist) && /<string>\$\(CURRENT_PROJECT_VERSION\)<\/string>/.test(plist));

  // ---- the address, the bound domain and the scheme ----
  const host = new URL(cfg.server.url).host, bound = plistArray(plist, 'WKAppBoundDomains');
  ok('the app opens vdex.crowmade.app, may navigate only there, and is bound to that domain', host === 'vdex.crowmade.app' && cfg.server.allowNavigation.includes(host) && bound.includes(host) && cfg.ios.limitsNavigationsToAppBoundDomains === true, `${host}; allowNavigation ${cfg.server.allowNavigation.join(', ')}; bound ${bound.join(', ')}`);
  const nativeJs = read('js/native.js');
  ok('sign-ins come back on vdex://, which the phone’s sign-in window catches itself: the scheme is not registered with the system, so no link or other app can open Vdex with it', /scheme: 'vdex'/.test(nativeJs) && !/CFBundleURLTypes/.test(plist) && /callbackURLScheme: scheme/.test(read('apple/ios/App/App/WebAuthPlugin.swift')));
  ok('the Capacitor config leaves ios.scheme alone: it names the Xcode scheme (App) that cap run and cap build use', !(cfg.ios && 'scheme' in cfg.ios));
  ok('files handed to the app are copied, not opened in place', /<key>LSSupportsOpeningDocumentsInPlace<\/key>\s*<false\/>/.test(plist));
  ok('localhost is app-bound too, as Capacitor needs for its own page (the offline error page)', bound.includes('localhost') && cfg.server.errorPath === 'index.html');
  ok('every permission the app or its plugins can ask for has a purpose string: camera, microphone, location, motion, calendars, reminders, local network', ['NSCameraUsageDescription', 'NSMicrophoneUsageDescription', 'NSLocationWhenInUseUsageDescription', 'NSMotionUsageDescription', 'NSCalendarsFullAccessUsageDescription', 'NSCalendarsUsageDescription', 'NSRemindersUsageDescription', 'NSRemindersFullAccessUsageDescription', 'NSLocalNetworkUsageDescription'].every(k => new RegExp(`<key>${k}</key>\\s*<string>[^<]{10,}</string>`).test(plist)));

  // ---- the purchase ----
  const PRODUCT = 'app.crowmade.vdex.licence';
  const webProduct = (read('js/licence-web.js').match(/const PRODUCT = '([^']+)'/) || [])[1], workerProduct = (worker.match(/const APPLE_PRODUCT = '([^']+)'/) || [])[1];
  ok(`the App Store product id ${PRODUCT} is the same in the app, the Worker and the owner's steps`, webProduct === PRODUCT && workerProduct === PRODUCT && doc.includes('`' + PRODUCT + '`'), `${webProduct}; ${workerProduct}`);
  const notify = (worker.match(/p === '(\/licence\/apple\/notify)' && m === 'POST'/) || [])[1];
  ok('the owner\'s steps give Apple the notify address the Worker serves, and name the sandbox switch the Worker reads', !!notify && doc.includes('https://vdex.crowmade.app' + notify) && /env\.APPLE_ALLOW_SANDBOX !== 'on'/.test(worker) && /`APPLE_ALLOW_SANDBOX` = `on`/.test(doc) && /`APPLE_BUNDLE_ID` = `app\.crowmade\.vdex`/.test(doc));

  // ---- the Swift plugins ----
  const controller = read('apple/ios/App/App/VdexViewController.swift');
  const sources = (pbx.match(/\/\* Begin PBXSourcesBuildPhase section \*\/([\s\S]*?)\/\* End PBXSourcesBuildPhase section \*\//) || ['', ''])[1];
  const plugins = ['PurchasesPlugin', 'DocumentPickerPlugin', 'WebAuthPlugin'];
  const missing = plugins.filter(p => !(exists(`apple/ios/App/App/${p}.swift`) && controller.includes(`registerPluginInstance(${p}())`) && sources.includes(`/* ${p}.swift in Sources */`)));
  ok('the three Swift plugins exist, are registered with the bridge and are compiled', missing.length === 0 && sources.includes('/* VdexViewController.swift in Sources */'), missing.join(', '));

  // ---- iPhone only ----
  const families = all(pbx, /TARGETED_DEVICE_FAMILY = ([^;]+);/g);
  ok('the app is iPhone-only in the store (TARGETED_DEVICE_FAMILY = 1), so App Store Connect asks for iPhone screenshots only', families.length === 2 && families.every(f => f === '1'), families.join(', '));

  // ---- the icon, the splash and the launch screen ----
  const iconFile = `${ASSETS}/AppIcon.appiconset/AppIcon-512@2x.png`, icon = png(iconFile);
  ok('the App Store icon is a 1024 × 1024 PNG with no alpha channel (Apple refuses a transparent one)', !!icon && icon.width === 1024 && icon.height === 1024 && icon.depth === 8 && icon.colour === 2, icon && icon.size);
  ok('the icon is Vdex\'s own, not Capacitor\'s placeholder: the brand background in the corner, the camera body and its amber top inside', !!icon && icon.at(8, 8) === BG && icon.at(300, 500) === BODY && icon.at(512, 360) === AMBER, icon && [icon.at(8, 8), icon.at(300, 500), icon.at(512, 360)].join(' '));
  ok('the icon set names that file at 1024x1024', JSON.parse(read(`${ASSETS}/AppIcon.appiconset/Contents.json`)).images.some(i => i.filename === 'AppIcon-512@2x.png' && i.size === '1024x1024'));
  const splashNames = ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png'];
  const splashes = splashNames.map(f => png(`${ASSETS}/Splash.imageset/${f}`));
  ok('the three splash pictures (3x, 2x, 1x) are 2732 × 2732 PNGs, and one and the same picture', splashes.every(s => s && s.width === 2732 && s.height === 2732 && s.depth === 8) && same(`${ASSETS}/Splash.imageset/${splashNames[0]}`, `${ASSETS}/Splash.imageset/${splashNames[1]}`) && same(`${ASSETS}/Splash.imageset/${splashNames[0]}`, `${ASSETS}/Splash.imageset/${splashNames[2]}`), splashes.map(s => s && s.size).join('; '));
  const set = JSON.parse(read(`${ASSETS}/Splash.imageset/Contents.json`)).images.map(i => i.filename);
  ok('the splash set names those three files', splashNames.every(f => set.includes(f)));
  const sp = splashes[0];
  // The logo is a third of the width (911 px, so the body spans about x 1081–1651 and y 1270–1555) on the brand colour.
  ok('the splash is the logo at about a third of the width, centred on the brand background', !!sp && sp.at(8, 8) === BG && sp.at(1366, 2700) === BG && sp.at(766, 1366) === BG && sp.at(1966, 1366) === BG && sp.at(1177, 1355) === BODY && sp.at(1555, 1355) === BODY && sp.at(1366, 1220) === AMBER, sp && [sp.at(8, 8), sp.at(766, 1366), sp.at(1177, 1355), sp.at(1366, 1220)].join(' '));
  const launch = read('apple/ios/App/App/Base.lproj/LaunchScreen.storyboard');
  ok('the launch screen shows the splash on the brand colour, so the start never flashes white', /<imageView[^>]*image="Splash"/.test(launch) && /<color key="backgroundColor" red="0\.078" green="0\.067" blue="0\.059" alpha="1" colorSpace="custom" customColorSpace="sRGB"\/>/.test(launch) && !/systemBackgroundColor/.test(launch));
  ok('the store kit has the 1024 icon (the very file built into the app) and says which screenshots go beside it', exists('store/apple/icon-1024.png') && same('store/apple/icon-1024.png', iconFile) && /6\.7-inch/.test(read('store/apple/README.md')) && /6\.1-inch/.test(read('store/apple/README.md')));

  // ---- the owner's steps ----
  ok('the owner\'s steps cover the build number, iPhone-only screenshots, the privacy answers, a published support page and the Mac build check', /CURRENT_PROJECT_VERSION/.test(doc) && /iPhone screenshots only/.test(doc) && /\n## App Privacy answers\n/.test(doc) && /\*\*Support URL\*\*: a published page where people can reach you directly/.test(doc) && !/full-guide\.md/.test(doc) && /ios\.yml/.test(doc));

  // ---- the Mac build check ----
  const yml = fs.readFileSync(path.join(REPO, '.github/workflows/ios.yml'), 'utf8'), job = yml.split('\njobs:\n')[1] || '';
  ok('the Mac build check runs only for a push under apple/ (or to itself) and by hand, with read-only access', /paths: \['apple\/\*\*', '\.github\/workflows\/ios\.yml'\]/.test(yml) && /\n  workflow_dispatch:\n/.test(yml) && !/pull_request/.test(yml) && /^permissions:\n  contents: read$/m.test(yml) && /runs-on: macos-/.test(job) && /^concurrency:\n  group: ios$/m.test(yml));
  ok('it installs apple/, syncs Capacitor, resolves the packages and builds unsigned for the simulator; it never signs, archives or uploads', /npm ci\n\s+working-directory: apple/.test(job) && /npx cap sync ios/.test(job) && /xcodebuild -resolvePackageDependencies -project ios\/App\/App\.xcodeproj -scheme App/.test(job) && /-sdk iphonesimulator -destination 'generic\/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build/.test(job) && /set -o pipefail/.test(job) && !/archivePath|exportArchive|upload-artifact|altool|notarytool|secrets\./.test(job) && /actions\/checkout@[0-9a-f]{40} /.test(job) && /actions\/setup-node@[0-9a-f]{40} /.test(job));
} catch (e) {
  console.log('FAIL spec crashed — ' + (e.stderr ? String(e.stderr) : e.message));
  process.exit(1);
}
