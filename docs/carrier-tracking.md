# Carrier tracking setup

## Production activation

1. Create an EasyPost account and enable its production Tracking API access. Review current tracking charges in the EasyPost dashboard before registering live shipments.
2. Add the production API key to the DukeDrop Vercel project's Production environment as the sensitive variable `EASYPOST_API_KEY`. Never commit it or expose it to the browser.
3. Ensure `EASYPOST_WEBHOOK_SECRET` and `CRON_SECRET` are set to separate random secrets in the same environment. For a new project, generate values of at least 32 random bytes.
4. Redeploy after changing environment variables. Open **Pickup readiness → Sync carrier tracking**. The server registers the production webhook automatically, then registers due shipments. Review per-shipment errors in the order details.
5. Confirm a real carrier update appears in the panel before relying on unattended operation. Test-mode tracker events are deliberately ignored in production.

The default webhook origin is `https://dukedrop-1jej.vercel.app`. Set the server-only `DASHBOARD_ORIGIN` if the production hostname changes. The callback is `/api/tracking/webhook`; it verifies EasyPost's signed raw request using the dedicated `EASYPOST_WEBHOOK_SECRET`, not the dashboard password. The script `scripts/configure-tracking.mjs` can also register the webhook when run in an environment containing the same server secrets. It does not print credentials.

## What happens automatically

- A database trigger seeds one tracking row per comma/newline/semicolon-separated carrier number on a new inbound order. Recognizable number syntax is required; retailer order IDs may need to be replaced by staff.
- New order checkout attempts tracker registration after saving the order. Provider failures do not discard orders. Pending rows retry through dashboard sync or daily reconciliation.
- EasyPost pushes carrier scans to the authenticated webhook, even with the dashboard closed. Updates apply only to registered carrier/number pairs and production-mode events. The database orders updates by carrier scan time and rejects older snapshots so an out-of-order webhook cannot undo a newer scan.
- Dashboard sync handles up to 10 due shipments per call. Open dashboards sync once a minute while visible and without an open order dialog. A row is claimed for 15 minutes before a provider request, failures back off 30 minutes, and successful polling reconciliation is deferred six hours.
- A daily Vercel cron (10:00 UTC scheduling window) handles up to 50 due shipments. This is a fallback for missed events and failed registrations; normal carrier updates arrive through webhooks. Large initial backlogs may require multiple dashboard syncs. Vercel Hobby's daily schedule is not a frequent-polling guarantee.

`tracking_subscriptions` shares a registration across duplicate carrier/number mappings. The integration avoids routine repeated POST registration, but a timeout after EasyPost accepted a registration can still result in a retry and duplicate webhook deliveries. Replayed events are safe to apply. Some carriers restrict standalone tracking or require linked carrier accounts; the dashboard surfaces lookup errors rather than assuming delivery.

## Readiness rules

`Delivered` is sufficient for pickup readiness, as requested. Every order item must be covered by delivered tracking entries. EasyPost needs a tracking number and works best when staff provide a carrier name. Each entry defaults to one item; staff can state that a single tracking number covers multiple items. Too much coverage is held for review. Partial arrival stays waiting. Carrier exceptions and lookup failures are held for attention. The panel shows stored scan state, not an independent physical verification.

Single-item pickup-style locker orders may also be ready based on the submitted location and six-digit pickup code. Returns, including Big Drop returns, require staff confirmation that items are packed for collection; an outgoing return delivery scan is not evidence that the return was ready before collection. Staff readiness overrides take precedence over carrier state. Completed/cancelled orders are closed, and collected orders stay collected. Payment remains independent.

Removing a tracking row removes its local order mapping. It does not cancel EasyPost tracking or reverse any provider charges. Staff can then add a corrected entry. Readiness recalculates from remaining entries.

## Schema

Apply `supabase/carrier-tracking.sql` and then `supabase/tracking-subscriptions.sql` after the existing schema, follow-up, and pickup-readiness migrations. `order_trackers` uses RLS and is inaccessible to anonymous/authenticated clients directly. Dashboard APIs require the signed staff session; only server-side service-role calls and the authenticated webhook write carrier statuses.

## References

- https://docs.easypost.com/docs/trackers
- https://docs.easypost.com/docs/webhooks
- https://docs.easypost.com/docs/webhooks#webhook-signatures
- https://vercel.com/docs/cron-jobs/usage-and-pricing
