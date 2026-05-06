# Anthology — Product Hunt launch kit

Everything you need to paste into the PH submission form. Drafted by AI;
edit to taste before launch.

---

## 1 · Tagline (60 chars max)

Pick one. The most important field — what people see in the daily list.

| # | Tagline | Chars | Angle |
|---|---|---|---|
| **A** | **Run many Claude Code sessions, control them from your iPhone** | 60 | Concise. Both halves of the value prop. |
| B | A control room for your parallel Claude Code sessions | 53 | Vibe-y. "Control room" sticks. |
| C | Orchestrate Claude Code sessions. Watch from anywhere. | 54 | Two-sentence rhythm. Strong verb. |
| D | Mac app + iPhone for orchestrating Claude Code at scale | 55 | Surface-area framing. |
| E | The dashboard for your parallel Claude Code agents | 50 | Buzzwordy in a useful way. |

**My pick: A.** Tells you exactly what it is in plain English, fits in 60 chars, mentions "iPhone" which is the unique angle vs every other Claude Code tool on PH.

---

## 2 · Description (260 chars max)

Pick one. PH shows this on the daily list and on the product page.

### Option A — Punchy (240 chars)

> A Mac app that runs many Claude Code sessions in parallel, each in a real PTY with persistent scrollback. The iPhone companion lets you watch and steer them from anywhere — and wakes your phone when a session needs your attention. Free + open source.

### Option B — Story (250 chars)

> Built for the moment your one Claude Code session became four. Anthology gives each its own real PTY, a status dot, persistent scrollback, and a Mission Control grid. The iPhone companion follows you out of the office. Free + Apache 2.0.

### Option C — Technical (255 chars)

> Multi-session Claude Code orchestrator for macOS. Real PTYs, durable scrollback, MCP-powered "Project Manager" mode for delegating between sessions, and an iPhone companion that streams sessions over Tailscale. Free + Apache 2.0.

**My pick: A.** Most accessible. PH skews to product people, not just devs.

---

## 3 · Topics

Pick exactly 3 (PH limit):

1. **Developer Tools** *(home category)*
2. **Artificial Intelligence**
3. **macOS**

Alternatives if those don't fit: *Productivity*, *Open Source*, *iPhone*.

---

## 4 · Pricing

**Free + open source** (toggle the "Free" badge in the form). Apache 2.0 license is bonus signal — PH community responds well to OSS.

---

## 5 · Links

| Field | Value |
|---|---|
| **Website** | https://github.com/michaellomuscio/anthology |
| **GitHub** | https://github.com/michaellomuscio/anthology |
| **Twitter** | (optional — if you have one) |

---

## 6 · Gallery (`gallery/`)

Six images at 1270×760, in this order:

1. `01-hero.png` — Mac mission control + iPhone session list, side-by-side. **This is the thumbnail** that 95% of viewers see. Most important image.
2. `02-mission-control.png` — Mac alone, mission control grid with live sessions
3. `03-session-view.png` — Mac alone, single-session view (the live terminal)
4. `04-command-palette.png` — Mac alone, ⌘K palette open
5. `05-spawn-dialog.png` — Mac alone, spawn modal showing the form
6. `06-iphone-pairing.png` — Mac + iPhone showing the pairing screen

Plus `demo.gif` (1.2 MB, 21 sec) — embed inline in the maker comment.

> ⚠️ Heads-up: the Mac screenshots show the old Lomuscio Labs lambda mark in the sidebar. The bee is the new brand (v0.3.1). If you want fresh shots before launch, ask me — I'll re-capture mission-control.png, command-palette.png, etc. with the bee in the corner. Takes ~10 min.

---

## 7 · Maker's first comment

Paste this as your first comment within 60 seconds of launch (most successful launches do this). It's the founder's pitch — sets tone, invites feedback.

