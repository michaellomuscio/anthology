'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const SecretScrubber = require('../src/main/secret-scrubber');
const { maskString, TAIL_BYTES } = require('../src/main/secret-scrubber');

// --------------------------------------------------------------------------
// maskString — direct, no buffering.
// Each pattern gets a positive case (must mask) AND a negative case (must
// pass through unchanged) so regression on a tightening rule shows up here.
// --------------------------------------------------------------------------

test('maskString redacts Anthropic API keys', () => {
  const input = 'token: sk-ant-api03-' + 'a'.repeat(95) + ' end';
  const { masked, hits } = maskString(input);
  assert.equal(hits, 1);
  assert.equal(masked, 'token: [REDACTED:anthropic] end');
});

test('maskString redacts OpenAI legacy and project keys', () => {
  const legacy = 'OPENAI=sk-' + 'X'.repeat(48);
  const proj = 'OPENAI=sk-proj-' + 'Y'.repeat(60);
  // env-style pattern wins first ("OPENAI=…" isn't in the env keyword list,
  // so the openai pattern handles it). Run both through directly.
  assert.match(maskString(legacy).masked, /\[REDACTED:openai\]/);
  assert.match(maskString(proj).masked, /\[REDACTED:openai\]/);
});

test('maskString redacts AWS access key IDs (AKIA and ASIA)', () => {
  const akia = 'aws_access_key_id = AKIA1234567890ABCDEF';
  const asia = 'aws_access_key_id = ASIAABCDEFGHIJKLMNOP';
  assert.match(maskString(akia).masked, /\[REDACTED:aws-access\]/);
  assert.match(maskString(asia).masked, /\[REDACTED:aws-access\]/);
});

test('maskString redacts classic and fine-grained GitHub PATs', () => {
  const classic = 'auth: ghp_' + 'a'.repeat(36);
  const fine = 'auth: github_pat_' + 'b'.repeat(82);
  assert.match(maskString(classic).masked, /\[REDACTED:github-pat\]/);
  assert.match(maskString(fine).masked, /\[REDACTED:github-pat\]/);
});

test('maskString redacts Slack and Stripe tokens', () => {
  assert.match(maskString('xoxb-1234567890-abcdefghij').masked, /\[REDACTED:slack\]/);
  assert.match(maskString('sk_live_' + 'Z'.repeat(24)).masked, /\[REDACTED:stripe\]/);
});

test('maskString redacts JWTs and Google API keys', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
  assert.match(maskString(jwt).masked, /\[REDACTED:jwt\]/);
  assert.match(maskString('AIza' + 'a'.repeat(35)).masked, /\[REDACTED:google-api\]/);
});

