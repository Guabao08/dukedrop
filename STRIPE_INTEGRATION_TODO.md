# Stripe Integration Setup

## Values to Replace

Stripe checkout stays unavailable on the storefront until its server and publishable keys and a matching Price are configured.

**Files containing placeholders:**
- [api/create-checkout-session.js](api/create-checkout-session.js)

| Field | Current Value | What to Set |
|-------|--------------|-------------|
| `STRIPE_SECRET_KEY` | Not configured | Set the test secret key for local/test mode and the live secret key in production. Keep it server-only. |
| `STRIPE_PUBLISHABLE_KEY` | Not configured | Set the matching publishable key. This value is returned by `/api/config` for Stripe.js. |
| `STRIPE_PRICE_ID` / `line_items[0].price` | `price_...` | Set a Stripe Price ID whose active USD one-time amount equals the order total. The endpoint checks the amount and refuses mismatches. |
| `mode` | `payment` | This is set for DukeDrop's one-time orders. Change it only if the product becomes recurring. |

**Important pricing limitation:** DukeDrop totals vary by service, quantity, tier, and promo code. One fixed Stripe Price cannot cover every order total. Before enabling card checkout, replace the single `STRIPE_PRICE_ID` lookup with a server-side map of exact totals to Price IDs or create a `price_data` line item from the server-calculated total. Keep the amount check so a checkout can never charge a different amount from the order summary. Zero-dollar orders are saved without Stripe Checkout.

## Configured Parameters

These Checkout Studio values are set in the server Checkout Session request.

**Files containing these parameters:**
- [api/create-checkout-session.js](api/create-checkout-session.js)

| Parameter | Value |
|-----------|-------|
| `ui_mode` | `form` (Stripe Node SDK 23.0.0; SDK 21.0.0 and above use `form`) |
| `mode` | `payment` |
| `billing_address_collection` | `auto` |
| `phone_number_collection.enabled` | `false` |
| `automatic_tax.enabled` | `false` |
| `submit_type` | `auto` |
| `integration_identifier` | `custom_embedded_web_0001` |
| `line_items[0].quantity` | `1` |
| Stripe API version | `2026-03-25.dahlia; custom_checkout_payment_form_preview=v1` |
| Stripe.js beta | `custom_checkout_payment_form_1` |

`payment_method_collection` is omitted because this is a one-time `payment` session; it is only sent for subscription mode per the integration rules.

## Setup and Next Steps

1. In Stripe, use test mode and create the required Price(s). Configure the corresponding `STRIPE_PRICE_ID` value in local `.env` or Vercel project environment variables.
2. Configure `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY` in the same environment. Do not expose the secret key in browser code or commit keys to git. The existing app also needs `ORDER_STORAGE_ENABLED=true` and its Supabase environment variables for card checkout.
3. Restart the local server or redeploy after setting environment variables. `/api/config` reports whether Stripe is ready; the storefront keeps card payments hidden behind the existing Venmo/Zelle options until the required configuration is present.
4. Select **Card** on an order, submit the checkout button, and use Stripe test cards in test mode. For example, `4242 4242 4242 4242` with any future expiry and any CVC succeeds. Use only Stripe's test cards: [Stripe testing](https://docs.stripe.com/testing#cards).
5. The browser creates a Checkout Session, saves the order, mounts Stripe's hosted form, and confirms through the Checkout Form SDK. Orders still need staff payment confirmation in the dashboard; this integration does not add a Stripe webhook or automatically mark orders paid.
6. Before launch, add a signed Stripe webhook to reconcile successful/failed sessions with dashboard order status, and test fulfillment and duplicate submissions. Switch both keys and Price configuration to live mode only after test-mode verification.

## Project Structure

- `api/create-checkout-session.js` creates and validates a one-time Checkout Session and returns its client secret.
- `api/config.js` exposes the publishable key and a readiness flag; it never returns the secret key.
- `app.js` starts the card flow and mounts/confirms the embedded form.
- `index.html` loads Stripe.js directly from `https://js.stripe.com/dahlia/stripe.js`.

## Resources

- [Stripe Support](https://support.stripe.com)
- [Stripe documentation MCP](https://docs.stripe.com/mcp)
- [Stripe Checkout Session API](https://docs.stripe.com/api/checkout/sessions/create)
