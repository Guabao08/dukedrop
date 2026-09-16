# DukeDrop

Mobile-friendly order form for DukeDrop package delivery, implemented from the
Claude Design project "App redesign requirements" (`DukeDrop.dc.html` /
`DukeDrop-print.dc.html`). Express, Pickup, and Returns are separate tabs,
each with its own remembered fields, tiered per-package pricing, and
service-specific instructions — see `docs/design-comparison.md` for the full
inventory of what the design specifies and how this app implements it.

- **Express** ships to DukeDrop's own address (1610 Valley Creek Dr., Hillsborough, NC
  27278); the Express tab shows a dedicated "before anything else" banner
  with a copyable address.
- **Pickup** is a mailroom box or a 6-digit locker code. Mailroom pickups
  show a "Step 1 · send consent" flow (name + a copy/text-able consent line);
  lockers skip straight to paying. Consent is a strong prompt, not a gate —
  matching the design, sending it does not block payment.
- **Returns** are left at the door; the payment memo (dorm + room) is treated
  as the authorization, so there's no separate consent step.

Payment is a handoff only: Venmo opens a prefilled mobile-safe deep link for
**@Timothymei71** and shows a "didn't open?" fallback with a manual profile
link; Zelle copies the full amount + recipient + memo line to the clipboard
for **(469) 964-9545** and shows the same line to paste manually. Card is
listed as launching soon. The app never confirms, submits, or tracks
payment — it only prepares what the user reviews and sends in their own
payment app.

## Run

Requires Node.js 18+. Run `npm test`, then `npm start` and open
http://localhost:4173. `npm start` remains a local Node development server
only.

## Design source

The authoritative UI/behavior spec lives in the Claude Design project
"App redesign requirements" (imported via the `claude_design` MCP server),
not in this repo. `docs/design-comparison.md` records what was audited and
corrected against it. `support.js` (the design tool's generated React
runtime) and `doc-page.js` (a generic print-pagination web component used
only to render the project's print sheet) are both design-tooling
scaffolding with no DukeDrop-specific logic — neither is vendored into this
app; the domain rules (pricing, memo/consent text, validation) are
hand-ported into `app.js` instead.

## Deploy to Vercel

DukeDrop is a static site. `npm run build` runs the tests and creates `dist/`
containing only `index.html`, `app.js`, and `styles.css`. Vercel is
configured in `vercel.json` with:

- Framework preset: **Other**
- Build command: `npm run build`
- Output directory: `dist`
- Install command: default
- No start command and no Functions

The deployment boundary is intentional: `server.js`, `package.json`, tests,
and development files stay outside the published artifact and cannot be
discovered as production functions. Static hosting serves files at request
time; it does not run the local `start` process.

If the Vercel dashboard has overrides, make them match the settings above
(especially output directory and framework preset), then redeploy with
**Redeploy** and disable **Use existing Build Cache**. Check the
deployment's Build Logs to confirm the `dist/` output.
