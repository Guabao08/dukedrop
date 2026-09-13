# DukeDrop

Mobile-friendly order form for DukeDrop parcel delivery. It calculates service pricing and prepares a Venmo payment handoff to **@Timothymei71**.

## Run

Requires Node.js 18+. Run `npm test`, then `npm start` and open http://localhost:4173.

## Deploy to Vercel

DukeDrop is a static site; it does not need a Vercel Function. The checked-in `vercel.json` makes Vercel run `npm test` as its build command and publish the repository root (`.`), including `index.html`, `app.js`, and `styles.css`. In the Vercel project settings, leave the framework preset as **Other**, set the build command to `npm test` (or use the repository default), and leave the output directory as `.`. No start command or serverless entrypoint is required for deployment; `server.js` remains the local development server.

The original `FUNCTION_INVOCATION_FAILED` could not be correlated with Vercel deployment logs from this repository, because those logs are not available here. Locally, `server.js` is a long-running Node HTTP process, whereas Vercel serves this app as static assets; explicitly selecting the static output avoids treating that process as a function.

Before enabling payment, the form requires dorm name, dorm/room number, package size (S/M/L), quantity, tracking number, and carrier. The Venmo deep link uses Venmo's documented `venmo://paycharge?txn=pay&recipients=...&amount=...&note=...` convention; a browser link and manual-account fallback are shown in the handoff message.

Payment is not completed by DukeDrop: the user must review and submit it in Venmo. Orders cannot be tracked inside this app, and no order/payment completion is claimed.