```
👋 Hey Product Hunt!

I built Anthology because my single Claude Code session became four
overnight, and Terminal tabs weren't cutting it. One session was
polishing tests, another drafting a PR description, a third was
exploring a refactor, and I kept losing track of which was waiting
on a permission decision.

So I built the manager I wanted:

🐝 Mac app — every session is a real PTY with persistent
   scrollback (no lost context on restart), a status dot
   (running / idle / waiting / error), and a Mission Control
   grid for watching the whole fleet at once.

📱 iPhone companion — pair via QR, then view and control any
   session from your phone over LAN, Tailscale, or anywhere.
   Push notifications wake you when a session needs you,
   even with the app closed.

⚡ Project Manager mode — toggle a session into PM mode and
   it gets MCP tools to spawn, message, monitor, and kill
   *other* sessions. One Claude session coordinating a
   multi-session refactor.

It's free and open source under Apache 2.0. The Cloudflare Worker
that powers push (~150 LOC) is also open. Apple Silicon only for
now (M1/M2/M3/M4); requires Claude Code installed and signed in.

I'd love to hear:
  - What other agentic-dev workflows do you wish were easier
    to manage in parallel?
  - For folks running 3+ Claude Code sessions: what's your
    current setup? Tmux? Multiple terminals? Something else?
  - iOS folks — would you use a tablet UI for this on iPad?

Demo video: <embed demo.gif>
GitHub: https://github.com/michaellomuscio/anthology
iOS companion: https://github.com/michaellomuscio/anthology-ios
Push relay: https://github.com/michaellomuscio/anthology-push-worker

Thanks for taking a look 🙏
— Michael
```

