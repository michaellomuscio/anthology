'use strict';

// Streaming secret scrubber for PTY output.
//
// Sits in front of the xterm-bound data stream so well-known credential
// shapes (API keys, tokens, .env values) are replaced with a [REDACTED:type]
// marker BEFORE bytes reach the renderer or the persisted scrollback. That
// keeps plaintext secrets off disk and out of over-shoulder view.
//
// The scrubber buffers a short tail (TAIL_BYTES) so a secret that straddles
// two PTY data chunks still gets masked on the second arrival. A small idle
// flush timer (FLUSH_DELAY_MS) drains the tail when the stream goes quiet so
// the user never sees an unmoving last-200-chars-stuck UI.

// Length of the smallest regex window we keep across feeds. Sized to comfortably
// exceed the longest patterns below (GitHub fine-grained PATs can be ~95 chars,
// long Anthropic keys are ~108 chars including prefix). 256 is conservative.
const TAIL_BYTES = 256;

// If no new chunk arrives within this many ms, flush whatever is held. 40 ms is
// well under one frame at 60fps and keeps the UI feeling live during idle bursts.
const FLUSH_DELAY_MS = 40;

// Pattern library. Order matters only for replacement clarity — first match wins
// per region because we run them sequentially with String.prototype.replace.
//
// Each entry:
//   name:    short label used in the [REDACTED:<name>] sentinel
//   regex:   global regex that finds the secret
//   replace: optional replacer (function or string). Default is full-match → sentinel.
//
// Adding a pattern? Be conservative — false positives that mask real output are
// more disruptive than false negatives. Patterns should be anchored to a
// well-known prefix or layout. Avoid bare "looks like a hash" matchers.
const PATTERNS = [
  {
    name: 'anthropic',
    regex: /\bsk-ant-[A-Za-z0-9_\-]{32,}\b/g,
  },
  {
    name: 'openai',
    // sk-... (legacy ≥40 chars) or sk-proj-... (project keys)
    regex: /\bsk-(?:proj-)?[A-Za-z0-9_\-]{40,}\b/g,
  },
  {
    name: 'aws-access',
    regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  },
  {
    name: 'github-pat',
    // classic ghp_/ghs_/gho_/ghu_/ghr_ tokens — fixed 36-char body
    regex: /\bgh[opurs]_[A-Za-z0-9]{36}\b/g,
  },
  {
    name: 'github-pat',
    // fine-grained PAT — much longer; 82 is conservative minimum
    regex: /\bgithub_pat_[A-Za-z0-9_]{82,}\b/g,
  },
  {
    name: 'slack',
    regex: /\bxox[bpoarse]-[A-Za-z0-9\-]{10,}\b/g,
  },
  {
    name: 'stripe',
    regex: /\b(?:sk|rk|pk)_(?:test|live)_[A-Za-z0-9]{24,}\b/g,
  },
  {
    name: 'jwt',
    // base64url . base64url . base64url with the standard JWT header prefix
    regex: /\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b/g,
  },
  {
    name: 'google-api',
    regex: /\bAIza[0-9A-Za-z\-_]{35}\b/g,
  },
  {
    name: 'env',
    // KEY=value lines where KEY names a secret-y concept. We preserve the KEY=
    // prefix so the user can still see WHICH variable was masked. The value
    // ends at the first whitespace, quote, or shell separator.
    //
    // Matches both `FOO_TOKEN=abc` and `export FOO_TOKEN=abc`. The optional
    // `_KEY` tail catches the very common STRIPE_SECRET_KEY shape (a secret-y
    // keyword followed by `_KEY` before the `=`). `_PATH`/`_NAME` are
    // intentionally NOT allowed as tails — those usually point at a secret
    // rather than being one.
    regex: /\b((?:[A-Z][A-Z0-9_]*_)?(?:PASSWORD|PASSWD|PWD|SECRET|TOKEN|APIKEY|API_KEY|PRIVATE_KEY|ACCESS_KEY|AUTH_TOKEN|BEARER)(?:_KEY)?\s*=\s*)([^\s'"`;&|]+)/gi,
    replace: (_match, prefix /*, value */) => `${prefix}[REDACTED]`,
  },
];

function sentinelFor(name) { return `[REDACTED:${name}]`; }

// Run all patterns over a string. Counts hits so the UI can show a badge.
function maskString(input) {
  if (!input) return { masked: input, hits: 0 };
  let out = input;
  let hits = 0;
  for (const p of PATTERNS) {
    if (p.replace) {
      out = out.replace(p.regex, (...args) => {
        hits += 1;
        return p.replace(...args);
      });
    } else {
      const sentinel = sentinelFor(p.name);
      out = out.replace(p.regex, () => {
        hits += 1;
        return sentinel;
      });
    }
  }
  return { masked: out, hits };
}

class SecretScrubber {
  constructor({ enabled = true, onRedaction = null } = {}) {
    this.enabled = !!enabled;
    this.onRedaction = onRedaction;
    // Bytes held across feed() calls so a pattern split by a chunk boundary
    // still matches on the next arrival.
    this.buffer = '';
    this.flushTimer = null;
    // Lifetime hit counter — surfaced via getRedactionCount() so the UI can
    // show "5 secrets masked in this session" without re-scanning.
    this.totalRedactions = 0;
  }

  setEnabled(enabled) {
    const prev = this.enabled;
    this.enabled = !!enabled;
    // Switching OFF: drain whatever's held so the user doesn't see a stall.
    if (prev && !this.enabled) {
      const tail = this.buffer;
      this.buffer = '';
      if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
      return tail; // caller emits as-is (no masking on the way out)
    }
    return '';
  }

  getRedactionCount() { return this.totalRedactions; }

  resetRedactionCount() { this.totalRedactions = 0; }

  // Feed a PTY chunk. Returns the masked string ready for emission. Some bytes
  // may be held back inside the scrubber (tail buffer) and emitted on the next
  // feed() or after FLUSH_DELAY_MS via _scheduleFlush. The caller must pass
  // every flushed string straight through — order is preserved.
  feed(chunk, emit) {
    if (typeof chunk !== 'string' || chunk.length === 0) return '';
    if (!this.enabled) {
      // Bypass: no buffering, no masking, no timer.
      emit && emit(chunk);
      return chunk;
    }
    this.buffer += chunk;
    // Hold the last TAIL_BYTES for next time; everything before that is safely
    // past the longest match window and can be emitted.
    let emitNow = '';
    if (this.buffer.length > TAIL_BYTES) {
      const cut = this.buffer.length - TAIL_BYTES;
      const head = this.buffer.slice(0, cut);
      this.buffer = this.buffer.slice(cut);
      const { masked, hits } = maskString(head);
      emitNow = masked;
      if (hits > 0) {
        this.totalRedactions += hits;
        this.onRedaction && this.onRedaction(hits, this.totalRedactions);
      }
    }
    if (emitNow && emit) emit(emitNow);
    this._scheduleFlush(emit);
    return emitNow;
  }

  // Flush whatever is in the tail buffer. Called on idle timer and on close().
  flush(emit) {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    if (!this.buffer) return '';
    const tail = this.buffer;
    this.buffer = '';
    const { masked, hits } = maskString(tail);
    if (hits > 0) {
      this.totalRedactions += hits;
      this.onRedaction && this.onRedaction(hits, this.totalRedactions);
    }
    if (emit) emit(masked);
    return masked;
  }

  _scheduleFlush(emit) {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush(emit);
    }, FLUSH_DELAY_MS);
  }

  // Tear-down hook — called on session kill so we don't leak a node timer.
  close() {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    this.buffer = '';
  }
}

module.exports = SecretScrubber;
module.exports.PATTERNS = PATTERNS;
module.exports.maskString = maskString;
module.exports.TAIL_BYTES = TAIL_BYTES;
module.exports.FLUSH_DELAY_MS = FLUSH_DELAY_MS;
