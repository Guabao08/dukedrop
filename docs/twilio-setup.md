# DukeDrop Twilio setup

The code is implemented locally. Nothing sends until the database migration,
Twilio sender, server secrets, and production deployment are configured.

## 1. Prepare a Twilio sender

1. Create or upgrade to a paid Twilio account. A trial account cannot register
   a US local number for A2P 10DLC.
2. Buy one SMS-capable US local number. A local number needs an approved A2P
   10DLC Brand and Campaign for application texts to US recipients. Register
   the legal entity in Twilio's Console, create a Messaging Service, add the
   number to its Sender Pool, and register the order-follow-up Campaign. Wait
   until the Campaign **and number** show approved/registered before testing.
   If DukeDrop has an EIN, use Twilio's Standard or Low-Volume Standard path;
   otherwise review its Sole Proprietor path. Do not guess the entity type.
3. In the Campaign form, describe this as one non-marketing order-fulfillment
   follow-up. The opt-in is the unchecked checkbox on the DukeDrop order form.
   Link the public `/privacy.html` and `/terms.html` pages. Supply the actual
   opt-in wording and these two sample texts (replace bracketed fields):

   - `Hi [name], DukeDrop: Order #[order]. Send your tracking number and estimated delivery date (YYYY-MM-DD). Reply STOP to opt out.`
   - `Hi [name], DukeDrop: Order #[order]. Send your Amazon shipping/tracking link and estimated delivery date (YYYY-MM-DD). Reply STOP to opt out.`

Twilio also offers toll-free senders, but those require their own verification
before US/Canada texting. See [A2P 10DLC](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc),
[registration quickstart](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/quickstart),
and [toll-free verification](https://www.twilio.com/docs/messaging/compliance/toll-free/console-onboarding).

## 2. Apply the database migration

In the connected Supabase project's SQL Editor, apply
[`supabase/sms-followup.sql`](../supabase/sms-followup.sql) once, after the
existing order, follow-up, and carrier-tracking migrations. It adds opt-in,
payment-confirmation timing, reply storage, and the atomic send claim. It also
clears old checkout-timed follow-ups so historical orders cannot suddenly be
texted. This changes the production database; review the SQL before applying.

## 3. Add Vercel Production environment variables

| Variable | Value |
| --- | --- |
| `TWILIO_ACCOUNT_SID` | `AC...` from the Twilio Console |
| `TWILIO_AUTH_TOKEN` | Twilio Auth Token (secret) |
| `TWILIO_FROM_NUMBER` | The approved sender, e.g. `+19195550123` |
| `TWILIO_WEBHOOK_URL` | Exact public URL, `https://YOUR-DOMAIN/api/sms/inbound` |

Keep existing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`ORDER_STORAGE_ENABLED=true`, and `CRON_SECRET` configured. Enter secrets in
Vercel Settings → Environment Variables, scoped to Production. Do not put them
in source files or share the Auth Token in chat. Redeploy after changing
variables. See [Twilio credential guidance](https://www.twilio.com/docs/usage/secure-credentials)
and [Vercel environment variables](https://vercel.com/docs/environment-variables).

## 4. Connect incoming texts

In Twilio Console → Phone Numbers → Active Numbers → the sender → Messaging,
set **A message comes in** to **Webhook**, `POST`, using the same exact URL as
`TWILIO_WEBHOOK_URL`. If the associated Messaging Service does not defer to the
number's webhook, set its Integration inbound webhook to that URL with `POST`
instead. The endpoint verifies Twilio's signature and saves replies on the
matched order; it returns empty TwiML, so it does not send a second text.
See [Twilio's incoming-message guide](https://www.twilio.com/docs/messaging/tutorials/how-to-receive-and-reply/node-js)
and [Messaging Service inbound routing](https://www.twilio.com/docs/messaging/services).

## 5. Deploy and test one order

1. Deploy this repository revision to Vercel after applying the migration and
   setting the variables. Confirm the two SMS cron jobs appear in Vercel's
   project settings.
2. Place a test non-return order using your own mobile number, select Amazon
   or Other, and check the SMS consent box. Mark the order paid in the staff
   dashboard. Its follow-up due time should become 24 hours after confirmation.
3. Before opening the sender manually, verify there are **no other due opted-in
   orders**. To test immediately, change only the test order's
   `tracking_followup_due_at` to `now()` in Supabase. Invoke the protected
   `/api/sms/reconcile` route with the `CRON_SECRET` bearer token, or wait for
   the next scheduled run. Do not paste the token into a public URL.
4. Confirm the message arrives. Reply with the requested tracking number/link
   and a `YYYY-MM-DD` date. Refresh the order detail and Tracking schedule.
   Send `HELP` and `STOP` from the test phone to verify Twilio's keyword
   handling; `STOP` should prevent further messages.

Two Vercel crons run daily at 16:00 and 22:00 UTC. Vercel Hobby can invoke
within the scheduled hour, so follow-ups normally leave about 24–43 hours
after the **dashboard's payment confirmation**, not necessarily the payment
app's transaction time. See [Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).
