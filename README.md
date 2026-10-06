# DukeDrop

Mobile-friendly order form with Express, Pickup, and Returns service options, each with a Normal size or Big Drop choice. Promo codes are `AUSTIN20` (20% off), `FREEDROP` (100% off for Craven House D, room 214), and `COMPEDROP` (100% off for Pegram, room 210). Orders collect a phone number. Production order storage activates when its Vercel toggle and server credentials are present; the local static server leaves it off. A zero-dollar promo order still follows the existing payment handoff and is marked `payment_started`; payment is never claimed as confirmed automatically.

## Supabase setup

The connected Supabase project (`cyisyclzzjkupsludvqk`) has the SQL in `supabase/schema.sql`, `supabase/tracking-followup.sql`, `supabase/pickup-readiness.sql`, `supabase/carrier-tracking.sql`, and `supabase/tracking-subscriptions.sql` applied. Apply `supabase/sms-followup.sql` before deploying the SMS code. The schema enables RLS. The dashboard uses a shared password checked by server-side API routes; it does not require Supabase Auth accounts.

To finish connecting production:

1. Set Vercel environment variables `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ORDER_STORAGE_ENABLED=true`, and `DASHBOARD_PASSWORD`. Store the service role key and dashboard password as sensitive server-side values. They must never be sent to frontend code. Order storage becomes active only when the toggle and server credentials are present.
2. Deploy. The internal dashboard is at `/dashboard/`. A successful password check creates an eight-hour signed, HttpOnly session cookie; the API uses the service role key only after validating that session.

For a new project or a reset, run `supabase/schema.sql` first and `supabase/tracking-followup.sql` second, then `supabase/pickup-readiness.sql`, `supabase/carrier-tracking.sql`, `supabase/tracking-subscriptions.sql`, and `supabase/sms-followup.sql` in the Supabase SQL Editor. The public order API validates fields and recomputes amounts from server-side pricing and promo rules. The service role key remains server-only.

## Operations dashboard

The dashboard opens on a compact overview of confirmed revenue, paid order average, order volume, outstanding active balances, active deliveries, refunds, and package alerts. Tracking shows incoming shipments with carrier status and estimates alongside a collection queue. The Orders page puts date ordered, order name, service, price, and status in a compact table; active, unpaid, follow-up, completed, and repeat queues are selected within that page. Less common filters are under “More filters.” The Creators page shows promo-code usage and confirmed paid revenue by code. It does not estimate creator payouts until code ownership and payout rates are defined, and code attribution alone does not measure views or clicks. The Payments page holds sheet reconciliation details. Open an order for contact, destination, locker, tracking, and payment details, then save status changes explicitly. Orders can be permanently deleted from their detail view after a second confirmation that requires typing the order reference; linked tracking entries are deleted with the order. Opening an SMS draft does not mark it sent; use “Mark as sent” after sending the message. Payment review excludes zero-dollar and closed orders.

### Payment verification and Venmo handoff

Payment verification reads the public sheet and maps columns by header name. Only rows explicitly marked Paid participate; identical duplicate rows are ignored. Automatic matches require the same service, quantity and dorm, plus the same room (or an exact tracking number when a room is missing). The amount and payment method must match unless an exact tracking number or customer/package name also identifies the order; a one-cent round-up is accepted. Strong unique matches copy the sheet's final amount, method and supplied details into the dashboard. Competing matches stay unconfirmed, blank cells do not erase saved details, refunded orders remain refunded, and receipt IDs already linked to another order cannot be reused.

On mobile, Venmo checkout saves the order first, then presents a directly tapped app link. The recipient, exact total and note remain available to copy, with a profile link when app opening or prefilling is unavailable. Opening Venmo does not confirm payment.

### Pickup readiness

The Pickup readiness panel shows all services, including Big Drop with its base service, and sorts ready orders first. Filter by readiness/service or search order and shipment details. Carrier `delivered` counts as ready when delivered tracking entries cover every order item. Staff can add/remove tracking numbers and specify how many items each shipment covers. Partial arrivals stay waiting; carrier errors are held for attention. Single-item pickup-style locker orders can also be flagged from their supplied location and code. Returns require staff confirmation that items are packed. Completed/cancelled orders are closed.

Staff readiness overrides and collection notes remain available; payment remains independent. Orders refresh every minute while the dashboard is visible and no detail dialog is open. The API pages through stored orders. EasyPost tracker registration, authenticated webhooks, and daily reconciliation are implemented; **live tracking requires a production EasyPost API key**. See [carrier tracking setup](docs/carrier-tracking.md) for activation, coverage rules, and retry behavior.

### Payment verification from Google Sheets

The dashboard's **Verify payments** action reads the public CSV view of the configured Google Sheet; no service account or added credentials are needed. Defaults point to the `Orders` tab in the linked sheet. To use a different sheet, set `PAYMENT_SHEET_ID` and `PAYMENT_SHEET_GID` in Vercel. It expects headers `Payment Time`, `Customer`, `Amount`, `Service`, `Package Count`, `Dorm`, `Room`, `Carrier`, `Tracking`, `Pickup Type`, `Pickup Location`, `Pickup Code/Box`, `Package Name`, `Payment Method`, `Status`, and `Email ID`. A match requires exact amount and Venmo/Zelle method, a similarity score of at least 80/100 across the other order fields, and a unique best match in both directions with an eight-point lead over alternatives. The matched row marked `Paid` updates every corresponding sheet-backed order field in the dashboard; ties, weak matches, and rows not marked `Paid` stay in review. The sheet is never modified. `supabase/payment-sheet-sync.sql` adds the payment time, package name, and email ID fields; it has been applied to the connected Supabase project.

## Tracking follow-up funnel

Customers may opt in to one shipping follow-up text on the order form. When staff confirm payment (manually or through sheet reconciliation), the database schedules the text 24 hours later for opted-in, non-return orders. A daily Vercel cron sends due messages through Twilio; including Vercel Hobby's hourly timing window, this is approximately 24–48 hours after confirmation. Amazon orders request a shipping/tracking link; other orders request a tracking number. Both request an estimated delivery date in `YYYY-MM-DD` format. The order reference in each text helps match replies. Twilio replies appear in order details; an ISO date and Amazon HTTPS link are also saved as structured fields. Staff can enter or correct the date/link and add a carrier tracking number. The Tracking page groups carrier and customer estimates by weekday for the next 14 days.

To activate SMS after applying `supabase/sms-followup.sql`, set server-only Vercel variables `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` (E.164), and `TWILIO_WEBHOOK_URL` (the exact public `https://…/api/sms/inbound` URL). Keep `CRON_SECRET` configured. Set the Twilio phone number's incoming-message webhook to that URL with HTTP POST, then redeploy and verify a real opt-in test order and reply. Historical pending rows are cleared by the migration to prevent surprise sends. The sender claims each order before contacting Twilio and never automatically retries a send whose outcome is uncertain; staff can review it in order details. Twilio credentials never reach the browser.

See [Twilio setup](docs/twilio-setup.md) for the Console, registration, environment-variable, deployment, and test sequence.

## Run and deploy

Requires Node.js 18+. Run `npm test`, then `npm start` and open http://localhost:4173 for local development. Vercel runs `npm run build`, publishing the generated frontend from `dist/`; `api/` functions remain server-side and are not copied into the static output.
