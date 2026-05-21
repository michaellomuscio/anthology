import React, { useEffect, useRef, useState } from 'react';

const station = window.station;

// Multi-line composer for sending long prompts to a Claude/Codex session.
// Typing into xterm directly is painful for anything more than a sentence —
// no editing, no easy paste-and-edit, no obvious "send" affordance. This
// modal gives a real textarea + Cmd+Enter to submit.
//
// Submission uses station.submitPrompt() which wraps the text in
// bracketed-paste markers in the main process so the receiving TUI treats
// it as one paste rather than per-keystroke input.
export default function RichInputModal({ sessionId, sessionName, onClose }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const textareaRef = useRef(null);

  useEffect(() => {
    // Defer focus so the textarea mounts first.
    const id = requestAnimationFrame(() => {
      try { textareaRef.current?.focus(); } catch (_) {}
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const submit = async () => {
    if (sending || !text.trim() || !sessionId) return;
    setSending(true);
    try {
      await station.submitPrompt(sessionId, text);
      onClose();
    } catch (e) {
      console.warn('[rich-input] submit failed:', e?.message);
      setSending(false);
    }
  };

  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    // Cmd+Enter / Ctrl+Enter sends. Plain Enter inserts a newline — important,
    // since long prompts span lines and the modal would be pointless if Enter
    // alone fired send.
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="modal-overlay rich-overlay" onClick={onClose}>
      <div className="modal rich-modal" onClick={(e) => e.stopPropagation()}>
        <div className="rich-header">
          <div>
            <div className="rich-title">Rich input</div>
            <div className="rich-subtitle">
              {sessionName ? <>→ <code>{sessionName}</code></> : 'no active session'}
            </div>
          </div>
          <span className="kbd-hint">esc</span>
        </div>
        <textarea
          ref={textareaRef}
          className="rich-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          placeholder="Write a long prompt, paste a transcript, sketch out a plan — then ⌘↵ to send it as one paste."
          spellCheck={false}
          rows={12}
        />
        <div className="rich-foot">
          <span><span className="kbd-hint">⌘ ↵</span> send · <span className="kbd-hint">esc</span> cancel · {text.length} chars</span>
          <div className="rich-foot-actions">
            <button type="button" onClick={onClose} disabled={sending}>Cancel</button>
            <button
              type="button"
              className="btn-primary"
              onClick={submit}
              disabled={sending || !text.trim() || !sessionId}
            >
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
