import Stripe from 'stripe';

async function rawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(503).json({ error: 'Stripe webhook is not configured.' });
  }

  let event;
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    event = stripe.webhooks.constructEvent(await rawBody(req), req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return res.status(400).json({ error: 'Invalid Stripe webhook signature.' });
  }

  if (event.type !== 'checkout.session.completed' && event.type !== 'checkout.session.async_payment_succeeded') {
    return res.status(200).json({ received: true });
  }
  const session = event.data.object;
  if (session.payment_status !== 'paid') return res.status(200).json({ received: true, payment: 'pending' });
  const orderId = session.metadata?.order_id || session.client_reference_id;
  const amount = Number(session.amount_total);
  if (!orderId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId) ||
      !Number.isSafeInteger(amount) || amount < 1 || session.currency !== 'usd') {
    return res.status(400).json({ error: 'Checkout session is missing valid order details.' });
  }

  try {
    const base = `${process.env.SUPABASE_URL}/rest/v1/orders`;
    const headers = {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    };
    const orderResponse = await fetch(`${base}?id=eq.${orderId}&select=id,amount_due,payment_method,payment_status`, { headers });
    if (!orderResponse.ok) return res.status(502).json({ error: 'Could not verify the order.' });
    const [order] = await orderResponse.json();
    if (!order || order.payment_method !== 'card' || Math.round(Number(order.amount_due) * 100) !== amount) {
      return res.status(400).json({ error: 'Checkout amount does not match the saved order.' });
    }
    if (order.payment_status === 'paid') return res.status(200).json({ received: true, payment: 'already_recorded' });
    if (order.payment_status !== 'unconfirmed') return res.status(200).json({ received: true, payment: 'order_not_payable' });
    const update = new URL(base);
    update.searchParams.set('id', `eq.${orderId}`);
    update.searchParams.set('payment_status', 'eq.unconfirmed');
    const response = await fetch(update, { method: 'PATCH', headers, body: JSON.stringify({ payment_status: 'paid', order_status: 'received', payment_time: new Date(event.created * 1000).toISOString() }) });
    if (!response.ok) return res.status(502).json({ error: 'Could not record the payment.' });
    return res.status(200).json({ received: true });
  } catch {
    return res.status(502).json({ error: 'Could not process the payment.' });
  }
}
