'use strict';

const ANSI_REGEX = /\[[0-9;?]*[a-zA-Z]|\][^]*(?:|\\)|[=>]|\([0-9A-B]/g;

function stripAnsi(s) {
  if (!s) return '';
  return s.replace(ANSI_REGEX, '').replace(/\r/g, '');
}

function uid() {
  return 's_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);
}

const SESSION_COLORS = ['#7B2FBE', '#1DB9A0', '#E8634F', '#D4A843', '#4DA3D4', '#7CBB4F', '#D4648A', '#5A6B7E'];

function pickColor() {
  return SESSION_COLORS[Math.floor(Math.random() * SESSION_COLORS.length)];
}

function buildTools({ ptyManager, sessionsStore, broadcast }) {
  return {
    station_list_sessions: {
      description:
        "List all Claude Code sessions currently managed by Anthology. Returns id, name, working directory, status (running/idle/waiting/error), tag, and whether the underlying PTY is alive. Use this first to see what's running before spawning more.",
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
      handler: async () => {
        const stored = sessionsStore.list();
        const list = stored.map((s) => ({
          id: s.id,
          name: s.name,
          cwd: s.cwd,
          tag: s.tag || null,
          color: s.color || null,
          status: ptyManager.exists(s.id) ? ptyManager.getStatus(s.id) || 'running' : 'idle',
          alive: ptyManager.exists(s.id),
          pinned: !!s.pinned,
          spawnedByPM: !!s.spawnedByPM,
        }));
        return {
          content: [{ type: 'text', text: JSON.stringify(list, null, 2) }],
        };
      },
    },

    station_spawn_session: {
      description:
        "Spawn a NEW Claude Code session in the given working directory. Returns the new session id. The new session starts running `claude` immediately. Use station_send_to_session to send it instructions, station_read_session_output to check on it, and station_kill_session when its work is done.",
      inputSchema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Short label for the session (shown in the sidebar). Be descriptive — e.g. "auth refactor", "fix flaky tests".',
          },
          cwd: {
            type: 'string',
            description: 'Absolute path to the working directory the session should run in. Use a real existing directory.',
          },
          tag: {
            type: 'string',
            description: 'Optional tag — feature, bugfix, docs, exploration, design, refactor, review, spike.',
          },
          initial_prompt: {
            type: 'string',
            description: 'Optional first message to send into the session after it starts (e.g. the task you want it to do).',
          },
        },
        required: ['name', 'cwd'],
      },
      handler: async ({ name, cwd, tag, initial_prompt }) => {
        const id = uid();
        const session = {
          id,
          name: String(name).slice(0, 80),
          cwd,
          tag: tag || 'feature',
          color: pickColor(),
          pinned: false,
          createdAt: Date.now(),
          spawnedByPM: true,
        };
        sessionsStore.upsert(session);
        ptyManager.create({ id, cwd, runClaude: true });
        broadcast('session:created', session);

        if (initial_prompt && typeof initial_prompt === 'string' && initial_prompt.trim()) {
          // Wait for claude to fully boot (banner, MCP server connect, input box ready)
          // before submitting the first prompt. The submit uses bracketed-paste + a
          // separate Enter keystroke so claude reliably treats it as "user pressed Enter".
          setTimeout(() => {
            try {
              ptyManager.submitPrompt(id, initial_prompt);
            } catch (_) {}
          }, 4500);
        }

        return {
          content: [
            {
              type: 'text',
              text: `Spawned session id=${id} name="${session.name}" cwd=${cwd}. ${initial_prompt ? 'Initial prompt queued.' : 'No initial prompt — call station_send_to_session to give it work.'}`,
            },
          ],
        };
      },
    },

    station_send_to_session: {
      description:
        "Send a message to an existing Claude Code session as if you typed it. The message is submitted (Enter is appended). Use this to give a session new instructions or to answer a permission prompt (e.g. message='1' to pick the first option).",
      inputSchema: {
        type: 'object',
        properties: {
          session_id: { type: 'string', description: 'The id of the session to send the message to.' },
          message: { type: 'string', description: 'The text to type into the session. Newline/Enter is appended automatically.' },
        },
        required: ['session_id', 'message'],
      },
      handler: async ({ session_id, message }) => {
        if (!ptyManager.exists(session_id)) {
          throw new Error(`session ${session_id} is not running (call station_list_sessions to see live sessions)`);
        }
        const cleaned = String(message).replace(/\r/g, '');
        const ok = ptyManager.submitPrompt(session_id, cleaned);
        if (!ok) throw new Error(`write to session ${session_id} failed`);
        return {
          content: [{ type: 'text', text: `Submitted ${cleaned.length} chars to ${session_id}.` }],
        };
      },
    },

    station_read_session_output: {
      description:
        "Read recent output from a session — the tail of the terminal buffer with ANSI codes stripped. Use this to check on what a session has been doing, what it's currently asking, or what error it hit. Returns up to ~20K characters by default.",
      inputSchema: {
        type: 'object',
        properties: {
          session_id: { type: 'string', description: 'The id of the session to read.' },
          chars: {
            type: 'number',
            description: 'Maximum number of characters to return from the tail. Default 8000.',
          },
        },
        required: ['session_id'],
      },
      handler: async ({ session_id, chars }) => {
        const buf = ptyManager.getRecentBuffer(session_id);
        if (buf === null) {
          throw new Error(`session ${session_id} not found`);
        }
        const limit = Math.max(200, Math.min(20000, Number(chars) || 8000));
        const tail = buf.slice(-limit);
        const cleaned = stripAnsi(tail);
        const status = ptyManager.getStatus(session_id) || 'idle';
        return {
          content: [
            {
              type: 'text',
              text:
                `[session ${session_id} · status=${status} · ${cleaned.length} chars]\n` +
                '----- BEGIN OUTPUT -----\n' +
                cleaned +
                '\n----- END OUTPUT -----',
            },
          ],
        };
      },
    },

    station_get_session_status: {
      description:
        "Get the current status of a session: running (Claude is actively producing output), idle (no recent output), waiting (Claude is waiting on a permission prompt — needs an answer!), or error (last tool call failed). Lightweight — call this often when monitoring.",
      inputSchema: {
        type: 'object',
        properties: {
          session_id: { type: 'string' },
        },
        required: ['session_id'],
      },
      handler: async ({ session_id }) => {
        const alive = ptyManager.exists(session_id);
        const status = alive ? ptyManager.getStatus(session_id) || 'running' : 'idle';
        return {
          content: [{ type: 'text', text: JSON.stringify({ session_id, status, alive }) }],
        };
      },
    },

    station_wait_for_idle: {
      description:
        "BLOCK until a Claude Code session goes idle (i.e., Claude has finished its current turn) OR enters waiting/error/ended state. Returns when the session has had no output for at least `idle_seconds` (default 5), or immediately if it needs permission or errored. Use this AFTER sending a prompt to know when Claude is done. Much better than polling station_get_session_status — this returns the moment the state changes, with the tail of the session's output included.",
      inputSchema: {
        type: 'object',
        properties: {
          session_id: { type: 'string' },
          idle_seconds: {
            type: 'number',
            description: 'How many seconds of inactivity should be considered "idle / done". Default 5.',
          },
          timeout_seconds: {
            type: 'number',
            description: 'Hard cap on how long to wait. Default 300 (5 min). Max 1800.',
          },
        },
        required: ['session_id'],
      },
      handler: async ({ session_id, idle_seconds = 5, timeout_seconds = 300 }) => {
        const cap = Math.max(5, Math.min(1800, Number(timeout_seconds) || 300));
        const idleMsTarget = Math.max(1, Math.min(120, Number(idle_seconds) || 5)) * 1000;
        const start = Date.now();
        while (Date.now() - start < cap * 1000) {
          if (!ptyManager.exists(session_id)) {
            return {
              content: [{ type: 'text', text: JSON.stringify({ session_id, event: 'ended' }) }],
            };
          }
          const status = ptyManager.getStatus(session_id);
          const idleMs = ptyManager.getIdleMs(session_id);
          if (status === 'waiting' || status === 'error') {
            const tail = stripAnsi((ptyManager.getRecentBuffer(session_id) || '').slice(-1500));
            return {
              content: [{ type: 'text', text: JSON.stringify({ session_id, event: status, idle_ms: idleMs, tail }) }],
            };
          }
          if (idleMs >= idleMsTarget) {
            const tail = stripAnsi((ptyManager.getRecentBuffer(session_id) || '').slice(-1500));
            return {
              content: [{ type: 'text', text: JSON.stringify({ session_id, event: 'idle', idle_ms: idleMs, tail }) }],
            };
          }
          await new Promise((r) => setTimeout(r, 750));
        }
        return {
          content: [{ type: 'text', text: JSON.stringify({ session_id, event: 'timeout', message: 'still active after timeout' }) }],
        };
      },
    },

    station_wait_for_any: {
      description:
        "BLOCK until ANY of the listed sessions changes to a meaningful state (becomes idle, enters waiting, errors, or ends). Returns the FIRST session to change and what happened. Use this to monitor multiple workers in parallel — the call returns the moment one of them needs your attention. Call it in a loop after spawning a batch of sessions to handle them as they finish.",
      inputSchema: {
        type: 'object',
        properties: {
          session_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'IDs to watch. Pass an empty array to watch ALL live sessions.',
          },
          idle_seconds: {
            type: 'number',
            description: 'Seconds of inactivity that count as "idle / done". Default 5.',
          },
          timeout_seconds: {
            type: 'number',
            description: 'Max wait. Default 180 (3 min). Max 1800.',
          },
        },
        required: ['session_ids'],
      },
      handler: async ({ session_ids, idle_seconds = 5, timeout_seconds = 180 }) => {
        const cap = Math.max(5, Math.min(1800, Number(timeout_seconds) || 180));
        const idleMsTarget = Math.max(1, Math.min(120, Number(idle_seconds) || 5)) * 1000;

        const resolveIds = () => {
          if (Array.isArray(session_ids) && session_ids.length > 0) return session_ids.slice();
          return sessionsStore.list().map((s) => s.id);
        };

        // Snapshot initial statuses so we only fire when something CHANGES.
        const initialStatus = {};
        for (const id of resolveIds()) {
          initialStatus[id] = ptyManager.getStatus(id);
        }

        const start = Date.now();
        while (Date.now() - start < cap * 1000) {
          const ids = resolveIds();
          for (const id of ids) {
            if (!ptyManager.exists(id)) {
              if (initialStatus[id] !== undefined) {
                return {
                  content: [{ type: 'text', text: JSON.stringify({ event: 'ended', session_id: id }) }],
                };
              }
              continue;
            }
            const status = ptyManager.getStatus(id);
            const idleMs = ptyManager.getIdleMs(id);

            if ((status === 'waiting' || status === 'error') && initialStatus[id] !== status) {
              const tail = stripAnsi((ptyManager.getRecentBuffer(id) || '').slice(-1500));
              return {
                content: [{ type: 'text', text: JSON.stringify({ event: status, session_id: id, idle_ms: idleMs, tail }) }],
              };
            }
            if (idleMs >= idleMsTarget && initialStatus[id] !== 'idle') {
              const tail = stripAnsi((ptyManager.getRecentBuffer(id) || '').slice(-1500));
              return {
                content: [{ type: 'text', text: JSON.stringify({ event: 'idle', session_id: id, idle_ms: idleMs, tail }) }],
              };
            }
          }
          await new Promise((r) => setTimeout(r, 750));
        }
        return {
          content: [{ type: 'text', text: JSON.stringify({ event: 'timeout' }) }],
        };
      },
    },

    station_kill_session: {
      description:
        "Kill a session and remove it from Anthology. The PTY is terminated and the session disappears from the sidebar. Call this when a session has finished its work.",
      inputSchema: {
        type: 'object',
        properties: {
          session_id: { type: 'string' },
        },
        required: ['session_id'],
      },
      handler: async ({ session_id }) => {
        // Always tear down the on-disk + sidebar record. The renderer's
        // pty:exit handler now keeps exited sessions around in the UI for the
        // restart banner — for an explicit MCP kill, we want a clean removal.
        ptyManager.kill(session_id);
        sessionsStore.remove(session_id);
        broadcast('session:killed', { id: session_id });
        return {
          content: [{ type: 'text', text: `Killed session ${session_id}.` }],
        };
      },
    },
  };
}

module.exports = { buildTools, stripAnsi };
