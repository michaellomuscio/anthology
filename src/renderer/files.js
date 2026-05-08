// Helpers for getting file paths into a live PTY — shared by the terminal
// drop handler and the SessionView "Attach" button.

const station = window.station;

// POSIX-safe single-quote shell escape: wraps the path in single quotes and
// replaces any literal ' with '\''. Works in bash/zsh/sh and is what macOS
// Terminal.app emits when you drag a file with spaces or special chars.
export function shellEscape(p) {
  if (typeof p !== 'string' || !p) return '';
  return "'" + p.replace(/'/g, "'\\''") + "'";
}

// True when the drag carries OS files (not a synthetic intra-app drag like
// our session-row drop). Filters out the sidebar's group drag-drop.
export function isFileDrag(event) {
  if (!event?.dataTransfer) return false;
  const types = event.dataTransfer.types;
  if (!types) return false;
  for (let i = 0; i < types.length; i++) {
    if (types[i] === 'Files') return true;
  }
  return false;
}

// Extract absolute paths from a drag/drop event. Uses Electron's
// webUtils.getPathForFile (exposed via preload as station.getPathForFile)
// since File.path is deprecated as of Electron 32.
export function pathsFromDropEvent(event) {
  if (!event?.dataTransfer) return [];
  const files = Array.from(event.dataTransfer.files || []);
  const out = [];
  for (const f of files) {
    let p = '';
    try { p = station.getPathForFile ? station.getPathForFile(f) : (f.path || ''); }
    catch (_) { p = f.path || ''; }
    if (p) out.push(p);
  }
  return out;
}

// Write a list of absolute paths into a session's PTY as if the user typed
// them — shell-escaped, space-separated, with a trailing space so the user
// can keep typing after.
export function insertPathsIntoSession(sessionId, paths) {
  if (!sessionId || !Array.isArray(paths) || paths.length === 0) return;
  const text = paths.map(shellEscape).join(' ') + ' ';
  try { station.writePty(sessionId, text); } catch (_) {}
}
