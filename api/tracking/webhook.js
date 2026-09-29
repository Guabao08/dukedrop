import { passwordMatches } from '../../lib/dashboard-session.js';
import { saveSnapshot } from '../../lib/carrier-tracking.js';
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const secret = process.env.SHIPPO_WEBHOOK_SECRET;
  if (!secret || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.SUPABASE_URL) return res.status(503).json({ error: 'Tracking is not configured.' });
  // Shippo documents self-generated URL tokens for webhook authentication.
  const token = new URL(req.url, 'https://dukedrop.invalid').searchParams.get('token');
  if (!token || !passwordMatches(token, secret)) return res.status(401).json({ error: 'Unauthorized.' });
  const event = req.body;
  if (!event || typeof event !== 'object') return res.status(400).json({ error: 'Invalid event.' });
  if (event.event !== 'track_updated' || event.test !== false) return res.status(200).json({ ignored: true });
  try {
    await saveSnapshot(event.data);
    return res.status(200).json({ ok: true });
  } catch { return res.status(503).json({ error: 'Tracking update could not be saved.' }); }
}