test('maskString preserves the KEY= prefix for .env-style secrets', () => {
  const cases = [
    ['DATABASE_PASSWORD=supersecret', 'DATABASE_PASSWORD=[REDACTED]'],
    ['export STRIPE_SECRET_KEY=sk_live_abc', 'export STRIPE_SECRET_KEY=[REDACTED]'],
    ['MY_API_KEY=hunter2', 'MY_API_KEY=[REDACTED]'],
    ['AUTH_TOKEN=eyJ.something', 'AUTH_TOKEN=[REDACTED]'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(maskString(input).masked, expected, `failed for: ${input}`);
  }
});

test('maskString leaves ordinary output untouched', () => {
  const benign = [
    'hello world',
    'cd /tmp && ls -la',
    'http://example.com/path?q=1',
    'commit abc123def456 by Alice',
    'a regular ANSI string \x1b[31mred\x1b[0m text',
  ];
  for (const s of benign) {
    const { masked, hits } = maskString(s);
    assert.equal(masked, s, `should not mask: ${s}`);
    assert.equal(hits, 0);
  }
});

test('maskString stops env-style values at whitespace and shell separators', () => {
  // Common shell patterns where the value is followed by another command.
  assert.equal(maskString('TOKEN=abc && echo done').masked, 'TOKEN=[REDACTED] && echo done');
  assert.equal(maskString('SECRET=xyz; cd /tmp').masked, 'SECRET=[REDACTED]; cd /tmp');
});

// --------------------------------------------------------------------------
// SecretScrubber — streaming behavior + tail buffering.
// --------------------------------------------------------------------------

function drain(scrubber, chunks) {
  const out = [];
  const emit = (s) => out.push(s);
  for (const c of chunks) scrubber.feed(c, emit);
  scrubber.flush(emit);
  return out.join('');
}

test('SecretScrubber masks a secret delivered in a single chunk', () => {
  const s = new SecretScrubber();
  const out = drain(s, ['prefix sk-ant-' + 'A'.repeat(95) + ' suffix']);
  assert.match(out, /\[REDACTED:anthropic\]/);
  assert.ok(!out.includes('sk-ant-A'));
  assert.equal(s.getRedactionCount(), 1);
});

test('SecretScrubber masks a secret split across two PTY chunks', () => {
  // Force the split point inside the secret token. The tail buffer should keep
  // bytes around long enough for the second chunk to complete the match.
  const secret = 'sk-ant-' + 'X'.repeat(95);
  const splitAt = 20;
  const chunkA = 'before ' + secret.slice(0, splitAt);
  const chunkB = secret.slice(splitAt) + ' after';
  const s = new SecretScrubber();
  const out = drain(s, [chunkA, chunkB]);
  assert.match(out, /\[REDACTED:anthropic\]/);
  assert.ok(!out.includes('sk-ant-X'), 'plaintext token must not leak across chunk boundary');
});

test('SecretScrubber emits non-secret output without buffering past TAIL_BYTES', () => {
  const s = new SecretScrubber();
  // Push more than TAIL_BYTES of benign output; everything before the tail
  // window should be released immediately on the first feed.
  const filler = 'x'.repeat(TAIL_BYTES * 3);
  const seen = [];
  s.feed(filler, (out) => seen.push(out));
  const released = seen.join('').length;
  assert.ok(released >= TAIL_BYTES * 2, `expected ~${TAIL_BYTES * 2}+ chars released, got ${released}`);
});

test('SecretScrubber idle-flushes the tail so the UI never stalls', async () => {
  const s = new SecretScrubber();
  let collected = '';
  s.feed('tail-only-content', (out) => { collected += out; });
  // No second chunk arrives; the idle timer should drain the tail soon.
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(collected, 'tail-only-content');
});

test('SecretScrubber passthrough when disabled', () => {
  const s = new SecretScrubber({ enabled: false });
  const out = drain(s, ['sk-ant-' + 'Q'.repeat(95)]);
  assert.match(out, /sk-ant-Q/);
  assert.equal(s.getRedactionCount(), 0);
});

test('SecretScrubber setEnabled(false) returns held tail unmasked', () => {
  const s = new SecretScrubber();
  // Prime with content shorter than TAIL_BYTES so all of it lives in the buffer.
  s.feed('partial-content', () => {});
  const drainOut = s.setEnabled(false);
  assert.equal(drainOut, 'partial-content');
});

test('SecretScrubber preserves ANSI escape sequences around a secret', () => {
  const s = new SecretScrubber();
  const input = '\x1b[33mtoken: sk-ant-' + 'Z'.repeat(95) + '\x1b[0m\n';
  const out = drain(s, [input]);
  // The escape sequences should pass through; the secret in the middle should be masked.
  assert.ok(out.startsWith('\x1b[33m'), 'preserves opening escape');
  assert.ok(out.endsWith('\x1b[0m\n'), 'preserves closing escape + newline');
  assert.match(out, /\[REDACTED:anthropic\]/);
});

test('SecretScrubber reports total redaction count across multiple feeds', () => {
  const s = new SecretScrubber();
  drain(s, [
    'sk-ant-' + 'A'.repeat(95),
    ' ',
    'AKIA1234567890ABCDEF',
    ' ',
    'DATABASE_PASSWORD=hunter2',
  ]);
  assert.equal(s.getRedactionCount(), 3);
});

test('SecretScrubber close() clears timers without throwing', () => {
  const s = new SecretScrubber();
  s.feed('something', () => {});
  // Should not throw and should leave buffer empty.
  s.close();
  assert.equal(s.buffer, '');
});
