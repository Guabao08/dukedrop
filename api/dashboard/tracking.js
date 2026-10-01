import { dashboardConfigured, hasDashboardSession } from '../../lib/dashboard-session.js';
import { storage, trackingConfigured, syncTracking, carrierName } from '../../lib/carrier-tracking.js';
import { flushPosthog, posthog } from '../../lib/posthog.js';
import { flushPosthogLogs, logTrackingSyncCompleted } from '../../lib/posthog-logs.js';
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET','POST','DELETE'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed.' });
  if (!dashboardConfigured()) return res.status(503).json({ error: 'Dashboard is not configured.' });
  if (!hasDashboardSession(req, process.env.DASHBOARD_PASSWORD)) return res.status(401).json({ error: 'Sign in required.' });
  if (req.method === 'GET') return res.status(200).json({ configured: trackingConfigured() });
  try {
    if (req.method === 'DELETE') {
      if (!uuid(req.body?.id)) return res.status(400).json({ error: 'Invalid tracking record.' });
      await storage(`order_trackers?id=eq.${req.body.id}`, { method: 'DELETE' });
      if (posthog) {
        posthog.capture({ event: 'tracking_record_deleted' });
        await flushPosthog();
      }
      return res.status(200).json({ ok: true });
    }
    if (req.body?.action === 'sync') {
      const result = await syncTracking();
      if (posthog) {
        posthog.capture({ event: 'tracking_sync_completed' });
        await flushPosthog();
      }
      logTrackingSyncCompleted();
      await flushPosthogLogs();
      return res.status(200).json(result);
    }
    const { order_id, tracking_code, carrier = '', items_count = 1 } = req.body || {};
    let carrierToken;
    try { carrierToken = carrierName(carrier); } catch { return res.status(400).json({ error: 'Enter the carrier (UPS, USPS, FedEx, DHL Express, or an EasyPost carrier name).' }); }
    const code = String(tracking_code || '').replace(/\s/g, '').toUpperCase();
    if (!uuid(order_id) || !/^[A-Z0-9-]{8,64}$/.test(code) || typeof carrier !== 'string' || carrier.length > 60 || !Number.isInteger(items_count) || items_count < 1 || items_count > 50) return res.status(400).json({ error: 'Enter a carrier tracking number and a valid item count.' });
    const [order] = await storage(`orders?id=eq.${order_id}&select=id,service,base_service,quantity,order_status`);
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    if (['completed','cancelled'].includes(order.order_status) || order.service === 'returns' || (order.service === 'bigdrop' && order.base_service === 'returns')) return res.status(400).json({ error: 'This order does not need inbound tracking. Use staff pickup confirmation.' });
    const trackers = await storage(`order_trackers?order_id=eq.${order_id}&select=tracking_code,items_count`);
    if (trackers.some(row => row.tracking_code === code)) return res.status(409).json({ error: 'That tracking number is already on this order.' });
    if (trackers.reduce((sum,row) => sum + row.items_count, 0) + items_count > order.quantity) return res.status(400).json({ error: 'Tracking already covers these items. Remove an incorrect entry before replacing it.' });
    await storage('order_trackers', { method: 'POST', body: { order_id, tracking_code: code, carrier: carrierToken, items_count } });
    await storage(`orders?id=eq.${order_id}`, { method: 'PATCH', body: { tracking_followup_status: 'received', tracking_received_at: new Date().toISOString(), tracking_followup_due_at: null } });
    // Save first: a provider outage must not discard the supplied tracking number.
    try { await syncTracking({ orderId: order_id }); } catch { /* queued for the next sync */ }
    if (posthog) {
      posthog.capture({
        event: 'tracking_record_created',
        properties: { carrier: carrierToken, items_count },
      });
      await flushPosthog();
    }
    return res.status(201).json({ ok: true });
  } catch { return res.status(502).json({ error: 'Could not update tracking. Please try again.' }); }
}
