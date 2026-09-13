# DukeDrop

Mobile-friendly order form for DukeDrop parcel delivery. Express, Pickup, and Returns have distinct instructions, fields, and tiered per-parcel pricing. Pickup supports mailroom boxes or six-digit lockers; mailroom pickup requires a copied/sent consent statement before payment. Returns are left at the customer's door for repacking and package-center drop-off.

Payment is a handoff only: Venmo opens a prefilled mobile-safe memo for **@Timothymei71**; Zelle displays **469-964-9545**, copies the complete memo, and instructs the user to send payment/request themselves. The app never confirms or submits payment. Card payments are not yet available.

## Run

Requires Node.js 18+. Run `npm test`, then `npm start` and open http://localhost:4173. `npm start` remains a local Node development server only.

## Deploy to Vercel

DukeDrop is a static site. `npm run build` runs the tests and creates `dist/` containing only `index.html`, `app.js`, and `styles.css`. Vercel is configured in `vercel.json` with:

- Framework preset: **Other**
- Build command: `npm run build`
- Output directory: `dist`
- Install command: default
- No start command and no Functions

The deployment boundary is intentional: `server.js`, `package.json`, tests, and development files stay outside the published artifact and cannot be discovered as production functions. Static hosting serves files at request time; it does not run the local `start` process. A successful Vercel deployment/build therefore does not prove that a request-time Function invocation will succeed.

If the Vercel dashboard has overrides, make them match the settings above (especially output directory and framework preset), then redeploy with **Redeploy** and disable **Use existing Build Cache**. Check the deployment's Build Logs to confirm the `dist/` output. Do not add a catch-all rewrite to `server.js` or configure a Node Function for this frontend.

Vercel's [FUNCTION_INVOCATION_FAILED documentation](https://vercel.com/docs/errors/function_invocation_failed) describes a request-time function crash, distinct from a build/deployment failure. The reported `500 INTERNAL_SERVER_ERROR` is consistent with a request being routed to a crashing function, while this repository alone cannot prove the active project's dashboard routing, rewrites, or runtime logs. The request ID (`iad1::jv4r9-1789259225312-9e298ce3da8f`) must be correlated in Vercel logs by a project administrator. Vercel's [build output configuration](https://vercel.com/docs/project-configuration) is the authority for the configured output directory.

Publishing `.` was unsafe because it mixed frontend files with a long-running local server and package metadata, leaving room for project settings or stale configuration to route requests as Functions. The dedicated artifact removes that ambiguity. Valid alternatives are a framework adapter/serverless API (appropriate when dynamic server code is needed, but requiring runtime-safe handlers) or another static host (simpler, but without Vercel's deployment integration). Neither alternative makes a local Node server a valid Vercel Function automatically.

Before enabling payment, the form requires dorm name, dorm/room number, package size (S/M/L), quantity, tracking number, and carrier. Payment is reviewed and submitted in Venmo; it is not completed or tracked in this app.
