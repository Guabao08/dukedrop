import Stripe from 'stripe';
import { isPickupUnavailable, PICKUP_UNAVAILABLE_MESSAGE } from '../app.js';
import { totalFor } from './orders.js';
import { capturePosthog } from '../lib/posthog.js';
import { validCheckoutToken } from '../lib/api-security.js';

const API_VERSION = '2026-03-25.dahlia; custom_checkout_payment_form_preview=v1';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PUBLISHABLE_KEY || !process.env.STRIPE_WEBHOOK_SECRET ||
      process.env.ORDER_STORAGE_ENABLED !== 'true' || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ error: 'Stripe is not configured.' });
  }
  const orderId = req.body?.orderId;
  if (typeof orderId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId)) {
    return res.status(400).json({ error: 'Save the order before starting card checkout.' });
  }
  if (!validCheckoutToken(orderId, req.body?.checkoutToken)) return res.status(401).json({ error: 'This order is not authorized for checkout.' });

  try {
    const orderResponse = await fetch(`${process.env.SUPABASE_URL}/rest/v1/orders?id=eq.${orderId}&select=id,service,base_service,order_size,quantity,fulfillment_mode,promo_code,discount_percent,amount_due,payment_method,payment_status`, {
      headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
    });
    if (!orderResponse.ok) return res.status(502).json({ error: 'Could not verify the saved order.' });
    const [order] = await orderResponse.json();
    if (order && isPickupUnavailable({ service: order.service, baseService: order.base_service, mode: order.fulfillment_mode })) {
      return res.status(503).json({ error: PICKUP_UNAVAILABLE_MESSAGE });
    }
    if (!order || order.payment_method !== 'card' || order.payment_status !== 'unconfirmed' || Number(order.amount_due) <= 0) {
      return res.status(409).json({ error: 'This order is not eligible for card checkout.' });
    }
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: API_VERSION });
    const expectedTotal = totalFor({ service: order.service, quantity: order.quantity, promoCode: order.promo_code });
    if (Math.round(Number(order.amount_due) * 100) !== Math.round(expectedTotal * 100)) {
      return res.status(409).json({ error: 'The saved order total could not be verified.' });
    }
    const session = await stripe.checkout.sessions.create({
      ui_mode: 'form',
      mode: 'payment',
      billing_address_collection: 'auto',
      phone_number_collection: { enabled: false },
      automatic_tax: { enabled: false },
      submit_type: 'auto',
      integration_identifier: 'custom_embedded_web_0001',
      client_reference_id: order.id,
      metadata: { order_id: order.id },
      payment_intent_data: { metadata: { order_id: order.id } },
      line_items: [{ price_data: { currency: 'usd', unit_amount: Math.round(expectedTotal * 100), product_data: { name: `DevilDrop ${order.service === 'bigdrop' ? 'Big Drop' : order.service} service`, description: `${order.quantity} package${order.quantity === 1 ? '' : 's'}` } }, quantity: 1 }],
    });
    if (!session.client_secret) return res.status(502).json({ error: 'Stripe did not return a Checkout client secret.' });
    await capturePosthog('card_checkout_started', {
      service: order.service,
      base_service: order.base_service || order.service,
      order_size: order.order_size,
      quantity: order.quantity,
      fulfillment_mode: order.fulfillment_mode || null,
      discount_percent: order.discount_percent,
      amount_due: expectedTotal,
    });
    return res.status(200).json({ client_secret: session.client_secret });
  } catch {
    return res.status(502).json({ error: 'Could not create a Stripe Checkout session.' });
  }
}
