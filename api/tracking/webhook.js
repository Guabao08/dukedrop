import { createHmac, timingSafeEqual } from 'node:crypto';
import { saveSnapshot } from '../../lib/carrier-tracking.js';
export const config = { api: { bodyParser: false } };

async function readRawBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error('Payload too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function validSignature(req, body, secret) {
  const timestamp = req.headers['x-timestamp'];
  const path = req.headers['x-path'];
  const signature = req.headers['x-hmac-signature-v2'];
  if (typeof timestamp !== 'string' || typeof path !== 'string' || typeof signature !== 'string') return false;
  if (path !== new URL(req.url, 'https://dukedrop.invalid').pathname) return false;
  const sentAt = Date.parse(timestamp);
  if (!Number.isFinite(sentAt) || Date.now() - sentAt > 60_000 || sentAt - Date.now() > 30_000) return false;
  const expected = createHmac('sha256', secret).update(timestamp + req.method.toUpperCase() + path).update(body).digest('hex');
  const received = signature.replace(/^hmac-sha256-hex=/i, '').toLowerCase();
  const expectedBuffer = Buffer.from(expected, 'hex');
  const receivedBuffer = /^[a-f0-9]{64}$/.test(received) ? Buffer.from(received, 'hex') : Buffer.alloc(0);
  return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer);
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const secret = process.env.EASYPOST_WEBHOOK_SECRET;
  if (!secret || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.SUPABASE_URL) return res.status(503).json({ error: 'Tracking is not configured.' });
  let body;
  try { body = await readRawBody(req); } catch { return res.status(413).json({ error: 'Payload too large.' }); }
  if (!validSignature(req, body, secret)) return res.status(401).json({ error: 'Unauthorized.' });
  let event;
  try { event = JSON.parse(body.toString('utf8')); } catch { return res.status(400).json({ error: 'Invalid event.' }); }
  if (event?.object !== 'Event') return res.status(400).json({ error: 'Invalid event.' });
  if (!['tracker.updated','tracker.created'].includes(event.description) || event.mode !== 'production') return res.status(200).json({ ignored: true });
  try { await saveSnapshot(event.result); return res.status(200).json({ ok: true }); }
  catch { return res.status(503).json({ error: 'Tracking update could not be saved.' }); }
}