Tweak the personal details (the "I built this because…" hook works best when it's true and specific to you).

---

## 8 · FAQ — pre-written replies

Have these ready to copy-paste in comments. Reply within an hour for the first 6 hours of the day.

### "Is this open source?"
> Yes — Apache 2.0. All three repos are public on my GitHub: anthology (the Mac app), anthology-ios (the companion), and anthology-push-worker (the Cloudflare Worker for push notifications). Contributions welcome — see CONTRIBUTING.md in each.

### "How does this differ from Raycast / Warp / iTerm?"
> Different layer. Raycast is a launcher; Warp and iTerm are general-purpose terminals. Anthology is purpose-built for Claude Code's session lifecycle — status detection ("waiting on permission"), per-session persistent scrollback, push-when-blocked, and an iPhone companion. You'd still use one of those terminals for non-Claude work; Anthology is for the Claude Code-specific workflow.

### "Mac only? Will there be a Linux/Windows version?"
> Mac only for v0.3. The hard parts (PTY spawning, signed/notarized distribution, MCP server) all work on Linux and Windows in principle, but I have no Linux or Windows machine to test on. If anyone wants to maintain those ports, I'd happily support — open an issue.

### "Does it work with [Cursor / Aider / OpenAI Codex]?"
> No, it's specifically designed for the `claude` CLI's behavior — the status dots reflect Claude's permission-prompt patterns, the Project Manager mode hooks into Claude's MCP support. Could be ported but it's not on my roadmap.

### "Does sending sessions to my phone send my code to a third party?"
> No. The phone connects directly to your Mac over WebSocket, encrypted at the network layer (Tailscale's WireGuard, or trusted Wi-Fi). The Cloudflare Worker only sees the alert title/body when forwarding push notifications — it never sees session contents. Full threat model: docs/bridge-protocol.md.

### "How is push secured?"
> A bearer token (288 bits of entropy, sha256-stored on the Mac) gates all remote control. Pairing is a one-shot 6-digit code over QR, with brute-force defense (burns after 3 failed attempts, rate-limited per IP). Tokens are revocable from the phone-icon modal. Detailed walkthrough: SECURITY.md.

### "Why use Cloudflare Workers for push? Why not roll your own?"
> Two reasons: (1) APNs requires an always-online HTTPS endpoint to fan out to multiple device tokens, which a personal Mac can't reliably be. (2) Cloudflare Workers' free tier (100k req/day) is way more than personal use — push is effectively free forever. The Worker is ~150 LOC, stateless, no KV/D1.

### "How does it differ from VS Code's Claude extension?"
> Different surface. The VS Code extension lives inside one editor session. Anthology lives outside any editor — each session is its own PTY-driven Claude Code, runnable from any directory, manageable as a fleet. Use both: editor extension for code-adjacent prompts, Anthology for long-running parallel work.

### "Can I use the iPhone app without Tailscale?"
> Yes, on the same Wi-Fi as your Mac. Tailscale is optional — it's what makes "control my Mac from a coffee shop" work. Install once on both devices (free for personal), and the iPhone connects to your Mac's tailnet IP from anywhere.

### "What's the catch? Is there a paid tier coming?"
> No catch. Free, Apache 2.0, no telemetry, no analytics, no paid tier. Maintained on personal time. If it grows beyond personal-time scale I'll figure out sustainability then; I'd rather under-promise than launch with a "Pro tier coming soon" that may never ship.

---

## 9 · Suggested launch dates

Today is **Tuesday, May 5, 2026**. Tuesdays–Thursdays are best on PH; avoid Mondays (high competition) and Fridays (low traffic).

| Date | Pros | Cons |
|---|---|---|
| **Tue, May 12** | One week prep — enough time to re-shoot screenshots, draft tweets, line up early supporters | Tight if you also need to do an iOS update |
| **Tue, May 19** | Two weeks prep — recommended | None |
| **Wed, May 27** | Three weeks prep — most polished | Right after Memorial Day weekend (mon May 25 is holiday); week may have lower-than-usual traffic |

**My pick: Tue, May 19.** Enough time for a screenshot refresh and to seed the launch with a Substack post on `fullstackeducator` a few days before; not so far out that the project loses momentum.

Avoid: dates within ±3 days of any rumored Apple Event or Anthropic announcement. Check <https://buffer.com/library/social-media-content-calendar/> closer to the date.

---

## 10 · Pre-launch checklist (the week before)

- [ ] Re-shoot Mac screenshots with the new Bee mark in the sidebar
- [ ] Update README's badges to v0.3.1 (already done)
- [ ] Verify the GitHub release DMG downloads cleanly without GitHub login (already true — public repo)
- [ ] Test pair flow end-to-end on a fresh iPhone
- [ ] Have 5–10 people lined up who will engage on launch morning (NOT explicitly upvote — just "I noticed you launched, here's a thoughtful comment")
- [ ] Schedule a "Coming soon" PH page 1 week before — it lets the community subscribe
- [ ] Write the Substack `fullstackeducator` post for launch day

---

## 11 · Day-of strategy

| Time (PT) | Time (ET) | Action |
|---|---|---|
| 12:01 AM | 3:01 AM | Submission auto-publishes (PH does this — schedule it the night before) |
| 7:00 AM | 10:00 AM | Post your maker's first comment |
| 7:30 AM | 10:30 AM | Tweet/email/Substack: "Anthology is on Product Hunt today" with the PH link |
| 8 AM – 12 PM | 11 AM – 3 PM | Reply to every comment within 30 min — this is the engagement window that ranks you |
| 3 – 6 PM | 6 – 9 PM | Slower window; check in every hour |
| 11 PM | 2 AM | Final ranking locks at midnight PT |

PH ToS forbids "please upvote me" — you can announce ("I launched today") but never ask for the click.

---

## 12 · After launch

Whatever happens, do these:

1. Thank every commenter individually
2. Open issues in the GitHub repo for any feature requests that came up
3. Add the PH badge to the README (PH gives you embed code post-launch)
4. Write a follow-up Substack post 2–3 days later with what you learned

Even a #20-of-the-day finish will get you 50–200 GitHub stars in week 1, which is enough to seed organic discovery via the topic pages you tagged earlier.
