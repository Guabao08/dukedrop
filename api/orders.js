import { syncTracking } from '../lib/carrier-tracking.js';
import { checkoutToken, consumeRateLimit } from '../lib/api-security.js';
import publicConfig from '../lib/public-config.js';
import { capturePosthog } from '../lib/posthog.js';
import { flushPosthogLogs, logOrderCreated } from '../lib/posthog-logs.js';
import { isPromoEligible, promoDiscountPercent } from '../promo-rules.js';

const allowedServices = new Set(['express', 'pickup', 'returns', 'bigdrop']);
const allowedBaseServices = new Set(['express', 'pickup', 'returns']);
const tiers = { express: [[2,4.99],[4,3.99],[50,2.99]], pickup: [[2,3.99],[4,2.99],[50,1.99]], returns: [[2,4.99],[4,3.99],[50,2.99]], bigdrop: [[50,12]] };

export function isValidOrder(o) {
  return o && allowedServices.has(o.service) && (!o.baseService || allowedBaseServices.has(o.baseService)) && Number.isInteger(o.quantity) && o.quantity >= 1 && o.quantity <= 50 &&
    String(o.dorm || '').trim() && String(o.room || '').trim() && /^\+?[\d ()-]{7,20}$/.test(String(o.phone || '').trim()) &&
    (o.service === 'returns' || !String(o.tracking || '').trim() || String(o.carrier || '').trim()) &&
    isPromoEligible(o.promoCode, o);
}
export function totalFor(o) {
  const tier = tiers[o.service].find(([max]) => o.quantity <= max);
  const percent = promoDiscountPercent(o.promoCode);
  return Number((tier[1] * o.quantity * (100 - percent) / 100).toFixed(2));
}

export default async function handler(req, res) {
  if (req.method === 'GET') return publicConfig(req, res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (process.env.ORDER_STORAGE_ENABLED !== 'true' || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return res.status(503).json({ error: 'Order storage is not configured' });
  try {
    if (!await consumeRateLimit(req, 'order-create', 5, 600)) return res.status(429).json({ error: 'Too many order attempts. Please wait before trying again.' });
  } catch { return res.status(503).json({ error: 'Order storage is temporarily unavailable.' }); }
  const o = req.body || {};
  if (!isValidOrder(o)) return res.status(400).json({ error: 'Please complete the required order details.' });
  const row = {
    service: o.service, base_service: o.baseService || o.service, order_size: o.orderSize || (o.service === 'bigdrop' ? 'bigdrop' : 'standard'), quantity: o.quantity, dorm: String(o.dorm).trim(), room: String(o.room).trim(),
    phone: String(o.phone).trim(), carrier: o.carrier || null, tracking: o.baseService === 'returns' || o.service === 'returns' ? null : String(o.tracking).trim(),
    retailer: o.retailer === 'amazon' ? 'amazon' : 'other',
    sms_opt_in: o.smsOptIn === true,
    source: o.source || null, mailroom: o.mailroom || null, box_number: o.box || null,
    locker_location: o.lockerLocation || null, locker_code: o.locker || null, recipient_name: o.name || null,
    fulfillment_mode: o.mode || null, promo_code: String(o.promoCode || '').trim().toUpperCase() || null,
    discount_percent: promoDiscountPercent(o.promoCode),
    amount_due: totalFor(o), payment_method: ['venmo','zelle','card'].includes(o.payMethod) ? o.payMethod : null,
    payment_status: 'unconfirmed', order_status: 'payment_started',
  };
  try {
    const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/orders`, {
      method: 'POST', headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(row),
    });
    if (!response.ok) return res.status(502).json({ error: 'Could not save the order.' });
    const [saved] = await response.json();
    try { await syncTracking({ orderId: saved.id }); } catch { /* Order saved; tracking retries independently. */ }
    await capturePosthog('order_created', {
      service: row.service,
      base_service: row.base_service,
      order_size: row.order_size,
      quantity: row.quantity,
      fulfillment_mode: row.fulfillment_mode,
      payment_method: row.payment_method,
      discount_percent: row.discount_percent,
      amount_due: row.amount_due,
    });
    logOrderCreated({ service: row.service, quantity: row.quantity });
    await flushPosthogLogs();
    return res.status(201).json({
      id: saved.id,
      ...(row.payment_method === 'card' ? { checkoutToken: checkoutToken(saved.id) } : {}),
    });
  } catch { return res.status(502).json({ error: 'Could not save the order.' }); }
}
