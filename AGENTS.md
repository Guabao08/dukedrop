# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- The UI/behavior spec for this app lives outside this repo, in the Claude Design project "App redesign requirements" (`claude_design` MCP, project id `2d26566b-bc13-427a-b83d-b53a1f6f5841`), not in any local file — read it live via MCP rather than trusting a prior download. `DukeDrop-print.dc.html` is only a print rate sheet (copy/pricing, no fields); the full interactive spec (fields, ordering, validation, consent, payment) is `DukeDrop.dc.html`'s `Component` class. See `docs/design-comparison.md` for the audited inventory and what's intentionally left out (`support.js`, `doc-page.js` — generated design-tool scaffolding, not app logic).
- `app.js` is plain, dependency-free JS: exported pure functions (pricing/memo/consent/validation/payment-link construction) plus a small hand-rolled DOM renderer guarded by `typeof document !== 'undefined'` so the same file works under `node --test` and in the browser. Keep new interaction logic in that shape rather than introducing a framework.
- `npm test` runs `node --test` (which also builds `dist/` and static-serves it as part of the test suite) — that's the same command `npm run build` depends on, so `npm test` is the one command to run before any change.
- `chrome-devtools-axi` was non-functional in at least one worktree session here (`open`/`page.open()` report success but every follow-up call fails with "Required at pageId", `pages` always reports 0) — verified across fresh/headed/named sessions, so it wasn't a one-off. If it recurs, don't sink more time into workarounds; fall back to the unit test suite + manual template review and note the gap.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
