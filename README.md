# DukeDrop

Mobile-friendly order form with Express, Pickup, and Returns service options, each with a Normal size or Big Drop choice. Promo codes are `AUSTIN20` (20% off), `FREEDROP` (100% off), and `COMPEDROP` (100% off). Orders collect a phone number and are saved when a customer starts payment. A zero-dollar promo order still follows the existing payment handoff and is marked `payment_started`; payment is never claimed as confirmed automatically.

## Supabase setup

1. Create a Supabase project. In SQL Editor, run `supabase/schema.sql`, then `supabase/tracking-followup.sql`.
2. In Supabase Auth, create staff accounts for dashboard users. Authenticated staff can view/update order/payment statuses through RLS.
3. Set Vercel environment variables `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. The service role key is used only by the serverless order endpoint and must never be added to frontend variables.
4. Deploy. The internal dashboard is at `/dashboard/` and requires a Supabase staff sign-in.

The API validates fields and recomputes the amount from server-side pricing and promo rules. Dashboard access uses Supabase Auth; the browser receives only the public anon key. The service role key remains server-only.

## Tracking follow-up funnel

Orders that need a tracking number are queued with a due time 24 hours after checkout. The dashboard shows the queue and offers a prefilled SMS link for staff to send manually; when a customer supplies a tracking number, staff can update the order. This repository does not send unattended SMS automatically. Before enabling a scheduled Twilio (or other SMS provider) sender, configure the SMS provider and approved messaging/consent language, then add its credentials as server-only environment variables and schedule a sender to select due `pending` rows and mark sent attempts. Never expose provider credentials in the frontend.

## Run and deploy

Requires Node.js 18+. Run `npm test`, then `npm start` and open http://localhost:4173 for local development. Vercel runs `npm run build`, publishing the generated frontend from `dist/`; `api/` functions remain server-side and are not copied into the static output.
