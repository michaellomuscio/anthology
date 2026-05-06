# Releasing Anthology

End-to-end checklist for cutting a new release across all three repos.
Future-you: read top-to-bottom in order. Estimated time per release: 20–30
minutes (notarization is the long pole).

## What ships in a "release"

A coordinated release usually touches three things:

| Repo | Output | When to bump |
|---|---|---|
| **anthology** (Mac) | `Anthology-X.Y.Z-arm64.dmg` on a GitHub release | Always |
| **anthology-ios** | A new TestFlight build | When iOS-side code changed |
| **anthology-push-worker** | A new Cloudflare Worker version | When Worker code changed |

If only one component changed, bump and ship just that one.

---

## Pre-flight (every release)

```bash
cd path/to/anthology
node --test test/bridge.test.js          # 16 passing
node --test test/mcp-server.test.js
git status                               # clean
git pull --rebase                        # up to date with main
```

Bump the version in `package.json`. **Use semver**:

| Change | Bump |
|---|---|
| Bug fix only | patch (0.3.0 → 0.3.1) |
| New feature, no breaking change | minor (0.3.0 → 0.4.0) |
| Breaking change to bridge protocol or DMG layout | major (0.3.0 → 1.0.0) |

If the bridge protocol changes and you bump the path (`/ws` → `/v2/ws`),
keep `/ws` for one minor release for graceful upgrade UX.

---

## Mac app release

### 1. Build a signed + notarized DMG

```bash
cd path/to/anthology
rm -rf dist
npm run build:signed
```

`build:signed` reads `.env` (mode 0600, gitignored) for `CSC_LINK`,
`CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`,
`APPLE_TEAM_ID`, and `ANTHOLOGY_SIGN=1`.

Watch the log for:
- `signing` — code signature applied
- `notarization successful` — Apple's notary service accepted the build
- `building target=DMG` — packaging starts after notarization
- Final output: `dist/Anthology-X.Y.Z-arm64.dmg` (~100 MB)

Total time: 5–10 min, dominated by notarization.

### 2. Install locally to verify

```bash
cp -R dist/mac-arm64/Anthology.app /Applications/
codesign --verify --verbose /Applications/Anthology.app
spctl -a -t exec -vv /Applications/Anthology.app   # expect: source=Notarized Developer ID
open /Applications/Anthology.app
```

Click the bee in the sidebar → About modal should show the new version.
Pair your iPhone if needed; check the bridge listens on port 17872.

### 3. Cut the GitHub release

```bash
git add package.json README.md src/renderer/components/AboutModal.jsx
git commit -m "vX.Y.Z: <one-line summary>"
git push

gh release create vX.Y.Z \
  dist/Anthology-X.Y.Z-arm64.dmg \
  dist/Anthology-X.Y.Z-arm64.dmg.blockmap \
  --title "vX.Y.Z — <headline>" \
  --notes-file docs/release-notes-vX.Y.Z.md   # or use --notes "..."
```

Update the README's badge + download link to point at the new tag.

---

## iOS app release (TestFlight)

### 1. Bump version

```bash
cd path/to/anthology-ios
# Edit project.yml: bump CFBundleVersion (must monotonically increase) and
# CFBundleShortVersionString (semver). Build numbers don't have to match
# the Mac app — they're independent.
xcodegen generate
```

### 2. Archive in Xcode

In Xcode (`xed .` to open):

1. Destination dropdown → **Any iOS Device (arm64)**
2. **Product → Archive**
3. Wait ~2 min. Organizer pops automatically.

### 3. Upload via TestFlight

