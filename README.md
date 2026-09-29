# DukeDrop

Mobile-friendly order form with Express, Pickup, and Returns service options, each with a Normal size or Big Drop choice. Promo codes are `AUSTIN20` (20% off), `FREEDROP` (100% off for Craven House D, room 214), and `COMPEDROP` (100% off for Pegram, room 210). Orders collect a phone number. Production order storage activates when its Vercel toggle and server credentials are present; the local static server leaves it off. A zero-dollar promo order still follows the existing payment handoff and is marked `payment_started`; payment is never claimed as confirmed automatically.

## Supabase setup

The connected Supabase project (`cyisyclzzjkupsludvqk`) has the SQL in `supabase/schema.sql`, `supabase/tracking-followup.sql`, `supabase/pickup-readiness.sql`, `supabase/carrier-tracking.sql`, and `supabase/shippo-subscriptions.sql` applied. The schema enables RLS. The dashboard uses a shared password checked by server-side API routes; it does not require Supabase Auth accounts.

To finish connecting production:

1. Set Vercel environment variables `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ORDER_STORAGE_ENABLED=true`, and `DASHBOARD_PASSWORD`. Store the service role key and dashboard password as sensitive server-side values. They must never be sent to frontend code. Order storage becomes active only when the toggle and server credentials are present.
2. Deploy. The internal dashboard is at `/dashboard/`. A successful password check creates an eight-hour signed, HttpOnly session cookie; the API uses the service role key only after validating that session.

For a new project or a reset, run `supabase/schema.sql` first and `supabase/tracking-followup.sql` second, then `supabase/pickup-readiness.sql`, `supabase/carrier-tracking.sql`, and `supabase/shippo-subscriptions.sql` in the Supabase SQL Editor. The public order API validates fields and recomputes amounts from server-side pricing and promo rules. The service role key remains server-only.

## Operations dashboard

The dashboard includes active-delivery, payment-review, tracking-follow-up, and completed-order queues. Search and service/status/payment filters combine within each queue. Open an order for contact, destination, locker, tracking, and payment details, then save status changes explicitly. Opening an SMS draft does not mark it sent; use “Mark as sent” after sending the message. Payment review excludes zero-dollar and closed orders.

### Pickup readiness

The Pickup readiness panel shows all services, including Big Drop with its base service, and sorts ready orders first. Filter by readiness/service or search order and shipment details. Carrier `delivered` counts as ready when delivered tracking entries cover every order item. Staff can add/remove tracking numbers and specify how many items each shipment covers. Partial arrivals stay waiting; carrier errors are held for attention. Single-item pickup-style locker orders can also be flagged from their supplied location and code. Returns require staff confirmation that items are packed. Completed/cancelled orders are closed.

Staff readiness overrides and collection notes remain available; payment remains independent. Orders refresh every minute while the dashboard is visible and no detail dialog is open. The API pages through stored orders. Shippo registration, authenticated webhooks, and daily reconciliation are implemented but **live tracking requires a production Shippo API key**. See [carrier tracking setup](docs/carrier-tracking.md) for activation, coverage rules, and retry behavior.

## Tracking follow-up funnel

After Supabase is configured and order storage is enabled, orders without tracking can be queued with a due time 24 hours after checkout. The dashboard can show that queue and offer a prefilled SMS link for staff to send manually. This repository does not send unattended SMS automatically. Before enabling a scheduled Twilio (or other SMS provider) sender, configure the SMS provider and approved messaging/consent language, then add its credentials as server-only environment variables and schedule a sender to select due `pending` rows and mark sent attempts. Never expose provider credentials in the frontend.

## Run and deploy

Requires Node.js 18+. Run `npm test`, then `npm start` and open http://localhost:4173 for local development. Vercel runs `npm run build`, publishing the generated frontend from `dist/`; `api/` functions remain server-side and are not copied into the static output.
