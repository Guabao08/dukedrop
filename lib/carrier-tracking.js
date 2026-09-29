const STATUS_MAP = {
  unknown: 'unknown', pre_transit: 'pre_transit', in_transit: 'in_transit', out_for_delivery: 'out_for_delivery',
  delivered: 'delivered', available_for_pickup: 'available_for_pickup', return_to_sender: 'return_to_sender',
  failure: 'failure', cancelled: 'cancelled', error: 'error',
};
export const trackingConfigured = () => Boolean(process.env.EASYPOST_API_KEY?.trim() && process.env.EASYPOST_WEBHOOK_SECRET?.trim());

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

export function carrierName(value) {
  const name = String(value || '').trim();
  const normalized = name.toLowerCase();
  const carrier = ({ ups: 'UPS', usps: 'USPS', fedex: 'FedEx', 'federal express': 'FedEx',
    dhl: 'DHLExpress', 'dhl express': 'DHLExpress', 'dhl e-commerce': 'DHLECommerce', 'dhl ecommerce': 'DHLECommerce' })[normalized] || name;
  if (carrier && !/^[a-zA-Z][a-zA-Z0-9]{1,60}$/.test(carrier)) throw new Error('Enter a supported carrier, such as UPS, USPS, FedEx, or DHL Express.');
  return carrier;
}

export async function easyPost(path, body) {
  if (!process.env.EASYPOST_API_KEY) throw new Error('EasyPost production key is not configured.');
  const response = await fetch(`https://api.easypost.com/v2/${path}`, {
    method: body ? 'POST' : 'GET', headers: { Authorization: `Basic ${Buffer.from(`${process.env.EASYPOST_API_KEY}:`).toString('base64')}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(response.status === 401 ? 'EasyPost rejected the API key.' : 'EasyPost could not register or retrieve this shipment. Check the tracking number and carrier account access.');
  return response.json();
}

function trackerId(carrier, code) { return `easypost:${carrier.toLowerCase()}:${code.toUpperCase()}`; }
export function trackerSnapshot(tracker) {
  const id = String(tracker?.id || '');
  const code = String(tracker?.tracking_code || '').toUpperCase();
  const status = STATUS_MAP[String(tracker?.status || '').toLowerCase()];
  if (!/^trk_[a-zA-Z0-9]+$/.test(id) || tracker.object !== 'Tracker' || tracker.mode !== 'production' || !status || !/^[A-Z0-9-]{8,64}$/.test(code) || !Number.isFinite(Date.parse(tracker.updated_at))) {
    throw new Error('Invalid EasyPost production tracking update.');
  }
  return { p_provider_id: id, p_status: status, p_updated_at: new Date(tracker.updated_at).toISOString(), p_estimated_at: Number.isFinite(Date.parse(tracker.est_delivery_date)) ? new Date(tracker.est_delivery_date).toISOString() : null };
}
export async function saveSnapshot(tracker) {
  await storage('rpc/apply_tracker_event', { method: 'POST', body: trackerSnapshot(tracker) });
}

async function trackingRequest(row, carrier) {
  const key = trackerId(carrier, row.tracking_code);
  await storage('tracking_subscriptions?on_conflict=id', { method: 'POST', body: { id: key }, prefer: 'resolution=ignore-duplicates' });
  const [subscription] = await storage(`tracking_subscriptions?id=eq.${encodeURIComponent(key)}`);
  if (subscription.registered && /^trk_/.test(row.provider_id || '')) return easyPost(`trackers/${encodeURIComponent(row.provider_id)}`);
  const claim = await storage(`tracking_subscriptions?id=eq.${encodeURIComponent(key)}&registered=eq.false&next_attempt_at=lte.${encodeURIComponent(new Date().toISOString())}`, {
    method: 'PATCH', body: { next_attempt_at: new Date(Date.now() + 15 * 60000).toISOString() }, prefer: 'return=representation',
  });
  if (!claim?.length) throw new Error('EasyPost tracker registration is in progress. It will retry automatically.');
  if (/^trk_/.test(row.provider_id || '')) {
    await storage(`tracking_subscriptions?id=eq.${encodeURIComponent(key)}`, { method: 'PATCH', body: { registered: true } });
    return easyPost(`trackers/${encodeURIComponent(row.provider_id)}`);
  }
  const tracker = await easyPost('trackers', { tracker: { tracking_code: row.tracking_code, ...(carrier ? { carrier } : {}) } });
  const snapshot = trackerSnapshot(tracker);
  if (snapshot.p_provider_id !== tracker.id || tracker.tracking_code.toUpperCase() !== row.tracking_code.toUpperCase()) throw new Error('EasyPost returned a different tracking number.');
  await storage(`order_trackers?id=eq.${row.id}`, { method: 'PATCH', body: { provider_id: tracker.id } });
  await storage(`tracking_subscriptions?id=eq.${encodeURIComponent(key)}`, { method: 'PATCH', body: { registered: true } });
  return tracker;
}

export async function syncTracker(row) {
  const now = new Date().toISOString();
  const claim = await storage(`order_trackers?id=eq.${row.id}&next_sync_at=lte.${encodeURIComponent(now)}`, {
    method: 'PATCH', body: { next_sync_at: new Date(Date.now() + 15 * 60000).toISOString() }, prefer: 'return=representation',
  });
  if (!claim?.length) return false;
  try {
    if (row.provider_id && !/^trk_/.test(row.provider_id)) await storage(`order_trackers?id=eq.${row.id}`, { method: 'PATCH', body: { provider_id: null } });
    const carrier = carrierName(row.carrier);
    const tracker = await trackingRequest(row, carrier);
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
    const { webhooks = [] } = await easyPost('webhooks');
    const matches = webhooks.some(hook => hook.mode === 'production' && hook.url === url.href && !hook.disabled_at);
    if (!matches) {
      const hook = await easyPost('webhooks', { webhook: { url: url.href, webhook_secret: process.env.EASYPOST_WEBHOOK_SECRET } });
      if (hook.mode !== 'production' || hook.url !== url.href) throw new Error('EasyPost did not activate the production webhook.');
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