1. Click **Distribute App**
2. Pick **Upload to TestFlight (Internal testing only)**
3. Re-sign options: leave **Automatically manage signing** → **Next**
4. Summary → **Upload**
5. Wait ~3-5 min. Apple processes for another 5-15 min after the upload
   completes (you'll get an email).

The build appears in TestFlight on your iPhone within ~15 min of upload.
No USB cable, no manual install.

### 4. Tag the iOS source

```bash
git add project.yml
git commit -m "iOS vX.Y.Z"
git push
git tag ios-vX.Y.Z
git push --tags
```

---

## Worker release

Only when `src/index.js` or `wrangler.toml` changed.

```bash
cd path/to/anthology-push-worker
npx wrangler deploy
```

Verify:

```bash
curl https://anthology-push.<your-cf-subdomain>.workers.dev/health
# {"ok":true,"version":1}
```

If you bumped the Worker's behavior in a way that affects the Mac side,
deploy the Worker FIRST, then the Mac app. The Mac app degrades gracefully
to "no push" if the Worker version mismatches; the reverse is more likely
to break.

---

## Post-release verification

After all three are out:

1. Open `/Applications/Anthology.app` — About modal shows new version
2. iOS Anthology updates via TestFlight on your iPhone
3. Pair / re-pair if necessary
4. Trigger a session on the Mac and confirm:
   - iOS shows it in the session list
   - Tap into the terminal — keystrokes work
   - Force-quit iOS app, force a `waiting` state on Mac
   - iPhone receives a push notification within a couple seconds
   - Tap the notification — opens the right session

If any of those fails, see [SECURITY.md](SECURITY.md) for which trust
boundary broke and the rollback section below.

---

## Rollback

### Mac app

```bash
# On any user's machine, install the previous DMG
gh release download vX.Y.<Z-1> --repo michaellomuscio/anthology -p '*.dmg' -O ~/Downloads/anthology-prev.dmg
open ~/Downloads/anthology-prev.dmg
```

### iOS app

In App Store Connect → TestFlight → Builds, the previous build is still
installable. Testers tap the older build's TestFlight entry and install.

### Worker

```bash
npx wrangler deployments list
npx wrangler rollback <deployment-id>
```

---

## Where the secrets live

| Secret | Location |
|---|---|
| Apple Developer cert (`.p12`) | path referenced by `CSC_LINK` in `.env` |
| App-specific password | `APPLE_APP_SPECIFIC_PASSWORD` in `.env` |
| APNs auth key (`.p8`) | `~/Documents/Anthology Secrets/AuthKey_<KEY_ID>.p8` |
| Worker shared secret | `~/Documents/Anthology Secrets/worker-secret.txt` (also in `~/Library/Application Support/Anthology/bridge-config.json`) |

`.env` is gitignored and at mode 0600. `~/Documents/Anthology Secrets/` is
mode 0700 with mode-0600 files. **Apple does not let you re-download the
.p8 if you lose it** — back it up out-of-band if you want disaster
recovery beyond a working Mac.

---

## Common gotchas

- **Notary stalls > 30 min**: abandon the submission, re-run
  `npm run build:signed`. Apple's notary queue occasionally hangs;
  fresh submission usually unsticks it.
- **`xcrun: error: ... Xcode license has not been agreed to`**: macOS CLT
  auto-update reset the license accept flag. `sudo xcodebuild -license` →
  type `agree`.
- **`cannot execute tool 'metal' due to missing Metal Toolchain`**: only
  affects iOS builds. `xcodebuild -downloadComponent MetalToolchain` (~700 MB).
- **Build numbers must be monotonically increasing for TestFlight**: if you
  upload `2` after `5` Apple rejects with "build number conflict". Always
  bump up.
- **Network during notarization**: the Mac must stay awake and online.
  Don't close the lid mid-notarization (we lost a build to
  `NSURLErrorDomain -1009` overnight once).

---

## TestFlight tester management

- **Internal testers** (no App Review needed): up to 100. Add via
  App Store Connect → Anthology Console → TestFlight → Internal Group →
  + → enter their Apple ID email.
- **External testers** (requires Beta App Review, ~24 hr first time, faster
  for subsequent builds): up to 10,000. Use this when Lomuscio Labs starts
  inviting outside collaborators.

The currently active build always wins on internal testers' devices —
they don't need to opt in to each new version.
