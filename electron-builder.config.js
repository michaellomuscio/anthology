// Build config for electron-builder.
// The package.json is intentionally minimal; the build settings live here.
//
// Signing & notarization (read this when you're ready to ship publicly):
// macOS Gatekeeper warns users on apps that aren't signed by an Apple Developer
// ID and notarized by Apple. To enable both:
//   1. Get a "Developer ID Application" certificate from developer.apple.com.
//   2. Set the env vars before building:
//        export CSC_LINK="path/to/developer-id.p12"
//        export CSC_KEY_PASSWORD="..."
//        export APPLE_ID="you@example.com"
//        export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
//        export APPLE_TEAM_ID="ABCDE12345"
//   3. Set ANTHOLOGY_SIGN=1 in the build environment so the mac block below
//      enables hardenedRuntime + notarization.
// Without ANTHOLOGY_SIGN, the build still produces a working .dmg suitable
// for personal use (right-click → Open the first time on a new Mac).
const SIGN = process.env.ANTHOLOGY_SIGN === '1';

module.exports = {
  appId: 'com.lomusciolabs.anthology',
  productName: 'Anthology',
  asar: true,
  asarUnpack: ['node_modules/node-pty/**/*'],
  files: [
    'src/main/**/*',
    'dist/index.html',
    'dist/assets/**/*',
    'package.json',
  ],
  directories: {
    buildResources: 'build',
  },
  mac: {
    target: [{ target: 'dmg', arch: ['arm64'] }],
    category: 'public.app-category.developer-tools',
    // Hardened runtime requires signing — flip both on together when distributing.
    hardenedRuntime: SIGN,
    entitlements: SIGN ? 'build/entitlements.mac.plist' : undefined,
    entitlementsInherit: SIGN ? 'build/entitlements.mac.plist' : undefined,
    gatekeeperAssess: false,
    // Setting identity to null skips signing entirely. When CSC_LINK is set
    // electron-builder picks up the cert automatically — leaving identity
    // unset (undefined) is the right thing for signed builds.
    identity: SIGN ? undefined : null,
    // notarize: true picks up APPLE_TEAM_ID + APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD
    // from env vars directly. Setting teamId here is deprecated in newer
    // @electron/notarize and triggers a build warning.
    notarize: SIGN,
    icon: 'build/icon.icns',
  },
  dmg: {
    title: 'Anthology ${version} ${arch}',
    artifactName: 'Anthology-${version}-${arch}.dmg',
    window: { width: 540, height: 380 },
    contents: [
      { x: 130, y: 200, type: 'file' },
      { x: 410, y: 200, type: 'link', path: '/Applications' },
    ],
  },
};
