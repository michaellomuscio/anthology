# Security policy

## Reporting a vulnerability

Please **do not** open a public GitHub issue for a security report. Instead,
either:

- Open a [private security advisory](https://github.com/michaellomuscio/anthology/security/advisories/new) on this repo, or
- Email the project author at the address listed on <https://www.michaellomuscio.com>.

Please include:

- A description of the issue
- Steps to reproduce, ideally on a clean install
- Impact: what an attacker can do, what trust boundary they cross
- Your name / handle if you'd like credit in the fix's release notes

You'll get a response within ~5 business days (this is a personal-time
project, response on weekends is hit-or-miss).

## Supported versions

Only the latest minor release is supported with security fixes.

| Version | Supported |
|---------|-----------|
| 0.3.x   | ✅ |
| 0.2.x   | ❌ — please upgrade |
| < 0.2   | ❌ |

## Threat model

Anthology runs locally on a single user's Mac. Its security posture assumes:

- The Mac itself is trusted (single user, no other admin accounts)
- The local filesystem is trusted (`~/Library/Application Support/anthology/`
  files have mode 0600 and contain bearer-token hashes; if an attacker has
  read access to these files they already have your home directory)
- Network confidentiality between the Mac and the iOS companion is provided
  by the **network layer** (Tailscale's WireGuard mesh, or trusted LAN) —
  the WebSocket itself is plaintext
- The bridge bearer token (288 bits of entropy, sha256-stored) gates all
  remote control. A leaked bearer token grants the same privileges as
  physical access to the Mac (spawn `claude` in any directory, kill, send
  arbitrary input). Revoke compromised tokens via the phone icon → Revoke

### Out of scope

- Mac compromise scenarios (root malware, full-disk forensic recovery)
- Network attackers between paired Tailscale endpoints (trust WireGuard)
- Apple Push Notification Service (trust APNs)
- Cloudflare Worker isolate compromise (trust Cloudflare)
- Side-channel attacks on the host machine

### In scope (please report)

- Authentication bypass on the bridge HTTP/WS endpoints
- Pre-auth pairing-code brute-force or recovery beyond the rate limits
- Path traversal through any user-supplied identifier
- Command injection via PTY spawn, MCP tool calls, or other interfaces
- Cross-paired-device privilege escalation (one device's token controlling
  another's session)
- Memory-unsafe handling of WebSocket frames or HTTP bodies
- Cryptographic weaknesses in token generation or storage
- iOS Keychain misuse on the companion app
- Cloudflare Worker JWT signing bypass or APNs token leak
