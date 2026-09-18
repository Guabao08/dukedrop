# Design import: corrected differences

Source of truth: the Claude Design project **"App redesign requirements"**
(`claude_design` MCP project `2d26566b-bc13-427a-b83d-b53a1f6f5841`), read
live via MCP — not a locally re-used prior download. Three files were read:

- `DukeDrop-print.dc.html` — a print/rate-sheet artboard (intro copy + rate
  tables only, no interactive fields). Its own metadata
  (`omelette-print-source`) points at `DukeDrop.dc.html` at the exact etag
  still current in the project, i.e. they describe the same design state.
- `DukeDrop.dc.html` — the full interactive design (the `Component` class:
  state, per-service view-model construction, validation, memo/consent/payment
  behavior). This is where every field, ordering, and interaction rule below
  came from.
- `doc-page.js` / `support.js` — both generated design-tool scaffolding
  (a generic print-pagination web component and a React-based template
  runtime for `<x-dc>` documents). Neither has any DukeDrop-specific logic;
  neither is vendored into the app. The design's actual business logic (the
  `Component` class body) was hand-ported into `app.js` as plain functions.

The previous pass (`e09097d`, `3be6641`) implemented pricing/copy/memo
correctly but never matched the design's interaction shell. This pass
rewrote `index.html`/`app.js`/`styles.css` from scratch against the
`Component` class. Corrected differences:

| Area | Old app | Design (and new app) |
|---|---|---|
| Service selector | `<select>` dropdown | Segmented tab bar (Express / Pickup / Returns), one button per service |
| Per-service state | One shared set of fields; switching services kept the same dorm/room/qty/tracking values | Each service keeps its own qty/dorm/room/tracking/pay method independently — switching tabs never leaks one service's data into another |
| Field order | Dorm/Room → Quantity → Tracking → (pickup extra) | Quantity (stepper) → Dorm/Room → (pickup source + extra) → Tracking → (consent) |
| Quantity input | Native `<input type=number>` | +/− stepper clamped to 1–50, snaps out-of-range typing back immediately |
| Express banner | None after JS loads (a static placeholder paragraph was overwritten by the generic intro) | Dedicated "Before anything else" dark banner + a copyable drop-off address row, shown only for Express |
| Rate table | No indication of the active tier | Current tier's row is highlighted as qty changes |
| Placeholders | None on any field | `e.g. Randolph`, `e.g. 214`, `e.g. Few Quad`, `e.g. 90123`, `e.g. Bell Tower`, `e.g. 447128`, `e.g. Jane Doe`, `TBA123456789` |
| Field labels | "Mailroom building", "Locker building", "Full name" | "Which mailroom (building)", "Which locker (building)", "Your full name (as it appears on the package)" |
| Consent gate | A "I have sent the consent" checkbox blocked the Pay button | No checkbox exists in the design — consent is a strong two-step prompt ("Step 1 / Step 2"), but Pay is only gated on the actual required fields, never on whether consent was sent |
| Consent extras | No Instagram fallback, no "didn't open" message | The consent button is a plain `sms:` link (no JS click handler needed); a fallback line is always shown below it — "If Messages doesn't open, copy the line above and text ⟨phone⟩", plus a "DM @dukedrop_" Instagram link |
| Payment method | Three radio buttons + one generic "Pay" submit button whose label never changed | Venmo/Zelle/Card segmented tabs; a dedicated pay button per method with a dynamic label ("Pay $X with Venmo", "Enter details to pay", "Enter details to pay with Zelle") |
| Venmo fallback | None | After attempting the deep link, a "Venmo app didn't open? Send $X to @user (profile link)" panel appears |
| Zelle action | A separate "Copy memo" button copied only the bare memo; Zelle radio + submit just showed a status line | Clicking "Pay $X with Zelle" copies the full `$amount to (469) 964-9545 — memo` line and shows it back for manual pasting |
| Missing-fields feedback | None (Pay button just stayed disabled with static text) | "Still need: dorm, room #, …" banner listing exactly what's missing, in the design's field names |
| Memo visibility | Hidden behind "Complete required fields…" until valid | Always visible, with `[Dorm]`/`[Room]`/etc. bracket placeholders for missing fields — copyable at any time |
| Zelle phone display | `469-964-9545` (dashes) everywhere | `(469) 964-9545` (design's `zelleDisplay`) for display; digits-only used for the `sms:` link |
| Legacy S/M/L/carrier fields | `calculateAmount`/`validateOrder`/`buildNote`/`venmoLinks` had a whole second code path keyed by package size + carrier, exercised only by tests, never reachable from the real form | Removed — the design has no package-size/carrier concept, only per-service tiered quantity pricing |

Unchanged because they already matched the design exactly: the per-tier
prices for all three services, the memo construction algorithm (prefix,
dorm/room placeholders, tracking line, pickup mailroom/locker suffix), the
consent sentence text and authorized names, the Venmo deep-link field order,
and the "payment is a handoff, never confirmed here" framing.

## Known gap

A real browser walkthrough (`chrome-devtools-axi`) could not be completed in
this environment: `open`/`page.open()` report success, but every follow-up
call (`snapshot`, `eval`, `screenshot`) fails with
`Required at pageId`, and `pages` always reports 0 open pages — reproduced
across a fresh session, `run` script mode, and headed mode. This looks like
a bridge bug unrelated to this app (filed as feedback). Verification here
relied on: the full `node --test` suite (14 tests covering pricing,
validation, memo/consent construction, and Venmo/Zelle link building for
every service), `npm run build`, and a close manual re-read of the rendered
`app.js` template logic against the design's `Component` class line by
line. A live mobile/desktop visual walkthrough is still worth doing once the
browser tool is working.
