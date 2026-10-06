import { createHmac, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

function serviceKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY;
}

export function checkoutToken(orderId) {
  return createHmac('sha256', serviceKey()).update(`dukedrop-checkout:${orderId}`).digest('base64url');
}

export function validCheckoutToken(orderId, candidate) {
  if (typeof candidate !== 'string') return false;
  const actual = Buffer.from(candidate, 'base64url');
  const expected = Buffer.from(checkoutToken(orderId), 'base64url');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function clientIp(req) {
  const candidates = [req.headers?.['x-real-ip'], req.headers?.['x-forwarded-for'], req.socket?.remoteAddress];
  for (const candidate of candidates) {
    const value = String(candidate || '').split(',')[0].trim();
    if (isIP(value)) return value;
  }
  return 'unknown';
}

export async function consumeRateLimit(req, bucket, limit, windowSeconds) {
  const key = createHmac('sha256', serviceKey()).update(`dukedrop-rate:${bucket}:${clientIp(req)}`).digest('hex');
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/consume_api_rate_limit`, {
    method: 'POST',
    headers: { apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_key_hash: key, p_limit: limit, p_window_seconds: windowSeconds }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('Rate limiting is unavailable.');
  return response.json();
}
