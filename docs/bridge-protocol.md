# Anthology Bridge Protocol v1

The **bridge** is a WebSocket + tiny HTTP server inside Anthology that lets the iOS companion app
(and any other authorized client) view and control sessions remotely.

## Network model

Anthology binds the bridge to **all interfaces on a fixed port (default `17872`)** but is intended
to be reachable only via:

- **localhost** — from tooling running on the same Mac, or
- **Tailscale** — the Mac's `100.x.y.z` address inside the user's tailnet.

The server is *not* meant to be exposed publicly. Defense-in-depth uses bearer tokens on every WS
message and per-pairing tokens that the user can revoke. Tailscale handles the network-layer
restriction (no public internet exposure, WireGuard E2E).

## Pairing flow

Pairing bootstraps a **long-lived bearer token** onto a new device. It does not require user input
on the phone beyond scanning a QR code.

```
┌─────────────┐                 ┌──────────────┐                 ┌──────────────┐
│  Mac UI     │                 │  Mac bridge  │                 │  iOS app     │
└──────┬──────┘                 └──────┬───────┘                 └──────┬───────┘
       │                               │                                │
       │  IPC: bridge:pair-start       │                                │
       ├──────────────────────────────▶│                                │
       │                               │  generate 6-digit code, 5m TTL │
       │  { code, host, port }         │                                │
       │◀──────────────────────────────┤                                │
       │                               │                                │
       │  show QR + code               │                                │
       │  anthology://pair?host=...    │                                │
       │      &port=...&code=NNNNNN    │                                │
       │                               │                                │
       │                               │   <user scans QR with iPhone>  │
       │                               │                                │
       │                               │  POST /pair                    │
       │                               │  { code, label }               │
       │                               │◀───────────────────────────────┤
       │                               │  validate, create token        │
       │                               │  { tokenId, token, name }      │
       │                               ├───────────────────────────────▶│
       │                               │                                │
       │                               │  WS upgrade /ws                │
       │                               │  Authorization: Bearer <token> │
       │                               │◀───────────────────────────────┤
```

- Code is **single-use** and consumed atomically; the server invalidates it on successful claim.
- Token is returned **once**, in the body of the `/pair` response. It is never retrievable again.
- Token is stored as `sha256(token)` on the Mac; the plaintext lives only in iOS Keychain.
- The Mac surfaces all paired devices and lets the user revoke any (revocation is immediate; an
  active WS connection using the revoked token is closed).

### `POST /pair`

Request:

```http
POST /pair HTTP/1.1
Content-Type: application/json

{ "code": "482917", "label": "Michael's iPhone 15 Pro" }
```

Response (success):

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "tokenId": "tk_3h8a1b2c",
  "token": "ant_<48 random url-safe chars>",
  "serverName": "Michael's MacBook Pro",
  "serverVersion": "0.2.0",
  "expiresAt": null
}
```

Errors: `400` malformed body · `401` invalid/expired code · `409` code already claimed.

The server allows at most **one in-flight pairing code at a time** to keep the QR/manual code
unambiguous.

## WebSocket connection

Upgrade endpoint: `ws://<host>:17872/ws`.

The client MUST send the bearer token in the `Authorization` header on the upgrade request:

```
GET /ws HTTP/1.1
Host: 100.92.18.4:17872
Upgrade: websocket
Authorization: Bearer ant_<...>
Sec-WebSocket-Version: 13
```

If auth fails, the upgrade is rejected with HTTP `401`. After upgrade, every text frame carries
JSON. Binary frames are not used.

### Message envelope

Every message is a JSON object with at least a `type` field. Request/response style messages
include an `id` (string, client-chosen, unique per connection). Server-pushed events do not carry
`id`.

```json
{ "type": "list_sessions", "id": "req_42" }
```

```json
{ "type": "ack", "id": "req_42", "result": { "sessions": [ ... ] } }
```

```json
{ "type": "session_data", "sessionId": "s_abc", "data": "...PTY bytes as utf-8..." }
```

### Errors

```json
{ "type": "err", "id": "req_42", "code": "not_found", "message": "session not found" }
```

Error `code` values: `bad_request`, `not_found`, `unauthorized`, `rate_limited`, `internal`.

## Client → Server messages

