# Contributing

Thanks for your interest. Anthology is a small personal-time project but
external contributions are welcome.

## Setup

```bash
git clone <your-fork-url>
cd anthology
npm install
npm run dev
```

This launches Electron with Vite hot-reload for the renderer. Main process
changes need a manual restart (Cmd+Q the app, re-run `npm run dev`).

## Tests

```bash
npm test                # currently runs node --test on test/*.test.js
node --test test/bridge.test.js
node --test test/mcp-server.test.js
```

CI doesn't yet run automatically; please make sure tests pass locally before
opening a PR.

## What changes are welcome

- Bug fixes (always)
- New PtyManager features (resize handling, status detection improvements)
- Performance improvements (especially renderer rendering under heavy
  output load)
- Bridge protocol additions (please coordinate via an issue first; iOS
  companion may need parallel changes)
- Documentation, especially `docs/SETUP_PUSH.md` improvements

## What probably won't be accepted

- Adding a public-internet exposure path for the bridge without a
  corresponding hardening of auth / TLS — the project's threat model assumes
  Tailscale or LAN
- Bundling additional dependencies that significantly increase the .dmg size
- Rewrites of major subsystems without prior discussion

## Coding style

- Two-space indentation
- Comments only when explaining *why*, not *what* — name things well
- Prefer adding tests for any change that fixes a bug
- Match the existing file's structure: top-level declarations, then helpers,
  then exports

## License

By contributing, you agree your changes are licensed under the same Apache
License 2.0 that covers the rest of the project.
