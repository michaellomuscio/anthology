# Push notifications — setup guide

End-to-end path so your iPhone wakes up when a Claude session goes
`waiting` or `error` while the iOS app is closed.

The transport: Mac (Anthology) → Cloudflare Worker → APNs → iPhone.
Cost: $0/mo. The Worker free tier (100 k req/day) is dramatically more than
personal use; APNs is free.

## What you'll do once

| Step | Where | Time |
|---|---|---|
| 1. Generate APNs Auth Key | developer.apple.com | 2 min |
| 2. Enable Push capability for the iOS bundle id | developer.apple.com | 1 min |
| 3. Deploy the Worker + set secrets | terminal | 5 min |
| 4. Tell Anthology the Worker URL + secret | Anthology UI | 30 s |
| 5. Allow notifications on iPhone | iOS first-launch prompt | 5 s |

After this, every paired iPhone shows a `push` badge in the Mac's pairing
modal, and waiting/error transitions wake your phone.

---

### 1 · Generate APNs Auth Key

Apple lets you have at most 2 active APNs auth keys per team, and they don't
expire. So creating one new key is fine.

1. <https://developer.apple.com/account/resources/authkeys/list> → **+**
2. Name: `Anthology APNs` · Check **Apple Push Notifications service (APNs)** · Continue
3. **Register** → **Download** (you only get this download once — save the .p8)
4. Copy the **Key ID** shown on the success page (10 chars, e.g. `ABC1234XYZ`)
5. Note your **Team ID** from the top-right of developer.apple.com (already known: `C9562TBW66`)

### 2 · Enable Push capability for the bundle id

1. <https://developer.apple.com/account/resources/identifiers/list>
2. Find / create `com.lomusciolabs.anthology-ios`
3. Toggle **Push Notifications** → Save

### 3 · Deploy the Cloudflare Worker

```bash
cd /Users/michaellomuscio/projects/anthology-push-worker
npm install
npx wrangler login                # one-time browser auth
npx wrangler deploy               # gives you https://anthology-push.<your-subdomain>.workers.dev

# Generate a secret the Mac will use to call the Worker. Save it — you'll
# paste it into Anthology in step 4.
openssl rand -hex 32 | tee /tmp/anthology-worker-secret.txt

# Set Worker secrets. Wrangler prompts you to paste each value.
cat /tmp/anthology-worker-secret.txt | npx wrangler secret put WORKER_SECRET
cat ~/Downloads/AuthKey_ABC1234XYZ.p8 | npx wrangler secret put APNS_AUTH_KEY
echo "ABC1234XYZ"           | npx wrangler secret put APNS_KEY_ID
echo "C9562TBW66"           | npx wrangler secret put APNS_TEAM_ID
echo "com.lomusciolabs.anthology-ios" | npx wrangler secret put APNS_BUNDLE_ID
```

Test the Worker:

```bash
SECRET=$(cat /tmp/anthology-worker-secret.txt)
curl -i -X POST https://anthology-push.<your-subdomain>.workers.dev/health
# 200, { "ok": true, "version": 1 }
```

### 4 · Tell Anthology

In Anthology on your Mac:

1. Click the **phone icon** in the top bar
2. Scroll to the **Push relay (optional)** panel
3. Paste the Worker URL and the Worker secret
4. **Save**

The status pill flips to **Configured**. From this moment on, when a session
goes waiting/error and no iOS client is currently connected, Anthology will
POST to the Worker, which will deliver an APNs push to every paired iPhone
that has registered.

You can change or clear these credentials any time. They are stored at
`~/Library/Application Support/anthology/bridge-config.json` (mode 0600), and
the secret never appears in any log.

### 5 · iPhone

Open Anthology on the iPhone. iOS prompts:
> "Anthology" Would Like to Send You Notifications

Tap **Allow**. Behind the scenes:

- iOS asks Apple for an APNs device token
- Anthology iOS sends `register_push_token { deviceToken, environment }` to the Mac via the bridge
- Mac stores the device token in `bridge-tokens.json` keyed by your bearer tokenId
- The Mac shows a small `push` badge next to the phone in the **Paired devices** list

To verify, force a session into a permission prompt while the iOS app is
fully closed (swipe up from the multitasking switcher). The phone should
buzz with `<session name> needs you`.

---

## Production builds (TestFlight / App Store)

The iOS entitlement currently uses `aps-environment: development`, which is
correct for **Xcode-installed builds going through the APNs sandbox**. The
iOS app's `PushManager` matches that automatically: `#if DEBUG` registers as
`environment: "sandbox"` so the Mac dispatches to the sandbox APNs host, and
release builds register as `production` so the dispatcher hits the
production APNs host.

**Two manual changes are needed before a TestFlight or App Store release**:

1. Edit `Anthology/Anthology.entitlements`:

   ```xml
   <key>aps-environment</key>
   <string>production</string>
   ```

2. Re-run `xcodegen generate` so the Xcode project picks it up, then
   archive with **Product → Archive** in Xcode.

The Worker side needs no change — the iOS app sends the correct
`environment` field at register-time, and the Worker's
`APNS_HOSTS[environment]` map routes to the right APNs host per push.

## Troubleshooting

**The pairing modal says "Not configured" even after Save.**
The Save button is disabled until both fields are populated and the secret
is non-empty. If the secret is already saved you can leave the secret field
blank to keep it; the URL alone can be edited.

**APNs returns `BadDeviceToken`.**
Mismatch between APS environment and the Worker's. Debug builds use
`sandbox`, production builds use `production`. The Worker reads the
environment from the iOS payload; this is normally invisible.

**Worker returns 401 "unauthorized".**
The secret in Anthology's bridge-config.json doesn't match
`WORKER_SECRET`. Re-paste from `/tmp/anthology-worker-secret.txt`.

**Worker returns "missing APNS_AUTH_KEY".**
You forgot one of the secrets. `npx wrangler secret list` to see what's set.

**iPhone never shows push badge.**
- Permission denied? Settings → Anthology → Notifications → Allow Notifications.
- App build is debug → uses `sandbox` APNs. Either build a TestFlight/Release
  variant or deploy with `APNS_ENVIRONMENT=sandbox` set on the Worker.

## What we send

Push payload (visible to APNs and the iOS app, NOT to the Worker beyond
relay):

```json
{
  "aps": {
    "alert": { "title": "auth-rewrite needs you",
               "body":  "Claude is waiting on a permission decision." },
    "sound": "default",
    "mutable-content": 1,
    "thread-id": "s_abc"
  },
  "sessionId": "s_abc",
  "status": "waiting"
}
```

No session contents, no terminal output, no file paths. Just enough for the
phone to surface the alert and deep-link to the session when tapped.
