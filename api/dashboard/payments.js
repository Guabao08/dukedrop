import { dashboardConfigured, hasDashboardSession } from '../../lib/dashboard-session.js';
import { paymentSheetConfigured, readPaymentSheet } from '../../lib/public-payment-sheet.js';
import { findPaymentMatches, paymentSheetHeaders } from '../../lib/payment-verification.js';

function headers() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

async function loadOrders() {
  const base = `${process.env.SUPABASE_URL}/rest/v1/orders`;
  const url = new URL(base);
  url.searchParams.set('select', 'id,service,base_service,quantity,dorm,room,carrier,tracking,amount_due,payment_method,payment_status');
  url.searchParams.set('order', 'created_at.asc,id.asc');
  const orders = [];
  for (let offset = 0; ; offset += 500) {
    url.searchParams.set('limit', '500');
    url.searchParams.set('offset', String(offset));
    const response = await fetch(url, { headers: headers(), cache: 'no-store', signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error('Could not load orders.');
    const page = await response.json();
    if (!Array.isArray(page)) throw new Error('Could not load orders.');
    orders.push(...page);
    if (page.length < 500) return orders;
  }
}

async function markPaid(ids) {
  const base = `${process.env.SUPABASE_URL}/rest/v1/orders`;
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    const url = new URL(base);
    url.searchParams.set('id', `in.(${batch.join(',')})`);
    url.searchParams.set('payment_status', 'eq.unconfirmed');
    const response = await fetch(url, {
      method: 'PATCH',
      headers: { ...headers(), Prefer: 'return=minimal' },
      body: JSON.stringify({ payment_status: 'paid' }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error('Could not update payment status.');
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed.' });
  if (!dashboardConfigured()) return res.status(503).json({ error: 'Dashboard is not configured.' });
  if (!hasDashboardSession(req, process.env.DASHBOARD_PASSWORD)) return res.status(401).json({ error: 'Sign in required.' });
  if (req.method === 'GET') return res.status(200).json({ configured: paymentSheetConfigured() });
  if (req.body?.action !== 'verify') return res.status(400).json({ error: 'Invalid verification request.' });

  try {
    const values = await readPaymentSheet();
    if (!paymentSheetHeaders(values)) return res.status(422).json({ error: 'The payment sheet columns do not match the expected Orders tab.' });
    const orders = await loadOrders();
    const matches = findPaymentMatches(orders, values);
    await markPaid(matches.confirmedIds);
    return res.status(200).json({
      confirmed: matches.confirmedIds.length,
      ambiguous: matches.ambiguous,
      unpaidRows: matches.unpaidRows,
      unmatched: matches.unmatched,
      confirmedIds: matches.confirmedIds,
    });
  } catch (error) {
    return res.status(502).json({ error: error.message === 'Payment sheet access is not configured.' ? error.message : 'Payment verification could not finish. Check the sheet connection and try again.' });
  }
}