| `type`                | params                                                                                       | result on `ack`                                  |
| --------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `hello`               | `{ clientName, clientVersion, platform }`                                                    | `{ serverName, serverVersion, sessionLimit }`    |
| `list_sessions`       | —                                                                                            | `{ sessions: SessionMeta[] }`                    |
| `list_recent_dirs`    | —                                                                                            | `{ dirs: string[] }` (most-recent-first)         |
| `get_buffer`          | `{ sessionId }`                                                                              | `{ data: string }` (latest serialized scrollback)|
| `subscribe`           | `{ sessionIds: string[] \| "all" }`                                                          | `{ subscribed: string[] }`                       |
| `unsubscribe`         | `{ sessionIds: string[] \| "all" }`                                                          | `{ unsubscribed: string[] }`                     |
| `send_input`          | `{ sessionId, data }`  (raw keystrokes / control chars)                                      | `{ ok: true }`                                   |
| `send_prompt`         | `{ sessionId, text }`  (bracketed-paste + enter, like the renderer)                          | `{ ok: true }`                                   |
| `resize`              | `{ sessionId, cols, rows }`                                                                  | `{ ok: true }`                                   |
| `spawn`               | `{ name, cwd, color?, tag?, runClaude?, projectManager? }`                                   | `{ session: SessionMeta }`                       |
| `kill`                | `{ sessionId }`                                                                              | `{ ok: true }`                                   |
| `list_schedules`      | —                                                                                            | `{ schedules: Schedule[] }`                      |
| `upsert_schedule`     | `{ schedule: Schedule }`                                                                     | `{ schedule: Schedule }`                         |
| `delete_schedule`     | `{ id }`                                                                                     | `{ ok: true }`                                   |
| `run_schedule_now`    | `{ id }`                                                                                     | `{ ok: true }`                                   |
| `ping`                | —                                                                                            | `{ pong: true, t: <ms> }`                        |
| `register_push_token` | `{ deviceToken: string, environment?: "production" \| "sandbox" }`                           | `{ ok: true }`                                   |

`subscribe` is mandatory before the server starts streaming `session_data` / `session_status`.
Subscriptions are scoped to the connection and discarded on disconnect.

## Server → Client events

| `type`              | payload                                                              |
| ------------------- | -------------------------------------------------------------------- |
| `session_data`      | `{ sessionId, data }` — raw PTY bytes (UTF-8 string, ANSI included). |
| `session_status`    | `{ sessionId, status }` — `"running" \| "idle" \| "waiting" \| "error"`. |
| `session_exit`      | `{ sessionId, exitCode, signal }`                                    |
| `session_created`   | `{ session: SessionMeta }`                                           |
| `session_killed`    | `{ sessionId }`                                                      |
| `session_meta`      | `{ session: SessionMeta }` — when name/color/tag changes.            |
| `schedule_fired`    | `{ id, ok, error?, lastRunAt }`                                      |
| `schedule_changed`  | `{ schedule: Schedule }`                                             |
| `bye`               | `{ reason }` — sent before the server closes the connection (e.g. token revoked, server shutting down). |

### Data flow rules

- After `subscribe`, the client receives an immediate `get_buffer`-equivalent snapshot for each
  newly-subscribed session, followed by live `session_data` frames.
- `session_data` frames are coalesced server-side at most every 30 ms to keep frame rate sane on
  cellular links.
- The client SHOULD `ping` every 30 s; the server closes idle connections after 90 s of silence.

## Types

```ts
type SessionStatus = "running" | "idle" | "waiting" | "error";

type SessionMeta = {
  id: string;
  name: string;
  cwd: string;
  color: string;
  tag: string | null;
  pinned: boolean;
  status: SessionStatus;
  alive: boolean;             // false once the PTY exits
  createdAt: number;
  spawnedBySchedule?: string;
};

type Schedule = {
  id: string;
  name: string;
  cwd: string;
  prompt: string;
  color: string;
  tag: string;
  kind: "cron" | "oneshot";
  cron: string | null;
  when: string | null;        // ISO datetime for oneshot
  enabled: boolean;
  createdAt: number;
  lastRunAt?: number;
  nextRunAt?: number;
};
```

## Security notes

- **Token format**: `ant_` + 48 url-safe random chars (≈288 bits entropy from `crypto.randomBytes`).
- **Storage**: server stores `sha256(token)` only; iOS stores the plaintext in Keychain
  (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`).
- **Token rotation**: revoking + re-pairing is the rotation path; there is no in-band rotation.
- **Pairing code**: 6 digits = 1,000,000 space; rate-limited to 5 attempts/minute per IP and
  invalidated on any failed attempt against an active code (code becomes one-shot to prevent
  brute force).
- **Origin**: server rejects WS upgrade requests carrying an `Origin` header (browsers send it,
  trusted clients don't). This blocks DNS-rebinding from a malicious page.
- **Rate limits**: per-connection cap of 200 messages/sec; offending connections are closed.
- **Audit log**: every pairing, revocation, and connection start/stop appended to
  `userData/bridge-audit.log` (newline-delimited JSON, capped at 5 MB with rotation).

## Versioning

The bridge sends `serverVersion` in `hello`. The iOS app gates feature use on this. Breaking
changes bump the path: `/ws` → `/v2/ws`, with `/ws` kept for one minor release for graceful
upgrade UX. The current protocol is **v1**.
