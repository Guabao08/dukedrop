const statusMap = { UNKNOWN: 'unknown', PRE_TRANSIT: 'pre_transit', TRANSIT: 'in_transit', DELIVERED: 'delivered', RETURNED: 'return_to_sender', FAILURE: 'failure' };
export const trackingConfigured = () => Boolean(process.env.SHIPPO_API_KEY?.startsWith('shippo_live_') && process.env.SHIPPO_WEBHOOK_SECRET);
export async function storage(path, { method = 'GET', body, prefer } = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    method, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('Order tracking storage unavailable.');
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
export async function shippo(path, body) {
  if (!process.env.SHIPPO_API_KEY?.startsWith('shippo_live_')) throw new Error('Use a Shippo live API key.');
  const response = await fetch(`https://api.goshippo.com/${path}`, {
    method: body ? 'POST' : 'GET', headers: { Authorization: `ShippoToken ${process.env.SHIPPO_API_KEY}`, 'Content-Type': 'application/json', 'SHIPPO-API-VERSION': '2018-02-08' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error([401,403].includes(response.status) ? 'Shippo did not authorize tracking this shipment. Check that standalone Tracking API access and this carrier are enabled for the account.' : 'Shippo lookup failed. Check the tracking number, carrier, and account access.');
  return response.json();
}
export function carrierName(value) {
  const name = String(value || '').trim().toLowerCase();
  const carrier = ({ 'dhl': 'dhl_express', 'dhl express': 'dhl_express', 'dhl e-commerce': 'dhl_ecommerce', 'dhl ecommerce': 'dhl_ecommerce', 'federal express': 'fedex', 'u.s. postal service': 'usps', 'united states postal service': 'usps' })[name] || name;
  if (!/^[a-z0-9_]{2,60}$/.test(carrier) || carrier === 'shippo') throw new Error('Enter a supported carrier, such as UPS, USPS, FedEx, or DHL Express.');
  return carrier;
}
function providerId(carrier, code) { return `shippo:${carrier}:${code}`; }
export function trackerSnapshot(tracker) {
  const carrier = carrierName(tracker?.carrier);
  const code = String(tracker?.tracking_number || '').toUpperCase();
  const scan = tracker?.tracking_status;
  if (!/^[A-Z0-9-]{8,64}$/.test(code) || tracker.test === true || !scan || !statusMap[scan.status]) throw new Error('Invalid live tracking update.');
  const date = scan.status_date || scan.object_updated || scan.object_created;
  // An unknown, unscanned number must never replace a dated carrier scan.
  if (!Number.isFinite(Date.parse(date)) && scan.status !== 'UNKNOWN') throw new Error('Tracking update is missing its scan time.');
  let status = statusMap[scan.status];
  if (scan.status === 'TRANSIT' && scan.substatus?.code === 'out_for_delivery') status = 'out_for_delivery';
  else if (scan.status === 'TRANSIT' && scan.substatus?.action_required) status = 'failure';
  return { p_provider_id: providerId(carrier, code), p_status: status, p_updated_at: Number.isFinite(Date.parse(date)) ? new Date(date).toISOString() : '1970-01-01T00:00:00.000Z', p_estimated_at: Number.isFinite(Date.parse(tracker.eta)) ? new Date(tracker.eta).toISOString() : null };
}
export async function saveSnapshot(tracker) {
  await storage('rpc/apply_tracker_event', { method: 'POST', body: trackerSnapshot(tracker) });
}
async function trackingRequest(carrier, code) {
  const id = providerId(carrier, code);
  await storage('tracking_subscriptions?on_conflict=id', { method: 'POST', body: { id }, prefer: 'resolution=ignore-duplicates' });
  const [subscription] = await storage(`tracking_subscriptions?id=eq.${encodeURIComponent(id)}`);
  if (subscription.registered) return shippo(`tracks/${encodeURIComponent(carrier)}/${encodeURIComponent(code)}`);
  const claim = await storage(`tracking_subscriptions?id=eq.${encodeURIComponent(id)}&registered=eq.false&next_attempt_at=lte.${encodeURIComponent(new Date().toISOString())}`, {
    method: 'PATCH', body: { next_attempt_at: new Date(Date.now() + 15 * 60000).toISOString() }, prefer: 'return=representation',
  });
  if (!claim?.length) throw new Error('Carrier registration is pending. It will retry automatically.');
  const tracker = await shippo('tracks/', { carrier, tracking_number: code, metadata: 'DukeDrop inbound tracking' });
  await storage(`tracking_subscriptions?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: { registered: true } });
  return tracker;
}
export async function syncTracker(row) {
  const now = new Date().toISOString();
  const claim = await storage(`order_trackers?id=eq.${row.id}&next_sync_at=lte.${encodeURIComponent(now)}`, {
    method: 'PATCH', body: { next_sync_at: new Date(Date.now() + 15 * 60000).toISOString() }, prefer: 'return=representation',
  });
  if (!claim?.length) return false;
  try {
    const carrier = carrierName(row.carrier);
    const id = providerId(carrier, row.tracking_code);
    // Attach the mapping before registration so an immediate webhook can be saved.
    await storage(`order_trackers?id=eq.${row.id}`, { method: 'PATCH', body: { provider_id: id } });
    const tracker = await trackingRequest(carrier, row.tracking_code);
    const snapshot = trackerSnapshot(tracker);
    if (snapshot.p_provider_id !== id) throw new Error('Shippo returned a different shipment.');
    await saveSnapshot(tracker);
    await storage(`order_trackers?id=eq.${row.id}`, { method: 'PATCH', body: { checked_at: new Date().toISOString(), next_sync_at: new Date(Date.now() + 6 * 3600000).toISOString(), sync_error: null } });
    return true;
  } catch (error) {
    await storage(`order_trackers?id=eq.${row.id}`, { method: 'PATCH', body: { checked_at: new Date().toISOString(), sync_error: error.message, next_sync_at: new Date(Date.now() + 30 * 60000).toISOString() } });
    return false;
  }
}
let webhookCheckedAt = 0;
let webhookSetup;
export async function ensureTrackingWebhook() {
  if (Date.now() - webhookCheckedAt < 20 * 60000) return;
  if (webhookSetup) return webhookSetup;
  webhookSetup = (async () => {
    const url = new URL('/api/tracking/webhook', process.env.DASHBOARD_ORIGIN || 'https://dukedrop-1jej.vercel.app');
    if (url.protocol !== 'https:') throw new Error('Tracking webhook requires HTTPS.');
    url.searchParams.set('token', process.env.SHIPPO_WEBHOOK_SECRET);
    let path = 'webhooks/';
    let found = false;
    do {
      const page = await shippo(path);
      if (!Array.isArray(page.results)) throw new Error('Could not read Shippo webhooks.');
      found = page.results.some(hook => hook.is_test === false && hook.event === 'track_updated' && hook.url === url.href && hook.active);
      if (found || !page.next) break;
      const next = new URL(page.next, 'https://api.goshippo.com');
      if (next.origin !== 'https://api.goshippo.com' || !next.pathname.startsWith('/webhooks')) throw new Error('Invalid Shippo pagination.');
      path = next.pathname.slice(1) + next.search;
    } while (path);
    if (!found) {
      // Serialize webhook creation across server instances as well as within this process.
      const setupId = `webhook:${url.origin}`;
      await storage('tracking_subscriptions?on_conflict=id', { method: 'POST', body: { id: setupId }, prefer: 'resolution=ignore-duplicates' });
      const claim = await storage(`tracking_subscriptions?id=eq.${encodeURIComponent(setupId)}&next_attempt_at=lte.${encodeURIComponent(new Date().toISOString())}`, {
        method: 'PATCH', body: { next_attempt_at: new Date(Date.now() + 5 * 60000).toISOString() }, prefer: 'return=representation',
      });
      if (!claim?.length) throw new Error('Shippo webhook setup is already in progress. Retry shortly.');
      const hook = await shippo('webhooks/', { url: url.href, event: 'track_updated', is_test: false });
      if (hook.is_test !== false || !hook.active) throw new Error('Shippo did not activate the production webhook.');
    }
    webhookCheckedAt = Date.now();
  })();
  try { await webhookSetup; } finally { webhookSetup = null; }
}
export async function syncTracking({ orderId, limit = 10 } = {}) {
  if (!trackingConfigured()) return { configured: false, attempted: 0, updated: 0 };
  await ensureTrackingWebhook();
  const params = new URLSearchParams({ select: '*,orders!inner(order_status,pickup_readiness)', 'orders.order_status': 'not.in.(completed,cancelled)', 'orders.pickup_readiness': 'neq.collected', next_sync_at: `lte.${new Date().toISOString()}`, order: 'next_sync_at.asc', limit: String(limit) });
  if (orderId) params.set('order_id', `eq.${orderId}`);
  const rows = await storage(`order_trackers?${params}`);
  const results = await Promise.allSettled(rows.map(syncTracker));
  return { configured: true, attempted: rows.length, updated: results.filter(result => result.status === 'fulfilled' && result.value).length };
}
