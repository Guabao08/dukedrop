# DukeDrop

Mobile-friendly order form with Express, Pickup, and Returns service options, each with a Normal size or Big Drop choice. Promo codes are `AUSTIN20` (20% off), `FREEDROP` (100% off), and `COMPEDROP` (100% off). Orders collect a phone number. Production order storage activates when its Vercel toggle and server credentials are present; the local static server leaves it off. A zero-dollar promo order still follows the existing payment handoff and is marked `payment_started`; payment is never claimed as confirmed automatically.

## Supabase setup

The connected Supabase project (`cyisyclzzjkupsludvqk`) has the SQL in `supabase/schema.sql` and `supabase/tracking-followup.sql` applied. The schema enables RLS, and dashboard access is restricted to Auth users whose admin-managed `app_metadata.role` is `staff`.

To finish connecting production:

1. In Supabase Auth, create each staff account and set its `app_metadata` to `{ "role": "staff" }`. Do not use user-editable `user_metadata` for this authorization claim.
2. Set Vercel environment variables `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `ORDER_STORAGE_ENABLED=true`. The service role key is used only by the serverless order endpoint and must never be added to frontend variables. Order storage becomes active only when the toggle and both server credentials are present.
3. Deploy. The internal dashboard is at `/dashboard/` and requires a Supabase staff sign-in.

For a new project or a reset, run `supabase/schema.sql` first and `supabase/tracking-followup.sql` second in the Supabase SQL Editor. The API validates fields and recomputes amounts from server-side pricing and promo rules. The dashboard receives only the public anon key; the service role key remains server-only.

## Tracking follow-up funnel

After Supabase is configured and order storage is enabled, orders without tracking can be queued with a due time 24 hours after checkout. The dashboard can show that queue and offer a prefilled SMS link for staff to send manually. This repository does not send unattended SMS automatically. Before enabling a scheduled Twilio (or other SMS provider) sender, configure the SMS provider and approved messaging/consent language, then add its credentials as server-only environment variables and schedule a sender to select due `pending` rows and mark sent attempts. Never expose provider credentials in the frontend.

## Run and deploy

Requires Node.js 18+. Run `npm test`, then `npm start` and open http://localhost:4173 for local development. Vercel runs `npm run build`, publishing the generated frontend from `dist/`; `api/` functions remain server-side and are not copied into the static output.
