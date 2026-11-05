// Keeps every copy of the app's version equal to VERSION in js/version.js: package.json's (the desktop installers carry
// it), apple/package.json's, and both MARKETING_VERSION lines in the iPhone app's Xcode project (the version App Store
// Connect shows). CURRENT_PROJECT_VERSION there is the build number, which the owner raises by hand before every upload
// to App Store Connect, so it is left alone. Idempotent, and silent when nothing changes.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'js', 'version.js'), 'utf8');
const m = /VERSION\s*=\s*'([^']+)'/.exec(src);
if (!m) throw new Error('VERSION not found in js/version.js');
const version = m[1];
for (const rel of ['package.json', 'apple/package.json']) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) continue;
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (pkg.version === version) continue;
  pkg.version = version;
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
  console.log(rel + ' version set to ' + version);
}
const pbxproj = path.join(root, 'apple', 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');
if (fs.existsSync(pbxproj)) {
  const before = fs.readFileSync(pbxproj, 'utf8');
  const value = /^[A-Za-z0-9_.]+$/.test(version) ? version : JSON.stringify(version); // a pbxproj quotes anything beyond letters, digits and dots
  const after = before.replace(/MARKETING_VERSION = [^;]+;/g, 'MARKETING_VERSION = ' + value + ';');
  if (after !== before) {
    fs.writeFileSync(pbxproj, after);
    console.log('apple/ios/App/App.xcodeproj MARKETING_VERSION set to ' + version);
  }
}
