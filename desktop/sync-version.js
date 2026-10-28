// Keeps package.json's version equal to VERSION in js/version.js, so the installers carry the app's version.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'js', 'version.js'), 'utf8');
const m = /VERSION\s*=\s*'([^']+)'/.exec(src);
if (!m) throw new Error('VERSION not found in js/version.js');
const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
if (pkg.version !== m[1]) {
  pkg.version = m[1];
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log('package.json version set to ' + m[1]);
}
