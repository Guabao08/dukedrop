import { dashboardConfigured, hasDashboardSession } from '../../lib/dashboard-session.js';

const ORDER_STATUSES = new Set(['payment_started', 'received', 'in_progress', 'completed', 'cancelled']);
const PAYMENT_STATUSES = new Set(['unconfirmed', 'paid', 'refunded']);
const FOLLOWUP_STATUSES = new Set(['not_needed', 'pending', 'sent', 'received', 'skipped']);

function headers() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'PATCH'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
  if (!dashboardConfigured()) return res.status(503).json({ error: 'Dashboard access is not configured.' });
  if (!hasDashboardSession(req, process.env.DASHBOARD_PASSWORD)) return res.status(401).json({ error: 'Sign in required.' });

  const base = `${process.env.SUPABASE_URL}/rest/v1/orders`;
  try {
    if (req.method === 'GET') {
      const url = new URL(base);
      url.searchParams.set('select', '*,order_trackers(*)');
      const orders = [];
      url.searchParams.set('order', 'created_at.desc,id.desc');
      for (let offset = 0; ; offset += 500) {
        url.searchParams.set('limit', '500');
        url.searchParams.set('offset', String(offset));
        const response = await fetch(url, { headers: headers() });
        if (!response.ok) return res.status(502).json({ error: 'Could not load orders.' });
        const page = await response.json();
        orders.push(...page);
        if (page.length < 500) break;
      }
      return res.status(200).json(orders);
    }

    const { id, updates } = req.body || {};
    if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ||
      !updates || typeof updates !== 'object' || Array.isArray(updates)) {
      return res.status(400).json({ error: 'Invalid order update.' });
    }
    const entries = Object.entries(updates);
    if (!entries.length || entries.some(([field, value]) => {
      if (field === 'pickup_readiness') return !['auto', 'waiting', 'ready', 'collected', 'hold'].includes(value);
      if (field === 'pickup_note') return typeof value !== 'string' || value.length > 1000;
      if (field === 'order_status') return !ORDER_STATUSES.has(value);
      if (field === 'payment_status') return !PAYMENT_STATUSES.has(value);
      if (field === 'tracking_followup_status') return !FOLLOWUP_STATUSES.has(value);
      if (field === 'tracking_followup_sent_at') return typeof value !== 'string' || Number.isNaN(Date.parse(value));
      return true;
    })) return res.status(400).json({ error: 'Invalid order update.' });

    const url = new URL(base);
    url.searchParams.set('id', `eq.${id}`);
    const response = await fetch(url, {
      method: 'PATCH', headers: { ...headers(), Prefer: 'return=minimal' }, body: JSON.stringify({ ...updates, ...(('pickup_readiness' in updates || 'pickup_note' in updates) ? { pickup_updated_at: new Date().toISOString() } : {}) }),
    });
    if (!response.ok) return res.status(502).json({ error: 'Could not update the order.' });
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(502).json({ error: 'Could not reach order storage.' });
  }
}
