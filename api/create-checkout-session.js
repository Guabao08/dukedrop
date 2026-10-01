import Stripe from 'stripe';
import { isValidOrder, totalFor } from './orders.js';
import { promoDiscountPercent } from '../promo-rules.js';
import { capturePosthog } from '../lib/posthog.js';

const API_VERSION = '2026-03-25.dahlia; custom_checkout_payment_form_preview=v1';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PUBLISHABLE_KEY || !process.env.STRIPE_PRICE_ID ||
      process.env.ORDER_STORAGE_ENABLED !== 'true' || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ error: 'Stripe is not configured. Add the server Stripe secret key and Price ID.' });
  }

  const order = { ...req.body?.order, payMethod: 'card' };
  if (!isValidOrder(order)) return res.status(400).json({ error: 'Please complete the required order details.' });

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: API_VERSION });
    const price = await stripe.prices.retrieve(process.env.STRIPE_PRICE_ID);
    if (!price.active || price.currency !== 'usd' || price.recurring || price.unit_amount !== Math.round(totalFor(order) * 100)) {
      return res.status(409).json({ error: 'The configured Stripe Price does not match this order total. Please use Venmo or Zelle.' });
    }
    const session = await stripe.checkout.sessions.create({
      ui_mode: 'form',
      mode: 'payment',
      billing_address_collection: 'auto',
      phone_number_collection: { enabled: false },
      automatic_tax: { enabled: false },
      submit_type: 'auto',
      integration_identifier: 'custom_embedded_web_0001',
      line_items: [{ price: process.env.STRIPE_PRICE_ID || 'price_...', quantity: 1 }],
    });
    if (!session.client_secret) return res.status(502).json({ error: 'Stripe did not return a Checkout client secret.' });
    await capturePosthog('card_checkout_started', {
      service: order.service,
      base_service: order.baseService || order.service,
      order_size: order.orderSize || (order.service === 'bigdrop' ? 'bigdrop' : 'standard'),
      quantity: order.quantity,
      fulfillment_mode: order.mode || null,
      discount_percent: promoDiscountPercent(order.promoCode),
      amount_due: totalFor(order),
    });
    return res.status(200).json({ client_secret: session.client_secret });
  } catch {
    return res.status(502).json({ error: 'Could not create a Stripe Checkout session.' });
  }
}
